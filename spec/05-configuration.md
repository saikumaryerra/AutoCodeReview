## 5. Configuration

### 5.1 Environment Variables

All configuration is via a `.env` file at the project root. The `config.ts` module reads these with `dotenv` and validates them with Zod at startup — the app refuses to start if required values are missing.

```bash
# .env.example

# ═══════════════════════════════════════════════════════
#  REPOSITORY SOURCES — configure one or both providers
# ═══════════════════════════════════════════════════════

# ── GitHub (optional — omit if only using Azure DevOps) ──
# Personal Access Token with `repo` scope (read access to PRs and code)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# Comma-separated list of GitHub repos to monitor: "owner/repo,owner/repo2"
GITHUB_REPOS=myorg/backend-api,myorg/frontend-app

# ── Azure DevOps (optional — omit if only using GitHub) ──
# Personal Access Token with Code (Read) scope
AZURE_DEVOPS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Azure DevOps organization URL (e.g. https://dev.azure.com/myorg)
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/myorg

# Comma-separated list of Azure DevOps repos: "project/repo,project/repo2"
# The format is "ProjectName/RepoName" (NOT org — org comes from the URL above)
AZURE_DEVOPS_REPOS=MyProject/backend-service,MyProject/web-frontend

# ── Polling ─────────────────────────────────────────
# How often to check for new PRs/commits, in seconds (default: 120)
POLL_INTERVAL_SECONDS=120

# ── Claude CLI ──────────────────────────────────────
# Path to claude binary (default: "claude" — assumes it's in PATH)
CLAUDE_CLI_PATH=claude

# Maximum time in seconds to wait for a single review (default: 300)
CLAUDE_REVIEW_TIMEOUT_SECONDS=300

# Optional: specific model to pass to claude CLI (leave blank for default)
CLAUDE_MODEL=

# ── Server ──────────────────────────────────────────
API_PORT=3001
FRONTEND_PORT=5173

# ── Storage ─────────────────────────────────────────
# Where to store the SQLite database
DB_PATH=./data/reviews.db

# Where to clone repos locally
REPOS_DIR=./data/repos

# ── Review Behavior ─────────────────────────────────
# Only review PRs in these states (comma-separated: open,closed,all)
# Note: Azure DevOps uses "active" internally but this is mapped automatically
PR_STATE_FILTER=open

# Skip draft PRs (default: true)
SKIP_DRAFTS=true

# Max number of changed files in a PR before skipping review (default: 50)
MAX_FILES_CHANGED=50

# Max diff size in characters before skipping (default: 100000)
MAX_DIFF_SIZE=100000

# ── Data Retention ──────────────────────────────────
# Reviews older than this many days are automatically deleted (default: 90).
# Set to 0 to disable automatic cleanup (reviews kept forever).
# The cleanup job runs once daily at 3:00 AM server time.
REVIEW_RETENTION_DAYS=90
```

### 5.2 Config Module (src/config/config.ts)

This module handles the **first tier** of configuration — reading from `.env` and parsing with Zod. The resulting object becomes the default values that the `ConfigService` (Section 8) falls back to when no database override exists. It still validates at startup and refuses to start if required values (like at least one provider) are missing.

```typescript
// This module is the single source of truth for all configuration.
// It reads from .env, applies defaults, validates with Zod, and exports
// a frozen config object. Every other module imports from here — nothing
// reads process.env directly.
//
// IMPORTANT: At least one provider (GitHub or Azure DevOps) must be configured.
// Both can be active simultaneously — the system will poll repos from all
// configured providers in the same polling cycle.

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  // --- Git Providers ---
  // Both are optional individually, but at least one must have repos configured.
  github: z.object({
    token: z.string().optional(),
    repos: z.array(z.string().regex(/^[^/]+\/[^/]+$/)),  // "owner/repo" format
  }),
  azureDevOps: z.object({
    token: z.string().optional(),
    orgUrl: z.string().url().optional(),                   // "https://dev.azure.com/myorg"
    repos: z.array(z.string().regex(/^[^/]+\/[^/]+$/)),   // "project/repo" format
  }),
  polling: z.object({
    intervalSeconds: z.number().min(30).default(120),
  }),
  claude: z.object({
    cliPath: z.string().default("claude"),
    reviewTimeoutSeconds: z.number().min(60).default(300),
    model: z.string().optional(),
  }),
  server: z.object({
    apiPort: z.number().default(3001),
    frontendPort: z.number().default(5173),
  }),
  storage: z.object({
    dbPath: z.string().default("./data/reviews.db"),
    reposDir: z.string().default("./data/repos"),
  }),
  review: z.object({
    prStateFilter: z.enum(["open", "closed", "all"]).default("open"),
    skipDrafts: z.boolean().default(true),
    maxFilesChanged: z.number().default(50),
    maxDiffSize: z.number().default(100000),
    retentionDays: z.number().min(0).default(90),  // 0 = disabled (keep forever)
  }),
}).refine(
  // At least one provider must have repos configured
  (cfg) => cfg.github.repos.length > 0 || cfg.azureDevOps.repos.length > 0,
  { message: "At least one provider must have repos configured (GITHUB_REPOS or AZURE_DEVOPS_REPOS)" }
).refine(
  // If GitHub repos are listed, a token is required
  (cfg) => cfg.github.repos.length === 0 || (cfg.github.token && cfg.github.token.length > 0),
  { message: "GITHUB_TOKEN is required when GITHUB_REPOS is configured" }
).refine(
  // If Azure DevOps repos are listed, both token and org URL are required
  (cfg) => cfg.azureDevOps.repos.length === 0 || (cfg.azureDevOps.token && cfg.azureDevOps.orgUrl),
  { message: "AZURE_DEVOPS_TOKEN and AZURE_DEVOPS_ORG_URL are required when AZURE_DEVOPS_REPOS is configured" }
);

// Helper to split comma-separated env var into trimmed, non-empty strings
const splitCsv = (val: string | undefined): string[] =>
  (val || "").split(",").map(s => s.trim()).filter(Boolean);

// Parse and validate — throws with clear message if invalid
export const config = ConfigSchema.parse({
  github: {
    token: process.env.GITHUB_TOKEN || undefined,
    repos: splitCsv(process.env.GITHUB_REPOS),
  },
  azureDevOps: {
    token: process.env.AZURE_DEVOPS_TOKEN || undefined,
    orgUrl: process.env.AZURE_DEVOPS_ORG_URL || undefined,
    repos: splitCsv(process.env.AZURE_DEVOPS_REPOS),
  },
  polling: {
    intervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS) || 120,
  },
  claude: {
    cliPath: process.env.CLAUDE_CLI_PATH || "claude",
    reviewTimeoutSeconds: Number(process.env.CLAUDE_REVIEW_TIMEOUT_SECONDS) || 300,
    model: process.env.CLAUDE_MODEL || undefined,
  },
  server: {
    apiPort: Number(process.env.API_PORT) || 3001,
    frontendPort: Number(process.env.FRONTEND_PORT) || 5173,
  },
  storage: {
    dbPath: process.env.DB_PATH || "./data/reviews.db",
    reposDir: process.env.REPOS_DIR || "./data/repos",
  },
  review: {
    prStateFilter: process.env.PR_STATE_FILTER || "open",
    skipDrafts: process.env.SKIP_DRAFTS !== "false",
    maxFilesChanged: Number(process.env.MAX_FILES_CHANGED) || 50,
    maxDiffSize: Number(process.env.MAX_DIFF_SIZE) || 100000,
    retentionDays: Number(process.env.REVIEW_RETENTION_DAYS ?? 90),
  },
});
```

---
