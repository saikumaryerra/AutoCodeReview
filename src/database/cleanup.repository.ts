import type Database from 'better-sqlite3';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('cleanup-repo');

// ── Types ───────────────────────────────────────────────────────

export interface CleanupDBResult {
    reviewsDeleted: number;
    seenCommitsDeleted: number;
}

export interface CleanupPreviewResult {
    reviewCount: number;
    oldestReviewDate: string | null;
}

// ── Constants ───────────────────────────────────────────────────

/** Maximum rows to delete per batch to avoid holding the write lock too long. */
const BATCH_SIZE = 500;

// ── Repository class ────────────────────────────────────────────

export class CleanupRepository {
    constructor(private db: Database.Database) {}

    /**
     * Delete reviews older than `retentionDays` days, along with their
     * matching seen_commits entries.
     *
     * Deletions are batched (BATCH_SIZE rows at a time) so the SQLite
     * write lock is not held for an extended period, allowing concurrent
     * readers to make progress between batches.
     *
     * After all deletes, VACUUM is run to reclaim disk space.
     */
    deleteOldReviews(retentionDays: number): CleanupDBResult {
        const cutoffDate = this.buildCutoffDate(retentionDays);
        log.info('Starting cleanup', { retentionDays, cutoffDate });

        let reviewsDeleted = 0;
        let seenCommitsDeleted = 0;

        // ── Delete reviews in batches ────────────────────────────
        const deleteReviewBatch = this.db.prepare(`
            DELETE FROM reviews
            WHERE id IN (
                SELECT id FROM reviews
                WHERE created_at < @cutoff
                LIMIT @batchSize
            )
        `);

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const result = deleteReviewBatch.run({ cutoff: cutoffDate, batchSize: BATCH_SIZE });
            reviewsDeleted += result.changes;

            if (result.changes < BATCH_SIZE) {
                break;
            }
        }

        // ── Delete orphaned seen_commits ─────────────────────────
        // A seen_commit is orphaned when it references a commit that no
        // longer has a review row (because we just deleted it).
        const deleteSeenBatch = this.db.prepare(`
            DELETE FROM seen_commits
            WHERE rowid IN (
                SELECT sc.rowid FROM seen_commits sc
                LEFT JOIN reviews r
                    ON  sc.repo_full_name = r.repo_full_name
                    AND sc.pr_number      = r.pr_number
                    AND sc.commit_sha     = r.commit_sha
                WHERE r.id IS NULL
                LIMIT @batchSize
            )
        `);

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const result = deleteSeenBatch.run({ batchSize: BATCH_SIZE });
            seenCommitsDeleted += result.changes;

            if (result.changes < BATCH_SIZE) {
                break;
            }
        }

        // ── Reclaim disk space ───────────────────────────────────
        try {
            this.db.exec('VACUUM');
            log.debug('VACUUM completed');
        } catch (err) {
            // VACUUM can fail if another connection holds a read transaction.
            // Log the error but do not propagate -- the cleanup itself succeeded.
            log.warn('VACUUM failed (non-fatal)', { error: (err as Error).message });
        }

        log.info('Cleanup completed', { reviewsDeleted, seenCommitsDeleted });
        return { reviewsDeleted, seenCommitsDeleted };
    }

    /**
     * Preview what a cleanup would delete without modifying any data.
     */
    previewCleanup(retentionDays: number): CleanupPreviewResult {
        const cutoffDate = this.buildCutoffDate(retentionDays);

        const row = this.db
            .prepare(`
                SELECT
                    COUNT(*)    AS reviewCount,
                    MIN(created_at) AS oldestReviewDate
                FROM reviews
                WHERE created_at < @cutoff
            `)
            .get({ cutoff: cutoffDate }) as { reviewCount: number; oldestReviewDate: string | null };

        return {
            reviewCount: row.reviewCount,
            oldestReviewDate: row.oldestReviewDate,
        };
    }

    // ── Private helpers ──────────────────────────────────────────

    /**
     * Build the ISO-8601 cutoff date string for a given retention window.
     */
    private buildCutoffDate(retentionDays: number): string {
        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
        return cutoff.toISOString().replace('T', ' ').slice(0, 19);
    }
}
