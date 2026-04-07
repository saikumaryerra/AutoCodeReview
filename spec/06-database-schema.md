## 6. Database Schema

### 6.1 Tables

The database has three tables. The `reviews` table is the heart of the system — it stores one row per review, and every row is uniquely identified by the triple of `(repo_full_name, pr_number, commit_sha)`.

```sql
-- Tracked repositories
CREATE TABLE IF NOT EXISTS repositories (
    id              TEXT PRIMARY KEY,          -- UUID
    full_name       TEXT NOT NULL UNIQUE,      -- "owner/repo" (GitHub) or "project/repo" (Azure DevOps)
    provider        TEXT NOT NULL              -- "github" | "azure_devops"
                    CHECK(provider IN ('github','azure_devops')),
    org_url         TEXT,                      -- Only for Azure DevOps: "https://dev.azure.com/myorg"
    default_branch  TEXT NOT NULL DEFAULT 'main',
    added_at        TEXT NOT NULL DEFAULT (datetime('now')),
    last_polled_at  TEXT,                      -- ISO timestamp of last successful poll
    is_active       INTEGER NOT NULL DEFAULT 1 -- 1 = actively polling, 0 = paused
);

-- One row per review. The unique constraint on (repo, PR, commit) means
-- the system will never review the same commit on the same PR twice.
CREATE TABLE IF NOT EXISTS reviews (
    id              TEXT PRIMARY KEY,          -- UUID
    repo_full_name  TEXT NOT NULL,             -- "owner/repo" or "project/repo"
    provider        TEXT NOT NULL              -- "github" | "azure_devops"
                    CHECK(provider IN ('github','azure_devops')),
    pr_number       INTEGER NOT NULL,          -- PR number (GitHub) or PR ID (Azure DevOps)
    pr_title        TEXT NOT NULL,             -- PR title at time of review
    pr_author       TEXT NOT NULL,             -- Username of PR author
    commit_sha      TEXT NOT NULL,             -- Full 40-char SHA of the reviewed commit
    commit_message  TEXT,                      -- First line of commit message
    branch_name     TEXT NOT NULL,             -- Source branch name

    -- Review content
    summary         TEXT NOT NULL,             -- One-paragraph review summary
    severity        TEXT NOT NULL              -- "critical" | "warning" | "info" | "clean"
                    CHECK(severity IN ('critical','warning','info','clean')),
    findings        TEXT NOT NULL,             -- JSON array of finding objects (see 6.2)
    raw_output      TEXT NOT NULL,             -- Complete raw Claude CLI output for debugging
    files_reviewed  TEXT NOT NULL,             -- JSON array of file paths that were reviewed
    stats           TEXT NOT NULL,             -- JSON: { files_changed, additions, deletions }

    -- Metadata
    review_duration_ms  INTEGER,              -- How long the claude CLI call took
    claude_model        TEXT,                  -- Model used (if reported by CLI)
    status              TEXT NOT NULL DEFAULT 'completed'
                        CHECK(status IN ('pending','in_progress','completed','failed','skipped')),
    error_message       TEXT,                  -- Populated when status = 'failed'
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),

    -- The core uniqueness constraint: one review per commit per PR per repo
    UNIQUE(repo_full_name, pr_number, commit_sha)
);

-- Indexes for the two primary lookup patterns
CREATE INDEX IF NOT EXISTS idx_reviews_pr
    ON reviews(repo_full_name, pr_number);

CREATE INDEX IF NOT EXISTS idx_reviews_commit
    ON reviews(commit_sha);

CREATE INDEX IF NOT EXISTS idx_reviews_created
    ON reviews(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_severity
    ON reviews(severity);

-- Tracks which commits have been fully processed (reviewed, skipped, or permanently failed)
-- so we don't re-queue them. A commit is inserted here ONLY after its review reaches a
-- terminal state. This guarantees that if the process crashes while a review is queued or
-- in-progress, the poller will re-detect and re-enqueue the commit on the next cycle.
CREATE TABLE IF NOT EXISTS seen_commits (
    repo_full_name  TEXT NOT NULL,
    pr_number       INTEGER NOT NULL,
    commit_sha      TEXT NOT NULL,
    first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (repo_full_name, pr_number, commit_sha)
);

-- Runtime-editable settings. This table provides a second layer of configuration
-- on top of the .env file. Values here OVERRIDE the corresponding .env value.
-- If a key is not present in this table, the .env default is used.
-- This is what enables the "change config from the UI" feature.
--
-- Not all config keys are editable at runtime — secrets (tokens, API keys) and
-- infrastructure settings (DB_PATH, API_PORT) can only be set via .env because
-- changing them at runtime would require a restart or could break the system.
-- The config.schema.ts file defines which keys are UI-editable.
CREATE TABLE IF NOT EXISTS settings (
    key             TEXT PRIMARY KEY,          -- Config key, e.g. "polling.intervalSeconds"
    value           TEXT NOT NULL,             -- JSON-encoded value (string, number, or boolean)
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by      TEXT NOT NULL DEFAULT 'system'  -- "system" or "ui" — tracks origin of change
);
```

### 6.2 Findings JSON Structure

Each review has a `findings` column containing a JSON array. Every element in the array follows this shape:

```typescript
interface Finding {
    // What kind of issue this is
    type: "bug" | "security" | "performance" | "style" | "maintainability" | "suggestion" | "praise";

    // How serious it is: critical must be fixed, warning should be fixed,
    // info is nice-to-know, praise is positive feedback
    severity: "critical" | "warning" | "info" | "praise";

    // The file this finding applies to (relative to repo root)
    file: string;

    // Line number or range, if applicable
    line_start: number | null;
    line_end: number | null;

    // Short one-line title for the finding
    title: string;

    // Detailed explanation of the issue and why it matters
    description: string;

    // Suggested fix or improvement (may include code)
    suggestion: string | null;

    // The relevant code snippet from the diff
    code_snippet: string | null;
}
```

---
