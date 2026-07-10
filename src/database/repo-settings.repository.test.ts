import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from './schema.js';
import { RepoSettingsRepository } from './repo-settings.repository.js';

function makeDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON'); // required for ON DELETE CASCADE
    db.exec(getSchemaSQL());
    // Seed a repository row so FK + cascade can be exercised.
    db.prepare(
        `INSERT INTO repositories (id, full_name, provider, default_branch)
         VALUES (?, ?, 'github', 'main')`
    ).run('repo-1', 'acme/api');
    db.prepare(
        `INSERT INTO repositories (id, full_name, provider, default_branch)
         VALUES (?, ?, 'github', 'main')`
    ).run('repo-2', 'acme/web');
    return db;
}

describe('RepoSettingsRepository', () => {
    let db: Database.Database;
    let repo: RepoSettingsRepository;

    beforeEach(() => {
        db = makeDb();
        repo = new RepoSettingsRepository(db);
    });

    it('returns null when no override exists', () => {
        expect(repo.get('repo-1', 'review.maxFilesChanged')).toBeNull();
    });

    it('upserts then reads back a value', () => {
        repo.upsert('repo-1', 'review.maxFilesChanged', '200', 'ui');
        const row = repo.get('repo-1', 'review.maxFilesChanged');
        expect(row?.value).toBe('200');
        expect(row?.updated_by).toBe('ui');
    });

    it('upsert replaces an existing value', () => {
        repo.upsert('repo-1', 'review.maxFilesChanged', '200');
        repo.upsert('repo-1', 'review.maxFilesChanged', '300');
        expect(repo.get('repo-1', 'review.maxFilesChanged')?.value).toBe('300');
    });

    it('isolates overrides per repo', () => {
        repo.upsert('repo-1', 'review.skipDrafts', 'false');
        expect(repo.get('repo-2', 'review.skipDrafts')).toBeNull();
    });

    it('delete removes a single override', () => {
        repo.upsert('repo-1', 'review.skipDrafts', 'false');
        repo.delete('repo-1', 'review.skipDrafts');
        expect(repo.get('repo-1', 'review.skipDrafts')).toBeNull();
    });

    it('deleteAllForRepo clears every override for the repo only', () => {
        repo.upsert('repo-1', 'review.skipDrafts', 'false');
        repo.upsert('repo-1', 'review.maxFilesChanged', '200');
        repo.upsert('repo-2', 'review.skipDrafts', 'true');
        repo.deleteAllForRepo('repo-1');
        expect(repo.listByRepo('repo-1')).toHaveLength(0);
        expect(repo.listByRepo('repo-2')).toHaveLength(1);
    });

    it('cascades on repository delete', () => {
        repo.upsert('repo-1', 'review.skipDrafts', 'false');
        db.prepare('DELETE FROM repositories WHERE id = ?').run('repo-1');
        expect(repo.get('repo-1', 'review.skipDrafts')).toBeNull();
    });
});
