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

# --------------------------------------------------------------------------
# 0a. Align prreview uid/gid with the host user who owns the mounted
#     credentials. The credentials file is mode 600, so only a uid-matched
#     process can read it. Without this, Claude CLI silently fails auth.
# --------------------------------------------------------------------------
if [ -f "${CLAUDE_AUTH_MOUNT}/.credentials.json" ]; then
    HOST_UID=$(stat -c %u "${CLAUDE_AUTH_MOUNT}/.credentials.json")
    HOST_GID=$(stat -c %g "${CLAUDE_AUTH_MOUNT}/.credentials.json")
    CURRENT_UID=$(id -u prreview)
    CURRENT_GID=$(id -g prreview)

    if [ "${HOST_UID}" != "${CURRENT_UID}" ] || [ "${HOST_GID}" != "${CURRENT_GID}" ]; then
        echo "[entrypoint] Aligning prreview uid/gid ${CURRENT_UID}:${CURRENT_GID} -> ${HOST_UID}:${HOST_GID} to match mounted credentials"
        # If another user already has the target uid/gid, remove that account
        EXISTING_USER=$(getent passwd "${HOST_UID}" | cut -d: -f1 || true)
        if [ -n "${EXISTING_USER}" ] && [ "${EXISTING_USER}" != "prreview" ]; then
            userdel "${EXISTING_USER}" 2>/dev/null || true
        fi
        EXISTING_GROUP=$(getent group "${HOST_GID}" | cut -d: -f1 || true)
        if [ -n "${EXISTING_GROUP}" ] && [ "${EXISTING_GROUP}" != "prreview" ]; then
            groupdel "${EXISTING_GROUP}" 2>/dev/null || true
        fi
        # Align gid then uid. groupmod must run first so a group with HOST_GID
        # exists for usermod -g to target. Track each step: if groupmod succeeds
        # but usermod fails we've left a partial state (gid shifted, uid unchanged),
        # so only chown on full success and say so plainly in the warning otherwise.
        gid_ok=0
        uid_ok=0
        groupmod -g "${HOST_GID}" prreview 2>/dev/null && gid_ok=1
        if [ "${gid_ok}" = "1" ]; then
            usermod -u "${HOST_UID}" -g "${HOST_GID}" prreview 2>/dev/null && uid_ok=1
        fi
        if [ "${gid_ok}" = "1" ] && [ "${uid_ok}" = "1" ]; then
            # Re-own only the runtime-writable home dir here. The large,
            # read-only image tree under /app (node_modules, dist, frontend/dist)
            # is world-readable as built and does NOT need per-boot chowning —
            # traversing it recursively on every recreate is what stalled startup
            # for minutes under host I/O pressure (chown blocked in ext4 journal
            # commit). The writable data tree is chowned after it is created (§3).
            chown -R "${HOST_UID}:${HOST_GID}" "${TARGET_HOME}" 2>/dev/null || true
        elif [ "${gid_ok}" = "1" ]; then
            echo "[entrypoint] WARNING: prreview gid was set to ${HOST_GID} but uid could not be set to ${HOST_UID}; account is partially aligned and Claude credentials may be unreadable"
        else
            echo "[entrypoint] WARNING: could not align prreview uid/gid to ${HOST_UID}:${HOST_GID}; Claude credentials may be unreadable"
        fi
    fi
fi

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

# Own the writable data tree as the (possibly just-realigned) runtime user.
# mkdir above runs as root, so freshly created dirs would otherwise be
# unwritable by prreview. Scoped to data/ only — small and bounded — so startup
# stays fast even under host I/O pressure, unlike a full /app chown.
chown -R prreview:prreview "${DATA_DIR}" 2>/dev/null || true

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
echo "  API port: ${API_PORT:-9998}"
echo "============================================"

# --------------------------------------------------------------------------
# 6. Hand off to CMD as the prreview user
# --------------------------------------------------------------------------
exec gosu prreview "$@"
