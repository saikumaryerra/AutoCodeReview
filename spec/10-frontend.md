## 10. Frontend Specification

### 10.1 Pages and Routes

| Route | Page Component | Purpose |
|-------|---------------|---------|
| `/` | `Dashboard` | Landing page with recent reviews, severity breakdown chart, and quick stats |
| `/search` | `Search` | Full search interface with filters for repo, PR number, commit, severity, date range |
| `/pr/:repo/:prNumber` | `PRDetail` | Timeline view of all reviews on a single PR showing the evolution of code quality |
| `/review/:id` | `ReviewDetail` | Full review display with all findings, code snippets, and severity indicators |
| `/settings` | `Settings` | Manage tracked repositories, view system status, and manage data retention |

### 10.2 Dashboard Page

The dashboard is the first thing developers see. It should give an instant overview of recent activity and highlight anything that needs attention.

**Layout:**

The top section shows 4 stat cards in a row: "Reviews Today" (number), "In Queue" (number), "Critical Issues Found" (number, shown in red if > 0), and "Average Review Time" (formatted duration). Below that, a "Recent Reviews" list shows the last 20 reviews as compact cards, each showing the repo name, PR number and title, commit SHA (truncated to 7 chars), severity badge, findings count, and relative timestamp ("3 minutes ago"). A sidebar or second column shows a severity breakdown — a simple donut chart or stacked bar showing how many reviews in the last 7 days were clean vs info vs warning vs critical.

### 10.3 Search Page

A unified search bar at the top accepts either a PR number (detects numbers), a commit SHA (detects hex strings >= 7 chars), or a free-text search (matches against PR titles). Below the search bar, filter chips let the user narrow by repository (dropdown), severity (multi-select), status, and date range. Results appear as a paginated list of review cards identical to the dashboard.

### 10.4 PR Detail Page

