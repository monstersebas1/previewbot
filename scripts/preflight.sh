#!/usr/bin/env bash
set -euo pipefail

PASS=0
FAIL=0
WARN=0

run_check() {
  local label="$1"
  local critical="$2"
  shift 2

  if "$@" >/dev/null 2>&1; then
    echo "  PASS  $label"
    ((PASS++))
  elif [[ "$critical" == "true" ]]; then
    echo "  FAIL  $label"
    ((FAIL++))
  else
    echo "  WARN  $label"
    ((WARN++))
  fi
}

check_env_set() { [[ -n "${!1:-}" ]]; }
check_port_free() { ! ss -tlnp 2>/dev/null | grep -q ":$1 " && ! netstat -tlnp 2>/dev/null | grep -q ":$1 "; }
check_disk_space() { [[ $(df -BG --output=avail / 2>/dev/null | tail -1 | tr -d ' G') -ge "$1" ]]; }
check_node_version() { [[ $(node -v | sed 's/v//' | cut -d. -f1) -ge "$1" ]]; }
check_github_token() { curl -sf -H "Authorization: token ${GITHUB_TOKEN}" https://api.github.com/user; }

echo "PreviewBot Preflight Checks"
echo "==========================="
echo ""

run_check "Docker daemon running" true docker info
run_check "Docker network 'pr-previews' exists" true docker network inspect pr-previews

run_check "GITHUB_TOKEN is set" true check_env_set GITHUB_TOKEN
run_check "GITHUB_WEBHOOK_SECRET is set" true check_env_set GITHUB_WEBHOOK_SECRET
run_check "PREVIEW_DOMAIN is set" true check_env_set PREVIEW_DOMAIN

run_check "GitHub token is valid" true check_github_token

run_check "Port 3500 is available" true check_port_free 3500

run_check "nginx is installed" true command -v nginx
run_check "nginx config is valid" false nginx -t

run_check "Disk space > 5GB free" true check_disk_space 5

run_check "Node.js >= 20" true check_node_version 20

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed, ${WARN} warnings"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "Fix the FAIL items before running PreviewBot."
  exit 1
fi

echo ""
echo "All critical checks passed. Ready to run."
