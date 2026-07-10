import type { AppConfig } from './config.js';
import { CONFIG_REGISTRY } from './config.schema.js';
import type { SettingsRepository } from '../database/settings.repository.js';
import type { RepoSettingsRepository } from '../database/repo-settings.repository.js';
import { createModuleLogger } from '../shared/logger.js';
import { NotFoundError, ValidationError } from '../shared/errors.js';

const logger = createModuleLogger('config-service');

const GLOBAL_SCOPE = '~global';

export interface RepoSettingItem {
    key: string;
    label: string;
    description: string;
    category: string;
    type: string;
    enumValues?: string[];
    global_value: unknown;
    repo_value: unknown;
    effective_value: unknown;
    is_overridden: boolean;
    min: number | null;
    max: number | null;
}

export class ConfigService {
    private cache: Map<string, unknown> = new Map();
    private listeners: Map<string, Array<(value: unknown) => void>> = new Map();

    constructor(
        private settingsRepo: SettingsRepository,
        private envConfig: AppConfig,
        private repoSettingsRepo: RepoSettingsRepository,
    ) {}

    private scopeKey(key: string, repoId?: string): string {
        return `${repoId ?? GLOBAL_SCOPE}:${key}`;
    }

    isRepoOverridable(key: string): boolean {
        return CONFIG_REGISTRY.some(m => m.key === key && m.perRepoOverridable === true);
    }

    isSensitive(key: string): boolean {
        return CONFIG_REGISTRY.some(m => m.key === key && m.sensitive === true);
    }

    get<T>(key: string, repoId?: string): T {
        const ck = this.scopeKey(key, repoId);
        if (this.cache.has(ck)) {
            return this.cache.get(ck) as T;
        }

        // Tier 1: repo override (only when scoped to a repo AND key is overridable)
        if (repoId !== undefined && this.isRepoOverridable(key)) {
            const repoRow = this.repoSettingsRepo.get(repoId, key);
            if (repoRow !== null) {
                const parsed = JSON.parse(repoRow.value);
                this.cache.set(ck, parsed);
                return parsed as T;
            }
        }

        // Tier 2: global override
        const dbValue = this.settingsRepo.get(key);
        if (dbValue !== null) {
            const parsed = JSON.parse(dbValue.value);
            this.cache.set(ck, parsed);
            return parsed as T;
        }

        // Tier 3: env default
        const envValue = this.resolveEnvKey(key);
        this.cache.set(ck, envValue);
        return envValue as T;
    }

    set(key: string, value: unknown, updatedBy: string = 'ui'): void {
        const meta = CONFIG_REGISTRY.find(m => m.key === key);
        if (!meta) throw new Error(`Unknown config key: ${key}`);
        if (!meta.editable) throw new Error(`Config key ${key} is not editable at runtime`);

        const result = meta.validation.safeParse(value);
        if (!result.success) {
            throw new Error(`Invalid value for ${key}: ${result.error.message}`);
        }

        this.settingsRepo.upsert(key, JSON.stringify(value), updatedBy);
        // A global change affects every scope that inherits this key.
        this.invalidateKeyAllScopes(key);
        this.notifyListeners(key, value);
    }

    reset(key: string): { previousValue: unknown; restoredValue: unknown } {
        const meta = CONFIG_REGISTRY.find(m => m.key === key);
        if (!meta) throw new NotFoundError('Setting', key);
        if (!meta.editable) {
            throw new ValidationError(`Config key ${key} is not editable at runtime`);
        }
        // A secret must never round-trip through an API response, and reset
        // returns the value it restored. Refuse rather than redact.
        if (meta.sensitive) {
            throw new ValidationError(`Config key ${key} is a secret and cannot be reset via the API`);
        }

        const previousValue = this.get(key);
        this.settingsRepo.delete(key);
        this.invalidateKeyAllScopes(key);
        const restoredValue = this.resolveEnvKey(key);
        this.notifyListeners(key, restoredValue);
        return { previousValue, restoredValue };
    }

    setForRepo(repoId: string, key: string, value: unknown, updatedBy: string = 'ui'): void {
        const meta = CONFIG_REGISTRY.find(m => m.key === key);
        if (!meta) throw new Error(`Unknown config key: ${key}`);
        if (meta.perRepoOverridable !== true) {
            throw new Error(`Config key ${key} is not overridable per-repo`);
        }
        const result = meta.validation.safeParse(value);
        if (!result.success) {
            throw new ValidationError(`Invalid value for ${key}: ${result.error.message}`);
        }
        this.repoSettingsRepo.upsert(repoId, key, JSON.stringify(value), updatedBy);
        this.cache.delete(this.scopeKey(key, repoId));
    }

