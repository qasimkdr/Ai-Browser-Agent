import { chromium, Page } from "playwright";
import fs from "node:fs/promises";

export type GmailCredential = { email: string; password: string };

type OtpCandidate = {
  code: string;
  score: number;
  context: string;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function scoreOtpCandidates(text: string, fromHint?: string): OtpCandidate[] {
  const normalized = text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const matches = [...normalized.matchAll(/\b\d{4,8}\b/g)];
  const hostTokens = (fromHint || "")
    .toLowerCase()
    .replace(/^www\./, "")
    .split(/[.\-_]/)
    .filter(x => x.length >= 3);

  const candidates: OtpCandidate[] = [];

  for (const match of matches) {
    const code = match[0];
    if (/^20\d{2}$/.test(code)) continue;
    if (/^(.)\1+$/.test(code)) continue;

    const index = match.index || 0;
    const before = normalized.slice(Math.max(0, index - 120), index);
    const after = normalized.slice(index + code.length, index + code.length + 100);
    const context = `${before} ${code} ${after}`;
    const lower = context.toLowerCase();

    let score = 0;
    if (/verification\s*(?:code|number)?|verify\s*(?:your|this)?\s*(?:email|account)?/i.test(context)) score += 45;
    if (/one[- ]time\s*(?:password|code)|\botp\b/i.test(context)) score += 42;
    if (/security\s*code|confirmation\s*code|confirm(?:ation)?\s*code/i.test(context)) score += 38;
    if (/enter|use|type|copy/i.test(before.slice(-55))) score += 12;
    if (/expires?|valid for|minutes?|do not share|don'?t share/i.test(context)) score += 9;
    if (code.length === 6) score += 14;
    else if (code.length === 4 || code.length === 8) score += 8;
    else score += 3;
    if (hostTokens.some(token => lower.includes(token))) score += 18;
    if (/unsubscribe|order|invoice|price|total|phone|zip|postal|year/i.test(context)) score -= 18;

    candidates.push({ code, score, context: context.slice(0, 280) });
  }

  const bestByCode = new Map<string, OtpCandidate>();
  for (const candidate of candidates) {
    const current = bestByCode.get(candidate.code);
    if (!current || candidate.score > current.score) bestByCode.set(candidate.code, candidate);
  }

  return [...bestByCode.values()].sort((a, b) => b.score - a.score);
}

async function gmailReady(page: Page) {
  return page.locator('input[placeholder*="Search mail"],input[aria-label*="Search mail"]').first().isVisible().catch(() => false);
}

export async function openGmail(
  cred: GmailCredential,
  profileDir: string,
  onStatus: (s: string) => void,
  show = true
) {
  await fs.mkdir(profileDir, { recursive: true });

  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: !show,
    viewport: { width: 1365, height: 900 },
    slowMo: Number(process.env.BROWSER_SLOW_MO || 80)
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto("https://mail.google.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  onStatus(`Gmail: ${cred.email}`);

  const emailBox = page.locator('input[type="email"]').first();
  if (await emailBox.isVisible().catch(() => false)) {
    await emailBox.fill(cred.email);
    await page.getByText("Next", { exact: true }).click().catch(() => {});
    await page.waitForTimeout(1200);
  }

  const passwordBox = page.locator('input[type="password"]').first();
  if (await passwordBox.isVisible({ timeout: 5000 }).catch(() => false)) {
    await passwordBox.fill(cred.password);
    await page.getByText("Next", { exact: true }).click().catch(() => {});
  }

  for (let i = 0; i < 20; i++) {
    if (await gmailReady(page)) break;
    await page.waitForTimeout(700);
  }

  return { ctx, page };
}

async function runSearch(page: Page, query: string) {
  const search = page.locator('input[placeholder*="Search mail"],input[aria-label*="Search mail"]').first();
  if (!await search.isVisible().catch(() => false)) return false;
  await search.fill(query);
  await search.press("Enter");
  await page.waitForTimeout(1600);
  return true;
}

async function extractOtpFromCurrentView(page: Page, fromHint?: string) {
  const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 70000);
  const ranked = scoreOtpCandidates(body, fromHint);
  const best = ranked[0];
  if (!best || best.score < 20) return null;
  return best;
}

async function openLikelyMessage(page: Page, fromHint?: string) {
  const rows = page.locator('tr[role="main"],tr,div[role="main"] table tr');
  const count = Math.min(await rows.count().catch(() => 0), 12);
  const hostTokens = (fromHint || "").toLowerCase().split(/[.\-_]/).filter(x => x.length >= 3);

  let bestIndex = -1;
  let bestScore = -999;

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = (await row.innerText().catch(() => "")).trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    let score = 0;
    if (/verification|verify|security code|confirmation|confirm|one[- ]time|\botp\b/i.test(text)) score += 40;
    if (hostTokens.some(token => lower.includes(token))) score += 25;
    if (/minute|just now|new|unread/i.test(text)) score += 8;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0 && bestScore >= 20) {
    await rows.nth(bestIndex).click().catch(() => {});
    await page.waitForTimeout(900);
    return true;
  }
  return false;
}

export async function findOtp(
  page: Page,
  fromHint?: string,
  options?: { timeoutMs?: number; pollMs?: number; notBeforeMs?: number }
) {
  const timeoutMs = options?.timeoutMs ?? Number(process.env.OTP_TIMEOUT_MS || 90000);
  const pollMs = options?.pollMs ?? Number(process.env.OTP_POLL_MS || 5000);
  const notBeforeMs = options?.notBeforeMs ?? Date.now() - 5 * 60_000;
  const started = Date.now();
  let attempt = 0;

  while (Date.now() - started < timeoutMs) {
    attempt++;
    const ageMinutes = Math.max(1, Math.ceil((Date.now() - notBeforeMs) / 60_000) + 1);
    const queries = [
      fromHint ? `newer_than:${Math.min(ageMinutes, 30)}m ${fromHint}` : `newer_than:${Math.min(ageMinutes, 30)}m`,
      fromHint ? `newer_than:1h (${fromHint})` : "newer_than:1h"
    ];

    for (const query of queries) {
      if (!await runSearch(page, query)) return null;

      let candidate = await extractOtpFromCurrentView(page, fromHint);
      if (candidate && candidate.score >= 55) {
        return { code: candidate.code, score: candidate.score, attempt };
      }

      const opened = await openLikelyMessage(page, fromHint);
      if (opened) {
        candidate = await extractOtpFromCurrentView(page, fromHint);
        if (candidate && candidate.score >= 35) {
          return { code: candidate.code, score: candidate.score, attempt };
        }
      }
    }

    await sleep(pollMs);
    await page.goto("https://mail.google.com/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  }

  return null;
}
