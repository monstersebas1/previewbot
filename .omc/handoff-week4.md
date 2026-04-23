# PreviewBot — Week 4 Handoff

## Project
PreviewBot — self-hosted, Docker-isolated PR preview system.
Repo: `C:\Users\deman\previewbot` (GitHub: `monstersebas1/previewbot`)

## What's Built (Weeks 1-3)

**Week 1 — Core pipeline:**
- `src/server.ts` — Express webhook receiver, p-queue build orchestration, cleanup cron
- `src/builder.ts` — git clone, Docker build, security-hardened container run (read-only fs, cap-drop ALL, isolated network)
- `src/github.ts` — HMAC verification, upsert PR comments (building/live/failed/cleaned up)
- `src/nginx.ts` — per-PR nginx config generation + reload
- `src/health.ts` — health check polling against preview containers
- `src/cleanup.ts` — stale preview reaper (checks PR state, 7-day max, Docker prune)
- `src/config.ts` — env-based config with `previewUrl()`, `previewPort()`, `containerName()` helpers

**Week 2 — Audits:**
- `src/lighthouse.ts` — Lighthouse via chrome-launcher, scores + optional production diff
- `src/accessibility.ts` — axe-core via puppeteer, aggregates violations across paths
- `src/audit-types.ts` — shared interfaces for all audit modules
- `src/audit-report.ts` — markdown report generator (score badges, diff tables, violation tables)

**Week 3 — AI Visual Diff (just completed):**
- `src/screenshot.ts` — Puppeteer screenshot capture at 3 viewports (mobile 375x812, tablet 768x1024, desktop 1440x900), JPEG 80% quality, saves to `/var/previewbot/reports/pr-{n}/screenshots/`
- `src/visual-diff.ts` — Claude Vision API (Sonnet) analysis of screenshot pairs. Comparison mode (preview vs production) and single-review mode (preview only). Structured output: category, severity, viewport per change. 90s timeout, graceful skip when no API key or API fails.
- `src/audit-types.ts` updated — `ViewportScreenshot`, `VisualChange`, `VisualDiffResult` interfaces; `visualDiff?` added to `AuditReport`
- `src/audit-report.ts` updated — `renderVisualDiff()` section with severity icons, change table, collapsible full AI analysis
- `src/server.ts` updated — visual diff runs in parallel with Lighthouse + axe-core in `runAudits()`
- `package.json` updated — added `@anthropic-ai/sdk`

**Key patterns across all weeks:**
- All audits use dynamic imports with try/catch — graceful degradation if modules fail
- Each audit has configurable timeout (`AUDIT_TIMEOUT` env, default 120s; visual diff has its own 90s)
- `config.productionUrl` (optional `PRODUCTION_URL` env) enables comparison modes
- PR comments use `<!-- previewbot -->` marker for upsert (no spam)
- Visual diff is fully optional — skips silently when `ANTHROPIC_API_KEY` is not set

## Stack
- Node.js 20, TypeScript, ESM (`"type": "module"`)
- Express 5, p-queue, @octokit/rest, lighthouse, chrome-launcher, puppeteer, @axe-core/puppeteer, @anthropic-ai/sdk
- Docker for preview containers, nginx for routing, PM2 for process management

## Test Coverage
- `tests/lighthouse.test.ts` — 4 tests
- `tests/accessibility.test.ts` — 5 tests
- `tests/audit-report.test.ts` — 9 tests (includes 3 visual diff rendering tests)
- `tests/screenshot.test.ts` — 5 tests (viewport shapes, paths, dimensions)
- `tests/visual-diff.test.ts` — 6 tests (structured output, no-key skip, malformed JSON, API errors)
- `tests/smoke.ts` — integration smoke test
- **Total: 29 tests, all passing**

## What's Next — Week 4 Candidates

### Option A: Dashboard & Reporting UI
- Web dashboard showing all active previews, their audit scores, visual diff summaries
- Historical tracking — score trends across PRs
- Screenshot gallery viewer (images are already saved to disk)
- Could use the existing `/previews` endpoint as data source

### Option B: Multi-Path Auditing
- Currently audits only hit the root URL
- Add configurable path list (`AUDIT_PATHS=/,/about,/pricing`) 
- Run Lighthouse, axe-core, and visual diff across all paths
- Aggregate results per path in the PR comment

### Option C: GitHub Check Runs Integration
- Replace/supplement PR comments with GitHub Check Runs API
- Pass/fail status based on configurable thresholds (e.g., Lighthouse performance < 50 = fail)
- Annotations on specific issues (accessibility violations, visual regressions)
- Block PR merge when critical issues found

### Option D: Cost & Performance Optimization
- Screenshot caching — skip visual diff if no visual files changed (check git diff for CSS/images/HTML)
- Parallel viewport capture (currently sequential per viewport)
- Lighthouse report storage (S3/local) with links in PR comments
- Rate limiting on Claude API calls per repo/hour

### Option E: VPS Deployment & Production Hardening
- PM2 ecosystem config, nginx reverse proxy for PreviewBot itself
- Systemd service, log rotation, monitoring
- SSL cert automation for wildcard `*.preview.domain`
- Secrets management (currently .env based)

## Do NOT Touch (stable modules)
- `src/builder.ts` — Week 1 core
- `src/cleanup.ts` — Week 1 core
- `src/nginx.ts` — Week 1 core
- `src/health.ts` — Week 1 core
