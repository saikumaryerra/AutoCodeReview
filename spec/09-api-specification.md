## 9. API Specification

### 9.1 Retention Status in the API

The system status endpoint (`GET /api/v1/status`) is extended to include retention information so the frontend can display it on the Settings page.

All endpoints are prefixed with `/api/v1`. The Express server runs on `API_PORT` (default 3001).

### 9.2 Endpoints

**GET /api/v1/reviews**
List reviews with filtering and pagination.

Query parameters:
- `repo` (optional): Filter by repository full name, e.g. `myorg/backend-api`
- `provider` (optional): Filter by provider: `github`, `azure_devops`
- `pr` (optional): Filter by PR number
- `commit` (optional): Filter by commit SHA (exact or prefix match with minimum 7 chars)
- `severity` (optional): Filter by severity: `critical`, `warning`, `info`, `clean`
- `status` (optional): Filter by status: `completed`, `failed`, `skipped`, `pending`, `in_progress`
- `page` (optional, default 1): Page number
- `limit` (optional, default 20, max 100): Results per page
- `sort` (optional, default `created_at`): Sort field — `created_at`, `severity`, `pr_number`
- `order` (optional, default `desc`): Sort order — `asc` or `desc`

Response:
```json
{
    "data": [
        {
            "id": "uuid",
            "repo_full_name": "myorg/backend-api",
            "provider": "github",
            "pr_number": 142,
        }
    ],
    "pagination": {
        "page": 1,
        "limit": 20,
        "total": 87,
        "total_pages": 5
    }
}
```

Note: The list endpoint returns `findings_count` instead of the full findings array to keep responses lightweight.

---

**GET /api/v1/reviews/:id**
Get a single review by its UUID, including the full findings array.

Response:
```json
{
    "data": {
        "id": "uuid",
        "repo_full_name": "myorg/backend-api",
        "pr_number": 142,
        "pr_title": "Add user authentication",
        "pr_author": "alice",
        "commit_sha": "abc1234def5678...",
        "commit_message": "implement JWT auth middleware",
        "branch_name": "feature/auth",
        "summary": "This change introduces JWT authentication...",
        "severity": "warning",
        "findings": [ /* full Finding objects */ ],
        "files_reviewed": ["src/auth/middleware.ts", "src/auth/jwt.ts"],
        "stats": { "files_changed": 4, "additions": 120, "deletions": 15 },
        "status": "completed",
        "review_duration_ms": 45000,
        "claude_model": "claude-sonnet-4-20250514",
        "created_at": "2026-04-07T14:30:00Z"
    }
}
```

---

**GET /api/v1/reviews/pr/:repoFullName/:prNumber**
Get all reviews for a specific PR, ordered by commit date (oldest first). This powers the "PR Timeline" view showing how the code evolved across reviews.

Path parameters:
- `repoFullName`: URL-encoded repo name, e.g. `myorg%2Fbackend-api`
- `prNumber`: The PR number

Response:
```json
{
    "data": {
        "pr_number": 142,
        "pr_title": "Add user authentication",
        "pr_author": "alice",
        "repo_full_name": "myorg/backend-api",
        "branch_name": "feature/auth",
        "reviews": [
            {
                "id": "uuid-1",
                "commit_sha": "aaa111...",
                "commit_message": "initial auth scaffold",
                "severity": "critical",
                "summary": "...",
                "findings_count": 5,
                "created_at": "2026-04-05T10:00:00Z"
            },
            {
                "id": "uuid-2",
                "commit_sha": "bbb222...",
                "commit_message": "address review feedback",
                "severity": "info",
                "summary": "...",
                "findings_count": 1,
                "created_at": "2026-04-06T09:00:00Z"
            }
        ]
    }
}
```

---

**GET /api/v1/reviews/commit/:commitSha**
Look up a review by commit SHA. Supports prefix matching (minimum 7 characters). This is useful for finding a review when you have a commit SHA from a git log or CI pipeline.

Response: Same shape as the single review endpoint.

---

**GET /api/v1/repos**
List all tracked repositories with their polling status.

Response:
```json
{
    "data": [
        {
            "id": "uuid",
            "full_name": "myorg/backend-api",
            "default_branch": "main",
            "is_active": true,
            "last_polled_at": "2026-04-07T14:28:00Z",
            "added_at": "2026-03-15T09:00:00Z",
            "review_count": 142
        }
    ]
}
```

---

**POST /api/v1/repos**
Add a new repository to track.

Request body:
```json
{
    "full_name": "myorg/new-service",
    "default_branch": "main"
}
```

---

**PATCH /api/v1/repos/:id**
Update a repository (pause/resume polling, change default branch).

Request body:
```json
{
    "is_active": false
}
```

---

**DELETE /api/v1/repos/:id**
Remove a repository from tracking (does not delete past reviews).

---

**GET /api/v1/status**
System health and queue status.

