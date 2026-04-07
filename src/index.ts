import { execSync } from 'child_process';
import cron from 'node-cron';
import { v4 as uuid } from 'uuid';
import { loadConfig } from './config/config.js';
import { ConfigService } from './config/config.service.js';
import { initializeDatabase } from './database/connection.js';
import { ReviewsRepository } from './database/reviews.repository.js';
import { ReposRepository } from './database/repos.repository.js';
import { SettingsRepository } from './database/settings.repository.js';
import { CleanupRepository } from './database/cleanup.repository.js';
import { ProviderFactory } from './poller/provider.factory.js';
import { ReviewQueue } from './poller/queue.js';
import { reconcileOrphanedReviews } from './poller/reconciliation.js';
import { PollerService } from './poller/poller.service.js';
import { RepoManager } from './reviewer/repo-manager.js';
import { ClaudeCliExecutor } from './reviewer/claude-cli.executor.js';
import { ReviewerService } from './reviewer/reviewer.service.js';
import { startApiServer } from './api/server.js';
import { createModuleLogger } from './shared/logger.js';

const logger = createModuleLogger('main');

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function main() {
    logger.info('Starting PR Review System...');

    // 1. Load and validate configuration
    const config = loadConfig();
    logger.info('Configuration loaded', {
        githubRepos: config.github.repos.length,
        azureRepos: config.azureDevOps.repos.length,
        pollInterval: config.polling.intervalSeconds,
    });

    // 2. Verify Claude CLI is available
    let claudeAvailable = false;
    try {
        const version = execSync(`${config.claude.cliPath} --version 2>/dev/null`, {
            timeout: 10_000,
            encoding: 'utf-8',
        }).trim();
        logger.info(`Claude CLI available: ${version}`);
        claudeAvailable = true;
    } catch {
        logger.warn(
            'Claude CLI not found or not responding. Reviews will fail until it is available. ' +
            `Checked path: ${config.claude.cliPath}`
        );
    }

    // 3. Initialize database
    const db = initializeDatabase(config.storage.dbPath);
    logger.info('Database initialized', { path: config.storage.dbPath });

    // 4. Create repositories
    const reviewsRepo = new ReviewsRepository(db);
    const reposRepo = new ReposRepository(db);
    const settingsRepo = new SettingsRepository(db);
    const cleanupRepo = new CleanupRepository(db);

    // 5. Create config service (two-tier: DB overrides > env defaults)
    const configService = new ConfigService(settingsRepo, config);

    // 6. Seed repositories from .env config
    const providerFactory = new ProviderFactory(config);
    const configuredRepos = providerFactory.getAllConfiguredRepos();

    for (const { fullName, provider } of configuredRepos) {
        const existing = reposRepo.getByFullName(fullName);
        if (!existing) {
            reposRepo.insert({
                id: uuid(),
                full_name: fullName,
                provider,
                org_url: provider === 'azure_devops' ? (config.azureDevOps.orgUrl ?? null) : null,
                default_branch: 'main',
                added_at: new Date().toISOString(),
                last_polled_at: null,
                is_active: true,
            });
            logger.info(`Seeded repository: ${fullName} (${provider})`);
        }
    }

    // 7. Create shared queue
    const queue = new ReviewQueue();

    // 8. Reconcile orphaned reviews from previous crash/shutdown
    const reconciled = reconcileOrphanedReviews(db, queue);
    if (reconciled > 0) {
        logger.info(`Startup reconciliation: re-enqueued ${reconciled} orphaned review(s)`);
    }

    // 9. Create reviewer components
    const repoManager = new RepoManager(config.storage.reposDir);
    const claudeExecutor = new ClaudeCliExecutor(
        config.claude.cliPath,
        config.claude.reviewTimeoutSeconds,
        config.claude.model
    );

    // 10. Start the reviewer service (continuous processing loop)
    const reviewerService = new ReviewerService(
        db,
        queue,
        providerFactory,
        configService,
        repoManager,
        claudeExecutor,
        reviewsRepo
    );
    reviewerService.startProcessing(); // runs in background (not awaited)
    logger.info('Reviewer service started');

    // 11. Start the poller service
    const pollerService = new PollerService(
        db,
        queue,
        providerFactory,
        configService
    );
    pollerService.start();
    logger.info('Poller service started', {
        intervalSeconds: configService.get<number>('polling.intervalSeconds'),
    });

    // 12. Schedule daily cleanup at 3:00 AM
    cron.schedule('0 3 * * *', async () => {
        logger.info('=== Daily cleanup started ===');

        // Phase 1: Database cleanup (old reviews + seen_commits)
        const retentionDays = configService.get<number>('review.retentionDays');
        if (retentionDays > 0) {
            logger.info(`Phase 1: Deleting reviews older than ${retentionDays} days`);
            try {
                const dbResult = cleanupRepo.deleteOldReviews(retentionDays);
                logger.info(
                    `Phase 1 complete: ${dbResult.reviewsDeleted} reviews deleted, ` +
                    `${dbResult.seenCommitsDeleted} seen_commits entries deleted`
                );
            } catch (err) {
                logger.error('Phase 1 (database cleanup) failed', { error: err });
            }
        } else {
            logger.info('Phase 1 skipped: data retention disabled');
        }

        // Phase 2: Remove clones for untracked repositories
        logger.info('Phase 2: Removing orphaned git clones');
        try {
            const clones = await repoManager.listClones();
            const trackedRepos = new Set(
                reposRepo.listAll().map(r => r.full_name)
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
            logger.error('Phase 2 (orphan cleanup) failed', { error: err });
        }

        // Phase 3: Prune active repo clones (git gc)
        logger.info('Phase 3: Pruning active git clones');
        try {
            const clones = await repoManager.listClones();
            let totalReclaimed = 0;

            for (const clone of clones) {
                try {
                    const result = await repoManager.pruneRepo(clone.repoFullName);
                    const reclaimed = result.sizeBefore - result.sizeAfter;
                    totalReclaimed += Math.max(0, reclaimed);
                    if (reclaimed > 1024 * 1024) {
                        logger.info(
                            `Pruned ${clone.repoFullName}: ` +
                            `${formatBytes(result.sizeBefore)} → ${formatBytes(result.sizeAfter)} ` +
                            `(freed ${formatBytes(reclaimed)})`
                        );
                    }
                } catch (err) {
                    logger.warn(`Failed to prune ${clone.repoFullName}`, { error: err });
                }
            }
            logger.info(`Phase 3 complete: reclaimed ${formatBytes(totalReclaimed)} from git gc`);
        } catch (err) {
            logger.error('Phase 3 (git prune) failed', { error: err });
        }

        logger.info('=== Daily cleanup finished ===');
    });
    logger.info('Daily cleanup scheduled at 3:00 AM');

    // 13. Start the API server
    await startApiServer({
        db,
        reviewsRepo,
        reposRepo,
        queue,
        configService,
        providerFactory,
        pollerService,
        reviewerService,
        cleanupRepo,
        repoManager,
    });

    const totalRepos = config.github.repos.length + config.azureDevOps.repos.length;
    logger.info(`System running. Tracking ${totalRepos} repo(s), polling every ${config.polling.intervalSeconds}s.`);
    logger.info(`API server at http://localhost:${config.server.apiPort}`);

    // Graceful shutdown
    const shutdown = () => {
        logger.info('Shutting down...');
        pollerService.stop();
        db.close();
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

main().catch(err => {
    logger.error('Fatal startup error', { error: err });
    process.exit(1);
});
