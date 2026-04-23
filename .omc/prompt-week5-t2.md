# Terminal 2 Prompt — Copy/paste this into a fresh Claude Code session

```
Read the handoff at .omc/handoff-week5-t2.md — it has full context for what to build.

You are building Week 5 of PreviewBot: integration tests, dogfooding scripts, and observability. The app has 66 unit tests (all mocked) but has NEVER been tested against real Docker, real nginx, or real GitHub webhooks. Your job is to add real integration tests and prepare for the first live run.

Split the work into 4 subagents. Agents A and D run in parallel first, then B, then C (which depends on A's fixtures).

**Agent A** (Test Framework + Webhook Tests + Fixtures) — Sonnet:
- Create tests/fixtures/preview-app/ with a minimal Dockerfile + server.js (serves "Hello PR" on port 3000, text/html content-type)
- Set up tests/integration/ directory with vitest config for long timeouts
- Add test:integration script to package.json (only runs when INTEGRATION=true)
- Create tests/integration/webhook.test.ts — start Express on random port, test: valid webhook (202), duplicate delivery, invalid signature (401), invalid PR number (400), ignored events
- Use real HMAC signing from src/github.ts to generate valid signatures

**Agent D** (Scripts + Logging + Metrics) — Sonnet, runs parallel with A:
- Create scripts/simulate-webhook.sh — sends fake webhook with correct HMAC signature, takes PR number + action + repo as args
- Create scripts/preflight.sh — checks Docker, network, env vars, GitHub token scopes, port availability, nginx, disk, Node.js version
- Add structured JSON logging: create src/logger.ts with { timestamp, level, prNumber?, action?, duration? } format
- Replace console.log/error in server.ts, builder.ts, cleanup.ts with the logger
- Extend /health endpoint with: totalBuilds, successCount, failCount, avgBuildTime, activeContainers, lastCleanup, queueDepth

**Agent B** (Docker + Nginx Integration Tests) — Sonnet, after A completes:
- Create tests/integration/build.test.ts — uses the fixture app from Agent A, calls buildPreview, verifies container running with correct labels/ports/security, calls destroyPreview, verifies cleanup
- Create tests/integration/nginx.test.ts — uses a temp dir for nginx configs (not real /etc/nginx), tests createRoute/removeRoute, verifies config content
- All tests clean up containers/files in afterAll

**Agent C** (Full Pipeline Smoke Test) — Sonnet, after A+B complete:
- Create tests/integration/pipeline.test.ts — the crown jewel
- Uses nock or msw to mock GitHub API (comment creation, check runs)
- Sends webhook → verifies full flow: build queued → container created → nginx config written → health check passes → GitHub API called
- Requires Docker daemon + fixtures from Agent A
- Add a 5-minute timeout for this test

After all agents complete:
1. Run npm test — verify 66 unit tests still pass
2. Run npm run test:integration (if Docker is available) or verify tests are properly guarded
3. Verify scripts/preflight.sh is executable and covers all prereqs
4. Verify structured logging compiles and doesn't break existing tests

Commit the result as: "feat: add integration tests and dogfooding scripts (Week 5)"
```
