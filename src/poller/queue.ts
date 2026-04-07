import type { ReviewJob } from '../shared/types.js';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('review-queue');

/**
 * Simple in-memory FIFO queue for review jobs.
 *
 * This queue does not survive restarts. On startup, the reconciliation step
 * (reconciliation.ts) detects orphaned reviews and re-enqueues them.
 */
export class ReviewQueue {
    private jobs: ReviewJob[] = [];

    enqueue(job: ReviewJob): void {
        this.jobs.push(job);
        log.info('Job enqueued', {
            jobId: job.id,
            repo: job.repoFullName,
            pr: job.prNumber,
            commit: job.commitSha.substring(0, 8),
            queueSize: this.jobs.length,
        });
    }

    dequeue(): ReviewJob | null {
        const job = this.jobs.shift() ?? null;
        if (job) {
            log.debug('Job dequeued', {
                jobId: job.id,
                repo: job.repoFullName,
                pr: job.prNumber,
                queueSize: this.jobs.length,
            });
        }
        return job;
    }

    peek(): ReviewJob | null {
        return this.jobs[0] ?? null;
    }

    size(): number {
        return this.jobs.length;
    }

    isEmpty(): boolean {
        return this.jobs.length === 0;
    }

    getAll(): ReviewJob[] {
        return [...this.jobs];
    }
}
