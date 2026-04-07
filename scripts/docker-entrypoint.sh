#!/usr/bin/env bash
# ============================================================================
# docker-entrypoint.sh — Pre-flight checks before starting AutoCodeReview
# ============================================================================
# This script runs as the container ENTRYPOINT. It validates that required
# tools and configuration are present, then hands off to the CMD (node).
# ============================================================================

set -euo pipefail

# --------------------------------------------------------------------------
# 1. Verify Claude CLI is installed and reachable
# --------------------------------------------------------------------------
if ! command -v claude &>/dev/null; then
    echo "[FATAL] Claude CLI (claude) is not installed or not in PATH."
    echo "        The review engine cannot function without it."
    exit 1
fi

CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
echo "[entrypoint] Claude CLI found: ${CLAUDE_VERSION}"

# --------------------------------------------------------------------------
# 2. Check Claude CLI auth directory
# --------------------------------------------------------------------------
CLAUDE_AUTH_DIR="${HOME}/.claude"
if [ ! -d "${CLAUDE_AUTH_DIR}" ]; then
    echo "[WARNING] Claude auth directory not found at ${CLAUDE_AUTH_DIR}"
    echo "          Mount your host ~/.claude directory into the container:"
    echo "            -v ~/.claude:/home/prreview/.claude:ro"
    echo "          Or run 'claude' inside the container to authenticate."
else
    echo "[entrypoint] Claude auth directory present at ${CLAUDE_AUTH_DIR}"
fi

# --------------------------------------------------------------------------
# 3. Ensure data directories exist with correct permissions
# --------------------------------------------------------------------------
DATA_DIR="/app/data"
REPOS_SUBDIR="${REPOS_DIR:-${DATA_DIR}/repos}"
LOGS_SUBDIR="${DATA_DIR}/logs"

mkdir -p "${DATA_DIR}" "${REPOS_SUBDIR}" "${LOGS_SUBDIR}"
echo "[entrypoint] Data directories verified:"
echo "             DB path:   ${DB_PATH:-${DATA_DIR}/reviews.db}"
echo "             Repos dir: ${REPOS_SUBDIR}"
echo "             Logs dir:  ${LOGS_SUBDIR}"

# --------------------------------------------------------------------------
# 4. Warn if no provider tokens are configured
# --------------------------------------------------------------------------
HAS_PROVIDER=false

if [ -n "${GITHUB_TOKEN:-}" ] && [ -n "${GITHUB_REPOS:-}" ]; then
    REPO_COUNT=$(echo "${GITHUB_REPOS}" | tr ',' '\n' | grep -c '[^[:space:]]' || true)
    echo "[entrypoint] GitHub provider configured (${REPO_COUNT} repo(s))"
    HAS_PROVIDER=true
fi

if [ -n "${AZURE_DEVOPS_TOKEN:-}" ] && [ -n "${AZURE_DEVOPS_REPOS:-}" ]; then
    REPO_COUNT=$(echo "${AZURE_DEVOPS_REPOS}" | tr ',' '\n' | grep -c '[^[:space:]]' || true)
    echo "[entrypoint] Azure DevOps provider configured (${REPO_COUNT} repo(s))"
    HAS_PROVIDER=true
fi

if [ "${HAS_PROVIDER}" = "false" ]; then
    echo "[WARNING] No git provider tokens detected."
    echo "          Set GITHUB_TOKEN + GITHUB_REPOS and/or"
    echo "          AZURE_DEVOPS_TOKEN + AZURE_DEVOPS_ORG_URL + AZURE_DEVOPS_REPOS"
    echo "          in your .env file or environment."
fi

# --------------------------------------------------------------------------
# 5. Print startup summary
# --------------------------------------------------------------------------
echo "============================================"
echo "  AutoCodeReview"
echo "  Node $(node --version) | ${NODE_ENV:-development}"
echo "  API port: ${API_PORT:-3001}"
echo "============================================"

# --------------------------------------------------------------------------
# 6. Hand off to CMD
# --------------------------------------------------------------------------
exec "$@"
