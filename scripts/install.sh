#!/bin/bash
set -euo pipefail

echo "========================================="
echo "  PreviewBot Installer"
echo "========================================="
echo ""

# Check root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash install.sh"
  exit 1
fi

# Prompt for configuration
read -rp "Preview domain (e.g. preview.yourdomain.com): " PREVIEW_DOMAIN
read -rp "GitHub Personal Access Token: " GITHUB_TOKEN
WEBHOOK_SECRET=$(openssl rand -hex 32)
echo "Generated webhook secret: $WEBHOOK_SECRET"

# Install Docker if missing
if ! command -v docker &> /dev/null; then
  echo "[1/7] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  echo "[1/7] Docker already installed"
fi

# Install Node.js 20 if missing
if ! command -v node &> /dev/null; then
  echo "[2/7] Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "[2/7] Node.js already installed ($(node -v))"
fi

# Install PM2 if missing
if ! command -v pm2 &> /dev/null; then
  echo "[3/7] Installing PM2..."
  npm install -g pm2
else
  echo "[3/7] PM2 already installed"
fi

# Create directories
echo "[4/7] Creating directories..."
mkdir -p /opt/previewbot
mkdir -p /var/previewbot/deploys
mkdir -p /var/previewbot/secrets

# Create isolated Docker network
echo "[5/7] Setting up Docker network..."
docker network create \
  --driver bridge \
  --subnet=172.20.0.0/16 \
  --opt com.docker.network.bridge.enable_icc=false \
  pr-previews 2>/dev/null || echo "  Network already exists"

# Block preview containers from accessing host services
iptables -C DOCKER-USER -s 172.20.0.0/16 -d 172.17.0.0/16 -j DROP 2>/dev/null || \
  iptables -I DOCKER-USER -s 172.20.0.0/16 -d 172.17.0.0/16 -j DROP
iptables -C DOCKER-USER -s 172.20.0.0/16 -d 10.0.0.0/8 -j DROP 2>/dev/null || \
  iptables -I DOCKER-USER -s 172.20.0.0/16 -d 10.0.0.0/8 -j DROP
iptables -C DOCKER-USER -s 172.20.0.0/16 -d 192.168.0.0/16 -j DROP 2>/dev/null || \
  iptables -I DOCKER-USER -s 172.20.0.0/16 -d 192.168.0.0/16 -j DROP

# Save iptables rules
if command -v netfilter-persistent &> /dev/null; then
  netfilter-persistent save
else
  apt-get install -y iptables-persistent
  netfilter-persistent save
fi

# Clone and install PreviewBot
echo "[6/7] Installing PreviewBot..."
cd /opt/previewbot
if [ -d ".git" ]; then
  git pull origin main
else
  git clone https://github.com/monstersebas1/previewbot.git .
fi
npm install
npm run build

# Create .env
cat > /opt/previewbot/.env << EOF
GITHUB_TOKEN=${GITHUB_TOKEN}
GITHUB_WEBHOOK_SECRET=${WEBHOOK_SECRET}
PREVIEW_DOMAIN=${PREVIEW_DOMAIN}
PORT=3500
DEPLOY_DIR=/var/previewbot/deploys
SECRETS_DIR=/var/previewbot/secrets
NGINX_CONF_DIR=/etc/nginx/conf.d
DOCKER_NETWORK=pr-previews
CONTAINER_MEMORY=512m
CONTAINER_CPUS=1
BUILD_TIMEOUT=600
HEALTH_CHECK_TIMEOUT=60
EOF

chmod 600 /opt/previewbot/.env

# Copy default Dockerfile template
cp /opt/previewbot/templates/Dockerfile.preview /opt/previewbot/templates/Dockerfile.preview

# Set up nginx include
if ! grep -q "preview-pr-" /etc/nginx/nginx.conf 2>/dev/null; then
  echo "  Nginx will auto-discover configs in ${NGINX_CONF_DIR}/preview-pr-*.conf"
fi

# Start with PM2
echo "[7/7] Starting PreviewBot..."
pm2 delete previewbot 2>/dev/null || true
pm2 start /opt/previewbot/dist/server.js --name previewbot
pm2 save
pm2 startup

# Set up daily cleanup cron
(crontab -l 2>/dev/null | grep -v "previewbot-cleanup"; echo "0 4 * * * docker container prune --filter 'until=24h' -f && docker image prune --filter 'until=48h' -f && docker builder prune --keep-storage=2g -f") | crontab -

echo ""
echo "========================================="
echo "  PreviewBot installed successfully!"
echo "========================================="
echo ""
echo "  Service:  http://localhost:3500/health"
echo "  Domain:   *.${PREVIEW_DOMAIN}"
echo "  Webhook:  https://${PREVIEW_DOMAIN}:3500/webhook"
echo "  Secret:   ${WEBHOOK_SECRET}"
echo ""
echo "  Next steps:"
echo "  1. Point *.${PREVIEW_DOMAIN} to this server's IP in Cloudflare"
echo "  2. Set Cloudflare SSL mode to 'Full'"
echo "  3. Run: previewbot add <owner/repo>"
echo ""
