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
});
