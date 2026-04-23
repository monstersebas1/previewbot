# PreviewBot — Week 5 Terminal 1: VPS Deployment & Infrastructure

## Mission
Get PreviewBot running on the Hostinger VPS (187.124.77.142) as a production service. By the end, `*.preview.yourdomain.com` routes live traffic to preview containers.

## Project Context
- Repo: `/c/Users/deman/previewbot` (GitHub: `monstersebas1/previewbot`)
- Stack: Node.js 20, TypeScript, ESM, Express 5, Docker, nginx, PM2
- VPS: Hostinger, Ubuntu, nginx already installed, PM2 available
- The app is fully built and tested (66 tests, 0 failures) — this terminal is purely infrastructure

## What Exists
- `src/server.ts` — Express app listening on `config.port` (default 3500)
- `src/config.ts` — all config via env vars, see required: `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `PREVIEW_DOMAIN`
- `src/nginx.ts` — generates per-PR nginx configs in `config.nginxConfDir` (default `/etc/nginx/conf.d`)
- `src/builder.ts` — Docker builds, needs Docker daemon + `pr-previews` network
- `src/cleanup.ts` — stale preview reaper (PR state check + 7-day age)
- README has a Quick Start section with manual steps

## What To Build

### 1. PM2 Ecosystem Config (`ecosystem.config.cjs`)
- Node.js 20, ESM app entry: `dist/server.js` (needs TypeScript build step)
- Set `NODE_ENV=production`
- Load `.env` from `/opt/previewbot/.env`
- Restart policy: exponential backoff, max 10 restarts
- Log files: `/var/log/previewbot/app.log`, `/var/log/previewbot/error.log`
- Watch: false (use PM2 deploy or git pull + restart)

### 2. TypeScript Build
- Add `build` script to package.json: `tsc`
- Ensure `tsconfig.json` has `outDir: "dist"`, `rootDir: "src"`, `declaration: true`
- Add `start` script: `node dist/server.js`
- Read the existing `tsconfig.json` first — may already have this

### 3. Install Script (`scripts/install.sh`)
- Create `/opt/previewbot/` directory structure
- Install Node.js 20 if not present
- Install Docker if not present
- Create `pr-previews` Docker network if not exists
- Create directories: `/var/previewbot/{deploys,secrets,reports}`, `/var/log/previewbot/`
- Clone repo to `/opt/previewbot/app`
- `npm ci && npm run build`
- Copy `.env.example` to `.env` (prompt user to fill in)
- PM2 start + save + startup

### 4. Nginx Reverse Proxy for PreviewBot Itself
- Config at `/etc/nginx/sites-available/previewbot` (not conf.d — that's for previews)
- Listen 443 SSL for `previewbot.yourdomain.com` (management endpoint)
- Proxy to `127.0.0.1:3500`
- Also handle webhook endpoint on a public URL
- Use certbot for SSL or assume Cloudflare (check existing nginx setup)

### 5. Wildcard SSL for Preview Domains
- `*.preview.yourdomain.com` needs TLS
- If Cloudflare: SSL mode "Full", wildcard handled by Cloudflare proxy
- If direct: certbot wildcard cert via DNS challenge
- Generate a config template that the install script uses

### 6. `.env.example`
- Document every env var from `config.ts` with descriptions and example values
- Mark required vs optional
- Include sensible defaults

### 7. Add Repo Script (`scripts/add-repo.sh`)
- Takes `owner/repo` as argument
- Creates GitHub webhook pointing to PreviewBot's public URL
- Sets the webhook secret
- Uses `gh` CLI or curl to GitHub API
- Validates the webhook was created

### 8. Logrotate Config
- Rotate `/var/log/previewbot/*.log` daily, keep 14 days, compress

## Coding Standards
- Shell scripts: `set -euo pipefail`, quote all variables, use `${VAR}` not `$VAR`
- No hardcoded IPs or domains in scripts — read from .env or arguments
- Scripts should be idempotent (safe to run twice)

## Test Plan
- `npm run build` succeeds with zero errors
- `scripts/install.sh` runs cleanly on a fresh Ubuntu 22.04
- PM2 starts the app, logs appear in `/var/log/previewbot/`
- `/health` endpoint responds via the nginx proxy
- `scripts/add-repo.sh owner/repo` creates the webhook

## Subagent Strategy
Use subagents to parallelize independent work:
1. **Agent A**: PM2 config + build scripts + package.json updates
2. **Agent B**: Install script + directory structure + logrotate
3. **Agent C**: Nginx reverse proxy config + SSL + add-repo script
4. **Agent D**: `.env.example` with full documentation
After all complete, integration test: verify build works, configs are consistent.
