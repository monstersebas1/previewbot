#!/bin/bash
set -euo pipefail

# Usage: previewbot add owner/repo
# Creates a webhook on the GitHub repo pointing to this server

if [ -z "${1:-}" ]; then
  echo "Usage: previewbot add <owner/repo>"
  echo "Example: previewbot add weautomatehq/phillup"
  exit 1
fi

REPO="$1"
OWNER=$(echo "$REPO" | cut -d'/' -f1)
REPO_NAME=$(echo "$REPO" | cut -d'/' -f2)

# Load config
if [ -f /opt/previewbot/.env ]; then
  source /opt/previewbot/.env
elif [ -f .env ]; then
  source .env
else
  echo "Error: No .env found"
  exit 1
fi

# Detect public URL
SERVER_IP=$(curl -s ifconfig.me)
WEBHOOK_URL="http://${SERVER_IP}:3500/webhook"

echo "Creating webhook for ${REPO}..."
echo "  Webhook URL: ${WEBHOOK_URL}"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "https://api.github.com/repos/${REPO}/hooks" \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -d "{
    \"name\": \"web\",
    \"active\": true,
    \"events\": [\"pull_request\"],
    \"config\": {
      \"url\": \"${WEBHOOK_URL}\",
      \"content_type\": \"json\",
      \"secret\": \"${GITHUB_WEBHOOK_SECRET}\",
      \"insecure_ssl\": \"0\"
    }
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ]; then
  HOOK_ID=$(echo "$BODY" | grep -o '"id": [0-9]*' | head -1 | grep -o '[0-9]*')
  echo ""
  echo "Webhook created successfully! (ID: ${HOOK_ID})"
  echo ""
  echo "Open a PR on ${REPO} to test. PreviewBot will:"
  echo "  1. Build a Docker container for the PR"
  echo "  2. Deploy it to pr-{number}.${PREVIEW_DOMAIN}"
  echo "  3. Comment on the PR with the live URL"
else
  echo "Error creating webhook (HTTP ${HTTP_CODE}):"
  echo "$BODY" | head -20
  exit 1
fi
