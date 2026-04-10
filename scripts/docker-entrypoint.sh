#!/usr/bin/env bash
# ============================================================================
# docker-entrypoint.sh — Pre-flight checks before starting AutoCodeReview
# ============================================================================
# This script runs as the container ENTRYPOINT. It validates that required
# tools and configuration are present, then hands off to the CMD (node).
# ============================================================================

set -euo pipefail

# --------------------------------------------------------------------------
# 0. Fix permissions on mounted auth files (must run before dropping to user)
# --------------------------------------------------------------------------
# This section runs as root (see Dockerfile: entrypoint runs as root,
# then exec's the CMD as prreview). We copy mounted auth files and fix
# ownership so the prreview user can read/write them.
CLAUDE_AUTH_MOUNT="/mnt/claude-auth"
CLAUDE_JSON_MOUNT="/mnt/claude-config.json"
TARGET_HOME="/home/prreview"

if [ -d "${CLAUDE_AUTH_MOUNT}" ]; then
    # Copy everything except credentials (settings, cache, etc.)
    mkdir -p "${TARGET_HOME}/.claude"
    cp -a "${CLAUDE_AUTH_MOUNT}/." "${TARGET_HOME}/.claude/" 2>/dev/null || true

    # Symlink credentials so the container always reads the host's
    # current token, even after the host CLI refreshes it.
    CRED_FILE="${CLAUDE_AUTH_MOUNT}/.credentials.json"
    if [ -f "${CRED_FILE}" ]; then
        rm -f "${TARGET_HOME}/.claude/.credentials.json"
        ln -s "${CRED_FILE}" "${TARGET_HOME}/.claude/.credentials.json"
        echo "[entrypoint] Claude credentials symlinked (live from host)"
    fi

    chown -R prreview:prreview "${TARGET_HOME}/.claude" 2>/dev/null || true
    chmod -R u+rw "${TARGET_HOME}/.claude" 2>/dev/null || true
    echo "[entrypoint] Claude auth files set up"
fi

if [ -f "${CLAUDE_JSON_MOUNT}" ]; then
    # Symlink config so it stays in sync with the host
    rm -f "${TARGET_HOME}/.claude.json"
    ln -s "${CLAUDE_JSON_MOUNT}" "${TARGET_HOME}/.claude.json"
    chown -h prreview:prreview "${TARGET_HOME}/.claude.json" 2>/dev/null || true
    echo "[entrypoint] Claude config symlinked (live from host)"
fi

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
# 2. Verify Claude CLI auth
# --------------------------------------------------------------------------
if [ -f "${TARGET_HOME}/.claude/.credentials.json" ]; then
    echo "[entrypoint] Claude credentials present"
else
    echo "[WARNING] Claude credentials not found — CLI will not be authenticated"
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
# 6. Hand off to CMD as the prreview user
# --------------------------------------------------------------------------
exec gosu prreview "$@"
