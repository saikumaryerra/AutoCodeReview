# Automatic Review Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically retry failed reviews with bounded exponential backoff (10 attempts) that survives process restarts.

**Architecture:** A new `RetryScheduler` service ticks on its own interval, atomically claims `failed` reviews whose `next_retry_at` is due, and re-enqueues them onto the existing in-memory `ReviewQueue`. Retry state (`retry_count`, `next_retry_at`) persists on the `reviews` row; the failure path in the reviewer schedules the next retry or gives up at the cap. Retries are driven off the `reviews` table and are independent of `seen_commits`, so the poller's dedup is untouched.

**Tech Stack:** TypeScript, Node ≥20, better-sqlite3, Zod, Vitest. Spec: `docs/superpowers/specs/2026-06-18-automatic-review-retry-design.md`.

---

## File Structure

- **Create** `src/poller/retry-policy.ts` — pure backoff math + constants.
- **Create** `src/poller/retry-policy.test.ts` — backoff unit tests.
- **Create** `src/poller/retry-scheduler.ts` — the scheduler service.
- **Create** `src/poller/retry-scheduler.test.ts` — scheduler tests (in-memory DB).
- **Create** `src/database/reviews.repository.test.ts` — repository retry-method tests.
- **Create** `src/config/config.test.ts` — config default test.
- **Modify** `src/database/schema.ts` — two new columns on `reviews`.
- **Modify** `src/database/connection.ts` — two migrations for existing DBs.
- **Modify** `src/shared/types.ts` — `Review.retry_count`/`next_retry_at`; `SystemStatus.scheduled_retries`.
- **Modify** `src/database/reviews.repository.ts` — row mapping, insert defaults, retry methods.
- **Modify** `src/config/config.ts` — Zod schema + loader for two settings.
- **Modify** `src/config/config.schema.ts` — two `CONFIG_REGISTRY` entries.
- **Modify** `src/reviewer/reviewer.service.ts` — `scheduleRetryOrGiveUp` helper; route both failure sites through it.
- **Modify** `src/index.ts` — construct/start/stop `RetryScheduler`.
- **Modify** `src/api/routes/reviews.routes.ts` — reset retry state on manual trigger.
- **Modify** `src/api/routes/status.routes.ts` — `scheduled_retries` count.
- **Modify** `frontend/src/types/index.ts` — retry fields + `scheduled_retries`.
- **Modify** `frontend/src/pages/ReviewDetail.tsx` — show retry banner on failed reviews.
- **Modify** `.env.example` — document the two new env vars.

---

## Task 1: Retry policy (pure functions)

**Files:**
- Create: `src/poller/retry-policy.ts`
- Test: `src/poller/retry-policy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/poller/retry-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeBackoffSeconds, nextRetryTimestamp, RETRY_CAP_SECONDS } from './retry-policy.js';

describe('computeBackoffSeconds', () => {
    it('returns the base delay for the first retry', () => {
        expect(computeBackoffSeconds(1)).toBe(120);
    });

    it('doubles for each subsequent retry', () => {
        expect(computeBackoffSeconds(2)).toBe(240);
        expect(computeBackoffSeconds(3)).toBe(480);
        expect(computeBackoffSeconds(4)).toBe(960);
        expect(computeBackoffSeconds(5)).toBe(1920);
    });

    it('caps at RETRY_CAP_SECONDS once the curve exceeds it', () => {
        expect(computeBackoffSeconds(6)).toBe(RETRY_CAP_SECONDS); // 3840 -> capped 3600
        expect(computeBackoffSeconds(9)).toBe(RETRY_CAP_SECONDS);
        expect(computeBackoffSeconds(100)).toBe(RETRY_CAP_SECONDS);
    });
});

describe('nextRetryTimestamp', () => {
    it('adds the backoff delay to the given time as an ISO string', () => {
        const from = new Date('2026-06-18T00:00:00.000Z');
        expect(nextRetryTimestamp(1, from)).toBe('2026-06-18T00:02:00.000Z');
        expect(nextRetryTimestamp(2, from)).toBe('2026-06-18T00:04:00.000Z');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/poller/retry-policy.test.ts`
Expected: FAIL — cannot find module `./retry-policy.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/poller/retry-policy.ts`:

```ts
/**
 * Pure backoff math for automatic review retries.
 *
 * Schedule for retries 1..9: 2, 4, 8, 16, 32, 60, 60, 60, 60 minutes
 * (exponential, capped at RETRY_CAP_SECONDS).
 */

export const RETRY_BASE_SECONDS = 120;
export const RETRY_FACTOR = 2;
export const RETRY_CAP_SECONDS = 3600;

/**
 * Delay in seconds before retry number `retryNumber` (1-based).
 */
export function computeBackoffSeconds(retryNumber: number): number {
    const raw = RETRY_BASE_SECONDS * Math.pow(RETRY_FACTOR, retryNumber - 1);
    return Math.min(RETRY_CAP_SECONDS, raw);
}

/**
 * ISO-8601 timestamp at which retry number `retryNumber` becomes due,
 * measured from `from`.
 */
export function nextRetryTimestamp(retryNumber: number, from: Date): string {
    const ms = from.getTime() + computeBackoffSeconds(retryNumber) * 1000;
    return new Date(ms).toISOString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/poller/retry-policy.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/poller/retry-policy.ts src/poller/retry-policy.test.ts
git commit -m "feat: add retry backoff policy"
```

