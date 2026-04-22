#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# PreviewBot — idempotent install script
# Usage: sudo bash scripts/install.sh
# No hardcoded domains or IPs — all config lives in .env
# ---------------------------------------------------------------------------

APP_DIR="/opt/previewbot/app"

# ── 1. Root check ────────────────────────────────────────────────────────────
if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: This script must be run as root. Try: sudo bash scripts/install.sh" >&2
  exit 1
fi

echo "========================================="
echo "  PreviewBot Installer"
echo "========================================="
echo ""

# ── 2. Directory structure ───────────────────────────────────────────────────
echo "==> Creating directory structure"

install -d -m 755 "${APP_DIR}"
install -d -m 755 "/var/previewbot/deploys"
install -d -m 700 "/var/previewbot/secrets"
install -d -m 755 "/var/previewbot/reports"
install -d -m 755 "/var/log/previewbot"

echo "    ${APP_DIR}              OK"
echo "    /var/previewbot/deploys        OK"
echo "    /var/previewbot/secrets  (700) OK"
echo "    /var/previewbot/reports        OK"
echo "    /var/log/previewbot/           OK"

# ── 3. Node.js 20 ────────────────────────────────────────────────────────────
echo "==> Checking Node.js version"

NODE_MAJOR=""
if command -v node &>/dev/null; then
  NODE_MAJOR="$(node --version | sed 's/v\([0-9]*\).*/\1/')"
fi

if [[ "${NODE_MAJOR}" != "20" ]]; then
  echo "    Node.js v20 not found (found: ${NODE_MAJOR:-none}). Installing via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "    Node.js $(node --version) installed"
else
  echo "    Node.js $(node --version) already present — skipping"
fi

# ── 4. Docker ────────────────────────────────────────────────────────────────
echo "==> Checking Docker"

if ! command -v docker &>/dev/null; then
  echo "    Docker not found. Installing via official script..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  echo "    Docker $(docker --version) installed"
else
  echo "    Docker already present — skipping"
fi

# ── 5. Docker network ────────────────────────────────────────────────────────
echo "==> Ensuring Docker network 'pr-previews' exists"
docker network create pr-previews 2>/dev/null || true
echo "    Network 'pr-previews' OK"

# ── 6. Repo check ────────────────────────────────────────────────────────────
if [[ ! -f "${APP_DIR}/package.json" ]]; then
  echo "" >&2
  echo "WARNING: No package.json found at ${APP_DIR}." >&2
  echo "         Clone the PreviewBot repository there first, then re-run this script." >&2
  echo "         Example: git clone <your-repo-url> ${APP_DIR}" >&2
  echo "" >&2
  exit 1
fi

# ── 7. npm install + build ───────────────────────────────────────────────────
echo "==> Installing dependencies and building"
cd "${APP_DIR}"
npm ci
npm run build
npm prune --omit=dev
echo "    Build complete"

# ── 8. .env setup ────────────────────────────────────────────────────────────
echo "==> Checking .env"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  if [[ -f "${APP_DIR}/.env.example" ]]; then
    cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
    chmod 600 "${APP_DIR}/.env"
    echo "" >&2
    echo "WARNING: .env was not found. Copied .env.example to .env." >&2
    echo "         IMPORTANT: Edit ${APP_DIR}/.env and fill in all required values before starting." >&2
    echo "" >&2
  else
    echo "WARNING: Neither .env nor .env.example found at ${APP_DIR}. Create .env before starting." >&2
  fi
else
  echo "    .env already exists — skipping"
fi

# ── 9. PM2 ───────────────────────────────────────────────────────────────────
echo "==> Checking PM2"

if ! command -v pm2 &>/dev/null; then
  echo "    PM2 not found. Installing globally..."
  npm install -g pm2
  echo "    PM2 $(pm2 --version) installed"
else
  echo "    PM2 already present — skipping"
fi

# ── 10. Start with PM2 ───────────────────────────────────────────────────────
echo "==> Starting PreviewBot with PM2"
cd "${APP_DIR}"
pm2 start ecosystem.config.cjs --env production
echo "    PM2 process started"

# ── 11. PM2 save + startup ───────────────────────────────────────────────────
echo "==> Configuring PM2 auto-start on reboot"
pm2 save
pm2 startup
echo "    PM2 startup configured"

# ── 12. Logrotate ────────────────────────────────────────────────────────────
echo "==> Installing logrotate config"

LOGROTATE_SRC="${APP_DIR}/scripts/logrotate.conf"
LOGROTATE_DEST="/etc/logrotate.d/previewbot"

if [[ -f "${LOGROTATE_SRC}" ]]; then
  cp "${LOGROTATE_SRC}" "${LOGROTATE_DEST}"
  chmod 644 "${LOGROTATE_DEST}"
  echo "    Logrotate config installed at ${LOGROTATE_DEST}"
else
  echo "WARNING: ${LOGROTATE_SRC} not found — skipping logrotate config" >&2
fi

# ── 13. Success summary ───────────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  PreviewBot installation complete!"
echo "========================================="
echo ""
echo "  App directory : ${APP_DIR}"
echo "  Logs          : /var/log/previewbot/"
echo "  Secrets dir   : /var/previewbot/secrets  (chmod 700)"
echo "  PM2 status    : run 'pm2 status' to verify"
echo ""
echo "  Next step: verify ${APP_DIR}/.env is fully configured"
echo ""
