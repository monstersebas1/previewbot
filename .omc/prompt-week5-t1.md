# Terminal 1 Prompt — Copy/paste this into a fresh Claude Code session

```
Read the handoff at .omc/handoff-week5-t1.md — it has full context for what to build.

You are building Week 5 of PreviewBot: VPS deployment infrastructure. The app is fully built and tested (66 unit tests passing). Your job is to create everything needed to deploy it as a production service on a Hostinger VPS (Ubuntu, nginx, PM2, Docker).

Split the work into 4 parallel subagents using Sonnet:

**Agent A** (PM2 + Build):
- Read tsconfig.json and package.json first
- Add/update build script, start script, dev script in package.json
- Ensure tsconfig.json outputs to dist/ with ESM settings
- Create ecosystem.config.cjs for PM2 (production config)
- Verify: npm run build succeeds

**Agent B** (Install Script + Logrotate):
- Create scripts/install.sh — idempotent, handles Node.js 20, Docker, directory structure, npm ci + build, PM2 setup
- Create scripts/logrotate.conf for /var/log/previewbot/*.log (daily, 14 days, compress)
- Scripts must use set -euo pipefail, no hardcoded domains

**Agent C** (Nginx + SSL + Add Repo):
- Create scripts/nginx-previewbot.conf — reverse proxy template for the management endpoint (port 3500)
- Create scripts/add-repo.sh — creates GitHub webhook for a repo using gh CLI or curl
- Document SSL strategy (Cloudflare wildcard vs certbot) in a comment block in the nginx config

**Agent D** (.env.example):
- Read src/config.ts to get ALL env vars
- Create .env.example with descriptions, types, defaults, required/optional markers
- Group by: required, optional (core), optional (audits), optional (thresholds)

After all 4 agents finish, verify:
1. npm run build succeeds with zero errors
2. All config files reference the same paths/ports
3. install.sh creates every directory that config.ts expects
4. .env.example covers every env var in config.ts

Commit the result as: "feat: add deployment infrastructure (Week 5)"
```
