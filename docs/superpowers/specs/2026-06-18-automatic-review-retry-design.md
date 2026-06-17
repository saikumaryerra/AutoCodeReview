# Automatic Review Retry — Design

**Date:** 2026-06-18
**Status:** Approved (design); pending implementation plan
**Author:** AutoCodeReview team

## Problem

When a review ends in `failed` status, the pipeline marks the commit as seen
(`insertSeenCommit`) and stops. The poller's dedup check (`isCommitSeen`) then
prevents it from ever being re-discovered, so a failed review is never retried
automatically — a transient Claude API rate limit, a network blip, or a CLI
timeout permanently fails the review until a human clicks **Re-review**.

Misleadingly, the parser already returns messages like
`"Claude API rate limit exceeded — retrying later"`
([parser.ts](../../../src/reviewer/parser.ts)), but nothing actually retries.

## Goal

Automatically retry failed reviews with bounded, exponential backoff that
survives process restarts.

### Decisions (from brainstorming)

- **Retry scope:** ALL failures (both transient — rate limit / connection /
  timeout — and permanent — auth, parse, etc.). Permanent failures are bounded
  by the attempt cap so they stop retrying.
- **Pacing:** exponential backoff.
- **Attempt cap:** 10 total attempts (1 original + 9 retries).
- **Durability:** retry state persists on the `reviews` row and survives restart.
- **Manual Re-review resets `retry_count` to 0** (a human retry starts the
  budget fresh).
- **Backoff constants are NOT user-configurable** (only enable + max attempts).

"Failure" means a review reaches `failed` status: a non-zero Claude CLI exit, or
an exception in the pipeline (e.g. clone failure). A successful CLI exit whose
output fails to parse stays `completed` today and is out of scope.

## Approaches Considered

- **A. Dedicated `RetryScheduler` + persistent state on `reviews`** — *chosen*.
  Precise backoff, survives restart, fully decoupled from the poller.
- **B. Poller-driven** (stop marking failed commits as seen). Rejected: retry
  cadence is locked to the poll interval (default 1 hour); no real backoff;
  capping attempts still needs a counter column.
- **C. In-memory `setTimeout` per failed job.** Rejected: timers are lost on
  restart/deploy; holding long-lived timers in memory is fragile.

## Architecture

A new `RetryScheduler` service mirrors `PollerService`: it owns a `setInterval`
tick and, each tick, atomically claims any `failed` review whose `next_retry_at`
is due, resets it to `pending`, and re-enqueues it onto the existing in-memory
`ReviewQueue`. The reviewer service processes it as a normal job.

Retries are driven entirely from the `reviews` table and are independent of
`seen_commits`, so the poller's dedup is unaffected and the existing
`insertSeenCommit`-on-failure behavior is unchanged.

```
review fails ──▶ scheduleRetryOrGiveUp()
                   ├─ insertSeenCommit(job)            (unchanged; keeps poller out)
                   ├─ if retries remain: retry_count++, next_retry_at = now + backoff
                   └─ else: next_retry_at = NULL        (give up)

RetryScheduler tick (every 60s):
   claim failed reviews where next_retry_at <= now  ──▶ status='pending', enqueue
```

## Components

### 1. Data model — 2 new columns on `reviews`

Added via the existing idempotent `migrations` array in
[connection.ts](../../../src/database/connection.ts):

| Column          | Type                       | Meaning                                                                 |
| --------------- | -------------------------- | ----------------------------------------------------------------------- |
| `retry_count`   | `INTEGER NOT NULL DEFAULT 0` | Retries performed so far (0 = only the original attempt has run).      |
| `next_retry_at` | `TEXT` (nullable ISO ts)   | When the next retry is due. `NULL` = not scheduled / pending / gave up. |

Migrations to append:

```sql
ALTER TABLE reviews ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reviews ADD COLUMN next_retry_at TEXT;
```

The base schema in [schema.ts](../../../src/database/schema.ts) gains the same
two columns for fresh databases.