---

## Task 2: Schema columns, Review type, and insert/parse mapping

**Files:**
- Modify: `src/database/schema.ts`
- Modify: `src/database/connection.ts:43-48`
- Modify: `src/shared/types.ts:22-46`
- Modify: `src/database/reviews.repository.ts`
- Test: `src/database/reviews.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/database/reviews.repository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from './schema.js';
import { ReviewsRepository } from './reviews.repository.js';
import type { Review } from '../shared/types.js';

function makeDb(): Database.Database {
    const db = new Database(':memory:');
    db.exec(getSchemaSQL());
    return db;
}

function makeReview(overrides: Partial<Review> = {}): Review {
    return {
        id: 'r1',
        repo_full_name: 'owner/repo',
        provider: 'github',
        pr_number: 1,
        pr_title: 'Title',
        pr_author: 'alice',
        commit_sha: 'abc1234',
        commit_message: 'msg',
        branch_name: 'feature/x',
        target_branch: 'main',
        pr_state: 'open',
        pr_url: 'https://example.com/pr/1',
        summary: '',
        severity: 'info',
        findings: [],
        raw_output: '',
        files_reviewed: [],
        stats: { files_changed: 0, additions: 0, deletions: 0 },
        review_duration_ms: null,
        claude_model: null,
        status: 'failed',
        error_message: 'boom',
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

describe('ReviewsRepository retry columns', () => {
    let db: Database.Database;
    let repo: ReviewsRepository;

    beforeEach(() => {
        db = makeDb();
        repo = new ReviewsRepository(db);
    });

    it('defaults retry_count to 0 and next_retry_at to null on insert', () => {
        repo.insert(makeReview());
        const r = repo.getById('r1');
        expect(r?.retry_count).toBe(0);
        expect(r?.next_retry_at).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/database/reviews.repository.test.ts`
Expected: FAIL — `retry_count` is `undefined` (column/mapping missing).

- [ ] **Step 3: Add columns to the base schema**

In `src/database/schema.ts`, inside the `reviews` table definition, add the two columns immediately after the `created_at` line and before the `UNIQUE(...)` constraint:

```sql
    error_message       TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    retry_count         INTEGER NOT NULL DEFAULT 0,
    next_retry_at       TEXT,

    UNIQUE(repo_full_name, pr_number, commit_sha)
```

- [ ] **Step 4: Add migrations for existing databases**

In `src/database/connection.ts`, extend the `migrations` array (currently lines 43-48) with two entries:

```ts
    const migrations = [
        'ALTER TABLE reviews ADD COLUMN pr_state TEXT CHECK(pr_state IN (\'open\', \'closed\', \'merged\'))',
        'ALTER TABLE reviews ADD COLUMN pr_url TEXT',
        'ALTER TABLE repositories ADD COLUMN coding_standards TEXT',
        'ALTER TABLE repositories ADD COLUMN token TEXT',
        'ALTER TABLE reviews ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE reviews ADD COLUMN next_retry_at TEXT',
    ];
```

- [ ] **Step 5: Add fields to the Review domain type**

In `src/shared/types.ts`, in the `Review` interface, add two optional fields right after `created_at: string;`:

```ts
    status: ReviewStatus;
    error_message: string | null;
    created_at: string;
    retry_count?: number;
    next_retry_at?: string | null;
}
```

- [ ] **Step 6: Map the columns in the repository**

In `src/database/reviews.repository.ts`, add the two fields to the `ReviewRow` interface (after `created_at: string;`):

```ts
    error_message: string | null;
    created_at: string;
    retry_count: number;
    next_retry_at: string | null;
}
```

Then update `insert()` to persist them. Change the column list and `VALUES` clause to include the two columns, and add the two params. The statement becomes:

```ts
        const stmt = this.db.prepare(`
            INSERT INTO reviews (
                id, repo_full_name, provider, pr_number, pr_title, pr_author,
                commit_sha, commit_message, branch_name, target_branch,
                pr_state, pr_url,
                summary, severity, findings, raw_output, files_reviewed, stats,
                review_duration_ms, claude_model, status, error_message, created_at,
                retry_count, next_retry_at
            ) VALUES (
                @id, @repo_full_name, @provider, @pr_number, @pr_title, @pr_author,
                @commit_sha, @commit_message, @branch_name, @target_branch,
                @pr_state, @pr_url,
                @summary, @severity, @findings, @raw_output, @files_reviewed, @stats,
                @review_duration_ms, @claude_model, @status, @error_message, @created_at,
                @retry_count, @next_retry_at
            )
        `);
```