This page tells the story of a PR across multiple reviews. The header shows PR metadata (number, title, author, branch, repo). Below that is a vertical timeline where each node is a commit. Each timeline node shows the commit SHA and message, the severity badge for that review, the findings count, and a mini-summary. Clicking a timeline node expands it inline (or navigates to the full review page). This lets developers see how the PR improved (or didn't) over successive commits.

### 10.5 Review Detail Page

The full review view. The header repeats PR metadata plus the specific commit SHA, branch, and review timestamp. Below is the summary paragraph. Then, findings are displayed as an expandable list grouped by file. Each finding card shows the severity badge, the title, the file and line range, the full description, the suggestion (if any), and the code snippet rendered with syntax highlighting. A "Raw Output" collapsible section at the bottom shows the unprocessed Claude CLI output for debugging.

### 10.6 Component Specifications

**ReviewCard** — Used on Dashboard and Search pages. Shows: repo avatar or icon, PR `#number: title`, commit SHA as a monospace chip, severity badge (color-coded: red for critical, yellow for warning, blue for info, green for clean), findings count, and relative time. Entire card is clickable and navigates to the review detail page.

**SeverityBadge** — A small pill-shaped badge with a background color and text. Critical: red bg, white text. Warning: amber bg, dark text. Info: blue bg, white text. Clean: green bg, dark text. Praise: purple bg, white text. Uses the same color mapping everywhere for consistency.

**PRTimeline** — A vertical timeline with a connecting line. Each node has a dot colored by severity, with the commit info to the right. Nodes are ordered chronologically (oldest at top).

**ReviewBody** — Renders the full findings list for a review. Groups findings by file. Within each file group, findings are sorted by line number. Each finding is a card with an icon for its type (bug icon for bugs, shield for security, etc.), the severity badge, and collapsible description/suggestion sections. Code snippets use `react-syntax-highlighter` with a light theme.

**SearchBar** — A single input with an icon. As the user types, it detects the input type (number → PR search, hex string → commit search, otherwise → title search) and shows a hint below the input like "Searching by PR number..." so the user knows what will happen.

### 10.7 Settings Page

The Settings page is the operational control center of the application. It has four sections, each in its own card, organized from most-frequently-used at the top to least-frequently-used at the bottom.

**Configuration** — This is the new section that enables changing system behavior from the UI without SSH access or container restarts. It is powered entirely by the `GET /api/v1/settings` and `PATCH /api/v1/settings` endpoints.

On page load, the frontend fetches all settings from the API. Settings are displayed grouped by their `category` field, with each category rendered as a collapsible section: "Polling", "Review Behavior", "Claude CLI", and "Providers". Within each category, settings are rendered dynamically based on their `type` metadata from the config registry: `number` fields render as numeric inputs with min/max validation, `boolean` fields render as toggle switches, `enum` fields render as dropdown selects populated from the `enumValues` array, and `string` fields render as text inputs. Settings where `editable: false` are rendered as read-only display fields with a lock icon and a tooltip explaining "This setting can only be changed via the .env file." Settings where `sensitive: true` show the masked value (e.g., `ghp_****xxxx`) and never expose the real token.

Each editable setting has an inline "Reset to default" link that appears only when `is_overridden: true`. Clicking it calls `POST /api/v1/settings/:key/reset` and restores the `.env` default. A visual indicator (a small blue dot or "Modified" badge) marks any setting that differs from its default, so administrators can see at a glance what has been customized.

The section has a "Save Changes" button at the bottom that collects all modified fields and sends them in a single `PATCH /api/v1/settings` request. On success, a toast notification shows "Settings updated — changes are active immediately." If any keys were rejected (validation failure or non-editable), the toast shows a warning with the specific errors, and the rejected fields are highlighted in red. Settings that have `requires_restart: true` (currently none of the editable ones, but included for future-proofing) show a banner: "This change will take effect after the next container restart."

**Tracked Repositories** — A table listing all repositories with columns for name, provider (GitHub icon or Azure DevOps icon), status (active/paused), last polled time, and total review count. Each row has a toggle to pause/resume polling and a delete button (with confirmation modal that warns "This will stop polling — existing reviews are preserved"). An "Add Repository" button opens a form with a provider selector dropdown (GitHub or Azure DevOps), a repo name input, and a default branch input.

**System Status** — Displays the live system health data from the `/api/v1/status` endpoint: uptime, queue depth, whether Claude CLI is available (green dot or red dot), the currently running review (if any), and the last/next poll times. This section auto-refreshes every 10 seconds.

**Data Retention & Storage** — Displays the current retention policy (read from the `review.retentionDays` setting, which is now editable in the Configuration section above) and the current disk usage. At the top, a summary line reads "Reviews older than 90 days are automatically deleted daily at 3:00 AM" (or "Automatic cleanup is disabled" if `retentionDays = 0`). Below that, a storage breakdown shows the SQLite database size and the total size of all git clones. A "pending cleanup" box shows how many reviews would be deleted by the next scheduled run (fetched from `/api/v1/cleanup/preview`) along with the oldest review date. A "Run Cleanup Now" button triggers the manual cleanup endpoint with a confirmation modal that shows the preview count: "This will permanently delete 142 reviews and prune all git clones. This action cannot be undone." After the cleanup runs, the page shows a success banner with the number of reviews deleted and the disk space reclaimed.

### 10.8 API Client

```typescript
// frontend/src/api/client.ts

import axios from 'axios';

const api = axios.create({
    baseURL: '/api/v1',  // Proxied by Vite in dev, served by Express in prod
});

export const reviewsApi = {
    list: (params: ReviewListParams) => api.get('/reviews', { params }),
    getById: (id: string) => api.get(`/reviews/${id}`),
    getByPR: (repo: string, prNumber: number) =>
        api.get(`/reviews/pr/${encodeURIComponent(repo)}/${prNumber}`),
    getByCommit: (sha: string) => api.get(`/reviews/commit/${sha}`),
    trigger: (body: TriggerReviewBody) => api.post('/reviews/trigger', body),
};

export const reposApi = {
    list: () => api.get('/repos'),
    add: (body: AddRepoBody) => api.post('/repos', body),
    update: (id: string, body: UpdateRepoBody) => api.patch(`/repos/${id}`, body),
    remove: (id: string) => api.delete(`/repos/${id}`),
};

export const settingsApi = {
    getAll: () => api.get('/settings'),
    update: (settings: Record<string, unknown>) => api.patch('/settings', { settings }),
    reset: (key: string) => api.post(`/settings/${encodeURIComponent(key)}/reset`),
};

export const cleanupApi = {
    preview: (retentionDays?: number) =>
        api.get('/cleanup/preview', { params: retentionDays ? { retention_days: retentionDays } : {} }),
    trigger: (retentionDays?: number) =>
        api.post('/cleanup', retentionDays ? { retention_days: retentionDays } : {}),
};

export const statusApi = {
    get: () => api.get('/status'),
};
```

---

