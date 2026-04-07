## 7. Core Module Specifications

### 7.1 Poller Service (`src/poller/poller.service.ts`)

The poller is the heartbeat of the application. It runs as a `node-cron` job inside the main process (not a separate worker).

**Polling cycle (runs every `POLL_INTERVAL_SECONDS`):**

1. For each active repository in the `repositories` table:
   a. Use the **ProviderFactory** to get the right `GitProvider` implementation based on the repository's `provider` column.
   b. Call `provider.listPullRequests()` to list open PRs.
   c. For each PR, skip if `SKIP_DRAFTS=true` and PR is a draft.
   d. Call `provider.listPRCommits()` to get commits on the PR.
   e. Take the **latest commit** (head of the PR branch).
   f. Check the `seen_commits` table — has this `(repo, pr_number, commit_sha)` been seen before?
   g. If not seen: enqueue a review job. Do **not** insert into `seen_commits` yet — that happens only after the review completes (status `completed` or `skipped`) or permanently fails (status `failed` after exhausting retries). This ensures that if the process crashes while a review is queued or in-progress, the next poll cycle will re-detect the commit and re-enqueue it.
2. Update `last_polled_at` on the repository record.
3. Log a summary: "Polled 3 repos (2 GitHub, 1 Azure DevOps), found 2 new commits to review."

**Rate limit handling:** Each provider handles rate limits internally. The GitHub provider reads `X-RateLimit-Remaining` headers and pauses if remaining calls drop below 100. The Azure DevOps provider respects `Retry-After` headers on 429 responses.

**Error handling:** If a single repo fails to poll (network error, 404, auth failure, etc.), log the error and continue to the next repo — don't let one broken repo stop all polling.

### 7.2 Git Provider Interface (`src/poller/provider.interface.ts`)

This is the core abstraction that makes the system provider-agnostic. Every git hosting platform implements this interface. The poller, reviewer, and all other modules interact only with this interface — they never import provider-specific code directly.

```typescript
// The normalized data shapes that all providers must return.
// These strip away provider-specific quirks and give the rest of the
// system a single vocabulary for PRs, commits, and files.

interface ProviderPullRequest {
    number: number;              // PR number (GitHub) or PR ID (Azure DevOps)
    title: string;
    author: string;              // Username
    sourceBranch: string;        // e.g. "feature/auth"
    targetBranch: string;        // e.g. "main"
    isDraft: boolean;
    state: "open" | "closed" | "merged";
    url: string;                 // Web URL to the PR for linking in the UI
}

interface ProviderCommit {
    sha: string;                 // Full 40-char SHA
    message: string;             // First line of commit message
    author: string;
    date: string;                // ISO timestamp
}

interface ProviderFile {
    path: string;                // Relative file path
    additions: number;
    deletions: number;
    status: "added" | "modified" | "deleted" | "renamed";
}

// The contract every provider must implement
interface GitProvider {
    readonly providerName: "github" | "azure_devops";

    // List pull requests matching the state filter
    listPullRequests(
        repoFullName: string,
        state: "open" | "closed" | "all"
    ): Promise<ProviderPullRequest[]>;

    // List all commits on a specific PR
    listPRCommits(
        repoFullName: string,
        prNumber: number
    ): Promise<ProviderCommit[]>;

    // Get the unified diff for a PR as a string
    getPRDiff(
        repoFullName: string,
        prNumber: number
    ): Promise<string>;

    // Get metadata about changed files in a PR
    getPRFiles(
        repoFullName: string,
        prNumber: number
    ): Promise<ProviderFile[]>;

    // Return the git clone URL for this repo (with auth token embedded)
    // Used by RepoManager to clone/pull the repo locally
    getCloneUrl(repoFullName: string): string;
}
```

### 7.3 GitHub Provider (`src/poller/github.provider.ts`)

The GitHub implementation wraps `Octokit` and maps GitHub API responses to the normalized `GitProvider` types.