And in the `stmt.run({ ... })` object, add after `created_at: review.created_at,`:

```ts
            created_at: review.created_at,
            retry_count: review.retry_count ?? 0,
            next_retry_at: review.next_retry_at ?? null,
        });
```

(`parseReviewRow` already spreads `...row`, so the two fields flow through automatically.)

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/database/reviews.repository.test.ts`
Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
git add src/database/schema.ts src/database/connection.ts src/shared/types.ts src/database/reviews.repository.ts src/database/reviews.repository.test.ts
git commit -m "feat: add retry_count and next_retry_at columns to reviews"
```

---

## Task 3: Repository retry methods

**Files:**
- Modify: `src/database/reviews.repository.ts`
- Test: `src/database/reviews.repository.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/database/reviews.repository.test.ts`, inside the existing file (after the first `describe` block):

```ts
describe('ReviewsRepository retry methods', () => {
    let db: Database.Database;
    let repo: ReviewsRepository;

    beforeEach(() => {
        db = makeDb();
        repo = new ReviewsRepository(db);
    });

    it('getRetryCount returns the stored count', () => {
        repo.insert(makeReview({ id: 'r1' }));
        expect(repo.getRetryCount('r1')).toBe(0);
    });

    it('scheduleRetry sets retry_count, next_retry_at, and failed status', () => {
        repo.insert(makeReview({ id: 'r1', status: 'in_progress' }));
        repo.scheduleRetry('r1', 1, '2026-06-18T00:02:00.000Z', 'rate limit');
        const r = repo.getById('r1');
        expect(r?.retry_count).toBe(1);
        expect(r?.next_retry_at).toBe('2026-06-18T00:02:00.000Z');
        expect(r?.status).toBe('failed');
        expect(r?.error_message).toBe('rate limit');
    });

    it('markFailedFinal clears next_retry_at and keeps status failed', () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 3, '2026-06-18T00:02:00.000Z', 'x');
        repo.markFailedFinal('r1', 'gave up');
        const r = repo.getById('r1');
        expect(r?.next_retry_at).toBeNull();
        expect(r?.status).toBe('failed');
        expect(r?.retry_count).toBe(3);
        expect(r?.error_message).toBe('gave up');
    });

    it('resetRetryState zeroes retry_count and clears next_retry_at', () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 5, '2026-06-18T00:02:00.000Z', 'x');
        repo.resetRetryState('r1');
        const r = repo.getById('r1');
        expect(r?.retry_count).toBe(0);
        expect(r?.next_retry_at).toBeNull();
    });

    it('claimDueRetries claims due failed reviews and flips them to pending', () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 1, '2020-01-01T00:00:00.000Z', 'x'); // past = due
        const claimed = repo.claimDueRetries(new Date().toISOString());
        expect(claimed).toHaveLength(1);
        expect(claimed[0].id).toBe('r1');
        expect(claimed[0].retry_count).toBe(1);
        const r = repo.getById('r1');
        expect(r?.status).toBe('pending');
        expect(r?.next_retry_at).toBeNull();
    });

    it('claimDueRetries ignores future and unscheduled reviews, and is idempotent', () => {
        repo.insert(makeReview({ id: 'future' }));
        repo.scheduleRetry('future', 1, '2999-01-01T00:00:00.000Z', 'x');
        repo.insert(makeReview({ id: 'nulled', status: 'failed' })); // next_retry_at stays null
        repo.insert(makeReview({ id: 'due' }));
        repo.scheduleRetry('due', 1, '2020-01-01T00:00:00.000Z', 'x');

        const first = repo.claimDueRetries(new Date().toISOString());
        expect(first.map((r) => r.id)).toEqual(['due']);

        // Second claim returns nothing — 'due' is now pending.
        const second = repo.claimDueRetries(new Date().toISOString());
        expect(second).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/database/reviews.repository.test.ts`
Expected: FAIL — `repo.getRetryCount is not a function` (methods not defined).

- [ ] **Step 3: Add `ClaimedRetryRow` type and the methods**

In `src/database/reviews.repository.ts`, add this exported interface near the top (after the `ReviewListItem` interface, before `ReviewListFilters`):

```ts
/** Minimal review fields needed to rebuild a ReviewJob for a retry. */
export interface ClaimedRetryRow {
    id: string;
    repo_full_name: string;
    provider: Provider;
    pr_number: number;
    pr_title: string;
    pr_author: string;
    commit_sha: string;
    commit_message: string | null;
    branch_name: string;
    target_branch: string;
    pr_state: PrState | null;
    pr_url: string | null;
    retry_count: number;
}
```

Then add these methods to the `ReviewsRepository` class (e.g. after `updateStatus`):