Both columns are surfaced on the `Review` domain type
([types.ts](../../../src/shared/types.ts)) and populated in `parseReviewRow`
so the API/UI can display retry progress.

### 2. Settings — 2 new registry keys

Added to `CONFIG_REGISTRY`
([config.schema.ts](../../../src/config/config.schema.ts)), the `review` block of
the Zod schema and loader ([config.ts](../../../src/config/config.ts)), and the
runtime `ConfigService` defaults:

| Key                       | Type    | Default | Editable | Restart |
| ------------------------- | ------- | ------- | -------- | ------- |
| `review.retryEnabled`     | boolean | `true`  | yes      | no      |
| `review.maxRetryAttempts` | number  | `10`    | yes      | no      |

Env vars: `REVIEW_RETRY_ENABLED`, `REVIEW_MAX_RETRY_ATTEMPTS`.
`maxRetryAttempts` validation: `z.number().min(1).max(50)`.

Backoff constants (module-level in the scheduler/service, not configurable):

```
RETRY_BASE_SECONDS = 120      # first retry ~2 min
RETRY_FACTOR       = 2        # 2,4,8,16,32 min ...
RETRY_CAP_SECONDS  = 3600     # capped at 60 min
RETRY_TICK_SECONDS = 60       # scheduler tick interval
```

`backoff(retryNumber)` where `retryNumber` is 1-based:
`min(RETRY_CAP_SECONDS, RETRY_BASE_SECONDS * RETRY_FACTOR^(retryNumber-1))`.
Schedule for 9 retries: 2, 4, 8, 16, 32, 60, 60, 60, 60 minutes.

### 3. Failure path — `reviewer.service.ts`

Both current failure sites (the `if (!cliResult.success)` block and the `catch`)
route through one private helper:

```
scheduleRetryOrGiveUp(reviewId, job, errorDetail):
    insertSeenCommit(job)                      # unchanged
    retryEnabled  = config.get('review.retryEnabled')
    maxAttempts   = config.get('review.maxRetryAttempts')
    current       = reviewsRepo.getRetryCount(reviewId)   # retry_count
    if retryEnabled and (current < maxAttempts - 1):
        next = current + 1
        nextRetryAt = now + backoff(next) seconds
        reviewsRepo.scheduleRetry(reviewId, next, nextRetryAt, errorDetail)
        log "retry scheduled (attempt {next+1}/{maxAttempts}) at {nextRetryAt}"
    else:
        reviewsRepo.markFailedFinal(reviewId, errorDetail)   # next_retry_at = NULL
        log "review failed permanently after {current+1} attempt(s)" (or "retry disabled")
```

The existing `updateStatus(reviewId, 'failed', …)` calls at both sites are
replaced by this helper. The success path is unchanged.

### 4. `RetryScheduler` — `src/poller/retry-scheduler.ts`

Constructed with `{ db, queue, configService, reposRepo }`. API:

- `start()` — schedule a `setInterval` tick every `RETRY_TICK_SECONDS`.
- `stop()` — clear the interval (called on shutdown).
- `tick()` — claim and enqueue due retries (also callable directly in tests).

`tick()`:

1. `claimed = reviewsRepo.claimDueRetries(nowIso)` — atomically (single
   transaction) finds rows where `status='failed' AND next_retry_at IS NOT NULL
   AND next_retry_at <= now`, sets each to `status='pending', next_retry_at=NULL`,
   and returns the claimed rows. The per-row claim uses
   `UPDATE … WHERE id=? AND status='failed'` and only treats the row as claimed
   when `changes === 1`, so overlapping ticks cannot double-enqueue.
2. For each claimed row, rebuild a `ReviewJob` (like
   [reconciliation.ts](../../../src/poller/reconciliation.ts)) **and** look up
   `org_url` / `token` from the `repositories` table so Azure DevOps private
   repos retry with correct credentials.
3. `queue.enqueue(job)` and log `attempt N/maxAttempts`.

