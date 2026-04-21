#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# PreviewBot — Add a GitHub repository webhook
# Usage: bash scripts/add-repo.sh owner/repo
# ---------------------------------------------------------------------------

if [[ -z "${1:-}" ]]; then
  echo "Usage: bash scripts/add-repo.sh <owner/repo>"
  echo "Example: bash scripts/add-repo.sh weautomatehq/myapp"
  exit 1
fi

REPO="${1}"

# Load config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "${SCRIPT_DIR}")"

if [[ -f "${APP_DIR}/.env" ]]; then
  set -a
  source "${APP_DIR}/.env"
  set +a
elif [[ -f "/opt/previewbot/app/.env" ]]; then
  set -a
  source "/opt/previewbot/app/.env"
  set +a
else
  echo "ERROR: No .env found at ${APP_DIR}/.env or /opt/previewbot/app/.env" >&2
  exit 1
fi

for var in GITHUB_TOKEN GITHUB_WEBHOOK_SECRET PREVIEW_DOMAIN; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required env var ${var} is not set in .env" >&2
    exit 1
  fi
done

WEBHOOK_URL="https://previewbot.${PREVIEW_DOMAIN}/webhook"

echo "Creating webhook for ${REPO}..."
echo "  Webhook URL: ${WEBHOOK_URL}"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "https://api.github.com/repos/${REPO}/hooks" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
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

HTTP_CODE=$(echo "${RESPONSE}" | tail -1)
BODY=$(echo "${RESPONSE}" | head -n -1)

if [[ "${HTTP_CODE}" == "201" ]]; then
  HOOK_ID=$(echo "${BODY}" | grep -o '"id": [0-9]*' | head -1 | grep -o '[0-9]*')
  echo ""
  echo "Webhook created successfully! (ID: ${HOOK_ID})"
  echo ""
  echo "Open a PR on ${REPO} to test. PreviewBot will:"
  echo "  1. Build a Docker container for the PR"
  echo "  2. Deploy it to pr-{number}.${PREVIEW_DOMAIN}"
  echo "  3. Comment on the PR with the live URL"
else
  echo "ERROR: Failed to create webhook (HTTP ${HTTP_CODE}):" >&2
  echo "${BODY}" | head -20 >&2
  exit 1
fi