Response:
```json
{
    "data": {
        "uptime_seconds": 86400,
        "queue_depth": 2,
        "currently_reviewing": {
            "repo": "myorg/backend-api",
            "pr_number": 142,
            "commit_sha": "abc1234...",
            "started_at": "2026-04-07T14:30:00Z"
        },
        "last_poll_at": "2026-04-07T14:28:00Z",
        "next_poll_at": "2026-04-07T14:30:00Z",
        "total_reviews_completed": 1247,
        "reviews_today": 12,
        "claude_cli_available": true,
        "retention": {
            "enabled": true,
            "retention_days": 90,
            "next_cleanup_at": "2026-04-08T03:00:00Z",
            "pending_deletion": {
                "review_count": 142,
                "oldest_review_date": "2026-01-05T09:30:00Z"
            }
        },
        "storage": {
            "db_size_bytes": 52428800,
            "total_clone_size_bytes": 2147483648,
            "clone_count": 5
        }
    }
}
```

---

**POST /api/v1/reviews/trigger**
Manually trigger a review for a specific PR and commit. Useful for retrying failed reviews or reviewing older commits.

Request body:
```json
{
    "repo_full_name": "myorg/backend-api",
    "pr_number": 142,
    "commit_sha": "abc1234def5678..."
}
```

---

**POST /api/v1/cleanup**
Manually trigger a retention cleanup outside the daily 3 AM schedule. Useful when you need to reclaim disk space immediately or after changing the retention period. The response reports how many reviews and seen_commits entries were actually deleted.

Request body (optional — if omitted, uses the configured `REVIEW_RETENTION_DAYS`):
```json
{
    "retention_days": 90
}
```

Response:
```json
{
    "data": {
        "reviews_deleted": 142,
        "seen_commits_deleted": 87,
        "clones_deleted": 1,
        "clone_space_freed_bytes": 524288000,
        "clone_space_pruned_bytes": 104857600,
        "duration_ms": 2340,
        "db_size_before_bytes": 52428800,
        "db_size_after_bytes": 41943040
    }
}
```

---

**GET /api/v1/cleanup/preview**
Preview what a cleanup would delete without actually deleting anything. Useful for verifying the retention period before triggering a destructive operation. Accepts an optional `retention_days` query parameter to simulate a different retention period than the configured default.

Query parameters:
- `retention_days` (optional): Override the configured retention period for this preview

Response:
```json
{
    "data": {
        "retention_days": 90,
        "cutoff_date": "2026-01-07T00:00:00Z",
        "reviews_to_delete": 142,
        "oldest_review_date": "2025-12-01T14:30:00Z",
        "total_reviews": 1247,
        "percentage_to_delete": 11.4,
        "orphaned_clones": [
            { "repo_full_name": "myorg/old-service", "size_bytes": 524288000 }
        ],
        "total_clone_size_bytes": 2147483648
    }
}
```

---

**GET /api/v1/settings**
Returns all configuration keys with their current effective values, metadata, and edit permissions. This is the primary endpoint that powers the Settings page in the UI. Sensitive values (tokens, API keys) are masked in the response — the actual values are never sent to the frontend.

Response:
```json
{
    "data": [
        {
            "key": "polling.intervalSeconds",
            "label": "Polling Interval",
            "description": "How often to check for new PRs and commits, in seconds.",
            "category": "polling",
            "type": "number",
            "current_value": 120,
            "default_value": 120,
            "is_overridden": false,
            "editable": true,
            "requires_restart": false,
            "sensitive": false
        },
        {
            "key": "review.retentionDays",
            "label": "Review Retention Period",
            "description": "Reviews older than this many days are automatically deleted.",
            "category": "review",
            "type": "number",
            "current_value": 90,
            "default_value": 90,
            "is_overridden": false,
            "editable": true,
            "requires_restart": false,
            "sensitive": false
        },
        {
            "key": "github.token",
            "label": "GitHub Token",
            "description": "Personal Access Token for GitHub API access.",
            "category": "providers",
            "type": "string",
            "current_value": "ghp_****xxxx",
            "default_value": "ghp_****xxxx",
            "is_overridden": false,
            "editable": false,
            "requires_restart": true,
            "sensitive": true
        }
    ]
}
```

---

**PATCH /api/v1/settings**
Update one or more configuration values from the UI. Only keys marked as `editable: true` can be changed through this endpoint. Each value is validated against its Zod schema before being persisted. Changes take effect immediately — no restart required.

Request body:
```json
{
    "settings": {
        "polling.intervalSeconds": 60,
        "review.skipDrafts": false,
        "review.retentionDays": 30
    }
}
```

Response:
```json
{
    "data": {
        "applied": [
            { "key": "polling.intervalSeconds", "old_value": 120, "new_value": 60 },
            { "key": "review.skipDrafts", "old_value": true, "new_value": false },
            { "key": "review.retentionDays", "old_value": 90, "new_value": 30 }
        ],
        "rejected": []
    }
}
```

If a key is not editable or validation fails, it appears in the `rejected` array with an error message, and the valid keys are still applied (partial success):

```json
{
    "data": {
        "applied": [
            { "key": "polling.intervalSeconds", "old_value": 120, "new_value": 60 }
        ],
        "rejected": [
            { "key": "github.token", "error": "This setting cannot be changed at runtime" },
            { "key": "review.maxFilesChanged", "error": "Value must be between 1 and 500" }
        ]
    }
}
```

---

**POST /api/v1/settings/:key/reset**
Resets a single configuration key back to its `.env` default by removing the database override. The next time the key is read, the original `.env` value will be used.

Response:
```json
{
    "data": {
        "key": "polling.intervalSeconds",
        "previous_value": 60,
        "restored_value": 120,
        "source": "env_default"
    }
}
```

---

