import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import { validate, validateQuery } from '../middleware/validate.js';
import { createModuleLogger } from '../../shared/logger.js';
import type Database from 'better-sqlite3';
import type { GitCloneInfo } from '../../shared/types.js';
import type { ConfigService } from '../../config/config.service.js';

const logger = createModuleLogger('cleanup-routes');

// ── Zod schemas ───────────────────────────────────────────────────

const PreviewQuerySchema = z.object({
    retention_days: z.coerce.number().int().min(0).optional(),
});

const CleanupBodySchema = z.object({
    retention_days: z.number().int().min(0).optional(),
}).optional();

// ── Async handler wrapper ─────────────────────────────────────────

type AsyncHandler = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler): import('express').RequestHandler {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}

// ── Dependencies interface ────────────────────────────────────────

export interface CleanupRepoDeps {
    previewCleanup(retentionDays: number): { reviewCount: number; oldestReviewDate: string | null };
    deleteOldReviews(retentionDays: number): { reviewsDeleted: number; seenCommitsDeleted: number };
}

export interface RepoManagerDeps {
    listClones(): Promise<GitCloneInfo[]>;
    deleteClone(repoFullName: string): Promise<{ freedBytes: number }>;
    pruneRepo(repoFullName: string): Promise<{ sizeBefore: number; sizeAfter: number }>;
}

export interface ReposRepoDeps {
    prepare(sql: string): { all(...args: unknown[]): unknown[] };
}

export interface CleanupRouterDeps {
    cleanupRepo: CleanupRepoDeps;
    repoManager: RepoManagerDeps;
    reposRepo: Database.Database;
    configService: ConfigService;
    db: Database.Database;
}

// ── Router factory ────────────────────────────────────────────────

export function createCleanupRouter(deps: CleanupRouterDeps): Router {
    const router = Router();
    const { cleanupRepo, repoManager, configService, db } = deps;

    // GET /preview — Preview what cleanup would delete
    router.get(
        '/preview',
        validateQuery(PreviewQuerySchema),
        asyncHandler(async (req, res) => {
            const query = req.query as z.infer<typeof PreviewQuerySchema>;
            const retentionDays = query.retention_days ?? configService.get<number>('review.retentionDays');

            logger.info('Previewing cleanup', { retentionDays });

            const preview = cleanupRepo.previewCleanup(retentionDays);

            // Get clones and compare with tracked repos
            const clones = await repoManager.listClones();
            const trackedRepos = db
                .prepare('SELECT full_name FROM repositories')
                .all() as Array<{ full_name: string }>;

            const trackedNames = new Set(trackedRepos.map((r) => r.full_name));
            const orphanedClones = clones
                .filter((c) => !trackedNames.has(c.repoFullName))
                .map((c) => ({ repo_full_name: c.repoFullName, size_bytes: c.sizeBytes }));

            const totalCloneSize = clones.reduce((sum, c) => sum + c.sizeBytes, 0);

            // Get total review count for percentage calculation
            const totalRow = db
                .prepare('SELECT COUNT(*) AS total FROM reviews')
                .get() as { total: number };
            const totalReviews = totalRow.total;

            // Compute cutoff date
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

            // Return snake_case keys to match frontend expectations
            res.json({
                data: {
                    retention_days: retentionDays,
                    cutoff_date: cutoffDate.toISOString(),
                    reviews_to_delete: preview.reviewCount,
                    oldest_review_date: preview.oldestReviewDate,
                    total_reviews: totalReviews,
                    percentage_to_delete: totalReviews > 0
                        ? Math.round((preview.reviewCount / totalReviews) * 100)
                        : 0,
                    orphaned_clones: orphanedClones,
                    total_clone_size_bytes: totalCloneSize,
                },
            });
        })
    );

    // POST / — Trigger cleanup
    router.post(
        '/',
        asyncHandler(async (req, res) => {
            // Manually parse body if present (body may be undefined for empty POST)
            const bodySchema = z.object({
                retention_days: z.number().int().min(0).optional(),
            }).optional();

            const parsed = bodySchema.safeParse(req.body);
            const retentionDays = (parsed.success ? parsed.data?.retention_days : undefined)
                ?? configService.get<number>('review.retentionDays');

            logger.info('Triggering cleanup', { retentionDays });

            const startTime = Date.now();

            // Get DB file size before cleanup
            const dbPath = configService.get<string>('storage.dbPath');
            let dbSizeBeforeBytes = 0;
            try {
                dbSizeBeforeBytes = fs.statSync(dbPath).size;
            } catch {
                // DB file may not exist yet
            }

            // 1. Database cleanup
            const dbResult = cleanupRepo.deleteOldReviews(retentionDays);

            // 2. Delete orphaned clones
            const clones = await repoManager.listClones();
            const trackedRepos = db
                .prepare('SELECT full_name FROM repositories')
                .all() as Array<{ full_name: string }>;

            const trackedNames = new Set(trackedRepos.map((r) => r.full_name));

            let clonesDeleted = 0;
            let cloneSpaceFreedBytes = 0;
            let cloneSpacePrunedBytes = 0;

            for (const clone of clones) {
                if (!trackedNames.has(clone.repoFullName)) {
                    // Orphaned clone — delete entirely
                    try {
                        const result = await repoManager.deleteClone(clone.repoFullName);
                        clonesDeleted++;
                        cloneSpaceFreedBytes += result.freedBytes;
                    } catch (err) {
                        logger.error('Failed to delete orphaned clone', {
                            repoFullName: clone.repoFullName,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                } else {
                    // Tracked clone — prune (git gc, etc.)
                    try {
                        const result = await repoManager.pruneRepo(clone.repoFullName);
                        cloneSpacePrunedBytes += Math.max(0, result.sizeBefore - result.sizeAfter);
                    } catch (err) {
                        logger.error('Failed to prune clone', {
                            repoFullName: clone.repoFullName,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            }

            // Get DB file size after cleanup
            let dbSizeAfterBytes = 0;
            try {
                dbSizeAfterBytes = fs.statSync(dbPath).size;
            } catch {
                // DB file may not exist
            }

            const durationMs = Date.now() - startTime;

            const result = {
                reviews_deleted: dbResult.reviewsDeleted,
                seen_commits_deleted: dbResult.seenCommitsDeleted,
                clones_deleted: clonesDeleted,
                clone_space_freed_bytes: cloneSpaceFreedBytes,
                clone_space_pruned_bytes: cloneSpacePrunedBytes,
                duration_ms: durationMs,
                db_size_before_bytes: dbSizeBeforeBytes,
                db_size_after_bytes: dbSizeAfterBytes,
            };

            logger.info('Cleanup completed', result);

            res.json({ data: result });
        })
    );

    return router;
}