```ts
    /** Number of retries already performed for a review. */
    getRetryCount(id: string): number {
        const row = this.db
            .prepare('SELECT retry_count FROM reviews WHERE id = ?')
            .get(id) as { retry_count: number } | undefined;
        return row?.retry_count ?? 0;
    }

    /** Record a failed attempt and schedule the next retry. */
    scheduleRetry(id: string, retryCount: number, nextRetryAt: string, errorMessage: string): void {
        this.db.prepare(`
            UPDATE reviews
            SET status = 'failed',
                retry_count = @retry_count,
                next_retry_at = @next_retry_at,
                error_message = @error_message
            WHERE id = @id
        `).run({ id, retry_count: retryCount, next_retry_at: nextRetryAt, error_message: errorMessage });
        log.debug('Review retry scheduled', { id, retryCount, nextRetryAt });
    }

    /** Mark a review failed permanently (no further retries). */
    markFailedFinal(id: string, errorMessage: string): void {
        this.db.prepare(`
            UPDATE reviews
            SET status = 'failed', next_retry_at = NULL, error_message = @error_message
            WHERE id = @id
        `).run({ id, error_message: errorMessage });
        log.debug('Review marked failed (final)', { id });
    }

    /** Clear retry budget (used when a human manually re-reviews). */
    resetRetryState(id: string): void {
        this.db.prepare(`
            UPDATE reviews SET retry_count = 0, next_retry_at = NULL WHERE id = @id
        `).run({ id });
        log.debug('Review retry state reset', { id });
    }

    /**
     * Atomically claim all failed reviews whose retry is due (next_retry_at <= now),
     * flip them to 'pending', and return the claimed rows. Per-row claim guards
     * against double-enqueue when ticks overlap.
     */
    claimDueRetries(nowIso: string): ClaimedRetryRow[] {
        const tx = this.db.transaction((now: string): ClaimedRetryRow[] => {
            const due = this.db.prepare(`
                SELECT id FROM reviews
                WHERE status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= @now
            `).all({ now }) as Array<{ id: string }>;

            const claimStmt = this.db.prepare(`
                UPDATE reviews SET status = 'pending', next_retry_at = NULL
                WHERE id = @id AND status = 'failed'
            `);
            const selectStmt = this.db.prepare(`
                SELECT id, repo_full_name, provider, pr_number, pr_title, pr_author,
                       commit_sha, commit_message, branch_name, target_branch,
                       pr_state, pr_url, retry_count
                FROM reviews WHERE id = @id
            `);

            const claimed: ClaimedRetryRow[] = [];
            for (const { id } of due) {
                const res = claimStmt.run({ id });
                if (res.changes === 1) {
                    claimed.push(selectStmt.get({ id }) as ClaimedRetryRow);
                }
            }
            return claimed;
        });
        return tx(nowIso);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/database/reviews.repository.test.ts`
Expected: PASS (7 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add src/database/reviews.repository.ts src/database/reviews.repository.test.ts
git commit -m "feat: add retry persistence methods to ReviewsRepository"
```

---

## Task 4: Config settings (`review.retryEnabled`, `review.maxRetryAttempts`)

**Files:**
- Modify: `src/config/config.ts:36-44, 86-94`
- Modify: `src/config/config.schema.ts`
- Modify: `.env.example`
- Test: `src/config/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig retry settings', () => {
    it('defaults retryEnabled=true and maxRetryAttempts=10', () => {
        process.env.GITHUB_TOKEN = 'x';
        process.env.GITHUB_REPOS = 'owner/repo';
        delete process.env.REVIEW_RETRY_ENABLED;
        delete process.env.REVIEW_MAX_RETRY_ATTEMPTS;

        const cfg = loadConfig();
        expect(cfg.review.retryEnabled).toBe(true);
        expect(cfg.review.maxRetryAttempts).toBe(10);
    });

    it('reads overrides from env', () => {
        process.env.GITHUB_TOKEN = 'x';
        process.env.GITHUB_REPOS = 'owner/repo';
        process.env.REVIEW_RETRY_ENABLED = 'false';
        process.env.REVIEW_MAX_RETRY_ATTEMPTS = '5';

        const cfg = loadConfig();
        expect(cfg.review.retryEnabled).toBe(false);
        expect(cfg.review.maxRetryAttempts).toBe(5);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/config.test.ts`
Expected: FAIL — `cfg.review.retryEnabled` is `undefined`.

- [ ] **Step 3: Extend the Zod schema and loader**

In `src/config/config.ts`, add two fields to the `review` object in `ConfigSchema` (after `autoPostSkipClean`):

```ts
        autoPostComment: z.boolean().default(false),
        autoPostSkipClean: z.boolean().default(true),
        retryEnabled: z.boolean().default(true),
        maxRetryAttempts: z.number().min(1).max(50).default(10),
    }),
```

And in `loadConfig()`, add the matching parsed values to the `review` object (after `autoPostSkipClean`):

```ts
            autoPostComment: process.env.AUTO_POST_COMMENT === 'true',
            autoPostSkipClean: process.env.AUTO_POST_SKIP_CLEAN !== 'false',
            retryEnabled: process.env.REVIEW_RETRY_ENABLED !== 'false',
            maxRetryAttempts: Number(process.env.REVIEW_MAX_RETRY_ATTEMPTS) || 10,
        },
