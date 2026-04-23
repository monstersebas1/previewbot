# PreviewBot Testing Handoff

## Branch: `feat/github-app`

## What Was Done (Phase 1)

**Legacy PAT mode verified** — all code paths traced and confirmed backward compatible.

**Code review fixes applied** (commit `a5f0ecf`):

| Severity | Fix |
|---|---|
| CRITICAL | XSS in `/setup` — `installation_id` query param now sanitized via `escapeHtml()` |
| HIGH | Cleanup handler reordered: `destroyPreview` + `removeRoute` run before `resolveOctokit` so auth failures don't leave ghost containers |
| HIGH | Build handler catch: best-effort cleanup of container, route, and build record on unexpected errors |
| MEDIUM | Build catch now reports actual elapsed time instead of `0` |

**Tests:** 90/90 passing

---

## What's Next (Phase 2): Test GitHub App Mode

### Goal
Verify the GitHub App authentication path works end-to-end — installation events, per-installation tokens, webhook processing with `installation.id` in the payload.

### Key Files
- `src/github-app.ts` — `isAppMode()`, `getInstallationOctokit()`, `getInstallationToken()`, `resolveOctokit()`, `resolveCloneToken()`
- `src/db.ts` — `saveInstallation()`, `getInstallationForRepo()`, installation_repos table
- `src/server.ts` — `handleInstallationEvent()`, `handleInstallationReposEvent()`, webhook handler uses `payload.installation?.id`
- `tests/github-app.test.ts` — existing unit tests (PAT path only, app path not yet tested)
- `tests/installation-events.test.ts` — installation event handler tests
- `tests/db.test.ts` — DB CRUD tests

### What to Test

1. **Unit tests for app-mode path in `github-app.ts`:**
   - `isAppMode()` returns `true` when both `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PATH` are set
   - `resolveOctokit(installationId)` calls `getInstallationOctokit` when in app mode
   - `resolveOctokit(undefined)` throws `"Installation ID required in app mode"` when in app mode
   - `resolveCloneToken(installationId)` calls `getInstallationToken` when in app mode
   - `resolveCloneToken(undefined)` falls back to PAT even in app mode (current behavior — verify this is intentional or fix)

2. **Integration-style tests for the webhook flow:**
   - Webhook with `installation.id` in payload → `resolveOctokit` gets installation-scoped token
   - Webhook without `installation.id` but repo in DB → `getInstallationForRepo` resolves it
   - Webhook without `installation.id` and repo NOT in DB → throws in app mode (no PAT fallback)

3. **Installation lifecycle:**
   - `installation.created` event → saves to DB with repos
   - `installation.deleted` event → removes from DB (cascade deletes repos)
   - `installation_repositories.added` → adds repos to existing installation
   - `installation_repositories.removed` → removes repos from existing installation
   - (These are already tested in `tests/installation-events.test.ts` — verify coverage is sufficient)

4. **Edge cases:**
   - App mode with expired/invalid private key → graceful error
   - `resolveCloneToken` in app mode with no installationId → returns empty `config.githubToken` (potential silent auth failure for private repos)
   - Cleanup of containers created by app-mode builds → `preview.installation` label parsed correctly

### Potential Issues to Watch

- `resolveCloneToken(undefined)` in app mode returns `config.githubToken` which is likely `""` — this would silently fail private repo clones instead of throwing. Consider whether this should throw like `resolveOctokit` does.
- The `/setup` page callback URL needs to match whatever is configured in the GitHub App settings.
- Check Runs require app-level permissions — with `CHECK_RUNS_ENABLED=true` in app mode, verify the installation token has the `checks:write` permission.

---

## Prompt for New Chat

```
I'm on branch `feat/github-app` in the previewbot repo. Read HANDOFF.md for full context.

Phase 1 (legacy PAT mode verification + code review fixes) is done. Start Phase 2: test the GitHub App mode paths. The handoff doc lists exactly what to test. Run existing tests first, then add missing coverage for the app-mode code paths in github-app.ts and the webhook flow.
```
