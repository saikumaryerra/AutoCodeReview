## 12. Error Handling Strategy

Every layer of the application handles errors with the same philosophy: **never crash the process, always log the error, always leave a record in the database, and always continue to the next piece of work.**

**Poller errors:** If the GitHub API returns a network error or a non-200 status for one repo, the poller logs the error with the repo name and continues to the next repo. Repeated failures for the same repo (3+ consecutive) trigger a warning-level log suggesting the token might lack access.

**Reviewer errors:** If Claude CLI times out, crashes, or returns unparseable output, the review row is updated with `status: 'failed'` and the `error_message` column is populated with a useful description. The job is **not** retried automatically — it can be retried via the `/reviews/trigger` endpoint.

**API errors:** All routes are wrapped in an async error handler. Unexpected errors return a 500 with a generic message (no stack traces in production). Validation errors (bad query params, missing fields) return 400 with a descriptive Zod error message.

**Database errors:** If SQLite throws (disk full, corruption, etc.), the error propagates to whichever layer triggered it. The logger writes the full error. The process continues running so the API still serves cached data.

---
