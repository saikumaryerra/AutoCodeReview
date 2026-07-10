/**
 * SQLite schema definition for AutoCodeReview.
 *
 * Five tables: repositories, reviews, seen_commits, settings, repo_settings.
 * All timestamps are ISO-8601 TEXT columns using SQLite's datetime('now').
 * JSON data (findings, files_reviewed, stats) is stored as TEXT and
 * parsed/serialized at the repository layer boundary.
 */

export function getSchemaSQL(): string {
    return `
-- ── Tracked repositories ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repositories (
    id              TEXT PRIMARY KEY,
    full_name       TEXT NOT NULL UNIQUE,
    provider        TEXT NOT NULL
                    CHECK(provider IN ('github', 'azure_devops')),
    org_url         TEXT,
    token           TEXT,
    default_branch  TEXT NOT NULL DEFAULT 'main',
    added_at        TEXT NOT NULL DEFAULT (datetime('now')),
    last_polled_at  TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    coding_standards TEXT
);

-- ── Reviews ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
    id                  TEXT PRIMARY KEY,
    repo_full_name      TEXT NOT NULL,
    provider            TEXT NOT NULL
                        CHECK(provider IN ('github', 'azure_devops')),
    pr_number           INTEGER NOT NULL,
    pr_title            TEXT NOT NULL,
    pr_author           TEXT NOT NULL,
    commit_sha          TEXT NOT NULL,
    commit_message      TEXT,
    branch_name         TEXT NOT NULL,
    target_branch       TEXT NOT NULL DEFAULT 'main',
    pr_state            TEXT CHECK(pr_state IN ('open', 'closed', 'merged')),
    pr_url              TEXT,

    summary             TEXT NOT NULL,
    severity            TEXT NOT NULL
                        CHECK(severity IN ('critical', 'warning', 'info', 'clean')),
    findings            TEXT NOT NULL,
    raw_output          TEXT NOT NULL,
    files_reviewed      TEXT NOT NULL,
    stats               TEXT NOT NULL,

    review_duration_ms  INTEGER,
    claude_model        TEXT,
    status              TEXT NOT NULL DEFAULT 'completed'
                        CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
    error_message       TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    retry_count         INTEGER NOT NULL DEFAULT 0,
    next_retry_at       TEXT,

    UNIQUE(repo_full_name, pr_number, commit_sha)
);

CREATE INDEX IF NOT EXISTS idx_reviews_pr
    ON reviews(repo_full_name, pr_number);

CREATE INDEX IF NOT EXISTS idx_reviews_commit
    ON reviews(commit_sha);

CREATE INDEX IF NOT EXISTS idx_reviews_created
    ON reviews(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_severity
    ON reviews(severity);

-- ── Seen commits ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seen_commits (
    repo_full_name  TEXT NOT NULL,
    pr_number       INTEGER NOT NULL,
    commit_sha      TEXT NOT NULL,
    first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (repo_full_name, pr_number, commit_sha)
);

-- ── Settings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by      TEXT NOT NULL DEFAULT 'system'
);

-- ── Per-repo setting overrides ───────────────────────────────────
CREATE TABLE IF NOT EXISTS repo_settings (
    repo_id     TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by  TEXT NOT NULL DEFAULT 'ui',
    PRIMARY KEY (repo_id, key)
);
`;
}
