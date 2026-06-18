import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from './schema.js';
import { ReviewsRepository } from './reviews.repository.js';
import type { Review } from '../shared/types.js';

function makeDb(): Database.Database {
    const db = new Database(':memory:');
    db.exec(getSchemaSQL());
    return db;
}

function makeReview(overrides: Partial<Review> = {}): Review {
    return {
        id: 'r1',
        repo_full_name: 'owner/repo',
        provider: 'github',
        pr_number: 1,
        pr_title: 'Title',
        pr_author: 'alice',
        commit_sha: 'abc1234',
        commit_message: 'msg',
        branch_name: 'feature/x',
        target_branch: 'main',
        pr_state: 'open',
        pr_url: 'https://example.com/pr/1',
        summary: '',
        severity: 'info',
        findings: [],
        raw_output: '',
        files_reviewed: [],
        stats: { files_changed: 0, additions: 0, deletions: 0 },
        review_duration_ms: null,
        claude_model: null,
        status: 'failed',
        error_message: 'boom',
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

describe('ReviewsRepository retry columns', () => {
    let db: Database.Database;
    let repo: ReviewsRepository;

    beforeEach(() => {
        db = makeDb();
        repo = new ReviewsRepository(db);
    });

    it('defaults retry_count to 0 and next_retry_at to null on insert', () => {
        repo.insert(makeReview());
        const r = repo.getById('r1');
        expect(r?.retry_count).toBe(0);
        expect(r?.next_retry_at).toBeNull();
    });

    it('persists explicit retry values through getById and list()', () => {
        repo.insert(makeReview({ id: 'r1', retry_count: 3, next_retry_at: '2026-06-18T10:00:00.000Z' }));

        const byId = repo.getById('r1');
        expect(byId?.retry_count).toBe(3);
        expect(byId?.next_retry_at).toBe('2026-06-18T10:00:00.000Z');

        const listed = repo.list({}).data.find((r) => r.id === 'r1');
        expect(listed?.retry_count).toBe(3);
        expect(listed?.next_retry_at).toBe('2026-06-18T10:00:00.000Z');
    });
});

describe('ReviewsRepository retry methods', () => {
    let db: Database.Database;
    let repo: ReviewsRepository;

    beforeEach(() => {
        db = makeDb();
        repo = new ReviewsRepository(db);
    });

    it('getRetryCount returns the stored count', () => {
        repo.insert(makeReview({ id: 'r1' }));
        expect(repo.getRetryCount('r1')).toBe(0);
    });

    it('scheduleRetry sets retry_count, next_retry_at, and failed status', () => {
        repo.insert(makeReview({ id: 'r1', status: 'in_progress' }));
        repo.scheduleRetry('r1', 1, '2026-06-18T00:02:00.000Z', 'rate limit');
        const r = repo.getById('r1');
        expect(r?.retry_count).toBe(1);
        expect(r?.next_retry_at).toBe('2026-06-18T00:02:00.000Z');
        expect(r?.status).toBe('failed');
        expect(r?.error_message).toBe('rate limit');
    });

    it('markFailedFinal clears next_retry_at and keeps status failed', () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 3, '2026-06-18T00:02:00.000Z', 'x');
        repo.markFailedFinal('r1', 'gave up');
        const r = repo.getById('r1');
        expect(r?.next_retry_at).toBeNull();
        expect(r?.status).toBe('failed');
        expect(r?.retry_count).toBe(3);
        expect(r?.error_message).toBe('gave up');
    });

    it('resetRetryState zeroes retry_count and clears next_retry_at', () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 5, '2026-06-18T00:02:00.000Z', 'x');
        repo.resetRetryState('r1');
        const r = repo.getById('r1');
        expect(r?.retry_count).toBe(0);
        expect(r?.next_retry_at).toBeNull();
    });

    it('claimDueRetries claims due failed reviews and flips them to pending', () => {
        repo.insert(makeReview({ id: 'r1' }));
        repo.scheduleRetry('r1', 1, '2020-01-01T00:00:00.000Z', 'x'); // past = due
        const claimed = repo.claimDueRetries(new Date().toISOString());
        expect(claimed).toHaveLength(1);
        expect(claimed[0].id).toBe('r1');
        expect(claimed[0].retry_count).toBe(1);
        const r = repo.getById('r1');
        expect(r?.status).toBe('pending');
        expect(r?.next_retry_at).toBeNull();
    });

    it('claimDueRetries ignores future and unscheduled reviews, and is idempotent', () => {
        repo.insert(makeReview({ id: 'future', commit_sha: 'sha_future' }));
        repo.scheduleRetry('future', 1, '2999-01-01T00:00:00.000Z', 'x');
        repo.insert(makeReview({ id: 'nulled', commit_sha: 'sha_nulled', status: 'failed' })); // next_retry_at stays null
        repo.insert(makeReview({ id: 'due', commit_sha: 'sha_due' }));
        repo.scheduleRetry('due', 1, '2020-01-01T00:00:00.000Z', 'x');

        const first = repo.claimDueRetries(new Date().toISOString());
        expect(first.map((r) => r.id)).toEqual(['due']);

        const second = repo.claimDueRetries(new Date().toISOString());
        expect(second).toHaveLength(0);
    });
});
