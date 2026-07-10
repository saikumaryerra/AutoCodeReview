import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getSchemaSQL } from '../database/schema.js';
import { SettingsRepository } from '../database/settings.repository.js';
import { RepoSettingsRepository } from '../database/repo-settings.repository.js';
import { ReviewsRepository } from '../database/reviews.repository.js';
import { ReposRepository } from '../database/repos.repository.js';
import { ConfigService } from '../config/config.service.js';
import { ReviewQueue } from '../poller/queue.js';
import { ReviewerService } from './reviewer.service.js';
import type { AppConfig } from '../config/config.js';
import type { ReviewJob } from '../shared/types.js';

const ENV_CONFIG = {
    review: { maxFilesChanged: 50, maxDiffSize: 100000 },
} as unknown as AppConfig;

function makeFiles(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        filename: `src/file-${i}.ts`, status: 'modified', additions: 1, deletions: 0,
    }));
}

describe('ReviewerService — per-repo maxFilesChanged', () => {
    let db: Database.Database;
    let tmpDir: string;

    beforeEach(() => {
        db = new Database(':memory:');
        db.exec(getSchemaSQL());
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acr-rev-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('honors a per-repo maxFilesChanged override (skips below the global limit)', async () => {
        const reposRepo = new ReposRepository(db);
        const reviewsRepo = new ReviewsRepository(db);
        const configService = new ConfigService(
            new SettingsRepository(db), ENV_CONFIG, new RepoSettingsRepository(db),
        );

        // Repo tracked with coding standards already set (so generation is skipped).
        reposRepo.insert({
            id: 'repo-a', full_name: 'acme/a', provider: 'github', org_url: null,
            token: null, default_branch: 'main', added_at: new Date().toISOString(),
            last_polled_at: null, is_active: true, coding_standards: 'x',
        });
        // Per-repo limit of 10 — below the global default of 50.
        configService.setForRepo('repo-a', 'review.maxFilesChanged', 10);

        const fakeProvider = {
            getCloneUrl: () => 'https://example.test/acme/a.git',
            getPRDiff: async () => 'diff',
            getPRFiles: async () => makeFiles(30), // 30 > per-repo 10, but < global 50
        };
        const fakeFactory = { getProvider: async () => fakeProvider };
        const fakeRepoManager = {
            prepare: async () => tmpDir,
            generateDiff: async () => 'diff',
        };

        const reviewer = new ReviewerService(
            db,
            new ReviewQueue(),
            fakeFactory as any,
            configService,
            fakeRepoManager as any,
            {} as any,               // claudeExecutor — not reached (skips first)
            reviewsRepo,
            reposRepo,
            {} as any,               // standardsGenerator — not reached
        );

        const job: ReviewJob = {
            id: 'job-1', repoFullName: 'acme/a', provider: 'github', prNumber: 7,
            prTitle: 't', prAuthor: 'a', commitSha: 'abc1234', commitMessage: 'm',
            branchName: 'feat', targetBranch: 'main', prState: 'open', prUrl: null,
            orgUrl: undefined, token: undefined,
        } as unknown as ReviewJob;

        await reviewer.processReview(job);

        const review = reviewsRepo.getByPR('acme/a', 7).find(r => r.commit_sha === 'abc1234');
        expect(review?.status).toBe('skipped');
        expect(review?.error_message ?? '').toContain('10');
    });
});
