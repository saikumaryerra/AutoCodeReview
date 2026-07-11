import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

// The loop under test never dequeues a job, so the provider/repo-manager/
// executor collaborators are never touched.
const ENV_CONFIG = { review: {}, claude: {} } as unknown as AppConfig;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms),
        ),
    ]);
}

describe('ReviewerService — graceful shutdown', () => {
    let db: Database.Database;
    let service: ReviewerService;

    beforeEach(() => {
        db = new Database(':memory:');
        db.exec(getSchemaSQL());
        const configService = new ConfigService(
            new SettingsRepository(db), ENV_CONFIG, new RepoSettingsRepository(db),
        );
        service = new ReviewerService(
            db,
            new ReviewQueue(),
            {} as never,          // providerFactory — unused on an empty queue
            configService,
            {} as never,          // repoManager
            {} as never,          // claudeExecutor
            new ReviewsRepository(db),
            new ReposRepository(db),
            {} as never,          // standardsGenerator
        );
    });

    afterEach(() => {
        db.close();
    });

    it('stop() ends an idle loop without waiting out the 5s poll sleep', async () => {
        const loop = service.startProcessing();
        service.stop();
        // 1000ms is far below the 5000ms idle sleep: proves the sleep is interrupted.
        await expect(withTimeout(loop, 1000)).resolves.toBeUndefined();
    });

    it('stop() before start means the loop body never runs', async () => {
        service.stop();
        await expect(withTimeout(service.startProcessing(), 1000)).resolves.toBeUndefined();
    });

    it('stop() is idempotent', async () => {
        const loop = service.startProcessing();
        service.stop();
        service.stop();
        await expect(withTimeout(loop, 1000)).resolves.toBeUndefined();
    });

    it('stop() called while a review is in flight lets it finish before the loop resolves', async () => {
        // The PRIMARY invariant of the drain: stop() must not truncate a
        // running review. processReview is public, so we subclass it locally
        // to simulate a slow in-flight job and observe ordering — no
        // production code changes needed.
        let reviewStarted = false;
        let reviewFinished = false;

        class SlowReviewerService extends ReviewerService {
            override async processReview(): Promise<void> {
                reviewStarted = true;
                await new Promise<void>(resolve => setTimeout(resolve, 50));
                reviewFinished = true;
            }
        }

        const queue = new ReviewQueue();
        const configService = new ConfigService(
            new SettingsRepository(db), ENV_CONFIG, new RepoSettingsRepository(db),
        );
        const slowService = new SlowReviewerService(
            db,
            queue,
            {} as never,          // providerFactory — processReview is overridden, never reached
            configService,
            {} as never,          // repoManager
            {} as never,          // claudeExecutor
            new ReviewsRepository(db),
            new ReposRepository(db),
            {} as never,          // standardsGenerator
        );

        const job: ReviewJob = {
            id: 'job-1', repoFullName: 'acme/a', provider: 'github', prNumber: 1,
            prTitle: 't', prAuthor: 'a', commitSha: 'abc1234', commitMessage: 'm',
            branchName: 'feat', targetBranch: 'main', prState: 'open',
            prUrl: 'https://example.test/acme/a/pull/1', enqueuedAt: new Date(),
        };
        queue.enqueue(job);

        const loop = slowService.startProcessing();

        // Let the loop dequeue the job and enter the (overridden) processReview
        // before we call stop() mid-flight.
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(reviewStarted).toBe(true);

        slowService.stop();
        // The instant stop() returns, the 50ms review must still be running —
        // proving stop() only requests exit and does not abort in-flight work.
        expect(reviewFinished).toBe(false);

        // The loop promise must not resolve until the in-flight review drains.
        await expect(withTimeout(loop, 1000)).resolves.toBeUndefined();
        expect(reviewFinished).toBe(true);
    });
});
