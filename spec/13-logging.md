## 13. Logging

All logging goes through Winston (`src/shared/logger.ts`) with two transports: console (colorized, human-readable) and a rotating file (`data/logs/app.log`, max 10MB per file, keep 5 files).

Log levels:
- `error`: Something broke and needs attention (CLI crash, DB error, GitHub auth failure)
- `warn`: Something is off but the system continues (rate limit approaching, large PR skipped, parse fallback used)
- `info`: Normal operations (poll completed, review completed, server started)
- `debug`: Detailed internals (full CLI command, raw output, queue state changes)

Every log line includes a `module` field (e.g., `poller`, `reviewer`, `api`) so logs can be filtered by component.

---
