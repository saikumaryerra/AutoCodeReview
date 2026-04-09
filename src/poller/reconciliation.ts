import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { ReviewJob } from '../shared/types.js';
import type { ReviewQueue } from './queue.js';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('reconciliation');

interface PendingReviewRow {
    repo_full_name: string;
    provider: string;
    pr_number: number;
    pr_title: string;
    pr_author: string;
    commit_sha: string;
    commit_message: string | null;
    branch_name: string;
    target_branch: string;
    pr_state: string | null;
    pr_url: string | null;
}

/**
 * Runs once at startup to recover from unclean shutdowns.
 *
 * 1. Resets any reviews stuck in 'in_progress' back to 'pending'.
 * 2. Re-enqueues all 'pending' reviews so the reviewer picks them up.
 *
 * This is safe because seen_commits is only populated after a review reaches
 * a terminal state (completed, skipped, failed). Pending/in_progress reviews
 * are guaranteed NOT to be in seen_commits.
 */
export function reconcileOrphanedReviews(
    db: Database.Database,
    queue: ReviewQueue
): number {
    // Step 1: Reset in_progress reviews to pending
    const resetResult = db.prepare(`
        UPDATE reviews
        SET status = 'pending', error_message = 'Reset after unclean shutdown'
        WHERE status = 'in_progress'
    `).run();

    if (resetResult.changes > 0) {
        log.warn('Reset orphaned in_progress reviews', {
            count: resetResult.changes,
        });
    }

    // Step 2: Re-enqueue all pending reviews (including those just reset)
    const pendingRows = db.prepare(`
        SELECT r.repo_full_name, r.provider, r.pr_number, r.pr_title,
               r.pr_author, r.commit_sha, r.commit_message, r.branch_name,
               r.target_branch, r.pr_state, r.pr_url
        FROM reviews r
        WHERE r.status = 'pending'
    `).all() as PendingReviewRow[];

    for (const row of pendingRows) {
        const job: ReviewJob = {
            id: uuid(),
            repoFullName: row.repo_full_name,
            provider: row.provider as ReviewJob['provider'],
            prNumber: row.pr_number,
            prTitle: row.pr_title,
            prAuthor: row.pr_author,
            commitSha: row.commit_sha,
            commitMessage: row.commit_message ?? '',
            branchName: row.branch_name,
            targetBranch: row.target_branch,
            prState: (row.pr_state as ReviewJob['prState']) ?? 'open',
            prUrl: row.pr_url ?? '',
            enqueuedAt: new Date(),
        };
        queue.enqueue(job);
    }

    const total = resetResult.changes + pendingRows.length;

    if (total > 0) {
        log.info('Reconciliation complete', {
            resetFromInProgress: resetResult.changes,
            reEnqueued: pendingRows.length,
            total,
        });
    } else {
        log.debug('Reconciliation complete: no orphaned reviews found');
    }

    return total;
}
