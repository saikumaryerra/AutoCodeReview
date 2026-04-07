export type Severity = 'critical' | 'warning' | 'info' | 'clean' | 'praise';
export type ReviewStatus = 'completed' | 'failed' | 'skipped' | 'pending' | 'in_progress';
export type Provider = 'github' | 'azure_devops';
export type FindingType = 'bug' | 'security' | 'performance' | 'style' | 'maintainability' | 'praise' | 'other';

export interface Finding {
  type: FindingType;
  severity: Severity;
  title: string;
  description: string;
  file: string;
  line_start: number;
  line_end: number;
  suggestion: string | null;
  code_snippet: string | null;
  language: string | null;
}

export interface ReviewListItem {
  id: string;
  repo_full_name: string;
  provider: Provider;
  pr_number: number;
  pr_title: string;
  pr_author: string;
  commit_sha: string;
  commit_message: string;
  branch_name: string;
  severity: Severity;
  findings_count: number;
  status: ReviewStatus;
  review_duration_ms: number | null;
  created_at: string;
}

export interface ReviewDetail {
  id: string;
  repo_full_name: string;
  provider: Provider;
  pr_number: number;
  pr_title: string;
  pr_author: string;
  commit_sha: string;
  commit_message: string;
  branch_name: string;
  summary: string;
  severity: Severity;
  findings: Finding[];
  files_reviewed: string[];
  stats: {
    files_changed: number;
    additions: number;
    deletions: number;
  };
  status: ReviewStatus;
  review_duration_ms: number | null;
  claude_model: string;
  raw_output?: string;
  created_at: string;
}

export interface PRReviewItem {
  id: string;
  commit_sha: string;
  commit_message: string;
  severity: Severity;
  summary: string;
  findings_count: number;
  created_at: string;
}

export interface PRDetailData {
  pr_number: number;
  pr_title: string;
  pr_author: string;
  repo_full_name: string;
  branch_name: string;
  reviews: PRReviewItem[];
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface ReviewListParams {
  repo?: string;
  provider?: Provider;
  pr?: number;
  commit?: string;
  severity?: Severity;
  status?: ReviewStatus;
  page?: number;
  limit?: number;
  sort?: 'created_at' | 'severity' | 'pr_number';
  order?: 'asc' | 'desc';
}

export interface TriggerReviewBody {
  repo_full_name: string;
  pr_number: number;
  commit_sha: string;
}

export interface Repository {
  id: string;
  full_name: string;
  provider: Provider;
  default_branch: string;
  is_active: boolean;
  last_polled_at: string | null;
  added_at: string;
  review_count: number;
}

export interface AddRepoBody {
  full_name: string;
  provider: Provider;
  default_branch: string;
}

export interface UpdateRepoBody {
  is_active?: boolean;
  default_branch?: string;
}

export interface SettingItem {
  key: string;
  label: string;
  description: string;
  category: string;
  type: 'number' | 'boolean' | 'string' | 'enum';
  current_value: string | number | boolean;
  default_value: string | number | boolean;
  is_overridden: boolean;
  editable: boolean;
  requires_restart: boolean;
  sensitive: boolean;
  enumValues?: string[];
  min?: number;
  max?: number;
}

export interface SettingsUpdateResult {
  applied: Array<{ key: string; old_value: unknown; new_value: unknown }>;
  rejected: Array<{ key: string; error: string }>;
}

export interface CurrentlyReviewing {
  repo: string;
  pr_number: number;
  commit_sha: string;
  started_at: string;
}

export interface SystemStatus {
  uptime_seconds: number;
  queue_depth: number;
  currently_reviewing: CurrentlyReviewing | null;
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

export interface PollResult {
  repos_polled: number;
  new_commits_found: number;
  reviews_enqueued: number;
  duration_ms: number;
  details: Array<{ repo: string; new_commits: number }>;
}

export interface CleanupPreview {
  retention_days: number;
  cutoff_date: string;
  reviews_to_delete: number;
  oldest_review_date: string | null;
  total_reviews: number;
  percentage_to_delete: number;
  orphaned_clones: Array<{ repo_full_name: string; size_bytes: number }>;
  total_clone_size_bytes: number;
}

export interface CleanupResult {
  reviews_deleted: number;
  seen_commits_deleted: number;
  clones_deleted: number;
  clone_space_freed_bytes: number;
  clone_space_pruned_bytes: number;
  duration_ms: number;
  db_size_before_bytes: number;
  db_size_after_bytes: number;
}

export interface ApiResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}
