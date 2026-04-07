import type Database from 'better-sqlite3';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('settings-repo');

// ── Types ───────────────────────────────────────────────────────

export interface SettingRow {
    key: string;
    value: string;
    updated_at: string;
    updated_by: string;
}

// ── Repository class ────────────────────────────────────────────

export class SettingsRepository {
    constructor(private db: Database.Database) {}

    /**
     * Get a single setting by key.
     * Returns null if the key does not exist.
     */
    get(key: string): SettingRow | null {
        const row = this.db
            .prepare('SELECT * FROM settings WHERE key = ?')
            .get(key) as SettingRow | undefined;
        return row ?? null;
    }

    /**
     * Insert or replace a setting.
     * Uses INSERT OR REPLACE so the row is created if absent,
     * or fully replaced (including updated_at) if it already exists.
     */
    upsert(key: string, value: string, updatedBy: string = 'system'): void {
        this.db
            .prepare(`
                INSERT OR REPLACE INTO settings (key, value, updated_at, updated_by)
                VALUES (@key, @value, datetime('now'), @updated_by)
            `)
            .run({ key, value, updated_by: updatedBy });

        log.debug('Setting upserted', { key, updated_by: updatedBy });
    }

    /**
     * Delete a setting by key (revert to env default).
     */
    delete(key: string): void {
        this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
        log.debug('Setting deleted', { key });
    }

    /**
     * List all settings rows.
     */
    listAll(): SettingRow[] {
        return this.db
            .prepare('SELECT * FROM settings ORDER BY key ASC')
            .all() as SettingRow[];
    }
}
