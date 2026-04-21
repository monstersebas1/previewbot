#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <PR_NUMBER> <ACTION> <REPO_URL>"
  echo ""
  echo "  PR_NUMBER  - Pull request number (e.g. 42)"
  echo "  ACTION     - opened | closed | synchronize | reopened"
  echo "  REPO_URL   - Clone URL (e.g. https://github.com/owner/repo.git)"
  echo ""
  echo "Environment:"
  echo "  GITHUB_WEBHOOK_SECRET - Required. The webhook secret."
  echo "  PREVIEWBOT_URL        - Optional. Default: http://localhost:3500"
  exit 1
}

if [[ $# -lt 3 ]]; then
  usage
fi

PR_NUMBER="$1"
ACTION="$2"
REPO_URL="$3"
PREVIEWBOT_URL="${PREVIEWBOT_URL:-http://localhost:3500}"

if [[ -z "${GITHUB_WEBHOOK_SECRET:-}" ]]; then
  if [[ -f .env ]]; then
    GITHUB_WEBHOOK_SECRET=$(grep '^GITHUB_WEBHOOK_SECRET=' .env | cut -d'=' -f2-)
  fi
  if [[ -z "${GITHUB_WEBHOOK_SECRET:-}" ]]; then
    echo "ERROR: GITHUB_WEBHOOK_SECRET is not set and not found in .env"
    exit 1
  fi
fi

OWNER=$(echo "$REPO_URL" | sed -E 's|.*github\.com[:/]([^/]+)/.*|\1|')
REPO=$(echo "$REPO_URL" | sed -E 's|.*github\.com[:/][^/]+/([^/.]+).*|\1|')
DELIVERY_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "test-$(date +%s)")

PAYLOAD=$(printf '{
  "action": "%s",
  "number": %d,
  "pull_request": {
    "head": {
      "sha": "abc1234567890",
      "ref": "feature/test-pr-%d",
      "repo": {
        "clone_url": "%s"
      }
    }
  },
  "repository": {
    "owner": { "login": "%s" },
    "name": "%s",
    "full_name": "%s/%s"
  }
}' "$ACTION" "$PR_NUMBER" "$PR_NUMBER" "$REPO_URL" "$OWNER" "$REPO" "$OWNER" "$REPO")

SIGNATURE="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" | sed 's/^.* //')"

echo "Sending ${ACTION} webhook for PR #${PR_NUMBER} to ${PREVIEWBOT_URL}/webhook"
echo "Signature: ${SIGNATURE}"
echo ""

curl -s -w "\nHTTP Status: %{http_code}\n" \
  -X POST "${PREVIEWBOT_URL}/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: ${SIGNATURE}" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: ${DELIVERY_ID}" \
  -d "$PAYLOAD"
