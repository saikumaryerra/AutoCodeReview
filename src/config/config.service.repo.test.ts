import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from '../database/schema.js';
import { SettingsRepository } from '../database/settings.repository.js';
import { RepoSettingsRepository } from '../database/repo-settings.repository.js';
import { ConfigService } from './config.service.js';
import type { AppConfig } from './config.js';

// Minimal env covering the review defaults the resolver falls back to.
const ENV_CONFIG = {
    review: { maxFilesChanged: 50, skipDrafts: true, prStateFilter: 'open' },
} as unknown as AppConfig;

const REPO = 'repo-1';

function makeService(): ConfigService {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(getSchemaSQL());
    // repo_settings.repo_id has a FK to repositories(id); seed rows for the
    // repo ids exercised below (mirrors repo-settings.repository.test.ts).
    db.prepare(
        `INSERT INTO repositories (id, full_name, provider, default_branch)
         VALUES (?, ?, 'github', 'main')`
    ).run(REPO, 'acme/repo-1');
    db.prepare(
        `INSERT INTO repositories (id, full_name, provider, default_branch)
         VALUES (?, ?, 'github', 'main')`
    ).run('repo-2', 'acme/repo-2');
    return new ConfigService(
        new SettingsRepository(db),
        ENV_CONFIG,
        new RepoSettingsRepository(db),
    );
}

describe('ConfigService — per-repo resolution', () => {
    let svc: ConfigService;
    beforeEach(() => { svc = makeService(); });

    it('with no repoId, returns the global/env value (unchanged behavior)', () => {
        expect(svc.get<number>('review.maxFilesChanged')).toBe(50);
    });

    it('a repo without an override falls through to global', () => {
        expect(svc.get<number>('review.maxFilesChanged', REPO)).toBe(50);
    });

    it('a repo override wins over global', () => {
        svc.setForRepo(REPO, 'review.maxFilesChanged', 200);
        expect(svc.get<number>('review.maxFilesChanged', REPO)).toBe(200);
        // Global and other repos are unaffected.
        expect(svc.get<number>('review.maxFilesChanged')).toBe(50);
        expect(svc.get<number>('review.maxFilesChanged', 'repo-2')).toBe(50);
    });

    it('resetForRepo reverts to global, and later global changes track live', () => {
        svc.setForRepo(REPO, 'review.maxFilesChanged', 200);
        svc.resetForRepo(REPO, 'review.maxFilesChanged');
        expect(svc.get<number>('review.maxFilesChanged', REPO)).toBe(50);
        // Cross-scope invalidation: a global change is observed by the inheriting repo.
        svc.set('review.maxFilesChanged', 80);
        expect(svc.get<number>('review.maxFilesChanged', REPO)).toBe(80);
    });

    it('resetAllForRepo clears every override', () => {
        svc.setForRepo(REPO, 'review.maxFilesChanged', 200);
        svc.setForRepo(REPO, 'review.skipDrafts', false);
        svc.resetAllForRepo(REPO);
        expect(svc.get<number>('review.maxFilesChanged', REPO)).toBe(50);
        expect(svc.get<boolean>('review.skipDrafts', REPO)).toBe(true);
    });

    it('rejects overriding a non-overridable key', () => {
        expect(() => svc.setForRepo(REPO, 'claude.model', 'opus')).toThrow();
    });

    it('rejects an out-of-bounds value', () => {
        expect(() => svc.setForRepo(REPO, 'review.maxFilesChanged', 99999)).toThrow();
    });

    it('getAllForRepo reports override state', () => {
        svc.setForRepo(REPO, 'review.maxFilesChanged', 200);
        const items = svc.getAllForRepo(REPO);
        expect(items).toHaveLength(8);
        const mf = items.find(i => i.key === 'review.maxFilesChanged')!;
        expect(mf.global_value).toBe(50);
        expect(mf.repo_value).toBe(200);
        expect(mf.effective_value).toBe(200);
        expect(mf.is_overridden).toBe(true);
        const sd = items.find(i => i.key === 'review.skipDrafts')!;
        expect(sd.is_overridden).toBe(false);
        expect(sd.repo_value).toBeNull();
        expect(sd.effective_value).toBe(true);
    });

    it('getAllForRepo includes numeric bounds from the Zod schema', () => {
        const items = svc.getAllForRepo(REPO);
        const mf = items.find(i => i.key === 'review.maxFilesChanged')!;
        expect(mf.min).toBe(1);
        expect(mf.max).toBe(500);
        const sd = items.find(i => i.key === 'review.skipDrafts')!;
        expect(sd.min).toBeNull();
        expect(sd.max).toBeNull();
    });
});