```

- [ ] **Step 4: Register the settings for the UI**

In `src/config/config.schema.ts`, add two entries to `CONFIG_REGISTRY` (after the `review.autoPostSkipClean` entry, before the `claude.reviewTimeoutSeconds` entry):

```ts
    {
        key: 'review.retryEnabled',
        label: 'Auto-Retry Failed Reviews',
        description: 'When enabled, reviews that end in failure are automatically retried with exponential backoff.',
        category: 'review',
        type: 'boolean',
        default: true,
        editable: true,
        requiresRestart: false,
        validation: z.boolean(),
        sensitive: false,
    },
    {
        key: 'review.maxRetryAttempts',
        label: 'Max Retry Attempts',
        description: 'Total attempts (including the first) before a failed review is given up. Backoff is exponential, capped at 60 minutes.',
        category: 'review',
        type: 'number',
        default: 10,
        editable: true,
        requiresRestart: false,
        validation: z.number().min(1).max(50),
        sensitive: false,
    },
```

- [ ] **Step 5: Document the env vars**

In `.env.example`, under the `# ── Review Behavior ──` section, add:

```
MAX_FILES_CHANGED=50
MAX_DIFF_SIZE=100000
REVIEW_RETRY_ENABLED=true
REVIEW_MAX_RETRY_ATTEMPTS=10
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/config/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/config/config.ts src/config/config.schema.ts src/config/config.test.ts .env.example
git commit -m "feat: add retry config settings"
```

---

## Task 5: Failure path schedules retries (reviewer.service)

**Files:**
- Modify: `src/reviewer/reviewer.service.ts`

- [ ] **Step 1: Import the retry policy**

In `src/reviewer/reviewer.service.ts`, add an import near the other reviewer imports (after the `parseClaudeOutput` import):

```ts
import { parseClaudeOutput } from './parser.js';
import { nextRetryTimestamp } from '../poller/retry-policy.js';
```

- [ ] **Step 2: Add the `scheduleRetryOrGiveUp` helper**

Add this private method to `ReviewerService` (immediately above the existing `insertSeenCommit` method):

```ts
    /**
     * Records a failed attempt. Marks the commit seen (keeping the poller out),
     * then either schedules the next retry with exponential backoff or, once the
     * attempt cap is reached / retries are disabled, gives up permanently.
     */
    private scheduleRetryOrGiveUp(reviewId: string, job: ReviewJob, errorDetail: string): void {
        this.insertSeenCommit(job);

        const retryEnabled = this.configService.get<boolean>('review.retryEnabled');
        const maxAttempts = this.configService.get<number>('review.maxRetryAttempts');
        const currentRetries = this.reviewsRepo.getRetryCount(reviewId);

        if (retryEnabled && currentRetries < maxAttempts - 1) {
            const nextRetry = currentRetries + 1;
            const nextRetryAt = nextRetryTimestamp(nextRetry, new Date());
            this.reviewsRepo.scheduleRetry(reviewId, nextRetry, nextRetryAt, errorDetail);
            logger.info('Review failed; retry scheduled', {
                reviewId,
                attempt: nextRetry + 1,
                maxAttempts,
                nextRetryAt,
            });
        } else {
            this.reviewsRepo.markFailedFinal(reviewId, errorDetail);
            logger.info('Review failed permanently', {
                reviewId,
                attempts: currentRetries + 1,
                retryEnabled,
            });
        }
    }
```

- [ ] **Step 3: Route the CLI-failure site through the helper**

In `processReview`, replace the current block (the `if (!cliResult.success) { ... }` at ~lines 320-328 followed by the unconditional `this.insertSeenCommit(job);` at ~line 331):

```ts
            if (!cliResult.success) {
                // Prefer the parsed summary — Claude CLI puts errors in the JSON
                // envelope (stdout), not stderr. The parser already extracts a
                // useful reason (auth error, max turns, rate limit, etc.).
                const stderrTrim = cliResult.stderr.trim();
                const errorDetail = parsed.summary
                    || (stderrTrim ? `Claude CLI: ${stderrTrim.substring(0, 500)}` : `Claude CLI exited with code ${cliResult.exitCode}`);
                this.reviewsRepo.updateStatus(reviewId, 'failed', errorDetail);
            }

            // ── Step 13: Mark commit as seen ──────────────────────
            this.insertSeenCommit(job);
```

with:

