// ── Domain Types ────────────────────────────────────────

export type Provider = "github" | "azure_devops";
export type Severity = "critical" | "warning" | "info" | "clean";
export type FindingSeverity = "critical" | "warning" | "info" | "praise";
export type FindingType = "bug" | "security" | "performance" | "style" | "maintainability" | "suggestion" | "praise";
export type ReviewStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";
export type PrState = "open" | "closed" | "merged";

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
    target_branch?: string;
    pr_state: PrState | null;
    pr_url: string | null;
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
    org_url: string | null;
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
    targetBranch: string;
    prState: PrState;
    prUrl: string;
    enqueuedAt: Date;
}

// ── Provider Types ────────────────────────────────────────

export interface ProviderPullRequest {
    number: number;
    title: string;
    author: string;
    sourceBranch: string;
    targetBranch: string;
    isDraft: boolean;
    state: "open" | "closed" | "merged";
    url: string;
}

export interface ProviderCommit {
    sha: string;
    message: string;
    author: string;
    date: string;
}

export interface ProviderFile {
    path: string;
    additions: number;
    deletions: number;
    status: "added" | "modified" | "deleted" | "renamed";
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
    isTracked: boolean;
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
        retention_days: number;
        next_cleanup_at: string | null;
        pending_deletion: {
            review_count: number;
            oldest_review_date: string | null;
        };
    };
    storage: {
        db_size_bytes: number;
        total_clone_size_bytes: number;
        clone_count: number;
    };
}

// ── Git Provider Interface ─────────────────────────────

export interface GitProvider {
    readonly providerName: Provider;

    listPullRequests(
        repoFullName: string,
        state: "open" | "closed" | "all"
    ): Promise<ProviderPullRequest[]>;

    listPRCommits(
        repoFullName: string,
        prNumber: number
    ): Promise<ProviderCommit[]>;

    getPRDiff(
        repoFullName: string,
        prNumber: number
    ): Promise<string>;

    getPRFiles(
        repoFullName: string,
        prNumber: number
    ): Promise<ProviderFile[]>;

    getCloneUrl(repoFullName: string): string;

    getDefaultBranch(repoFullName: string): Promise<string>;

    getPRState(repoFullName: string, prNumber: number): Promise<PrState>;

    postPrComment(
        repoFullName: string,
        prNumber: number,
        body: string,
        marker?: string,
    ): Promise<{ url: string | null; action: 'created' | 'updated' }>;
}