    resetForRepo(repoId: string, key: string): void {
        this.repoSettingsRepo.delete(repoId, key);
        this.cache.delete(this.scopeKey(key, repoId));
    }

    resetAllForRepo(repoId: string): void {
        this.repoSettingsRepo.deleteAllForRepo(repoId);
        const prefix = `${repoId}:`;
        for (const ck of Array.from(this.cache.keys())) {
            if (ck.startsWith(prefix)) this.cache.delete(ck);
        }
    }

    getAllForRepo(repoId: string): RepoSettingItem[] {
        return CONFIG_REGISTRY
            .filter(m => m.perRepoOverridable === true)
            .map(meta => {
                const globalValue = this.get(meta.key) ?? meta.default;
                const repoRow = this.repoSettingsRepo.get(repoId, meta.key);
                const isOverridden = repoRow !== null;
                const repoValue = isOverridden ? JSON.parse(repoRow.value) : null;
                const numeric = meta.type === 'number'
                    ? (meta.validation as { minValue?: number | null; maxValue?: number | null })
                    : undefined;
                return {
                    key: meta.key,
                    label: meta.label,
                    description: meta.description,
                    category: meta.category,
                    type: meta.type,
                    enumValues: meta.enumValues,
                    global_value: globalValue,
                    repo_value: repoValue,
                    effective_value: isOverridden ? repoValue : globalValue,
                    is_overridden: isOverridden,
                    min: numeric && typeof numeric.minValue === 'number' ? numeric.minValue : null,
                    max: numeric && typeof numeric.maxValue === 'number' ? numeric.maxValue : null,
                };
            });
    }

    getAll(): Array<{
        key: string;
        label: string;
        description: string;
        category: string;
        type: string;
        enumValues?: string[];
        current_value: unknown;
        default_value: unknown;
        is_set: boolean;
        is_overridden: boolean;
        editable: boolean;
        requires_restart: boolean;
        sensitive: boolean;
    }> {
        return CONFIG_REGISTRY.map(meta => {
            const dbValue = this.settingsRepo.get(meta.key);
            const envValue = this.resolveEnvKey(meta.key);
            const rawCurrent = dbValue !== null ? JSON.parse(dbValue.value) : envValue;

            const common = {
                key: meta.key,
                label: meta.label,
                description: meta.description,
                category: meta.category,
                type: meta.type,
                enumValues: meta.enumValues,
                is_overridden: dbValue !== null,
                editable: meta.editable,
                requires_restart: meta.requiresRestart,
                sensitive: meta.sensitive,
            };

            // Secrets are never returned over the API — not even masked. The
            // API is unauthenticated; the UI only needs to know whether a
            // credential is configured, never what it is.
            if (meta.sensitive) {
                return {
                    ...common,
                    current_value: null,
                    default_value: null,
                    is_set: typeof rawCurrent === 'string' && rawCurrent.length > 0,
                };
            }

            const currentValue = rawCurrent ?? meta.default;
            return {
                ...common,
                current_value: currentValue,
                default_value: envValue ?? meta.default,
                is_set: currentValue !== undefined && currentValue !== null,
            };
        });
    }

    onChange(key: string, callback: (value: unknown) => void): void {
        const list = this.listeners.get(key) || [];
        list.push(callback);
        this.listeners.set(key, list);
    }

    private invalidateKeyAllScopes(key: string): void {
        const suffix = `:${key}`;
        for (const ck of Array.from(this.cache.keys())) {
            if (ck.endsWith(suffix)) this.cache.delete(ck);
        }
    }

    private notifyListeners(key: string, value: unknown): void {
        const list = this.listeners.get(key) || [];
        for (const cb of list) {
            try {
                cb(value);
            } catch (err) {
                logger.error(`Config change listener error for ${key}`, { error: err });
            }
        }
    }

    private resolveEnvKey(key: string): unknown {
        const parts = key.split('.');
        let current: unknown = this.envConfig;
        for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
                current = (current as Record<string, unknown>)[part];
            } else {
                return undefined;
            }
        }
        return current;
    }
}
