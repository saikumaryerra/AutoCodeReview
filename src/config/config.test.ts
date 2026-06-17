import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig retry settings', () => {
    it('defaults retryEnabled=true and maxRetryAttempts=10', () => {
        process.env.GITHUB_TOKEN = 'x';
        process.env.GITHUB_REPOS = 'owner/repo';
        delete process.env.REVIEW_RETRY_ENABLED;
        delete process.env.REVIEW_MAX_RETRY_ATTEMPTS;

        const cfg = loadConfig();
        expect(cfg.review.retryEnabled).toBe(true);
        expect(cfg.review.maxRetryAttempts).toBe(10);
    });

    it('reads overrides from env', () => {
        process.env.GITHUB_TOKEN = 'x';
        process.env.GITHUB_REPOS = 'owner/repo';
        process.env.REVIEW_RETRY_ENABLED = 'false';
        process.env.REVIEW_MAX_RETRY_ATTEMPTS = '5';

        const cfg = loadConfig();
        expect(cfg.review.retryEnabled).toBe(false);
        expect(cfg.review.maxRetryAttempts).toBe(5);
    });
});