```typescript
class GitHubProvider implements GitProvider {
    readonly providerName = "github";
    private octokit: Octokit;
    private token: string;

    constructor(token: string);

    // Splits "owner/repo" into owner and repo, then calls
    // GET /repos/{owner}/{repo}/pulls?state={state}
    // Maps GitHub's draft field and state ("open"/"closed") to ProviderPullRequest.
    // GitHub uses "closed" for both closed-without-merge and merged — check
    // the `merged_at` field to distinguish.
    async listPullRequests(repoFullName: string, state: "open" | "closed" | "all"): Promise<ProviderPullRequest[]>;

    // GET /repos/{owner}/{repo}/pulls/{prNumber}/commits
    async listPRCommits(repoFullName: string, prNumber: number): Promise<ProviderCommit[]>;

    // GET /repos/{owner}/{repo}/pulls/{prNumber}
    // with Accept: application/vnd.github.v3.diff header
    async getPRDiff(repoFullName: string, prNumber: number): Promise<string>;

    // GET /repos/{owner}/{repo}/pulls/{prNumber}/files
    async getPRFiles(repoFullName: string, prNumber: number): Promise<ProviderFile[]>;

    // Returns: https://{token}@github.com/{owner}/{repo}.git
    getCloneUrl(repoFullName: string): string;
}
```

### 7.4 Azure DevOps Provider (`src/poller/azuredevops.provider.ts`)

The Azure DevOps implementation uses `azure-devops-node-api` and maps Azure DevOps API concepts to the same normalized types. This section details the API mapping because Azure DevOps has significantly different terminology and URL structures from GitHub.

**Key concept mapping:**