```ts
            if (cliResult.success) {
                // ── Step 13: Mark commit as seen ──────────────────
                this.insertSeenCommit(job);
            } else {
                // Prefer the parsed summary — Claude CLI puts errors in the JSON
                // envelope (stdout), not stderr. The parser already extracts a
                // useful reason (auth error, max turns, rate limit, etc.).
                const stderrTrim = cliResult.stderr.trim();
                const errorDetail = parsed.summary
                    || (stderrTrim ? `Claude CLI: ${stderrTrim.substring(0, 500)}` : `Claude CLI exited with code ${cliResult.exitCode}`);
                // Marks the commit seen AND schedules a retry (or gives up).
                this.scheduleRetryOrGiveUp(reviewId, job, errorDetail);
            }
```

- [ ] **Step 4: Route the catch-block failure site through the helper**

In the `catch (err)` block of `processReview`, replace:

```ts
            this.reviewsRepo.updateStatus(reviewId, 'failed', errorMessage.substring(0, 2000));
            this.insertSeenCommit(job);
```

with:

```ts
            this.scheduleRetryOrGiveUp(reviewId, job, errorMessage.substring(0, 2000));
```

- [ ] **Step 5: Verify the build and existing tests**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: PASS (all existing + new tests).

- [ ] **Step 6: Commit**

```bash
git add src/reviewer/reviewer.service.ts
git commit -m "feat: schedule retries on review failure"
```

---

## Task 6: RetryScheduler service

**Files:**
- Create: `src/poller/retry-scheduler.ts`
- Test: `src/poller/retry-scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/poller/retry-scheduler.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from '../database/schema.js';
import { ReviewsRepository } from '../database/reviews.repository.js';
import { ReviewQueue } from './queue.js';
import { RetryScheduler } from './retry-scheduler.js';
import type { Review } from '../shared/types.js';

function makeDb(): Database.Database {
    const db = new Database(':memory:');
    db.exec(getSchemaSQL());
    return db;
}

function makeReview(overrides: Partial<Review> = {}): Review {
    return {
        id: 'r1', repo_full_name: 'owner/repo', provider: 'github', pr_number: 1,
        pr_title: 'Title', pr_author: 'alice', commit_sha: 'abc1234', commit_message: 'msg',
        branch_name: 'feature/x', target_branch: 'main', pr_state: 'open',
        pr_url: 'https://example.com/pr/1', summary: '', severity: 'info', findings: [],
        raw_output: '', files_reviewed: [], stats: { files_changed: 0, additions: 0, deletions: 0 },
        review_duration_ms: null, claude_model: null, status: 'failed', error_message: 'boom',
        created_at: new Date().toISOString(), ...overrides,
    };
}

const stubRepos = { getByFullName: () => ({ org_url: null, token: null }) };

describe('RetryScheduler.tick', () => {
    let db: Database.Database;
    let repo: ReviewsRepository;
    let queue: ReviewQueue;
    let scheduler: RetryScheduler;

    beforeEach(() => {
        db = makeDb();
        repo = new ReviewsRepository(db);
        queue = new ReviewQueue();
        scheduler = new RetryScheduler(repo, queue, stubRepos);
    });

    it('re-enqueues a due failed review and flips it to pending', async () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 1, '2020-01-01T00:00:00.000Z', 'rate limit');

        await scheduler.tick();

        expect(queue.size()).toBe(1);
        expect(queue.peek()?.commitSha).toBe('abc1234');
        expect(queue.peek()?.repoFullName).toBe('owner/repo');
        expect(repo.getById('r1')?.status).toBe('pending');
    });

    it('does not enqueue a review that is not yet due', async () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 1, '2999-01-01T00:00:00.000Z', 'x');

        await scheduler.tick();

        expect(queue.size()).toBe(0);
    });

    it('does not enqueue a failed review with no next_retry_at', async () => {
        repo.insert(makeReview({ id: 'r1', status: 'failed' }));

        await scheduler.tick();

        expect(queue.size()).toBe(0);
    });

    it('enqueues a due review only once across two ticks', async () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 1, '2020-01-01T00:00:00.000Z', 'x');

        await scheduler.tick();
        await scheduler.tick();

        expect(queue.size()).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/poller/retry-scheduler.test.ts`
Expected: FAIL — cannot find module `./retry-scheduler.js`.

- [ ] **Step 3: Write the scheduler**

Create `src/poller/retry-scheduler.ts`:

