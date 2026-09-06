# AI Browser Agent V6

Smart, visible browser automation agent built with Node.js, TypeScript, Playwright, Gemini and SQLite for websites and test environments you own or are authorized to automate.

## V6 highlights

- Visible Chromium by default so you can watch the agent work live
- AI planner with per-job memory and task context
- Structured DOM/page observation with required-field and validation metadata
- Deterministic Playwright actions with AI fallback
- Confidence-aware action execution
- Self-healing selector and action recovery
- Loop/stuck watchdog
- SQLite-backed persistent jobs, events, checkpoints and test identities
- Resume/recovery support after process restarts
- Screenshot history for important steps and failures
- Persistent browser profiles
- Smarter verification-code extraction for authorized workflows
- Smart authorized-domain form filling for recognized fields
- One persistent test identity per profile
- Saved email, generated username and generated password per test profile
- Automatic username regeneration when an authorized test site reports that the username is unavailable
- Secure JSON/CSV export of stored test identities
- Pause, resume and stop controls
- Optional dashboard authentication
- Required domain allowlist for automated form workflows
- Sensitive-data redaction in normal API responses

## Test identity memory

For each test profile V6 creates and persists one identity containing:

- email
- first name
- last name
- full name
- username
- generated password
- phone
- birth date
- creation time

The identity is stored in SQLite and reused when a paused or interrupted job resumes. Normal result APIs redact passwords. Credential export is a separate protected endpoint and requires `DASHBOARD_TOKEN`.

## Export

With `DASHBOARD_TOKEN` configured:

- JSON: `GET /api/jobs/<job-id>/export?format=json`
- CSV: `GET /api/jobs/<job-id>/export?format=csv`

Send the same dashboard bearer token used by the UI. Treat exported files as sensitive and keep them private.

## Safety model

The agent is intended only for websites, staging environments and workflows you own or are authorized to automate. `ALLOWED_DOMAINS` is required before an automated form workflow can start. CAPTCHA, anti-bot challenges, identity verification and 2FA/security challenges that require user participation remain manual.

## Setup

1. Install Node.js 22.5 or newer.
2. Clone the repository.
3. Run `npm install`.
4. Install Chromium with `npx playwright install chromium`.
5. Copy `.env.example` to `.env`.
6. Set `GEMINI_API_KEY`.
7. Set `ALLOWED_DOMAINS` to domains you own or are authorized to test.
8. Set a strong `DASHBOARD_TOKEN` if you want credential export.
9. Run `npm run dev` during development or `npm run build` followed by `npm start`.
10. Open `http://localhost:3000`.

### Alpine / Android

Playwright requires a compatible Chromium executable. On Alpine/aarch64, bundled browser availability can vary. If Playwright reports that the executable does not exist, install a Playwright-compatible browser/runtime for the architecture. Visible mode also requires a graphical display environment; a plain terminal alone cannot display Chromium.

## Architecture

`Dashboard -> Job Manager -> SQLite -> Identity Memory -> Planner -> Observer -> DOM + Vision -> Executor -> Validator/Recovery -> Playwright`

V6 focuses on reliability and deterministic handling of known fields. Gemini is reserved for planning, ambiguity, unexpected pages and recovery rather than being asked to guess every normal browser action.
