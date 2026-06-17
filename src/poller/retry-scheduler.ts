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
