## 11. Application Entry Point

The `src/index.ts` file boots every component in the right order:

```typescript
// src/index.ts — Application bootstrap

import { config } from './config';
import { initializeDatabase } from './database/connection';
import { PollerService } from './poller/poller.service';
import { ReviewerService } from './reviewer/reviewer.service';
import { ReviewQueue } from './poller/queue';
import { startApiServer } from './api/server';
import { logger } from './shared/logger';

async function main() {
    logger.info('Starting PR Review System...');

    // 1. Verify Claude CLI is available
    // Spawn "claude --version" and check exit code. Fail fast if not installed.

    // 2. Initialize database (create tables if they don't exist)
    const db = initializeDatabase(config.storage.dbPath);

    // 3. Seed repositories from config (insert any from GITHUB_REPOS that aren't tracked yet)
    // This ensures repos from .env are automatically tracked on first run.

    // 4. Create shared queue
    const queue = new ReviewQueue();

    // 5. Reconcile orphaned reviews from previous crash/shutdown.
    //    Must run BEFORE the poller and reviewer start to avoid races.
    const reconciled = reconcileOrphanedReviews(db, queue);
    if (reconciled > 0) {
        logger.info(`Startup reconciliation: re-enqueued ${reconciled} orphaned review(s)`);
    }

    // 6. Start the reviewer service (begins its processing loop)
    const reviewer = new ReviewerService(db, queue, config);
    reviewer.startProcessing(); // runs in background (not awaited)

    // 7. Start the poller service (begins cron-based polling)
    const poller = new PollerService(db, queue, config);
    poller.start();

    // 8. Start the API server
    await startApiServer(db, queue, config);

    logger.info(`System running. Polling ${config.github.repos.length} repos every ${config.polling.intervalSeconds}s.`);
    logger.info(`API server at http://localhost:${config.server.apiPort}`);
}

main().catch(err => {
    logger.error('Fatal startup error', err);
    process.exit(1);
});
```

---
