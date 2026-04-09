import type { AppConfig } from './config.js';
import { CONFIG_REGISTRY } from './config.schema.js';
import type { SettingsRepository } from '../database/settings.repository.js';
import { createModuleLogger } from '../shared/logger.js';

const logger = createModuleLogger('config-service');

export class ConfigService {
    private cache: Map<string, unknown> = new Map();
    private listeners: Map<string, Array<(value: unknown) => void>> = new Map();

    constructor(
        private settingsRepo: SettingsRepository,
        private envConfig: AppConfig
    ) {}

    get<T>(key: string): T {
        if (this.cache.has(key)) {
            return this.cache.get(key) as T;
        }

        const dbValue = this.settingsRepo.get(key);
        if (dbValue !== null) {
            const parsed = JSON.parse(dbValue.value);
            this.cache.set(key, parsed);
            return parsed as T;
        }

        const envValue = this.resolveEnvKey(key);
        this.cache.set(key, envValue);
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
        this.cache.delete(key);
        this.notifyListeners(key, value);
    }

    reset(key: string): { previousValue: unknown; restoredValue: unknown } {
        const previousValue = this.get(key);
        this.settingsRepo.delete(key);
        this.cache.delete(key);
        const restoredValue = this.resolveEnvKey(key);
        this.notifyListeners(key, restoredValue);
        return { previousValue, restoredValue };
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
        is_overridden: boolean;
        editable: boolean;
        requires_restart: boolean;
        sensitive: boolean;
    }> {
        return CONFIG_REGISTRY.map(meta => {
            const dbValue = this.settingsRepo.get(meta.key);
            const envValue = this.resolveEnvKey(meta.key);
            let currentValue: unknown;

            if (dbValue !== null) {
                currentValue = JSON.parse(dbValue.value);
            } else {
                currentValue = envValue;
            }

            if (meta.sensitive && typeof currentValue === 'string' && currentValue.length > 8) {
                currentValue = currentValue.substring(0, 4) + '****' + currentValue.slice(-4);
            }

            const defaultDisplay = meta.sensitive && typeof envValue === 'string' && envValue.length > 8
                ? envValue.substring(0, 4) + '****' + envValue.slice(-4)
                : envValue;

            return {
                key: meta.key,
                label: meta.label,
                description: meta.description,
                category: meta.category,
                type: meta.type,
                enumValues: meta.enumValues,
                current_value: currentValue ?? meta.default,
                default_value: defaultDisplay ?? meta.default,
                is_overridden: dbValue !== null,
                editable: meta.editable,
                requires_restart: meta.requiresRestart,
                sensitive: meta.sensitive,
            };
        });
    }

    onChange(key: string, callback: (value: unknown) => void): void {
        const list = this.listeners.get(key) || [];
        list.push(callback);
        this.listeners.set(key, list);
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
