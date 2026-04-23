# Track B: axe-core Accessibility Audit Module

## Project
PreviewBot — self-hosted PR preview system at `C:\Users\deman\previewbot`
Week 2 feature: Accessibility auditing with axe-core

## What Exists
- Full Week 1 core: webhook receiver, Docker builder, nginx, health checks, PR comments
- Source in `src/`, builds with `tsc`, runs as ESM (`"type": "module"`)
- Config in `src/config.ts` — has `previewUrl(prNumber)` helper
- Express 5, p-queue, @octokit/rest already installed

## Your Task
Create `src/accessibility.ts` — a module that:

1. Launches headless Chrome via Puppeteer
2. Navigates to preview URL
3. Injects and runs axe-core
4. Parses results into structured `AxeResult`
5. Handles timeouts (max 60s per page)
6. Supports scanning multiple paths (/, /about, etc.) with a configurable page list
7. Aggregates violations across pages (deduplicated by rule ID, sum node counts)

## Interface Contract (src/audit-types.ts)

Shared types for all audit modules.

## Key Decisions
- Use puppeteer (not puppeteer-core) for bundled Chrome
- Use @axe-core/puppeteer for clean integration
- Sort violations by impact: critical > serious > moderate > minor
- Default scan paths: just / unless configured otherwise
- Return empty result (0 violations, 0 passes) on timeout — don't throw

## Files Touched
- CREATE or UPDATE: src/audit-types.ts
- CREATE: src/accessibility.ts
- UPDATE: package.json (add puppeteer, @axe-core/puppeteer)

## Do NOT Touch
- src/server.ts, src/github.ts, src/builder.ts — Track C handles integration
