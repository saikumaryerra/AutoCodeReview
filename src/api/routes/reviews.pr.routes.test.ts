import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from '../../database/schema.js';
import { ReviewsRepository } from '../../database/reviews.repository.js';
import { createReviewsRouter } from './reviews.routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import type { Review } from '../../shared/types.js';

function makeReview(overrides: Partial<Review> = {}): Review {
    return {
        id: 'r1',
        repo_full_name: 'acme/a',
        provider: 'github',
        pr_number: 7,
        pr_title: 'Title',
        pr_author: 'alice',
        commit_sha: 'abc1234',
        commit_message: 'msg',
        branch_name: 'feature/x',
        target_branch: 'main',
        pr_state: 'open',
        pr_url: 'https://example.com/pr/7',
        summary: '',
        severity: 'info',
        findings: [],
        raw_output: '',
        files_reviewed: [],
        stats: { files_changed: 0, additions: 0, deletions: 0 },
        review_duration_ms: null,
        claude_model: null,
        status: 'completed',
        error_message: null,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

function makeApp(): express.Express {
    const db = new Database(':memory:');
    db.exec(getSchemaSQL());
    const reviewsRepo = new ReviewsRepository(db);
    reviewsRepo.insert(makeReview());

    const app = express();
    app.use(express.json());
    app.use(
        '/api/v1/reviews',
        createReviewsRouter({
            reviewsRepo,
            queue: {} as any,
            providerFactory: { getProvider: async () => ({}) } as any,
            configService: { get: () => undefined } as any,
            db,
        })
    );
    app.use(errorHandler);
    return app;
}

describe('GET /reviews/pr (repo as query param, proxy-portable)', () => {
    let app: express.Express;
    beforeEach(() => { app = makeApp(); });

    it('resolves a slash-bearing repo passed in the query string', async () => {
        // The crux: `acme/a` contains a slash. As a query param it survives any
        // proxy that would otherwise decode a %2F path segment.
        const res = await request(app)
            .get('/api/v1/reviews/pr')
            .query({ repo: 'acme/a', pr: 7 });

        expect(res.status).toBe(200);
        expect(res.body.data.repo_full_name).toBe('acme/a');
        expect(res.body.data.pr_number).toBe(7);
        expect(res.body.data.reviews).toHaveLength(1);
    });

    it('returns an empty structure (200) for a PR with no reviews', async () => {
        const res = await request(app)
            .get('/api/v1/reviews/pr')
            .query({ repo: 'acme/a', pr: 999 });

        expect(res.status).toBe(200);
        expect(res.body.data.pr_number).toBe(999);
        expect(res.body.data.reviews).toEqual([]);
    });

    it('rejects a missing repo with 400', async () => {
        const res = await request(app).get('/api/v1/reviews/pr').query({ pr: 7 });
        expect(res.status).toBe(400);
    });

    it('rejects a non-numeric pr with 400', async () => {
        const res = await request(app)
            .get('/api/v1/reviews/pr')
            .query({ repo: 'acme/a', pr: 'notanumber' });
        expect(res.status).toBe(400);
    });

    it('rejects a non-positive pr with 400', async () => {
        const res = await request(app)
            .get('/api/v1/reviews/pr')
            .query({ repo: 'acme/a', pr: 0 });
        expect(res.status).toBe(400);
    });
});