Wired in [index.ts](../../../src/index.ts): constructed after the poller,
`.start()` called, `.stop()` added to the `shutdown` handler.

Startup ordering is safe: reconciliation re-enqueues `pending` reviews first;
the scheduler then picks up any already-due `failed` reviews on its first tick,
so retries scheduled before a crash resume after restart.

### 5. Repository methods — `reviews.repository.ts`

- `getRetryCount(id): number`
- `scheduleRetry(id, retryCount, nextRetryAt, errorMessage)` — sets
  `retry_count`, `next_retry_at`, `status='failed'`, `error_message`.
- `markFailedFinal(id, errorMessage)` — sets `status='failed'`,
  `next_retry_at=NULL`, `error_message` (leaves `retry_count` as-is).
- `claimDueRetries(nowIso): ClaimedRetryRow[]` — atomic claim described above.
- `resetRetryState(id)` — sets `retry_count=0`, `next_retry_at=NULL`; called by
  the manual Re-review / trigger path so a human retry starts fresh.

### 6. Manual trigger interaction — `reviews.routes.ts`

`POST /api/reviews/trigger` already resets an existing review to `pending`. It
will additionally call `resetRetryState(existing.id)` so a manual Re-review
clears the automatic-retry budget and `next_retry_at`.

### 7. Observability & UI (minimal)

- `GET /api/status` ([status.routes.ts](../../../src/api/routes/status.routes.ts))
  gains `scheduled_retries: number` (`COUNT(*) FROM reviews WHERE
  next_retry_at IS NOT NULL`). Added to the `SystemStatus` type.
- Frontend: failed `ReviewCard` / `ReviewDetail` may show
  `Retrying (N/10) · next attempt <relative time>` using the new
  `retry_count` / `next_retry_at` fields. The existing Re-review button is
  unchanged.

## Error Handling

- A failure while *scheduling* a retry (DB error) is logged; the review remains
  `failed` and will simply not be retried — no crash.
- The scheduler `tick()` wraps work in try/catch and logs; one bad row never
  stops the tick. An unhandled tick rejection is caught like the poller's
  `poll().catch(...)`.
- `maxRetryAttempts` changed at runtime takes effect on the next failure
  evaluation; reviews already scheduled keep their `next_retry_at`.

## Testing

Vitest, matching existing style ([queue.test.ts](../../../src/poller/queue.test.ts),
[parser.test.ts](../../../src/reviewer/parser.test.ts)):

1. **Backoff** — growth (2/4/8/16/32 min), cap at 60 min, give-up boundary at the
   10th attempt.
2. **`scheduleRetryOrGiveUp`** — schedules + increments below the cap; gives up
   (`next_retry_at = NULL`) at the cap; no-op scheduling when `retryEnabled=false`.
3. **`RetryScheduler.tick`** (real `:memory:` SQLite) — a due `failed` review is
   claimed + enqueued; a not-yet-due review is skipped; a `next_retry_at=NULL`
   review is skipped; running two ticks back-to-back enqueues the row only once.
4. **`claimDueRetries`** — sets `status='pending'`, clears `next_retry_at`,
   returns the claimed row.

## Blast Radius

- `reviews` table: additive columns only (defaulted) — existing rows/queries
  unaffected.
- `Review` type gains two optional fields — consumers that spread the row are
  unaffected; no consumer requires them.
- `reviewer.service.ts` failure path is refactored behind one helper; the
  success path and `insertSeenCommit` semantics are unchanged.
- New service + columns + settings are purely additive; with
  `review.retryEnabled=false` behavior is identical to today (modulo the two
  inert columns).

## Out of Scope

- Retrying reviews that exit 0 but produce unparseable output (stay `completed`).
- Per-error-type retry policies (all failures share one policy).
- Configurable backoff curve (constants only).
- Fixing reconciliation's omission of `org_url`/`token` (separate latent issue;
  the new scheduler does include credentials).
