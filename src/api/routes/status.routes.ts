import { Router } from 'express';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createModuleLogger } from '../../shared/logger.js';
import type { ReviewQueue } from '../../poller/queue.js';
import type { SystemStatus } from '../../shared/types.js';
import type Database from 'better-sqlite3';
import type { ConfigService } from '../../config/config.service.js';

const logger = createModuleLogger('status-routes');

// ── Async handler wrapper ─────────────────────────────────────────

type AsyncHandler = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler): import('express').RequestHandler {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}

// ── Dependencies interface ────────────────────────────────────────

export interface ReviewerServiceDeps {
    getCurrentReview(): {
        repo: string;
        pr_number: number;
        commit_sha: string;
        started_at: string;
    } | null;
}

export interface PollerServiceDeps {
    getLastPollAt(): string | null;
    getNextPollAt(): string | null;
}

export interface CleanupRepoDeps {
    previewCleanup(retentionDays: number): {
        reviewsToDelete: number;
        oldestReviewDate: string | null;
    };
}

export interface RepoManagerDeps {
    listClones(): Array<{ sizeBytes: number }>;
    getReposDir(): string;
}

export interface StatusRouterDeps {
    queue: ReviewQueue;
    reviewerService: ReviewerServiceDeps;
    pollerService: PollerServiceDeps;
    configService: ConfigService;
    cleanupRepo: CleanupRepoDeps;
    repoManager: RepoManagerDeps;
    db: Database.Database;
}

// Track process start time for uptime calculation
const processStartTime = Date.now();

// ── Router factory ────────────────────────────────────────────────

export function createStatusRouter(deps: StatusRouterDeps): Router {
    const router = Router();
    const { queue, reviewerService, pollerService, configService, cleanupRepo, repoManager, db } = deps;

    // GET / — System status
    router.get(
        '/',
        asyncHandler(async (_req, res) => {
            logger.debug('Getting system status');

            // Uptime
            const uptimeSeconds = Math.floor((Date.now() - processStartTime) / 1000);

            // Queue depth
            const queueDepth = queue.size();

            // Currently reviewing
            const currentlyReviewing = reviewerService.getCurrentReview();

            // Poll times
            const lastPollAt = pollerService.getLastPollAt();
            const nextPollAt = pollerService.getNextPollAt();

            // Review counts
            const totalReviewsRow = db
                .prepare("SELECT COUNT(*) AS count FROM reviews WHERE status = 'completed'")
                .get() as { count: number };
            const totalReviewsCompleted = totalReviewsRow.count;

            const todayRow = db
                .prepare("SELECT COUNT(*) AS count FROM reviews WHERE date(created_at) = date('now')")
                .get() as { count: number };
            const reviewsToday = todayRow.count;

            // Claude CLI availability
            let claudeCliAvailable = false;
            try {
                const cliPath = configService.get<string>('claude.cliPath');
                execSync(`${cliPath} --version`, { stdio: 'pipe', timeout: 5000 });
                claudeCliAvailable = true;
            } catch {
                // CLI not available
            }

            // Retention info
            const retentionDays = configService.get<number>('review.retentionDays');
            const retentionEnabled = retentionDays > 0;
            let pendingDeletion = { reviewCount: 0, oldestReviewDate: null as string | null };

            if (retentionEnabled) {
                try {
                    const preview = cleanupRepo.previewCleanup(retentionDays);
                    pendingDeletion = {
                        reviewCount: preview.reviewsToDelete,
                        oldestReviewDate: preview.oldestReviewDate,
                    };
                } catch (err) {
                    logger.warn('Failed to get cleanup preview for status', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }

            // Storage info
            const dbPath = configService.get<string>('storage.dbPath');
            let dbSizeBytes = 0;
            try {
                dbSizeBytes = fs.statSync(dbPath).size;
            } catch {
                // DB file may not exist yet
            }

            const clones = repoManager.listClones();
            const totalCloneSizeBytes = clones.reduce((sum, c) => sum + c.sizeBytes, 0);
            const cloneCount = clones.length;

            const status: SystemStatus = {
                uptime_seconds: uptimeSeconds,
                queue_depth: queueDepth,
                currently_reviewing: currentlyReviewing,
                last_poll_at: lastPollAt,
                next_poll_at: nextPollAt,
                total_reviews_completed: totalReviewsCompleted,
                reviews_today: reviewsToday,
                claude_cli_available: claudeCliAvailable,
                retention: {
                    enabled: retentionEnabled,
                    retentionDays,
                    nextCleanupAt: null, // Filled in by the cleanup scheduler if available
                    pendingDeletion: {
                        reviewCount: pendingDeletion.reviewCount,
                        oldestReviewDate: pendingDeletion.oldestReviewDate,
                    },
                },
                storage: {
                    dbSizeBytes,
                    totalCloneSizeBytes,
                    cloneCount,
                },
            };

            res.json({ data: status });
        })
    );

    return router;
}