```ts
import { v4 as uuid } from 'uuid';
import type { ReviewJob, Provider, PrState } from '../shared/types.js';
import type { ReviewsRepository, ClaimedRetryRow } from '../database/reviews.repository.js';
import type { ReviewQueue } from './queue.js';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('retry-scheduler');

/** Tick interval — how often we check for due retries. */
export const RETRY_TICK_SECONDS = 60;

/** Narrow lookup interface so the scheduler stays decoupled from ReposRepository. */
export interface RetryRepoLookup {
    getByFullName(fullName: string): { org_url: string | null; token: string | null } | null;
}

/**
 * Periodically re-enqueues failed reviews whose retry time has arrived.
 * Mirrors PollerService: owns a setInterval, drained one tick at a time.
 */
export class RetryScheduler {
    private handle: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly reviewsRepo: Pick<ReviewsRepository, 'claimDueRetries'>,
        private readonly queue: ReviewQueue,
        private readonly reposRepo: RetryRepoLookup,
    ) {}

    start(): void {
        if (this.handle) return;
        this.handle = setInterval(() => {
            this.tick().catch((err) => {
                log.error('Unhandled error in retry tick', {
                    error: err instanceof Error ? err.message : String(err),
                });
            });
        }, RETRY_TICK_SECONDS * 1000);
        // Run one immediately so retries scheduled before a restart resume promptly.
        this.tick().catch((err) => {
            log.error('Unhandled error in initial retry tick', {
                error: err instanceof Error ? err.message : String(err),
            });
        });
        log.info('Retry scheduler started', { tickSeconds: RETRY_TICK_SECONDS });
    }

    stop(): void {
        if (this.handle) {
            clearInterval(this.handle);
            this.handle = null;
            log.info('Retry scheduler stopped');
        }
    }

    /** Claim and re-enqueue all due retries. Safe to call directly (tests). */
    async tick(): Promise<void> {
        const now = new Date().toISOString();
        const claimed = this.reviewsRepo.claimDueRetries(now);
        for (const row of claimed) {
            this.queue.enqueue(this.buildJob(row));
            log.info('Retry re-enqueued', {
                repo: row.repo_full_name,
                pr: row.pr_number,
                commit: row.commit_sha.substring(0, 8),
                retryCount: row.retry_count,
            });
        }
    }

    private buildJob(row: ClaimedRetryRow): ReviewJob {
        const repo = this.reposRepo.getByFullName(row.repo_full_name);
        return {
            id: uuid(),
            repoFullName: row.repo_full_name,
            provider: row.provider as Provider,
            prNumber: row.pr_number,
            prTitle: row.pr_title,
            prAuthor: row.pr_author,
            commitSha: row.commit_sha,
            commitMessage: row.commit_message ?? '',
            branchName: row.branch_name,
            targetBranch: row.target_branch ?? 'main',
            prState: (row.pr_state as PrState) ?? 'open',
            prUrl: row.pr_url ?? '',
            enqueuedAt: new Date(),
            orgUrl: repo?.org_url ?? undefined,
            token: repo?.token ?? undefined,
        };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/poller/retry-scheduler.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/poller/retry-scheduler.ts src/poller/retry-scheduler.test.ts
git commit -m "feat: add RetryScheduler service"
```

---

## Task 7: Wire RetryScheduler into startup/shutdown

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Import the scheduler**

In `src/index.ts`, add the import after the `PollerService` import (line 14):

```ts
import { PollerService } from './poller/poller.service.js';
import { RetryScheduler } from './poller/retry-scheduler.js';
```

- [ ] **Step 2: Construct and start it after the poller**

After the `pollerService.start();` block (the `logger.info('Poller service started', ...)` call around line 154-157), add:

```ts
    // 11b. Start the retry scheduler (re-enqueues due failed reviews)
    const retryScheduler = new RetryScheduler(reviewsRepo, queue, reposRepo);
    retryScheduler.start();
    logger.info('Retry scheduler started');
```

- [ ] **Step 3: Stop it on shutdown**

In the `shutdown` function, add `retryScheduler.stop();` before `pollerService.stop();`:

```ts
    const shutdown = () => {
        logger.info('Shutting down...');
        retryScheduler.stop();
        pollerService.stop();
        db.close();
        process.exit(0);
    };
```

- [ ] **Step 4: Verify the build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: start retry scheduler on boot"
```

---

## Task 8: Manual re-review resets the retry budget

**Files:**
- Modify: `src/api/routes/reviews.routes.ts:196-203`

- [ ] **Step 1: Reset retry state in the force branch**

In `src/api/routes/reviews.routes.ts`, inside the `POST /trigger` handler's `if (force) { ... }` branch, add a `resetRetryState` call after the existing `updateStatus` reset:

```ts
                if (force) {
                    // Reset existing review to pending so the reviewer service will reprocess it
                    reviewsRepo.updateStatus(existing.id, 'pending');
                    // A human-initiated retry starts the auto-retry budget fresh.
                    reviewsRepo.resetRetryState(existing.id);
                    logger.info('Existing review reset to pending for re-review', {
                        reviewId: existing.id,
                        previousStatus: existing.status,
                    });
                }
```

- [ ] **Step 2: Verify the build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/routes/reviews.routes.ts
git commit -m "feat: reset retry budget on manual re-review"
```

---

## Task 9: Surface scheduled-retries count in system status

**Files:**
- Modify: `src/shared/types.ts:194-222`
- Modify: `src/api/routes/status.routes.ts`
- Modify: `frontend/src/types/index.ts:205-228`

- [ ] **Step 1: Add the field to the backend SystemStatus type**

In `src/shared/types.ts`, in the `SystemStatus` interface, add `scheduled_retries` after `reviews_today`:

