#!/usr/bin/env bash
# ============================================================================
# setup.sh — First-time local development setup for AutoCodeReview
# ============================================================================
# Run this once after cloning the repository. It checks prerequisites,
# installs dependencies, creates the .env file from the example, and
# prepares the data directories.
#
# Usage:
#   chmod +x scripts/setup.sh
#   ./scripts/setup.sh
# ============================================================================

set -euo pipefail

# Terminal colors (degrade gracefully if tput is missing)
RED=$(tput setaf 1 2>/dev/null || echo "")
GREEN=$(tput setaf 2 2>/dev/null || echo "")
YELLOW=$(tput setaf 3 2>/dev/null || echo "")
BOLD=$(tput bold 2>/dev/null || echo "")
RESET=$(tput sgr0 2>/dev/null || echo "")

PASS="${GREEN}[OK]${RESET}"
FAIL="${RED}[FAIL]${RESET}"
WARN="${YELLOW}[WARN]${RESET}"

# Track overall status
ERRORS=0

echo ""
echo "${BOLD}AutoCodeReview - Local Development Setup${RESET}"
echo "=========================================="
echo ""

# --------------------------------------------------------------------------
# 1. Check Node.js >= 20
# --------------------------------------------------------------------------
echo -n "Checking Node.js ... "
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version | sed 's/^v//')
    NODE_MAJOR=$(echo "${NODE_VERSION}" | cut -d. -f1)
    if [ "${NODE_MAJOR}" -ge 20 ]; then
        echo "${PASS} v${NODE_VERSION}"
    else
        echo "${FAIL} v${NODE_VERSION} (requires >= 20)"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "${FAIL} not installed"
    echo "  Install Node.js 20+ from https://nodejs.org/"
    ERRORS=$((ERRORS + 1))
fi

# --------------------------------------------------------------------------
# 2. Check git
# --------------------------------------------------------------------------
echo -n "Checking git ... "
if command -v git &>/dev/null; then
    GIT_VERSION=$(git --version | awk '{print $3}')
    echo "${PASS} v${GIT_VERSION}"
else
    echo "${FAIL} not installed"
    echo "  Install git: https://git-scm.com/downloads"
    ERRORS=$((ERRORS + 1))
fi

# --------------------------------------------------------------------------
# 3. Check Claude CLI
# --------------------------------------------------------------------------
echo -n "Checking Claude CLI ... "
if command -v claude &>/dev/null; then
    CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
    echo "${PASS} ${CLAUDE_VERSION}"
else
    echo "${WARN} not installed"
    echo "  Install: npm install -g @anthropic-ai/claude-code"
    echo "  Reviews will fail until Claude CLI is available."
fi

# --------------------------------------------------------------------------
# Abort if hard requirements are missing
# --------------------------------------------------------------------------
if [ "${ERRORS}" -gt 0 ]; then
    echo ""
    echo "${FAIL} ${ERRORS} required prerequisite(s) missing. Fix them and re-run."
    exit 1
fi

echo ""

# --------------------------------------------------------------------------
# 4. Install backend dependencies
# --------------------------------------------------------------------------
echo "${BOLD}Installing backend dependencies...${RESET}"
npm install
echo ""

# --------------------------------------------------------------------------
# 5. Install frontend dependencies
# --------------------------------------------------------------------------
echo "${BOLD}Installing frontend dependencies...${RESET}"
cd frontend && npm install && cd ..
echo ""

# --------------------------------------------------------------------------
# 6. Create .env from .env.example if it does not exist
# --------------------------------------------------------------------------
echo -n "Checking .env file ... "
if [ -f .env ]; then
    echo "${PASS} already exists (not overwritten)"
else
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "${PASS} created from .env.example"
    else
        echo "${WARN} .env.example not found, skipping"
    fi
fi

# --------------------------------------------------------------------------
# 7. Create data directories
# --------------------------------------------------------------------------
echo -n "Creating data directories ... "
mkdir -p data/repos data/logs
echo "${PASS} data/repos, data/logs"

echo ""
echo "=========================================="
echo "${GREEN}${BOLD}Setup complete.${RESET}"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit ${BOLD}.env${RESET} and add at least one provider:"
echo "     - GitHub:     GITHUB_TOKEN + GITHUB_REPOS"
echo "     - Azure DevOps: AZURE_DEVOPS_TOKEN + AZURE_DEVOPS_ORG_URL + AZURE_DEVOPS_REPOS"
echo ""
echo "  2. Authenticate Claude CLI (if not already done):"
echo "     ${BOLD}claude${RESET}"
echo ""
echo "  3. Start the dev server:"
echo "     ${BOLD}npm run dev${RESET}"
echo ""
echo "  4. Open the dashboard:"
echo "     http://localhost:5173"
echo ""
