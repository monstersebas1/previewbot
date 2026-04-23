# PreviewBot — Week 3 Handoff: AI Visual Diff

## Project
PreviewBot — self-hosted, Docker-isolated PR preview system.
Repo: `C:\Users\deman\previewbot` (GitHub: `monstersebas1/previewbot`)

## What's Built (Weeks 1-2)

**Week 1 — Core pipeline:**
- `src/server.ts` — Express webhook receiver, p-queue build orchestration, cleanup cron
- `src/builder.ts` — git clone, Docker build, security-hardened container run (read-only fs, cap-drop ALL, isolated network)
- `src/github.ts` — HMAC verification, upsert PR comments (building/live/failed/cleaned up)
- `src/nginx.ts` — per-PR nginx config generation + reload
- `src/health.ts` — health check polling against preview containers
- `src/cleanup.ts` — stale preview reaper (checks PR state, 7-day max, Docker prune)
- `src/config.ts` — env-based config with `previewUrl()`, `previewPort()`, `containerName()` helpers

**Week 2 — Audits (just merged):**
- `src/audit-types.ts` — shared interfaces: `LighthouseResult`, `AxeResult`, `AuditReport`
- `src/lighthouse.ts` — runs Lighthouse via `lighthouse` + `chrome-launcher`, returns scores + optional production diff
- `src/accessibility.ts` — runs axe-core via `puppeteer` + `@axe-core/puppeteer`, aggregates violations across paths
- `src/audit-report.ts` — markdown report generator (score badges, diff tables, violation tables)
- `src/server.ts` updated — `runAudits()` runs Lighthouse + axe-core in parallel after health check, results passed to `commentLive()`
- `src/github.ts` updated — `commentLive()` accepts optional `audit: AuditReport`, appends audit markdown to PR comment

**Key patterns:**
- Audits use dynamic imports with try/catch — graceful degradation if modules fail
- Each audit has a configurable timeout (`AUDIT_TIMEOUT` env, default 120s)
- `config.productionUrl` (optional `PRODUCTION_URL` env) enables Lighthouse diff mode
- PR comments use `<!-- previewbot -->` marker for upsert (no spam)

## Stack
- Node.js 20, TypeScript, ESM (`"type": "module"`)
- Express 5, p-queue, @octokit/rest, lighthouse, chrome-launcher, puppeteer, @axe-core/puppeteer
- Docker for preview containers, nginx for routing, PM2 for process management

## Week 3 Goal: AI Visual Diff

Build a Claude Vision-powered visual comparison system that screenshots the preview and (optionally) production, then generates an AI analysis of visual differences.

### Features to Build

1. **Screenshot capture module** (`src/screenshot.ts`)
   - Use Puppeteer (already installed from Week 2) to capture full-page screenshots
   - Capture preview URL at multiple viewport sizes: mobile (375x812), tablet (768x1024), desktop (1440x900)
   - Optionally capture production URL at same viewports for comparison
   - Save screenshots to `/var/previewbot/reports/pr-{number}/screenshots/`
   - Return structured result with file paths and metadata

2. **AI visual diff module** (`src/visual-diff.ts`)
   - Send screenshot pairs (preview vs production) to Claude Vision API
   - Prompt Claude to identify: layout changes, color changes, missing/added elements, responsive issues, visual regressions
   - Return structured analysis per viewport
   - If no production URL, do single-screenshot review (check for obvious issues: broken layouts, missing images, overflow)
   - Use `ANTHROPIC_API_KEY` from config (already defined in `src/config.ts` as `anthropicApiKey`)
   - Handle API errors gracefully — visual diff is optional, never blocks the preview

3. **Visual diff report section** (`src/audit-report.ts` update)
   - Add `VisualDiffResult` to `src/audit-types.ts`
   - Add visual diff section to the PR comment after Lighthouse and axe-core sections
   - Show: viewport name, summary of changes, severity (info/warning/critical)
   - Collapsible details for full AI analysis

4. **Pipeline integration** (`src/server.ts` update)
   - Add visual diff to `runAudits()` — runs in parallel with Lighthouse and axe-core
   - Add `VisualDiffResult` to `AuditReport` interface

### Interface Design

```typescript
// Add to src/audit-types.ts

export interface ViewportScreenshot {
  viewport: string;
  width: number;
  height: number;
  previewPath: string;
  productionPath?: string;
}

export interface VisualChange {
  category: "layout" | "color" | "content" | "responsive" | "regression" | "improvement";
  severity: "info" | "warning" | "critical";
  description: string;
  viewport: string;
}

export interface VisualDiffResult {
  screenshots: ViewportScreenshot[];
  changes: VisualChange[];
  summary: string;
  hasProductionComparison: boolean;
}

// Update AuditReport:
export interface AuditReport {
  lighthouse?: LighthouseResult;
  axe?: AxeResult;
  visualDiff?: VisualDiffResult;
  timestamp: string;
  previewUrl: string;
  productionUrl?: string;
}
```

### Constraints
- Claude Vision API calls cost money — make them optional (only when `ANTHROPIC_API_KEY` is set)
- Max 3 screenshots per API call to control token usage
- Screenshots should be compressed (JPEG, 80% quality) to reduce API costs
- Total visual diff timeout: 90s
- If Claude API is down or slow, skip gracefully — log warning, return undefined

### Files to Create
- `src/screenshot.ts` — Puppeteer screenshot capture
- `src/visual-diff.ts` — Claude Vision analysis

### Files to Update
- `src/audit-types.ts` — add visual diff interfaces
- `src/audit-report.ts` — add visual diff markdown section
- `src/server.ts` — wire visual diff into `runAudits()`
- `package.json` — add `@anthropic-ai/sdk`

### Do NOT Touch
- `src/builder.ts`, `src/cleanup.ts`, `src/nginx.ts`, `src/health.ts` — Week 1 core, stable
- `src/lighthouse.ts`, `src/accessibility.ts` — Week 2 modules, stable

### Tests
- `tests/screenshot.test.ts` — validate return shape, viewport configs
- `tests/visual-diff.test.ts` — validate structured analysis output with mocked Claude response
- Update `tests/audit-report.test.ts` — add visual diff section rendering tests