```ts
    total_reviews_completed: number;
    reviews_today: number;
    scheduled_retries: number;
    claude_cli_available: boolean;
```

- [ ] **Step 2: Compute and return it in the status route**

In `src/api/routes/status.routes.ts`, after the `reviewsToday` query (around line 95-98), add:

```ts
            const scheduledRetriesRow = db
                .prepare('SELECT COUNT(*) AS count FROM reviews WHERE next_retry_at IS NOT NULL')
                .get() as { count: number };
            const scheduledRetries = scheduledRetriesRow.count;
```

Then add the field to the `status` object literal, right after `reviews_today: reviewsToday,`:

```ts
                total_reviews_completed: totalReviewsCompleted,
                reviews_today: reviewsToday,
                scheduled_retries: scheduledRetries,
                claude_cli_available: claudeCliAvailable,
```

- [ ] **Step 3: Add the field to the frontend SystemStatus type**

In `frontend/src/types/index.ts`, in the `SystemStatus` interface, add after `reviews_today: number;`:

```ts
  total_reviews_completed: number;
  reviews_today: number;
  scheduled_retries: number;
  claude_cli_available: boolean;
```

- [ ] **Step 4: Verify the build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/api/routes/status.routes.ts frontend/src/types/index.ts
git commit -m "feat: report scheduled_retries in system status"
```

---

## Task 10: Show retry status on the Review detail page

**Files:**
- Modify: `frontend/src/types/index.ts:41-68`
- Modify: `frontend/src/pages/ReviewDetail.tsx`

- [ ] **Step 1: Add retry fields to the frontend ReviewDetail type**

In `frontend/src/types/index.ts`, in the `ReviewDetail` interface, add two optional fields after `created_at: string;`:

```ts
  raw_output?: string;
  created_at: string;
  retry_count?: number;
  next_retry_at?: string | null;
}
```

- [ ] **Step 2: Render a retry banner on failed reviews**

In `frontend/src/pages/ReviewDetail.tsx`, the loaded review is the `review` variable from `const { data: review, ... } = useReview(id ?? '')`. Inside the returned JSX, find the "Back to Dashboard" link and the `{/* Header */}` comment that follows it:

```tsx
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* Header */}
```

Insert the two banner blocks between the closing `</Link>` and the `{/* Header */}` comment, so the new content reads:

```tsx
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {review.status === 'failed' && review.next_retry_at && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Retry scheduled — attempt {(review.retry_count ?? 0) + 1} — next attempt at{' '}
          {new Date(review.next_retry_at).toLocaleString()}.
        </div>
      )}
      {review.status === 'failed' && !review.next_retry_at && (review.retry_count ?? 0) > 0 && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Failed permanently after {(review.retry_count ?? 0) + 1} attempts.
        </div>
      )}

      {/* Header */}
```

For reference, the banner blocks are:

```tsx
{review.status === 'failed' && review.next_retry_at && (
  <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
    Retry scheduled — attempt {(review.retry_count ?? 0) + 1} — next attempt at{' '}
    {new Date(review.next_retry_at).toLocaleString()}.
  </div>
)}
{review.status === 'failed' && !review.next_retry_at && (review.retry_count ?? 0) > 0 && (
  <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
    Failed permanently after {(review.retry_count ?? 0) + 1} attempts.
  </div>
)}
```

- [ ] **Step 3: Verify the frontend build**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (If the frontend has no standalone `tsc` target, run `cd frontend && npm run build` instead and confirm it completes.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/ReviewDetail.tsx
git commit -m "feat: show retry status on review detail page"
```

---

## Task 11: Full verification

- [ ] **Step 1: Run the whole backend test suite**

Run: `npx vitest run`
Expected: PASS — including `retry-policy`, `reviews.repository`, `retry-scheduler`, `config`, plus the pre-existing `parser`, `prompt`, `queue` suites.

- [ ] **Step 2: Typecheck the backend**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: completes without errors.

- [ ] **Step 4: Final commit (if anything was adjusted during verification)**

```bash
git add -A
git commit -m "chore: verify automatic review retry" || echo "nothing to commit"
```

---

## Notes for the implementer

- **"Failure" = `failed` status only.** A successful CLI exit whose output fails to parse stays `completed` (unchanged) and is not retried — this is intentional and out of scope.
- **`insertSeenCommit` still runs on every failure.** Retries are driven from the `reviews` table by the scheduler, independent of `seen_commits`, so the poller's dedup is untouched.
- **With `review.retryEnabled=false`** the behavior matches today's exactly (the two columns stay inert; `markFailedFinal` clears `next_retry_at`).
- **Attempt math:** retry while `retry_count < maxRetryAttempts - 1`. Default 10 ⇒ original + 9 retries; backoff `2, 4, 8, 16, 32, 60, 60, 60, 60` minutes.
- **Out of scope (do not implement):** per-error-type policies, configurable backoff curve, dashboard/PR-card retry display, fixing reconciliation's omission of `org_url`/`token`.
