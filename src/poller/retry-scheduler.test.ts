import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from '../database/schema.js';
import { ReviewsRepository } from '../database/reviews.repository.js';
import { ReviewQueue } from './queue.js';
import { RetryScheduler } from './retry-scheduler.js';
import type { Review } from '../shared/types.js';

function makeDb(): Database.Database {
    const db = new Database(':memory:');
    db.exec(getSchemaSQL());
    return db;
}

function makeReview(overrides: Partial<Review> = {}): Review {
    return {
        id: 'r1', repo_full_name: 'owner/repo', provider: 'github', pr_number: 1,
        pr_title: 'Title', pr_author: 'alice', commit_sha: 'abc1234', commit_message: 'msg',
        branch_name: 'feature/x', target_branch: 'main', pr_state: 'open',
        pr_url: 'https://example.com/pr/1', summary: '', severity: 'info', findings: [],
        raw_output: '', files_reviewed: [], stats: { files_changed: 0, additions: 0, deletions: 0 },
        review_duration_ms: null, claude_model: null, status: 'failed', error_message: 'boom',
        created_at: new Date().toISOString(), ...overrides,
    };
}

const stubRepos = { getByFullName: () => ({ org_url: null, token: null }) };

describe('RetryScheduler.tick', () => {
    let db: Database.Database;
    let repo: ReviewsRepository;
    let queue: ReviewQueue;
    let scheduler: RetryScheduler;

    beforeEach(() => {
        db = makeDb();
        repo = new ReviewsRepository(db);
        queue = new ReviewQueue();
        scheduler = new RetryScheduler(repo, queue, stubRepos);
    });

    it('re-enqueues a due failed review and flips it to pending', async () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 1, '2020-01-01T00:00:00.000Z', 'rate limit');

        await scheduler.tick();

        expect(queue.size()).toBe(1);
        expect(queue.peek()?.commitSha).toBe('abc1234');
        expect(queue.peek()?.repoFullName).toBe('owner/repo');
        expect(repo.getById('r1')?.status).toBe('pending');
    });

    it('does not enqueue a review that is not yet due', async () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 1, '2999-01-01T00:00:00.000Z', 'x');

        await scheduler.tick();

        expect(queue.size()).toBe(0);
    });

    it('does not enqueue a failed review with no next_retry_at', async () => {
        repo.insert(makeReview({ id: 'r1', status: 'failed' }));

        await scheduler.tick();

        expect(queue.size()).toBe(0);
    });

    it('enqueues a due review only once across two ticks', async () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 1, '2020-01-01T00:00:00.000Z', 'x');

        await scheduler.tick();
        await scheduler.tick();

        expect(queue.size()).toBe(1);
    });
});
