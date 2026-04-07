## 15. Shared Types (`src/shared/types.ts`)

This file defines every TypeScript interface used across the backend. The frontend has its own copy of the API response types (or they can be extracted into a shared package if the project grows).

```typescript
// ── Domain Types ────────────────────────────────────────

export type Provider = "github" | "azure_devops";
export type Severity = "critical" | "warning" | "info" | "clean";
export type FindingSeverity = "critical" | "warning" | "info" | "praise";
export type FindingType = "bug" | "security" | "performance" | "style" | "maintainability" | "suggestion" | "praise";
export type ReviewStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export interface Finding {
    type: FindingType;
    severity: FindingSeverity;
    file: string;
    line_start: number | null;
    line_end: number | null;
    title: string;
    description: string;
    suggestion: string | null;
    code_snippet: string | null;
}

export interface Review {
    id: string;
    repo_full_name: string;
    provider: Provider;
    pr_number: number;
    pr_title: string;
    pr_author: string;
    commit_sha: string;
    commit_message: string | null;
    branch_name: string;
    summary: string;
    severity: Severity;
    findings: Finding[];
    raw_output: string;
    files_reviewed: string[];
    stats: { files_changed: number; additions: number; deletions: number };
    review_duration_ms: number | null;
    claude_model: string | null;
    status: ReviewStatus;
    error_message: string | null;
    created_at: string;
}

export interface Repository {
    id: string;
    full_name: string;
    provider: Provider;
    org_url: string | null;           // Only for Azure DevOps
    default_branch: string;
    added_at: string;
    last_polled_at: string | null;
    is_active: boolean;
}

export interface ReviewJob {
    id: string;
    repoFullName: string;
    provider: Provider;
    prNumber: number;
    prTitle: string;
    prAuthor: string;
    commitSha: string;
    commitMessage: string;
    branchName: string;
    enqueuedAt: Date;
}

// ── Settings & Config Types ────────────────────────────

export type SettingType = "number" | "boolean" | "string" | "enum";
export type SettingCategory = "polling" | "review" | "claude" | "storage" | "server" | "providers";

export interface SettingEntry {
    key: string;
    label: string;
    description: string;
    category: SettingCategory;
    type: SettingType;
    enumValues?: string[];
    currentValue: unknown;
    defaultValue: unknown;
    isOverridden: boolean;
    editable: boolean;
    requiresRestart: boolean;
    sensitive: boolean;
}

export interface SettingsUpdateResult {
    applied: Array<{ key: string; old_value: unknown; new_value: unknown }>;
    rejected: Array<{ key: string; error: string }>;
}

export interface SettingResetResult {
    key: string;
    previous_value: unknown;
    restored_value: unknown;
    source: "env_default";
}

// ── Cleanup Types ──────────────────────────────────────

export interface CleanupResult {
    reviewsDeleted: number;
    seenCommitsDeleted: number;
    clonesDeleted: number;
    cloneSpaceFreedBytes: number;
    cloneSpacePrunedBytes: number;
    durationMs: number;
    dbSizeBeforeBytes: number;
    dbSizeAfterBytes: number;
}

export interface CleanupPreview {
    retentionDays: number;
    cutoffDate: string;
    reviewsToDelete: number;
    oldestReviewDate: string | null;
    totalReviews: number;
    percentageToDelete: number;
    orphanedClones: Array<{ repoFullName: string; sizeBytes: number }>;
    totalCloneSize: number;
}

export interface GitCloneInfo {
    dirName: string;
    repoFullName: string;
    provider: string;
    sizeBytes: number;
    lastModified: Date;
    isTracked: boolean;             // false = orphaned, will be deleted on cleanup
}

// ── System Status Types ────────────────────────────────

export interface SystemStatus {
    uptime_seconds: number;
    queue_depth: number;
    currently_reviewing: {
        repo: string;
        pr_number: number;
        commit_sha: string;
        started_at: string;
    } | null;
    last_poll_at: string | null;
    next_poll_at: string | null;
    total_reviews_completed: number;
    reviews_today: number;
    claude_cli_available: boolean;
    retention: {
        enabled: boolean;
        retentionDays: number;
        nextCleanupAt: string | null;
        pendingDeletion: {
            reviewCount: number;
            oldestReviewDate: string | null;
        };
    };
    storage: {
        dbSizeBytes: number;
        totalCloneSizeBytes: number;
        cloneCount: number;
    };
}
```

---