Azure DevOps uses a three-level hierarchy: **Organization** → **Project** → **Repository**. The org is configured once in `AZURE_DEVOPS_ORG_URL`. Each repo is specified as `"Project/RepoName"` in `AZURE_DEVOPS_REPOS`. Pull requests in Azure DevOps are identified by a numeric `pullRequestId` (equivalent to GitHub's PR number). Azure DevOps PRs have statuses `active`, `completed`, and `abandoned` — these map to `open`, `merged`, and `closed` respectively. Azure DevOps marks draft PRs with the `isDraft` boolean, same as GitHub.

```typescript
class AzureDevOpsProvider implements GitProvider {
    readonly providerName = "azure_devops";
    private connection: WebApi;     // from azure-devops-node-api
    private gitApi: IGitApi;
    private orgUrl: string;
    private token: string;

    constructor(orgUrl: string, token: string);

    // Initialize must be called once before use (creates the API connection).
    // Called by ProviderFactory during construction.
    async initialize(): Promise<void>;

    // Splits "Project/Repo" into project and repo name.
    // Calls gitApi.getPullRequests(repoId, searchCriteria) where
    // searchCriteria.status maps "open" → PullRequestStatus.Active,
    // "closed" → PullRequestStatus.Abandoned, "all" → PullRequestStatus.All.
    // Also fetches PullRequestStatus.Completed for the "all" and "closed" cases.
    async listPullRequests(repoFullName: string, state: "open" | "closed" | "all"): Promise<ProviderPullRequest[]>;

    // Calls gitApi.getPullRequestCommits(repoName, prId, project).
    // Azure DevOps returns commits with commitId (the SHA).
    async listPRCommits(repoFullName: string, prNumber: number): Promise<ProviderCommit[]>;

    // Azure DevOps does not have a single "get diff" endpoint like GitHub.
    // Instead, we get the diff by comparing the source and target branches:
    //   1. Get the PR details to find source/target refs
    //   2. Call gitApi.getCommitDiffs(repoName, project, ...) or
    //   3. For each changed file, call gitApi.getItemText() for both versions
    //      and produce a unified diff programmatically
    //
    // The pragmatic approach: use `git diff` locally after the repo is checked out.
    // The RepoManager checks out the target branch, then diffs against the source
    // commit. This approach is simpler, consistent across providers, and avoids
    // Azure DevOps API limitations around large diffs.
    async getPRDiff(repoFullName: string, prNumber: number): Promise<string>;

    // Calls gitApi.getPullRequestIterationChanges() to get the list of changed files
    // for the latest iteration (Azure DevOps groups PR updates into "iterations").
    // Maps VersionControlChangeType to our normalized status: Add → "added",
    // Edit → "modified", Delete → "deleted", Rename → "renamed".
    async getPRFiles(repoFullName: string, prNumber: number): Promise<ProviderFile[]>;

    // Returns: https://{token}@dev.azure.com/{org}/{project}/_git/{repo}
    // The token is used as a Basic auth password with empty username.
    // Actual clone URL format for Azure DevOps:
    //   https://{anything}:{PAT}@dev.azure.com/{org}/{project}/_git/{repo}
    getCloneUrl(repoFullName: string): string;
}
```

**Azure DevOps diff strategy — important implementation note:**

The cleanest way to get a unified diff for an Azure DevOps PR is to compute it locally using `git diff` after the repo has been cloned and checked out. This is because the Azure DevOps REST API has no direct "give me the unified diff for this PR" endpoint (unlike GitHub's `Accept: application/vnd.github.v3.diff`). The reviewer service already clones the repo for Claude CLI to read, so generating the diff locally via `git diff {targetBranch}...{commitSha}` costs nothing extra and gives a clean unified diff identical in format to what GitHub returns.

This means `AzureDevOpsProvider.getPRDiff()` can either delegate to a local git operation (if the repo is already cloned) or return an empty string and let the `ReviewerService` generate the diff after checkout. The recommended approach is the latter — have `ReviewerService` always generate the diff locally for both providers, using `GitProvider.getPRDiff()` only as a fallback for providers that support it natively. This ensures consistent diff formatting regardless of provider.

### 7.5 Provider Factory (`src/poller/provider.factory.ts`)

The factory creates and caches provider instances. It reads from config at startup and returns the right provider for a given repository.

```typescript
class ProviderFactory {
    private githubProvider?: GitHubProvider;
    private azureDevOpsProvider?: AzureDevOpsProvider;

    constructor(config: typeof import('./config').config);

    // Returns the appropriate provider for a repository based on its
    // provider column. Throws if the provider isn't configured.
    getProvider(providerName: "github" | "azure_devops"): GitProvider;

    // Returns all configured providers (used during startup to seed repos)
    getAllConfiguredRepos(): Array<{ fullName: string; provider: "github" | "azure_devops" }>;
}
```

### 7.6 Review Queue (`src/poller/queue.ts`)

A simple in-memory FIFO queue. It does not need to survive restarts because the system performs a **startup reconciliation** step (see Section 7.6.1) that detects orphaned commits — entries in `seen_commits` that have no corresponding completed or skipped review — and re-enqueues them automatically.

```typescript
interface ReviewJob {
    id: string;                // UUID for this job
    repoFullName: string;      // "owner/repo"
    prNumber: number;
    prTitle: string;
    prAuthor: string;
    commitSha: string;
    commitMessage: string;
    branchName: string;
    enqueuedAt: Date;
}

class ReviewQueue {
    enqueue(job: ReviewJob): void;
    dequeue(): ReviewJob | null;
    peek(): ReviewJob | null;
    size(): number;
    isEmpty(): boolean;
}
```

The queue processes one job at a time. A continuous loop in the reviewer service calls `dequeue()`, processes the review, then calls `dequeue()` again.

### 7.6.1 Startup Reconciliation

When the system starts, there may be reviews stuck in `in_progress` state from a previous crash or unclean shutdown. These reviews were dequeued but never completed, and since the in-memory queue is gone, they would be orphaned forever. The reconciliation step runs **once at startup**, after the database is initialized but before the poller and reviewer begin.

```typescript
// In src/poller/reconciliation.ts

function reconcileOrphanedReviews(db: Database, queue: ReviewQueue): number {
    // Step 1: Find reviews stuck in 'in_progress' — these were mid-flight when
    // the process died. Reset them to 'pending' so they get re-processed.
    const orphaned = db.prepare(`
        UPDATE reviews
        SET status = 'pending', error_message = 'Reset after unclean shutdown'
        WHERE status = 'in_progress'
    `).run();

    // Step 2: Find all 'pending' reviews (including the ones just reset above)
    // and re-enqueue them. These have a reviews row but never reached a terminal state.
    const pending = db.prepare(`
        SELECT r.repo_full_name, r.pr_number, r.pr_title, r.pr_author,
               r.commit_sha, r.commit_message, r.branch_name
        FROM reviews r
        WHERE r.status = 'pending'
    `).all();

    for (const row of pending) {
        queue.enqueue({
            id: uuid(),
            repoFullName: row.repo_full_name,
            prNumber: row.pr_number,
            prTitle: row.pr_title,
            prAuthor: row.pr_author,
            commitSha: row.commit_sha,
            commitMessage: row.commit_message,
            branchName: row.branch_name,
            enqueuedAt: new Date(),
        });
    }

    const total = orphaned.changes + pending.length;
    return total;
}
```

**Why this is safe:** The poller only inserts into `seen_commits` after a review reaches a terminal state (`completed`, `skipped`, or `failed`). So if a commit has a `pending` or `in_progress` review, it is guaranteed to NOT be in `seen_commits`, meaning the poller would also re-detect it on its next cycle. The reconciliation step simply accelerates this by re-enqueuing immediately at startup rather than waiting for the next poll cycle.

**Edge case — duplicate enqueue:** If reconciliation re-enqueues a commit and then the poller also detects it (because it's not in `seen_commits`), the reviewer must handle this by checking the review status before starting work. If a review already exists with `status != 'pending'`, the duplicate job is silently dropped.

### 7.7 Repo Manager (`src/reviewer/repo-manager.ts`)

This module manages local git clones so that Claude CLI can read the full project source, not just a diff. It is provider-agnostic — it receives a clone URL from the `GitProvider` and works only with standard git operations.

```typescript
class RepoManager {
    constructor(reposDir: string);

    // Ensures a fresh local copy exists at the correct branch and commit.
    // The cloneUrl is obtained from the GitProvider — it already has auth embedded.
    // If the repo hasn't been cloned yet, it clones it.
    // If it exists, it fetches and checks out the target branch + commit.
    // Returns the absolute path to the local repo directory.
    async prepare(
        repoFullName: string,
        branchName: string,
        commitSha: string,
        cloneUrl: string         // Provider supplies this via getCloneUrl()
    ): Promise<string>;

    // Generates a unified diff locally using git. This is the preferred
    // method for all providers because it guarantees consistent diff format.
    // Runs: git diff {targetBranch}...{commitSha} from the repo directory.
    async generateDiff(
        repoFullName: string,
        targetBranch: string,
        commitSha: string
    ): Promise<string>;

    // Cleans up a repo directory if needed (e.g., after review)
    async cleanup(repoFullName: string): Promise<void>;
}
```

**Git operations** use the `src/utils/git.ts` helper, which shells out to `git` via `child_process.execFile`. Clone URLs already contain embedded auth tokens (the format differs by provider, but git handles both transparently):

GitHub: `https://{token}@github.com/{owner}/{repo}.git`
Azure DevOps: `https://pat:{token}@dev.azure.com/{org}/{project}/_git/{repo}`

**Directory naming:** repos are stored as `{REPOS_DIR}/{provider}__{project}__{repo}/` (double underscore separators, with the provider prefix to avoid naming collisions between a GitHub repo and an Azure DevOps repo that happen to share a name).

### 7.8 Claude CLI Executor (`src/reviewer/claude-cli.executor.ts`)

This is the most critical module. It spawns the `claude` CLI process and captures its output.

**How Claude CLI is invoked:**

```bash
claude --print \
  --output-format json \
  --max-turns 3 \
  --model {MODEL} \
  --allowedTools "View,GlobTool,GrepTool,BatchTool" \
  --prompt "{REVIEW_PROMPT}"
```

**Flag explanations:**

The `--print` flag tells Claude CLI to run non-interactively — it processes the prompt once and prints the result to stdout instead of entering a REPL. The `--output-format json` flag makes the output machine-parseable. The `--max-turns 3` limits how many tool-use rounds Claude can do (reading files, grepping code) so a review doesn't run forever. The `--allowedTools` flag restricts Claude to read-only operations — it can view files, search with glob and grep, and batch those operations, but it cannot edit, write, or execute anything.

**Implementation details:**

```typescript
interface ClaudeCliResult {
    success: boolean;
    stdout: string;            // Raw JSON output from claude CLI
    stderr: string;            // Any warnings or errors
    exitCode: number;
    durationMs: number;
    model: string | null;      // Extracted from output if available
}

class ClaudeCliExecutor {
    constructor(cliPath: string, timeoutSeconds: number, model?: string);

    // Executes a review by spawning claude CLI with the repo as the working directory.
    // The cwd is set to repoPath so Claude can read project files.
    async executeReview(repoPath: string, prompt: string): Promise<ClaudeCliResult>;
}
```

**Spawning strategy:** Use `child_process.spawn` (not `exec`) so we can stream stdout/stderr and enforce the timeout. If the process exceeds `CLAUDE_REVIEW_TIMEOUT_SECONDS`, kill it with SIGTERM, wait 5 seconds, then SIGKILL if still alive. Record the review as `status: 'failed'` with an appropriate error message.

**Working directory:** The `cwd` of the spawned process is set to the local repo checkout path. This is critical — it means when Claude CLI's built-in tools read files, they read from the actual project code.

### 7.9 Review Prompt (`src/reviewer/prompt.ts`)

The prompt is a template that gets filled in with PR-specific details before being passed to Claude CLI. This is the most important piece of "configuration" in the system — it controls the quality and structure of every review.

```typescript
export function buildReviewPrompt(params: {
    repoFullName: string;
    prNumber: number;
    prTitle: string;
    prAuthor: string;
    branchName: string;
    commitSha: string;
    commitMessage: string;
    diff: string;
    changedFiles: string[];
}): string {
    return `
You are a senior software engineer performing a code review. You are reviewing PR #${params.prNumber} titled "${params.prTitle}" by ${params.prAuthor} on the repository ${params.repoFullName}.

Branch: ${params.branchName}
Commit: ${params.commitSha}
Commit message: ${params.commitMessage}

The following files were changed in this commit:
${params.changedFiles.map(f => `- ${f}`).join('\n')}

Here is the diff for this commit:
\`\`\`diff
${params.diff}
\`\`\`

IMPORTANT INSTRUCTIONS:
1. Use your file-reading tools to examine the full source files when you need more context (imports, type definitions, related functions, tests). Do not review the diff in isolation.
2. Focus on substantive issues: bugs, security vulnerabilities, performance problems, logic errors, race conditions, missing error handling. Do NOT nitpick formatting or style unless it causes a real problem.
3. Give positive feedback when you see well-written code.

RESPOND WITH ONLY VALID JSON matching this exact schema — no markdown, no preamble, no explanation outside the JSON:

{
    "summary": "A 2-3 sentence summary of the overall quality of this change and its purpose.",
    "severity": "critical | warning | info | clean",
    "findings": [
        {
            "type": "bug | security | performance | style | maintainability | suggestion | praise",
            "severity": "critical | warning | info | praise",
            "file": "relative/path/to/file.ts",
            "line_start": 42,
            "line_end": 45,
            "title": "Short descriptive title",
            "description": "Detailed explanation of the issue and why it matters.",
            "suggestion": "Suggested fix or improvement, may include code.",
            "code_snippet": "The relevant lines of code"
        }
    ]
}

The top-level severity should be the highest severity among all findings. If there are no issues at all, use "clean" with an empty findings array (or only praise findings).
`.trim();
}
```

### 7.10 Output Parser (`src/reviewer/parser.ts`)

Claude CLI with `--output-format json` returns a JSON envelope. The parser extracts the actual review content from this envelope.

```typescript
interface ParsedReview {
    summary: string;
    severity: "critical" | "warning" | "info" | "clean";
    findings: Finding[];
    model: string | null;
}

// Parses the raw claude CLI JSON output and extracts the review.
// Handles edge cases: malformed JSON, truncated output, unexpected envelope format.
// Uses Zod to validate the parsed review matches the expected schema.
// If parsing fails, returns a fallback ParsedReview with the raw output in the summary
// and severity "warning" so the review is still stored and visible.
export function parseClaudeOutput(rawOutput: string): ParsedReview;
```

**Parsing strategy:** The Claude CLI JSON output contains a `result` field with the text response. That text response should be the JSON object we asked for in the prompt. The parser:

1. Parses the outer Claude CLI envelope to extract `result`.
2. Extracts the inner JSON from the result text (handling possible markdown code fences that Claude might wrap it in).
3. Validates the inner JSON against a Zod schema matching the `Finding` interface.
4. Returns the structured `ParsedReview`.

If any step fails, the parser still returns a usable result — the raw output is preserved in the `raw_output` database column for manual inspection.

### 7.11 Reviewer Service (`src/reviewer/reviewer.service.ts`)

This orchestrator ties together the repo manager, CLI executor, parser, and database.

**Review flow for a single job:**

1. Insert a `reviews` row with `status: 'pending'` and the correct `provider` value.
2. Use `ProviderFactory.getProvider(job.provider)` to get the right `GitProvider`.
3. Call `RepoManager.prepare()` with the clone URL from `provider.getCloneUrl()`.
4. Generate the diff locally via `RepoManager.generateDiff()` (preferred for consistency across providers) or fall back to `provider.getPRDiff()` for providers with native support.
5. Fetch changed files list via `provider.getPRFiles()`.
6. Check skip conditions: if `files.length > MAX_FILES_CHANGED` or `diff.length > MAX_DIFF_SIZE`, mark as `status: 'skipped'`, insert into `seen_commits`, and move on.
7. Build the review prompt with `buildReviewPrompt()`.
8. Update review row to `status: 'in_progress'`.
9. Call `ClaudeCliExecutor.executeReview()` with the repo path and prompt.
10. Parse the output with `parseClaudeOutput()`.
11. Update the review row with all parsed fields and `status: 'completed'`.
12. Insert into `seen_commits` — this marks the commit as fully processed so the poller won't re-enqueue it. This insert happens **only** on terminal states: `completed`, `skipped`, or `failed` (after exhausting retries).
13. If any step throws, catch the error, update `status: 'failed'` and `error_message`, insert into `seen_commits` (to prevent infinite retry of permanently broken reviews), and log the failure.

**Processing loop:**

```typescript
class ReviewerService {
    // Runs continuously, pulling jobs from the queue one at a time
    async startProcessing(): Promise<void> {
        while (true) {
            const job = this.queue.dequeue();
            if (job) {
                await this.processReview(job);
            } else {
                // No work — wait 5 seconds before checking again
                await sleep(5000);
            }
        }
    }
}
```

### 7.12 Cleanup Service (`src/database/cleanup.repository.ts` + `src/reviewer/repo-manager.ts` + cron in `src/index.ts`)

The cleanup service handles three separate housekeeping tasks, all running in the same daily cron job at 3:00 AM: deleting old reviews from the database, deleting stale `seen_commits` tracking entries, and pruning local git clones that are no longer needed or have grown too large.

**How it works:**

The cleanup runs as a `node-cron` job scheduled at **3:00 AM server time daily**. This timing is deliberate — it avoids running during peak hours when the poller and reviewer are busiest, and it ensures the potentially expensive DELETE + VACUUM + git operations don't compete with review writes or API reads. The cleanup is a single cron job in the main process, not a separate service.

**Part 1 — Database Cleanup (`src/database/cleanup.repository.ts`):**

```typescript
class CleanupRepository {
    constructor(private db: Database);

    // Deletes all reviews where created_at is older than the retention threshold.
    // Returns the number of deleted rows for logging.
    //
    // The deletion is performed in batches of 500 to avoid locking the SQLite
    // database for too long. Each batch is a separate transaction so the API
    // and reviewer can still read/write between batches.
    //
    // After all old reviews are deleted, the matching seen_commits entries
    // are also cleaned up so they don't accumulate forever.
    deleteOldReviews(retentionDays: number): { reviewsDeleted: number; seenCommitsDeleted: number } {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffISO = cutoffDate.toISOString();

        // Step 1: Delete old reviews in batches
        let totalReviewsDeleted = 0;
        const BATCH_SIZE = 500;

        while (true) {
            const result = this.db.prepare(`
                DELETE FROM reviews
                WHERE id IN (
                    SELECT id FROM reviews
                    WHERE created_at < ?
                    LIMIT ?
                )
            `).run(cutoffISO, BATCH_SIZE);

            totalReviewsDeleted += result.changes;
            if (result.changes < BATCH_SIZE) break; // No more rows to delete
        }

        // Step 2: Delete orphaned seen_commits entries.
        // A seen_commit is orphaned if its first_seen_at is older than the
        // retention period AND there is no corresponding review left for it.
        // This prevents re-reviewing ancient commits that were already cleaned up.
        const seenResult = this.db.prepare(`
            DELETE FROM seen_commits
            WHERE first_seen_at < ?
        `).run(cutoffISO);

        // Step 3: Reclaim disk space.
        // SQLite does not automatically shrink the database file after deletes.
        // VACUUM rewrites the entire database and reclaims freed pages.
        // This is safe but can briefly lock the database, which is why the
        // cleanup runs at 3 AM.
        if (totalReviewsDeleted > 0) {
            this.db.pragma('wal_checkpoint(TRUNCATE)');  // Flush WAL first
            this.db.exec('VACUUM');
        }

        return {
            reviewsDeleted: totalReviewsDeleted,
            seenCommitsDeleted: seenResult.changes
        };
    }

    // Returns a summary of what would be deleted without actually deleting.
    // Useful for the status API and for dry-run verification.
    previewCleanup(retentionDays: number): { reviewCount: number; oldestReviewDate: string | null } {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffISO = cutoffDate.toISOString();

        const row = this.db.prepare(`
            SELECT COUNT(*) as count, MIN(created_at) as oldest
            FROM reviews
            WHERE created_at < ?
        `).get(cutoffISO) as { count: number; oldest: string | null };

        return { reviewCount: row.count, oldestReviewDate: row.oldest };
    }
}
```

**Part 2 — Git Clone Cleanup (added to `src/reviewer/repo-manager.ts`):**

Local git clones accumulate data over time — every `git fetch` pulls new objects, and stale branches, dangling objects, and pack files pile up. Without periodic cleanup, clones for active repos can grow to several gigabytes each, eventually filling the Docker volume. Additionally, clones for repositories that have been removed from tracking should be deleted entirely.

The `RepoManager` is extended with three cleanup methods:

```typescript
class RepoManager {
    // ... existing methods (prepare, generateDiff, cleanup) ...

    // ── Clone Cleanup Methods ──

    // Runs `git gc --aggressive --prune=now` on a single repo clone.
    // This compresses loose objects, removes dangling refs, and prunes
    // unreachable objects. Can significantly reduce clone size.
    // Returns the size difference in bytes (positive = space reclaimed).
    async pruneRepo(repoFullName: string): Promise<{ sizeBefore: number; sizeAfter: number }> {
        const repoPath = this.getRepoPath(repoFullName);
        const sizeBefore = await this.getDirectorySize(repoPath);

        await this.execGit(repoPath, ['gc', '--aggressive', '--prune=now']);
        await this.execGit(repoPath, ['reflog', 'expire', '--expire=now', '--all']);
        await this.execGit(repoPath, ['repack', '-a', '-d', '--depth=250', '--window=250']);

        const sizeAfter = await this.getDirectorySize(repoPath);
        return { sizeBefore, sizeAfter };
    }

    // Deletes the local clone directory entirely for a specific repo.
    // Used when a repo is removed from tracking or hasn't been polled
    // in a long time. This is a destructive operation — the next review
    // for this repo (if any) will require a full clone.
    async deleteClone(repoFullName: string): Promise<{ freedBytes: number }> {
        const repoPath = this.getRepoPath(repoFullName);
        if (!fs.existsSync(repoPath)) return { freedBytes: 0 };

        const size = await this.getDirectorySize(repoPath);
        await fs.promises.rm(repoPath, { recursive: true, force: true });
        return { freedBytes: size };
    }

    // Lists all local clone directories with their sizes.
    // Used by the cleanup orchestrator to identify what's on disk.
    async listClones(): Promise<Array<{
        dirName: string;            // The directory name (e.g., "github__myorg__backend")
        repoFullName: string;       // Parsed back to "myorg/backend"
        provider: string;           // Parsed from dir prefix
        sizeBytes: number;          // Total directory size
        lastModified: Date;         // Most recent file modification in the directory
    }>>;

    // Returns total size of a directory in bytes (recursive).
    private async getDirectorySize(dirPath: string): Promise<number>;
}
```

**Part 3 — Orchestrated Cleanup in `src/index.ts`:**

The daily cron job ties together both the database cleanup and the git clone cleanup into a single orchestrated sequence:

```typescript
import cron from 'node-cron';

// Inside main(), after the poller and reviewer are started:

const cleanupRepo = new CleanupRepository(db);
const repoManager = new RepoManager(config.storage.reposDir);

// Run daily at 3:00 AM server time
cron.schedule('0 3 * * *', async () => {
    logger.info('=== Daily cleanup started ===');

    // ── Phase 1: Database cleanup (old reviews + seen_commits) ──
    if (configService.get('review.retentionDays') > 0) {
        const retentionDays = configService.get('review.retentionDays');
        logger.info(`Phase 1: Deleting reviews older than ${retentionDays} days`);
        try {
            const dbResult = cleanupRepo.deleteOldReviews(retentionDays);
            logger.info(
                `Phase 1 complete: ${dbResult.reviewsDeleted} reviews deleted, ` +
                `${dbResult.seenCommitsDeleted} seen_commits entries deleted`
            );
        } catch (err) {
            logger.error('Phase 1 (database cleanup) failed', err);
        }
    } else {
        logger.info('Phase 1 skipped: data retention disabled');
    }

    // ── Phase 2: Remove clones for untracked repositories ──
    // If a repo was removed from the tracked list (via UI or config),
    // its local clone is now orphaned and should be deleted.
    logger.info('Phase 2: Removing orphaned git clones');
    try {
        const clones = await repoManager.listClones();
        const trackedRepos = new Set(
            reposRepository.listAll().map(r => r.full_name)
        );

        let orphanedFreed = 0;
        for (const clone of clones) {
            if (!trackedRepos.has(clone.repoFullName)) {
                const result = await repoManager.deleteClone(clone.repoFullName);
                orphanedFreed += result.freedBytes;
                logger.info(
                    `Deleted orphaned clone: ${clone.repoFullName} ` +
                    `(freed ${formatBytes(result.freedBytes)})`
                );
            }
        }
        logger.info(`Phase 2 complete: freed ${formatBytes(orphanedFreed)} from orphaned clones`);
    } catch (err) {
        logger.error('Phase 2 (orphan cleanup) failed', err);
    }

    // ── Phase 3: Prune active repo clones (git gc) ──
    // For repos that are still tracked, compress git objects to reclaim space.
    // This is particularly important for large monorepos.
    logger.info('Phase 3: Pruning active git clones');
    try {
        const clones = await repoManager.listClones();
        let totalReclaimed = 0;

        for (const clone of clones) {
            try {
                const result = await repoManager.pruneRepo(clone.repoFullName);
                const reclaimed = result.sizeBefore - result.sizeAfter;
                totalReclaimed += Math.max(0, reclaimed);
                if (reclaimed > 1024 * 1024) { // Only log if > 1MB reclaimed
                    logger.info(
                        `Pruned ${clone.repoFullName}: ` +
                        `${formatBytes(result.sizeBefore)} → ${formatBytes(result.sizeAfter)} ` +
                        `(freed ${formatBytes(reclaimed)})`
                    );
                }
            } catch (err) {
                logger.warn(`Failed to prune ${clone.repoFullName}`, err);
                // Continue to next repo — one failure shouldn't stop all pruning
            }
        }
        logger.info(`Phase 3 complete: reclaimed ${formatBytes(totalReclaimed)} from git gc`);
    } catch (err) {
        logger.error('Phase 3 (git prune) failed', err);
    }

    logger.info('=== Daily cleanup finished ===');
});

logger.info('Daily cleanup scheduled at 3:00 AM');
```

**Why batched deletes matter:**

SQLite locks the entire database for the duration of a write transaction. If the cleanup tried to delete 50,000 old reviews in a single `DELETE FROM reviews WHERE created_at < ?` statement, the database would be locked for potentially several seconds — during which the API would return errors and the reviewer could not write new reviews. By batching in groups of 500, each lock is held for only a few milliseconds, and other operations can proceed between batches.

**Why VACUUM runs only after actual deletes:**

SQLite's `VACUUM` command rewrites the entire database file, which can be slow on large databases and briefly locks everything. It only runs when at least one review was actually deleted to avoid wasting time on no-op cleanups. The `wal_checkpoint(TRUNCATE)` call flushes the Write-Ahead Log before the VACUUM to ensure the database is in a clean state.

**Edge case — what happens to in-progress reviews on cleanup day:**

The cleanup only deletes rows where `created_at < cutoff`. A review with `status: 'in_progress'` that was created yesterday will not be touched — only reviews older than 90 days are deleted. If a review is stuck in `in_progress` for 90+ days (which would indicate a bug), it will be cleaned up, which is the correct behavior since it's clearly orphaned.

**Edge case — git clone for a repo that gets re-added after deletion:**

If a repo is removed from tracking, its clone is deleted by Phase 2 of the cleanup. If the same repo is later re-added via the UI, the `RepoManager.prepare()` method will simply re-clone it on the next review. There is no need to preemptively clone — the re-clone happens lazily when the first review for the re-added repo is processed.

---

