import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from '../database/schema.js';
import { SettingsRepository } from '../database/settings.repository.js';
import { RepoSettingsRepository } from '../database/repo-settings.repository.js';
import { ConfigService } from './config.service.js';
import type { AppConfig } from './config.js';

const SECRET = 'ghp_supersecrettokenvalue';

const ENV_CONFIG = {
    github: { token: SECRET },
    azureDevOps: { token: undefined },
    claude: { model: undefined },
} as unknown as AppConfig;

function makeService(): ConfigService {
    const db = new Database(':memory:');
    db.exec(getSchemaSQL());
    return new ConfigService(
        new SettingsRepository(db),
        ENV_CONFIG,
        new RepoSettingsRepository(db),
    );
}

describe('ConfigService — sensitive values are never returned', () => {
    let service: ConfigService;

    beforeEach(() => {
        service = makeService();
    });

    it('nulls out the value of a sensitive key and reports is_set instead', () => {
        const meta = service.getAll().find(s => s.key === 'github.token');
        expect(meta).toBeDefined();
        expect(meta!.sensitive).toBe(true);
        expect(meta!.current_value).toBeNull();
        expect(meta!.default_value).toBeNull();
        expect(meta!.is_set).toBe(true);
    });

    it('reports is_set false when no token is configured anywhere', () => {
        const meta = service.getAll().find(s => s.key === 'azureDevOps.token');
        expect(meta!.is_set).toBe(false);
        expect(meta!.current_value).toBeNull();
    });

    it('never leaks the secret anywhere in the serialized payload', () => {
        expect(JSON.stringify(service.getAll())).not.toContain(SECRET);
        // Not even a mask fragment: the first four chars must not appear.
        expect(JSON.stringify(service.getAll())).not.toContain('ghp_');
    });

    it('still returns real values for non-sensitive keys', () => {
        const meta = service.getAll().find(s => s.key === 'polling.intervalSeconds');
        expect(meta!.current_value).toBe(3600);
        expect(meta!.is_set).toBe(true);
    });

    it('rejects writes to a token — it is not editable at runtime', () => {
        expect(() => service.set('github.token', 'ghp_attacker')).toThrow(
            /not editable at runtime/,
        );
        expect(() => service.set('azureDevOps.token', 'pat_attacker')).toThrow(
            /not editable at runtime/,
        );
    });

    it('marks both tokens as non-editable, restart-required', () => {
        const all = service.getAll();
        for (const key of ['github.token', 'azureDevOps.token']) {
            const meta = all.find(s => s.key === key);
            expect(meta, key).toBeDefined();
            expect(meta!.editable, key).toBe(false);
            expect(meta!.requires_restart, key).toBe(true);
            expect(meta!.sensitive, key).toBe(true);
        }
    });
});
