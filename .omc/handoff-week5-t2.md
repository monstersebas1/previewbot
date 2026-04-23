# PreviewBot — Week 5 Terminal 2: Integration Tests & Dogfooding Prep

## Mission
Build real end-to-end integration tests and prepare PreviewBot for its first dogfood run against a live repo. By the end, we have confidence the full pipeline works: webhook → build → deploy → audit → comment.

## Project Context
- Repo: `/c/Users/deman/previewbot` (GitHub: `monstersebas1/previewbot`)
- Stack: Node.js 20, TypeScript, ESM, Express 5, Docker, nginx, PM2
- 66 unit tests passing — all use mocks. Zero integration tests exist.
- The app has never been run against a real GitHub webhook or Docker daemon.

## What Exists
- `src/server.ts` — Express webhook handler, build queue, cleanup cron
- `src/builder.ts` — git clone, Docker build/run with security hardening
- `src/nginx.ts` — per-PR nginx config generation + reload
- `src/health.ts` — health check polling
- `src/github.ts` — HMAC verification, PR comment upsert
- `src/check-runs.ts` — GitHub Check Runs creation/update
- `src/lighthouse.ts` — Lighthouse performance audits
- `src/accessibility.ts` — axe-core accessibility audits
- `src/visual-diff.ts` �� AI-powered visual diff via Claude Vision
- `src/cleanup.ts` — stale preview reaper
- `src/config.ts` — env-based config (see file for all vars)
- `tests/smoke.ts` — exists but unclear state, read it first

## What To Build

### 1. Integration Test Framework
- New directory: `tests/integration/`
- Use vitest but with longer timeouts (builds take minutes)
- Needs: Docker daemon running, network access, real filesystem
- Guard: skip integration tests in CI unless `INTEGRATION=true` env var
- Add `test:integration` script to `package.json`

### 2. Webhook Handler Integration Test (`tests/integration/webhook.test.ts`)
- Start the Express server on a random port
- Send a properly signed webhook payload (use the real HMAC signing logic)
- Verify: response is 202, build is queued
- Test duplicate delivery rejection
- Test invalid signature rejection (401)
- Test invalid PR number rejection (400)
- Test ignored events (non-pull_request)
- No Docker needed — just test the webhook handler + queue

### 3. Docker Build Integration Test (`tests/integration/build.test.ts`)
- Requires Docker daemon
- Create a minimal test repo (temp dir with a simple Dockerfile + node app)
- Call `buildPreview` with the test repo
- Verify: container is running, has correct labels, correct port mapping
- Verify: security hardening (read-only fs, dropped caps, memory limit)
- Call `destroyPreview` — verify container + image removed
- Cleanup: remove temp dir, container, image

### 4. Nginx Integration Test (`tests/integration/nginx.test.ts`)
- Call `createRoute(999)` — verify config file written to a temp nginx dir
- Verify config content: correct server_name, proxy_pass, port
- Call `removeRoute(999)` — verify config file removed
- Mock nginx reload (don't actually reload system nginx)

### 5. Full Pipeline Smoke Test (`tests/integration/pipeline.test.ts`)
- The crown jewel — tests the entire flow
- Create a test GitHub app or use a mock HTTP server that simulates GitHub API
- Send webhook → verify build starts → verify container created → verify nginx config → verify health check → verify PR comment API called → verify Check Run API called
- Use nock or msw to intercept GitHub API calls
- Requires Docker daemon

### 6. Test Fixture: Minimal Preview App
- `tests/fixtures/preview-app/` — tiny Node.js app
- `Dockerfile` + `server.js` that serves "Hello PR" on port 3000
- Health endpoint at `/` returns 200 with `text/html` content-type
- Used by integration tests as the "repo being previewed"

### 7. GitHub Webhook Simulator (`scripts/simulate-webhook.sh`)
- For manual dogfooding — sends a fake webhook to a running PreviewBot
- Takes: PR number, action (opened/closed/synchronize), repo URL
- Computes HMAC signature from GITHUB_WEBHOOK_SECRET
- Sends POST to PreviewBot's webhook endpoint
- Shows response

### 8. Monitoring & Observability
- Add structured JSON logging (replace console.log/error with a logger)
- Include: timestamp, level, prNumber, action, duration
- Add metrics endpoint (`/metrics`) or extend `/health`:
  - Total builds (success/fail counts)
  - Average build time
  - Active containers count
  - Last cleanup run time
  - Queue depth

### 9. Pre-dogfood Checklist Script (`scripts/preflight.sh`)
- Checks all prerequisites before first real run:
  - Docker daemon running
  - `pr-previews` network exists
  - Required env vars set
  - GitHub token has correct scopes (test API call)
  - Webhook secret is non-empty
  - Port 3500 is available
  - Nginx is installed and running
  - Disk space > 5GB
  - Node.js version >= 20

## Coding Standards
- Integration tests use real implementations, mock only external APIs (GitHub)
- Each test cleans up after itself (containers, files, configs)
- Use `afterAll` / `afterEach` for cleanup to handle test failures
- Shell scripts: `set -euo pipefail`

## Test Plan
- `npm test` still runs only unit tests (fast, no Docker needed)
- `npm run test:integration` runs integration tests (needs Docker)
- `scripts/simulate-webhook.sh` successfully triggers a build
- `scripts/preflight.sh` passes on a configured VPS

## Subagent Strategy
Use subagents to parallelize independent work:
1. **Agent A**: Integration test framework setup + webhook handler tests + test fixtures
2. **Agent B**: Docker build integration test + nginx integration test
3. **Agent C**: Full pipeline smoke test (depends on fixtures from Agent A — run after A completes)
4. **Agent D**: Scripts (simulate-webhook, preflight) + structured logging + metrics endpoint
After all complete, run the full test suite to verify nothing broke.
