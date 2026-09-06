# AI Browser Agent V5

Smart, visible browser automation agent built with Node.js, TypeScript, Playwright, Gemini and SQLite.

## V5 highlights

- Visible Chromium by default so you can watch the agent work live
- AI planner with per-job memory and task context
- Structured DOM/page observation instead of relying only on page text
- Deterministic Playwright actions with AI fallback
- Confidence-aware action execution
- Self-healing selector and action recovery
- Loop/stuck watchdog
- SQLite-backed persistent jobs, events and checkpoints
- Resume/recovery support after process restarts
- Screenshot history for important steps and failures
- Live dashboard with job progress and action/event timeline
- Persistent browser profiles
- Smarter verification-code extraction for authorized workflows
- Pause, resume and stop controls
- Responsive dark dashboard
- Optional dashboard authentication and allowed-domain controls
- Sensitive-data redaction and safer upload handling

## Safety model

The agent is intended for websites, test environments and workflows you own or are authorized to automate. CAPTCHA, anti-bot challenges, identity verification and 2FA/security challenges that require user participation remain manual.

## Setup

1. Install Node.js 20+.
2. Clone the repository.
3. Run `npm install`.
4. Install Chromium with `npx playwright install chromium`.
5. Configure the required environment variables.
6. Start the application using the scripts in `package.json`.

### Alpine / Android

Playwright requires a compatible Chromium executable. If Playwright reports that the executable does not exist, install the required browser/runtime for your architecture before starting a job.

## Architecture

`Dashboard -> Job Manager -> SQLite -> Planner/Memory -> Observer -> DOM + Vision -> Executor -> Playwright -> Validator -> Recovery`

V5 focuses on reliability rather than blindly increasing AI calls. Normal browser operations are handled deterministically when possible, while AI reasoning handles planning, ambiguity, unexpected pages and recovery.
