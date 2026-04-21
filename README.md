# PreviewBot

Self-hosted, AI-native PR preview deployments. Free alternative to Vercel previews + Percy + QA Wolf.

Open a pull request → get a live preview URL on your own server. Automatic cleanup when the PR is merged or closed.

## What You Get

- **Live preview URL** for every PR (`pr-42.preview.yourdomain.com`)
- **Docker-isolated builds** — containers can't access host services
- **Security hardened** — read-only filesystem, dropped capabilities, memory/CPU limits
- **Rich PR comments** — live link, build status, updated in place (no spam)
- **Automatic cleanup** — previews removed on PR close + daily stale reaper
- **One-command setup** — install script handles Docker, networking, nginx, PM2

## Architecture

```
GitHub PR Event → Webhook → PreviewBot (Node.js)
                                │
                                ├── Docker build (isolated network)
                                ├── Nginx config generation
                                ├── Health check polling
                                └── PR comment with live URL
```

Each preview runs in a Docker container with:
- 512MB memory limit, 1 CPU, 100 PID limit
- Read-only filesystem with tmpfs /tmp
- Isolated Docker network (no access to host services)
- Secrets via mounted files (not environment variables)

## Quick Start

### 1. Install on your VPS

```bash
curl -fsSL https://raw.githubusercontent.com/monstersebas1/previewbot/main/scripts/install.sh | sudo bash
```

### 2. Set up DNS (Cloudflare)

- Add a wildcard A record: `*.preview.yourdomain.com` → your server IP
- Set SSL mode to "Full"

### 3. Connect a repo

```bash
bash /opt/previewbot/scripts/add-repo.sh your-org/your-repo
```

### 4. Open a PR

PreviewBot will automatically build, deploy, and comment with the live URL.

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub PAT with `admin:repo_hook` and `repo` scope |
| `GITHUB_WEBHOOK_SECRET` | Yes | HMAC secret for webhook verification |
| `PREVIEW_DOMAIN` | Yes | Your preview domain (e.g. `preview.yourdomain.com`) |
| `PORT` | No | PreviewBot port (default: 3500) |
| `CONTAINER_MEMORY` | No | Memory limit per preview (default: 512m) |
| `CONTAINER_CPUS` | No | CPU limit per preview (default: 1) |
| `BUILD_TIMEOUT` | No | Max build time in seconds (default: 600) |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook` | POST | GitHub webhook receiver |
| `/health` | GET | Service health + queue status |
| `/previews` | GET | List active preview containers |

## How It Works

**On PR open/update:**
1. Receive webhook, verify HMAC signature, deduplicate
2. Queue build (concurrency: 1, sequential)
3. Clone PR branch, Docker build with multi-stage Dockerfile
4. Start container with security flags on isolated network
5. Generate nginx config, reload
6. Health check the preview URL
7. Comment on PR with live link

**On PR close/merge:**
1. Stop and remove Docker container
2. Remove nginx config, reload
3. Delete secrets and deploy directory
4. Update PR comment: "Cleaned up"

**Every 6 hours:**
- Check all running previews against GitHub API
- Remove previews for closed/merged PRs
- Kill anything older than 7 days
- Prune Docker images and build cache

## Requirements

- Linux VPS (Ubuntu/Debian recommended)
- Docker
- Node.js 20+
- Nginx
- Domain with Cloudflare DNS (for wildcard SSL)

## Roadmap

- [ ] Lighthouse performance diff (preview vs production)
- [ ] axe-core accessibility audit
- [ ] AI visual diff (Claude Vision)
- [ ] AI code + visual review
- [ ] Web dashboard for non-technical stakeholders
- [ ] GitHub App (auto-discover repos)
- [ ] QR code in PR comment for mobile testing

## License

MIT
