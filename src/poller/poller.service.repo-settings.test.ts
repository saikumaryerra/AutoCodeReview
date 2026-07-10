import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from '../database/schema.js';
import { SettingsRepository } from '../database/settings.repository.js';
import { RepoSettingsRepository } from '../database/repo-settings.repository.js';
import { ConfigService } from '../config/config.service.js';
import { ReviewQueue } from './queue.js';
import { PollerService } from './poller.service.js';
import type { AppConfig } from '../config/config.js';

const ENV_CONFIG = {
    review: { prStateFilter: 'open', skipDrafts: true },
    polling: { intervalSeconds: 3600 },
} as unknown as AppConfig;

/** Fake provider that records the state filter it was polled with, returns no PRs. */
function makeFakeFactory(calls: Array<{ repo: string; state: string }>) {
    return {
        async getProvider() {
            return {
                async listPullRequests(fullName: string, state: string) {
                    calls.push({ repo: fullName, state });
                    return [];
                },
            };
        },
    };
}

function seedRepo(db: Database.Database, id: string, fullName: string) {
    db.prepare(
        `INSERT INTO repositories (id, full_name, provider, default_branch, is_active)
         VALUES (?, ?, 'github', 'main', 1)`
    ).run(id, fullName);
}

describe('PollerService — per-repo review filters', () => {
    let db: Database.Database;
    let svc: ConfigService;

    beforeEach(() => {
        db = new Database(':memory:');
        db.exec(getSchemaSQL());
        svc = new ConfigService(new SettingsRepository(db), ENV_CONFIG, new RepoSettingsRepository(db));
        seedRepo(db, 'repo-a', 'acme/a');
        seedRepo(db, 'repo-b', 'acme/b');
    });

    it('polls each repo with its own prStateFilter', async () => {
        // Repo A overrides to 'all'; repo B inherits global 'open'.
        svc.setForRepo('repo-a', 'review.prStateFilter', 'all');

        const calls: Array<{ repo: string; state: string }> = [];
        const poller = new PollerService(db, new ReviewQueue(), makeFakeFactory(calls) as any, svc);

        await poller.triggerManualPoll();

        expect(calls).toContainEqual({ repo: 'acme/a', state: 'all' });
        expect(calls).toContainEqual({ repo: 'acme/b', state: 'open' });
    });
});
