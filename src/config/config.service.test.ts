import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from '../database/schema.js';
import { SettingsRepository } from '../database/settings.repository.js';
import { ConfigService } from './config.service.js';
import type { AppConfig } from './config.js';

// ConfigService only reads envConfig via resolveEnvKey (path navigation),
// so a minimal object covering the keys under test is sufficient.
const ENV_CONFIG = { claude: { model: undefined } } as unknown as AppConfig;

function makeService(): ConfigService {
    const db = new Database(':memory:');
    db.exec(getSchemaSQL());
    return new ConfigService(new SettingsRepository(db), ENV_CONFIG);
}

describe('ConfigService — claude.model selection', () => {
    let service: ConfigService;

    beforeEach(() => {
        service = makeService();
    });

    it('exposes claude.model as an editable, runtime-applied enum', () => {
        const meta = service.getAll().find(s => s.key === 'claude.model');
        expect(meta).toBeDefined();
        expect(meta!.type).toBe('enum');
        expect(meta!.enumValues).toEqual(['default', 'opus', 'sonnet', 'haiku']);
        expect(meta!.editable).toBe(true);
        expect(meta!.requires_restart).toBe(false);
        // With no env override and no DB row, the dropdown shows 'default'.
        expect(meta!.current_value).toBe('default');
    });

    it('accepts a valid model alias and notifies listeners (executor wiring)', () => {
        const seen: unknown[] = [];
        service.onChange('claude.model', v => seen.push(v));

        service.set('claude.model', 'opus');

        expect(service.get('claude.model')).toBe('opus');
        expect(seen).toEqual(['opus']);
    });

    it('rejects a model outside the allowed aliases', () => {
        expect(() => service.set('claude.model', 'gpt-4')).toThrow();
    });

    it('reset restores the env default and notifies listeners', () => {
        service.set('claude.model', 'sonnet');

        const seen: unknown[] = [];
        service.onChange('claude.model', v => seen.push(v));

        const { previousValue, restoredValue } = service.reset('claude.model');
        expect(previousValue).toBe('sonnet');
        expect(restoredValue).toBeUndefined(); // env has no model -> CLI default
        expect(seen).toEqual([undefined]);
    });
});
