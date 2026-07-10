import type Database from 'better-sqlite3';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('repo-settings-repo');

export interface RepoSettingRow {
    repo_id: string;
    key: string;
    value: string;
    updated_at: string;
    updated_by: string;
}

/**
 * Sparse per-repo setting overrides. A row exists ONLY for a key a repo
 * explicitly overrides; absence means "follow the global value".
 */
export class RepoSettingsRepository {
    constructor(private db: Database.Database) {}

    get(repoId: string, key: string): RepoSettingRow | null {
        const row = this.db
            .prepare('SELECT * FROM repo_settings WHERE repo_id = ? AND key = ?')
            .get(repoId, key) as RepoSettingRow | undefined;
        return row ?? null;
    }

    upsert(repoId: string, key: string, value: string, updatedBy = 'ui'): void {
        this.db
            .prepare(`
                INSERT OR REPLACE INTO repo_settings (repo_id, key, value, updated_at, updated_by)
                VALUES (@repo_id, @key, @value, datetime('now'), @updated_by)
            `)
            .run({ repo_id: repoId, key, value, updated_by: updatedBy });
        log.debug('Repo setting upserted', { repoId, key, updatedBy });
    }

    delete(repoId: string, key: string): void {
        this.db
            .prepare('DELETE FROM repo_settings WHERE repo_id = ? AND key = ?')
            .run(repoId, key);
        log.debug('Repo setting deleted', { repoId, key });
    }

    deleteAllForRepo(repoId: string): void {
        this.db.prepare('DELETE FROM repo_settings WHERE repo_id = ?').run(repoId);
        log.debug('All repo settings deleted', { repoId });
    }

    listByRepo(repoId: string): RepoSettingRow[] {
        return this.db
            .prepare('SELECT * FROM repo_settings WHERE repo_id = ? ORDER BY key ASC')
            .all(repoId) as RepoSettingRow[];
    }
}
