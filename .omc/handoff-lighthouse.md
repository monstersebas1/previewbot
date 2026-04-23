# Track A: Lighthouse Performance Diff Module — Handoff

## Status: COMPLETE

## What Was Built

### `src/audit-types.ts`
- `LighthouseScores`, `PerformanceDiff`, `LighthouseResult` — shared interfaces
- Also contains `AxeViolation`, `AxeResult`, `AuditReport` (added by Track B)

### `src/lighthouse.ts`
- `runLighthouse(url, productionUrl?, prNumber?)` — main export
- Uses `lighthouse` npm package + `chrome-launcher` for headless Chrome
- Runs against preview URL, optionally diffs against production URL
- Diff metrics: FCP, LCP, TBT, CLS, SI
- Scores are 0-100 integers
- Saves HTML report to `/var/previewbot/reports/pr-{number}/lighthouse.html`
- 120s timeout per run via Promise.race
- Chrome flags: `--headless --no-sandbox --disable-gpu`

### `src/audit-report.ts` (updated)
- Fixed to use new `LighthouseResult` shape (scores as ints, not raw categories)
- Removed stale `LighthouseDiff` import, uses `PerformanceDiff` from audit-types
- `renderLighthouse()` now reads from `scores`, `performanceDiff`, `rawReportUrl`

### `tests/lighthouse.test.ts`
- 3 tests, all passing: score shape, diff shape, metric names
- Mocks lighthouse and chrome-launcher

### Dependencies Added
- `lighthouse` ^13.1.0
- `chrome-launcher` ^1.2.1
- `vitest` ^4.1.5 (dev)

## Integration Notes for Track C
- Import: `import { runLighthouse } from "./lighthouse.js"`
- Call with PR number to get HTML report saved: `runLighthouse(previewUrl(pr), prodUrl, pr)`
- Result shape matches `LighthouseResult` in `audit-types.ts`
- `audit-report.ts` already knows how to render the result into a markdown PR comment section

## Not Touched
- `server.ts`, `github.ts`, `builder.ts` — untouched as specified
- `accessibility.ts` — Track B, has its own type errors (unrelated)
