# Per-Repo Review Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each tracked repository override a subset of review settings while unset settings follow the global default live (inherit-with-override).

**Architecture:** Add a sparse `repo_settings` table (a row exists only for an explicit override). Extend `ConfigService.get(key, repoId?)` into a 3-tier resolver: repo override → global setting → env default. Thread the repo id into the poller and reviewer call sites that read the 8 overridable `review.*` keys. Expose per-repo CRUD via new repos sub-routes and a per-repo table UI in the Settings page.

**Tech Stack:** TypeScript, better-sqlite3, Zod, Express, Vitest (backend); React 18, React Query, Vite, Tailwind (frontend).

## Global Constraints

- Node.js >= 20; all code is TypeScript (no plain JS files).
- Use Zod for all external-data validation.
- Use Winston module-level loggers (`createModuleLogger('<tag>')`).
- SQLite access lives in repository classes, not scattered in services/routes.
- Do **not** add `Co-Authored-By` lines to commit messages.
- Do **not** modify anything under `spec/`.
- The 8 overridable keys are exactly: `review.skipDrafts`, `review.maxFilesChanged`, `review.maxDiffSize`, `review.prStateFilter`, `review.autoPostComment`, `review.autoPostSkipClean`, `review.retryEnabled`, `review.maxRetryAttempts`.
- Reset = **delete the row**; never copy the global value into a repo row.
- Global behavior of `ConfigService.get(key)` (no `repoId`) must remain byte-for-byte unchanged.

## File Structure

- `src/database/schema.ts` — add `repo_settings` table (modify).
- `src/database/repo-settings.repository.ts` — new sparse-override repository.
- `src/config/config.schema.ts` — add optional `perRepoOverridable` flag; set on the 8 keys (modify).
- `src/config/config.service.ts` — repo-aware resolver, mutations, scoped cache (modify).
- `src/index.ts` — instantiate `RepoSettingsRepository`, inject into `ConfigService` (modify).
- `src/poller/poller.service.ts` — resolve `skipDrafts`/`prStateFilter` per repo (modify).
- `src/reviewer/reviewer.service.ts` — resolve `repoId`, thread into 6 reads (modify).
- `src/api/routes/repos.routes.ts` — 4 new sub-routes (modify).
- `src/api/server.ts` — pass `configService` into `createReposRouter` (modify).
- `frontend/src/types.ts` — `RepoSettingItem` type (modify).
- `frontend/src/api/client.ts` — 4 `reposApi` methods (modify).
- `frontend/src/hooks/useRepoSettings.ts` — new React Query hooks.
- `frontend/src/pages/Settings.tsx` — `RepoReviewSettingsPanel` + wire into `ReposSection` (modify).

---

### Task 1: `repo_settings` table + `RepoSettingsRepository`

**Files:**
- Modify: `src/database/schema.ts` (after the `settings` table, ~line 90)
- Create: `src/database/repo-settings.repository.ts`
- Test: `src/database/repo-settings.repository.test.ts`

**Interfaces:**
- Produces:
  - `RepoSettingRow = { repo_id: string; key: string; value: string; updated_at: string; updated_by: string }`
  - `class RepoSettingsRepository` with:
    - `get(repoId: string, key: string): RepoSettingRow | null`
    - `upsert(repoId: string, key: string, value: string, updatedBy?: string): void`
    - `delete(repoId: string, key: string): void`
    - `deleteAllForRepo(repoId: string): void`
    - `listByRepo(repoId: string): RepoSettingRow[]`

- [ ] **Step 1: Add the table to the schema**

In `src/database/schema.ts`, insert this block immediately after the `settings` table `CREATE TABLE` (after the closing `);` of `settings`, before the final closing `` ` ``):

```sql
-- ── Per-repo setting overrides ───────────────────────────────────
CREATE TABLE IF NOT EXISTS repo_settings (
    repo_id     TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by  TEXT NOT NULL DEFAULT 'ui',
    PRIMARY KEY (repo_id, key)
);
```

Also update the header comment on line 4 from `Four tables:` to `Five tables:` and append `, repo_settings`.

- [ ] **Step 2: Write the failing test**

Create `src/database/repo-settings.repository.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/database/repo-settings.repository.test.ts`
Expected: FAIL — cannot find module `./repo-settings.repository.js`.

- [ ] **Step 4: Implement the repository**

Create `src/database/repo-settings.repository.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/database/repo-settings.repository.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/database/schema.ts src/database/repo-settings.repository.ts src/database/repo-settings.repository.test.ts
git commit -m "feat: add repo_settings table and repository"
```

---

### Task 2: `perRepoOverridable` registry flag

**Files:**
- Modify: `src/config/config.schema.ts`
- Test: `src/config/config.schema.test.ts`

**Interfaces:**
- Produces: `ConfigKeyMetadata.perRepoOverridable?: boolean` (optional; `true` only on the 8 keys).

- [ ] **Step 1: Write the failing test**

Create `src/config/config.schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CONFIG_REGISTRY } from './config.schema.js';

const OVERRIDABLE = [
    'review.skipDrafts',
    'review.maxFilesChanged',
    'review.maxDiffSize',
    'review.prStateFilter',
    'review.autoPostComment',
    'review.autoPostSkipClean',
    'review.retryEnabled',
    'review.maxRetryAttempts',
];

describe('CONFIG_REGISTRY perRepoOverridable', () => {
    it('marks exactly the 8 review keys as overridable', () => {
        const flagged = CONFIG_REGISTRY.filter(m => m.perRepoOverridable).map(m => m.key).sort();
        expect(flagged).toEqual([...OVERRIDABLE].sort());
    });

    it('does not mark claude/polling/retention keys as overridable', () => {
        for (const key of ['claude.model', 'claude.reviewTimeoutSeconds', 'polling.intervalSeconds', 'review.retentionDays']) {
            const meta = CONFIG_REGISTRY.find(m => m.key === key);
            expect(meta?.perRepoOverridable ?? false).toBe(false);
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/config.schema.test.ts`
Expected: FAIL — flagged array is empty, not the 8 keys.

- [ ] **Step 3: Add the flag to the interface**

In `src/config/config.schema.ts`, add to the `ConfigKeyMetadata` interface (after `sensitive: boolean;`):

```ts
    /** When true, each repo may override this key (repo → global → env). Default false. */
    perRepoOverridable?: boolean;
```

- [ ] **Step 4: Set the flag on the 8 keys**

In `src/config/config.schema.ts`, add `perRepoOverridable: true,` to each of these registry entries (add the line right after their `sensitive: false,` line): `review.skipDrafts`, `review.maxFilesChanged`, `review.maxDiffSize`, `review.prStateFilter`, `review.autoPostComment`, `review.autoPostSkipClean`, `review.retryEnabled`, `review.maxRetryAttempts`. Do **not** add it to any other entry.

Example (for `review.maxFilesChanged`):

```ts
    {
        key: 'review.maxFilesChanged',
        label: 'Max Files Changed',
        description: 'PRs with more changed files than this are skipped. Prevents extremely large PRs from overwhelming the reviewer.',
        category: 'review',
        type: 'number',
        default: 50,
        editable: true,
        requiresRestart: false,
        validation: z.number().min(1).max(500),
        sensitive: false,
        perRepoOverridable: true,
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/config/config.schema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/config/config.schema.ts src/config/config.schema.test.ts
git commit -m "feat: mark 8 review keys as per-repo overridable"
```

---

### Task 3: `ConfigService` repo-aware resolution + wiring

**Files:**
- Modify: `src/config/config.service.ts`
- Modify: `src/index.ts:74-79` (instantiate + inject `RepoSettingsRepository`)
- Modify: `src/config/config.service.test.ts` (update `makeService` for new constructor arg)
- Test: `src/config/config.service.repo.test.ts`

**Interfaces:**
- Consumes: `RepoSettingsRepository` (Task 1), `CONFIG_REGISTRY` + `perRepoOverridable` (Task 2).
- Produces (public `ConfigService` API):
  - `get<T>(key: string, repoId?: string): T` — 3-tier when `repoId` set and key overridable.
  - `setForRepo(repoId: string, key: string, value: unknown, updatedBy?: string): void`
  - `resetForRepo(repoId: string, key: string): void`
  - `resetAllForRepo(repoId: string): void`
  - `getAllForRepo(repoId: string): RepoSettingItem[]` where
    `RepoSettingItem = { key, label, description, category, type, enumValues?, global_value, repo_value, effective_value, is_overridden }`
  - `isRepoOverridable(key: string): boolean`
  - Constructor gains a 3rd param: `repoSettingsRepo: RepoSettingsRepository`.

- [ ] **Step 1: Write the failing test**

Create `src/config/config.service.repo.test.ts`:

```ts
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
    db.exec(getSchemaSQL());
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/config.service.repo.test.ts`
Expected: FAIL — `ConfigService` constructor takes 2 args / `setForRepo` is not a function.

- [ ] **Step 3: Rewrite `ConfigService` for scoped resolution**

Replace the contents of `src/config/config.service.ts` with:

```ts
import type { AppConfig } from './config.js';
import { CONFIG_REGISTRY } from './config.schema.js';
import type { SettingsRepository } from '../database/settings.repository.js';
import type { RepoSettingsRepository } from '../database/repo-settings.repository.js';
import { createModuleLogger } from '../shared/logger.js';

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
            throw new Error(`Invalid value for ${key}: ${result.error.message}`);
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
```

- [ ] **Step 4: Wire the new repository in bootstrap**

In `src/index.ts`, add the import near the other database imports:

```ts
import { RepoSettingsRepository } from './database/repo-settings.repository.js';
```

Then update the block at lines ~74-79:

```ts
    const reposRepo = new ReposRepository(db);
    const settingsRepo = new SettingsRepository(db);
    const repoSettingsRepo = new RepoSettingsRepository(db);
    const cleanupRepo = new CleanupRepository(db);

    // 5. Create config service (three-tier: repo override > DB global > env default)
    const configService = new ConfigService(settingsRepo, config, repoSettingsRepo);
```

- [ ] **Step 5: Update the existing ConfigService test for the new constructor**

In `src/config/config.service.test.ts`, add the import:

```ts
import { RepoSettingsRepository } from '../database/repo-settings.repository.js';
```

and update `makeService` to pass the third arg:

```ts
function makeService(): ConfigService {
    const db = new Database(':memory:');
    db.exec(getSchemaSQL());
    return new ConfigService(
        new SettingsRepository(db),
        ENV_CONFIG,
        new RepoSettingsRepository(db),
    );
}
```

- [ ] **Step 6: Run the config tests + typecheck**

Run: `npx vitest run src/config/config.service.repo.test.ts src/config/config.service.test.ts`
Expected: PASS (both files — new per-repo suite + existing claude.model suite green).

Run: `npx tsc --noEmit`
Expected: no errors (confirms `src/index.ts` wiring compiles).

- [ ] **Step 7: Commit**

```bash
git add src/config/config.service.ts src/config/config.service.repo.test.ts src/config/config.service.test.ts src/index.ts
git commit -m "feat: three-tier per-repo resolution in ConfigService"
```

---

### Task 4: Poller — resolve review filters per repo

**Files:**
- Modify: `src/poller/poller.service.ts` (poll loop ~175-188)
- Test: `src/poller/poller.service.repo-settings.test.ts`

**Interfaces:**
- Consumes: `ConfigService.get(key, repoId)` (Task 3).
- Behavior change: `skipDrafts`/`prStateFilter` are resolved **per repo** (`repo.id`) inside the loop instead of once globally.

- [ ] **Step 1: Write the failing test**

Create `src/poller/poller.service.repo-settings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/poller/poller.service.repo-settings.test.ts`
Expected: FAIL — repo A is polled with `'open'` (global) instead of `'all'`.

- [ ] **Step 3: Move the resolution inside the loop**

In `src/poller/poller.service.ts`, delete the pre-loop reads (the `const skipDrafts = ...` and `const prStateFilter = ...` block at ~175-180). Then update the `for (const repo of activeRepos)` body so the call becomes:

```ts
            for (const repo of activeRepos) {
                try {
                    const skipDrafts = this.configService.get<boolean>(
                        'review.skipDrafts',
                        repo.id,
                    );
                    const prStateFilter = this.configService.get<
                        'open' | 'closed' | 'all'
                    >('review.prStateFilter', repo.id);

                    const jobsFound = await this.pollSingleRepo(
                        repo,
                        prStateFilter,
                        skipDrafts,
                    );

                    reposPolled++;
                    newJobsEnqueued += jobsFound;

                    const providerName = repo.provider;
                    providerBreakdown[providerName] =
                        (providerBreakdown[providerName] ?? 0) + 1;

                    this.updateLastPolledAt(repo.full_name);
                } catch (err) {
```

Leave the rest of the loop body and `pollSingleRepo`'s signature unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/poller/poller.service.repo-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Guard against regressions in the wider poller/config suites**

Run: `npx vitest run src/poller src/config`
Expected: PASS (no existing poller/config test broke).

- [ ] **Step 6: Commit**

```bash
git add src/poller/poller.service.ts src/poller/poller.service.repo-settings.test.ts
git commit -m "feat: poller resolves skipDrafts/prStateFilter per repo"
```

---

### Task 5: Reviewer — thread repo id into settings reads

**Files:**
- Modify: `src/reviewer/reviewer.service.ts` (resolve `repoId` in `processReview`; thread into skip-check, `maybeAutoPostComment`, `scheduleRetryOrGiveUp`)
- Test: `src/reviewer/reviewer.service.repo-settings.test.ts`

**Interfaces:**
- Consumes: `ConfigService.get(key, repoId)` (Task 3), `ReposRepository.getByFullName` (existing).
- Internal change: `maybeAutoPostComment` and `scheduleRetryOrGiveUp` gain a `repoId: string | undefined` parameter.

- [ ] **Step 1: Write the failing test**

Create `src/reviewer/reviewer.service.repo-settings.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

const ENV_CONFIG = {
    review: { maxFilesChanged: 50, maxDiffSize: 100000 },
} as unknown as AppConfig;

function makeFiles(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        filename: `src/file-${i}.ts`, status: 'modified', additions: 1, deletions: 0,
    }));
}

describe('ReviewerService — per-repo maxFilesChanged', () => {
    let db: Database.Database;
    let tmpDir: string;

    beforeEach(() => {
        db = new Database(':memory:');
        db.exec(getSchemaSQL());
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acr-rev-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('honors a per-repo maxFilesChanged override (skips below the global limit)', async () => {
        const reposRepo = new ReposRepository(db);
        const reviewsRepo = new ReviewsRepository(db);
        const configService = new ConfigService(
            new SettingsRepository(db), ENV_CONFIG, new RepoSettingsRepository(db),
        );

        // Repo tracked with coding standards already set (so generation is skipped).
        reposRepo.insert({
            id: 'repo-a', full_name: 'acme/a', provider: 'github', org_url: null,
            token: null, default_branch: 'main', added_at: new Date().toISOString(),
            last_polled_at: null, is_active: true, coding_standards: 'x',
        });
        // Per-repo limit of 10 — below the global default of 50.
        configService.setForRepo('repo-a', 'review.maxFilesChanged', 10);

        const fakeProvider = {
            getCloneUrl: () => 'https://example.test/acme/a.git',
            getPRDiff: async () => 'diff',
            getPRFiles: async () => makeFiles(30), // 30 > per-repo 10, but < global 50
        };
        const fakeFactory = { getProvider: async () => fakeProvider };
        const fakeRepoManager = {
            prepare: async () => tmpDir,
            generateDiff: async () => 'diff',
        };

        const reviewer = new ReviewerService(
            db,
            new ReviewQueue(),
            fakeFactory as any,
            configService,
            fakeRepoManager as any,
            {} as any,               // claudeExecutor — not reached (skips first)
            reviewsRepo,
            reposRepo,
            {} as any,               // standardsGenerator — not reached
        );

        const job: ReviewJob = {
            id: 'job-1', repoFullName: 'acme/a', provider: 'github', prNumber: 7,
            prTitle: 't', prAuthor: 'a', commitSha: 'abc1234', commitMessage: 'm',
            branchName: 'feat', targetBranch: 'main', prState: 'open', prUrl: null,
            orgUrl: undefined, token: undefined,
        } as unknown as ReviewJob;

        await reviewer.processReview(job);

        const review = reviewsRepo.getByPR('acme/a', 7).find(r => r.commit_sha === 'abc1234');
        expect(review?.status).toBe('skipped');
        expect(review?.error_message ?? '').toContain('10');
    });
});
```

> If `ReviewJob`'s exact fields differ, keep the `as unknown as ReviewJob` cast and add any missing required fields the compiler flags — the test only needs `repoFullName`, `prNumber`, `commitSha`, and the fields `processReview` inserts.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/reviewer/reviewer.service.repo-settings.test.ts`
Expected: FAIL — review is not skipped (global limit 50 applied, 30 < 50), so `status` is not `'skipped'`.

- [ ] **Step 3: Resolve `repoId` in `processReview` and thread it**

In `src/reviewer/reviewer.service.ts`, inside `processReview`, right after the `logCtx` object is built (~line 121), add:

```ts
        // Resolve the repo UUID once so per-repo setting overrides apply.
        // Undefined if the repo row was deleted -> settings fall back to global.
        const repoId = this.reposRepo.getByFullName(job.repoFullName)?.id;
```

Update the skip-condition reads (~245-246) to pass `repoId`:

```ts
            const maxFilesChanged = this.configService.get<number>('review.maxFilesChanged', repoId);
            const maxDiffSize = this.configService.get<number>('review.maxDiffSize', repoId);
```

Find where `maybeAutoPostComment(...)` and `scheduleRetryOrGiveUp(...)` are **called** within `processReview` and add `repoId` as the final argument to each call.

- [ ] **Step 4: Add the `repoId` parameter to the two helpers**

Update `maybeAutoPostComment`'s signature to accept `repoId` and use it:

```ts
    private async maybeAutoPostComment(
        reviewId: string,
        provider: GitProvider,
        job: ReviewJob,
        parsed: { severity: string; findings: unknown[] },
        logCtx: Record<string, unknown>,
        repoId: string | undefined,
    ): Promise<void> {
        const enabled = this.configService.get<boolean>('review.autoPostComment', repoId);
        if (!enabled) return;

        const skipClean = this.configService.get<boolean>('review.autoPostSkipClean', repoId);
```

Update `scheduleRetryOrGiveUp`'s signature and reads:

```ts
    private scheduleRetryOrGiveUp(
        reviewId: string,
        job: ReviewJob,
        errorDetail: string,
        repoId: string | undefined,
    ): void {
        this.insertSeenCommit(job);

        try {
            const retryEnabled = this.configService.get<boolean>('review.retryEnabled', repoId);
            const maxAttempts = this.configService.get<number>('review.maxRetryAttempts', repoId);
```

> Every call site of these two helpers is inside `processReview`, where `repoId` is now in scope. Pass it as the last argument at each call.

- [ ] **Step 5: Run the test + typecheck**

Run: `npx vitest run src/reviewer/reviewer.service.repo-settings.test.ts`
Expected: PASS — review is `'skipped'` with a message containing `10`.

Run: `npx tsc --noEmit`
Expected: no errors (all helper call sites updated).

- [ ] **Step 6: Commit**

```bash
git add src/reviewer/reviewer.service.ts src/reviewer/reviewer.service.repo-settings.test.ts
git commit -m "feat: reviewer honors per-repo review settings"
```

---

### Task 6: API — per-repo settings sub-routes

**Files:**
- Modify: `src/api/routes/repos.routes.ts` (add `configService` to deps + 4 routes)
- Modify: `src/api/server.ts` (pass `configService` into `createReposRouter`)
- Test: `src/api/routes/repos.settings.routes.test.ts`

**Interfaces:**
- Consumes: `ConfigService.getAllForRepo/setForRepo/resetForRepo/resetAllForRepo/isRepoOverridable/get` (Task 3).
- Produces routes (all under `/api/v1/repos`):
  - `GET /:id/settings` → `{ data: RepoSettingItem[] }`
  - `PUT /:id/settings/:key` (body `{ value }`) → `{ data: { key, repo_value, effective_value, is_overridden: true } }`
  - `DELETE /:id/settings/:key` → `{ data: { key, is_overridden: false, effective_value } }`
  - `DELETE /:id/settings` → `{ data: { reset: true } }`
- `ReposRouterDeps` gains `configService: ConfigService`.

- [ ] **Step 1: Write the failing test**

Create `src/api/routes/repos.settings.routes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from '../../database/schema.js';
import { SettingsRepository } from '../../database/settings.repository.js';
import { RepoSettingsRepository } from '../../database/repo-settings.repository.js';
import { ConfigService } from '../../config/config.service.js';
import { createReposRouter } from './repos.routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import type { AppConfig } from '../../config/config.js';

const ENV_CONFIG = { review: { maxFilesChanged: 50 } } as unknown as AppConfig;

function makeApp() {
    const db = new Database(':memory:');
    db.exec(getSchemaSQL());
    db.prepare(
        `INSERT INTO repositories (id, full_name, provider, default_branch)
         VALUES ('repo-a', 'acme/a', 'github', 'main')`
    ).run();
    const configService = new ConfigService(
        new SettingsRepository(db), ENV_CONFIG, new RepoSettingsRepository(db),
    );
    const app = express();
    app.use(express.json());
    app.use('/api/v1/repos', createReposRouter({
        db,
        providerFactory: { getProvider: async () => ({}) } as any,
        repoManager: {} as any,
        standardsGenerator: {} as any,
        configService,
    }));
    app.use(errorHandler);
    return app;
}

describe('repos settings routes', () => {
    let app: express.Express;
    beforeEach(() => { app = makeApp(); });

    it('GET lists the 8 overridable keys, all inherited by default', async () => {
        const res = await request(app).get('/api/v1/repos/repo-a/settings');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(8);
        expect(res.body.data.every((s: any) => s.is_overridden === false)).toBe(true);
    });

    it('PUT sets an override', async () => {
        const res = await request(app)
            .put('/api/v1/repos/repo-a/settings/review.maxFilesChanged')
            .send({ value: 200 });
        expect(res.status).toBe(200);
        expect(res.body.data.effective_value).toBe(200);
        const list = await request(app).get('/api/v1/repos/repo-a/settings');
        const mf = list.body.data.find((s: any) => s.key === 'review.maxFilesChanged');
        expect(mf.is_overridden).toBe(true);
        expect(mf.repo_value).toBe(200);
    });

    it('DELETE clears one override', async () => {
        await request(app).put('/api/v1/repos/repo-a/settings/review.maxFilesChanged').send({ value: 200 });
        const res = await request(app).delete('/api/v1/repos/repo-a/settings/review.maxFilesChanged');
        expect(res.status).toBe(200);
        expect(res.body.data.is_overridden).toBe(false);
        expect(res.body.data.effective_value).toBe(50);
    });

    it('DELETE /settings clears all overrides', async () => {
        await request(app).put('/api/v1/repos/repo-a/settings/review.maxFilesChanged').send({ value: 200 });
        await request(app).put('/api/v1/repos/repo-a/settings/review.skipDrafts').send({ value: false });
        const res = await request(app).delete('/api/v1/repos/repo-a/settings');
        expect(res.status).toBe(200);
        const list = await request(app).get('/api/v1/repos/repo-a/settings');
        expect(list.body.data.every((s: any) => s.is_overridden === false)).toBe(true);
    });

    it('404 for unknown repo', async () => {
        const res = await request(app).get('/api/v1/repos/nope/settings');
        expect(res.status).toBe(404);
    });

    it('404 for a non-overridable key', async () => {
        const res = await request(app)
            .put('/api/v1/repos/repo-a/settings/claude.model')
            .send({ value: 'opus' });
        expect(res.status).toBe(404);
    });

    it('400 for an out-of-bounds value', async () => {
        const res = await request(app)
            .put('/api/v1/repos/repo-a/settings/review.maxFilesChanged')
            .send({ value: 99999 });
        expect(res.status).toBe(400);
    });
});
```

> Confirm the error-handler import path: it is whatever `src/api/server.ts` imports for global error handling (search `errorHandler` there). Adjust the import if the filename differs. If `supertest` is not installed, run `npm i -D supertest @types/supertest` first.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/routes/repos.settings.routes.test.ts`
Expected: FAIL — `configService` not in deps / routes return 404 for every path.

- [ ] **Step 3: Add `configService` to the router deps**

In `src/api/routes/repos.routes.ts`, add the import:

```ts
import type { ConfigService } from '../../config/config.service.js';
```

and add to `ReposRouterDeps`:

```ts
    configService: ConfigService;
```

Then destructure it inside `createReposRouter` (near `const db = deps.db;`):

```ts
    const configService = deps.configService;
```

- [ ] **Step 4: Add the four routes**

In `src/api/routes/repos.routes.ts`, add these routes inside `createReposRouter` (place them next to the coding-standards routes, before `return router;`). Add `import { z } from 'zod';` and `import { validate } from '../middleware/validate.js';` at the top if not already present (they are used by the existing add-repo route).

```ts
    const SetRepoSettingBodySchema = z.object({ value: z.unknown() });

    function repoExists(id: string): boolean {
        return db.prepare('SELECT 1 FROM repositories WHERE id = ?').get(id) !== undefined;
    }

    // GET /:id/settings — overridable review settings for a repo
    router.get(
        '/:id/settings',
        asyncHandler(async (req, res) => {
            const { id } = req.params;
            if (!repoExists(id)) {
                res.status(404).json({ error: { message: `Repository ${id} not found` } });
                return;
            }
            res.json({ data: configService.getAllForRepo(id) });
        })
    );

    // PUT /:id/settings/:key — set one override
    router.put(
        '/:id/settings/:key',
        validate(SetRepoSettingBodySchema),
        asyncHandler(async (req, res) => {
            const { id, key } = req.params;
            const { value } = req.body as { value: unknown };
            if (!repoExists(id)) {
                res.status(404).json({ error: { message: `Repository ${id} not found` } });
                return;
            }
            if (!configService.isRepoOverridable(key)) {
                res.status(404).json({ error: { message: `Setting ${key} is not overridable per-repo` } });
                return;
            }
            try {
                configService.setForRepo(id, key, value, 'ui');
            } catch (err) {
                res.status(400).json({ error: { message: (err as Error).message } });
                return;
            }
            logger.info('Repo setting overridden', { repoId: id, key });
            res.json({ data: { key, repo_value: value, effective_value: value, is_overridden: true } });
        })
    );

    // DELETE /:id/settings/:key — clear one override (revert to global)
    router.delete(
        '/:id/settings/:key',
        asyncHandler(async (req, res) => {
            const { id, key } = req.params;
            if (!repoExists(id)) {
                res.status(404).json({ error: { message: `Repository ${id} not found` } });
                return;
            }
            configService.resetForRepo(id, key);
            logger.info('Repo setting reset to global', { repoId: id, key });
            res.json({ data: { key, is_overridden: false, effective_value: configService.get(key) } });
        })
    );

    // DELETE /:id/settings — clear all overrides for a repo
    router.delete(
        '/:id/settings',
        asyncHandler(async (req, res) => {
            const { id } = req.params;
            if (!repoExists(id)) {
                res.status(404).json({ error: { message: `Repository ${id} not found` } });
                return;
            }
            configService.resetAllForRepo(id);
            logger.info('All repo settings reset to global', { repoId: id });
            res.json({ data: { reset: true } });
        })
    );
```

> **Route ordering:** Express matches in declaration order. Register `DELETE /:id/settings` **before** any `DELETE /:id` route so `settings` is not captured as an `:id`-scoped delete. Since these paths carry the extra `/settings` segment they won't collide with the existing `/:id` and `/:id/coding-standards` routes, but keep the `/:id/settings` group together and above the bare `/:id` delete.

- [ ] **Step 5: Pass `configService` into the router in server.ts**

In `src/api/server.ts`, update the `createReposRouter({ ... })` call (~line 115) to include `configService` (already in scope in `createServer`):

```ts
        createReposRouter({
            db,
            providerFactory: providerFactory as any,
            repoManager,
            standardsGenerator,
            configService,
        })
```

- [ ] **Step 6: Run the route tests + typecheck**

Run: `npx vitest run src/api/routes/repos.settings.routes.test.ts`
Expected: PASS (7 tests).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/api/routes/repos.routes.ts src/api/server.ts src/api/routes/repos.settings.routes.test.ts
git commit -m "feat: per-repo review settings API routes"
```

---

### Task 7: Frontend — types, API client, hooks

**Files:**
- Modify: `frontend/src/types.ts` (add `RepoSettingItem`)
- Modify: `frontend/src/api/client.ts` (4 `reposApi` methods)
- Create: `frontend/src/hooks/useRepoSettings.ts`

**Interfaces:**
- Consumes: the Task 6 routes.
- Produces:
  - `RepoSettingItem` type (mirrors the backend `RepoSettingItem`).
  - `reposApi.getSettings/setSetting/resetSetting/resetAllSettings`.
  - hooks: `useRepoSettings(id)`, `useSetRepoSetting()`, `useResetRepoSetting()`, `useResetAllRepoSettings()`.

- [ ] **Step 1: Add the `RepoSettingItem` type**

In `frontend/src/types.ts`, add:

```ts
export interface RepoSettingItem {
  key: string;
  label: string;
  description: string;
  category: string;
  type: 'number' | 'boolean' | 'string' | 'enum';
  enumValues?: string[];
  global_value: unknown;
  repo_value: unknown;
  effective_value: unknown;
  is_overridden: boolean;
}
```

- [ ] **Step 2: Add the API client methods**

In `frontend/src/api/client.ts`, add `RepoSettingItem` to the type import from `'../types'`, then add these methods inside the `reposApi` object (after `regenerateStandards`):

```ts
  getSettings: (id: string) =>
    api.get<ApiResponse<RepoSettingItem[]>>(`/repos/${id}/settings`),
  setSetting: (id: string, key: string, value: unknown) =>
    api.put<ApiResponse<{ key: string; repo_value: unknown; effective_value: unknown; is_overridden: boolean }>>(
      `/repos/${id}/settings/${encodeURIComponent(key)}`, { value },
    ),
  resetSetting: (id: string, key: string) =>
    api.delete<ApiResponse<{ key: string; is_overridden: boolean; effective_value: unknown }>>(
      `/repos/${id}/settings/${encodeURIComponent(key)}`,
    ),
  resetAllSettings: (id: string) =>
    api.delete<ApiResponse<{ reset: boolean }>>(`/repos/${id}/settings`),
```

- [ ] **Step 3: Create the hooks**

Create `frontend/src/hooks/useRepoSettings.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reposApi } from '../api/client';

export function useRepoSettings(id: string) {
  return useQuery({
    queryKey: ['repos', id, 'settings'],
    queryFn: async () => {
      const res = await reposApi.getSettings(id);
      return res.data.data;
    },
    enabled: !!id,
  });
}

export function useSetRepoSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key, value }: { id: string; key: string; value: unknown }) =>
      reposApi.setSetting(id, key, value),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repos', variables.id, 'settings'] });
    },
  });
}

export function useResetRepoSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) => reposApi.resetSetting(id, key),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repos', variables.id, 'settings'] });
    },
  });
}

export function useResetAllRepoSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reposApi.resetAllSettings(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['repos', id, 'settings'] });
    },
  });
}
```

- [ ] **Step 4: Typecheck the frontend**

Run: `npm --prefix frontend run build`
Expected: build succeeds (TypeScript compiles; no unused/missing symbols).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/hooks/useRepoSettings.ts
git commit -m "feat: frontend api client and hooks for per-repo settings"
```

---

### Task 8: Frontend — `RepoReviewSettingsPanel` + wire into `ReposSection`

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `useRepoSettings`, `useSetRepoSetting`, `useResetRepoSetting`, `useResetAllRepoSettings` (Task 7); the existing `CodingStandardsPanel` pattern in `ReposSection`.

- [ ] **Step 1: Import the hooks**

In `frontend/src/pages/Settings.tsx`, add near the existing `useRepos` import:

```ts
import { useRepoSettings, useSetRepoSetting, useResetRepoSetting, useResetAllRepoSettings } from '../hooks/useRepoSettings';
import type { RepoSettingItem } from '../types';
```

- [ ] **Step 2: Add the `RepoReviewSettingsPanel` component**

In `frontend/src/pages/Settings.tsx`, add this component just above `// --- Tracked Repositories Section ---`:

```tsx
const CORE_FILTER_KEYS = [
  'review.skipDrafts',
  'review.maxFilesChanged',
  'review.maxDiffSize',
  'review.prStateFilter',
];

function RepoReviewSettingsPanel({ repoId, onClose }: { repoId: string; onClose: () => void }) {
  const { data: settings, isLoading } = useRepoSettings(repoId);
  const setSetting = useSetRepoSetting();
  const resetSetting = useResetRepoSetting();
  const resetAll = useResetAllRepoSettings();

  if (isLoading || !settings) {
    return <div className="p-4 text-sm text-gray-500">Loading review settings…</div>;
  }

  const core = settings.filter((s) => CORE_FILTER_KEYS.includes(s.key));
  const autopost = settings.filter((s) => !CORE_FILTER_KEYS.includes(s.key));

  const renderControl = (s: RepoSettingItem) => {
    if (!s.is_overridden) {
      return (
        <button
          className="text-xs text-blue-600 hover:underline"
          onClick={() => setSetting.mutate({ id: repoId, key: s.key, value: s.global_value })}
        >
          Override
        </button>
      );
    }
    const commit = (value: unknown) => setSetting.mutate({ id: repoId, key: s.key, value });
    if (s.type === 'boolean') {
      return (
        <button
          className={`w-8 h-[18px] rounded-full relative ${s.repo_value ? 'bg-blue-600' : 'bg-gray-400'}`}
          onClick={() => commit(!s.repo_value)}
          aria-label={`Toggle ${s.label}`}
        >
          <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${s.repo_value ? 'left-4' : 'left-0.5'}`} />
        </button>
      );
    }
    if (s.type === 'enum') {
      return (
        <select
          className="border border-blue-500 rounded px-2 py-1 text-xs"
          value={String(s.repo_value)}
          onChange={(e) => commit(e.target.value)}
        >
          {(s.enumValues ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      );
    }
    return (
      <input
        type="number"
        className="border border-blue-500 rounded px-2 py-1 text-xs w-24"
        defaultValue={Number(s.repo_value)}
        onBlur={(e) => commit(Number(e.target.value))}
      />
    );
  };

  const row = (s: RepoSettingItem) => (
    <tr key={s.key} className={s.is_overridden ? 'bg-amber-50' : ''}>
      <td className="py-2 pr-3">
        <div className="text-sm text-gray-900">{s.label}</div>
        <div className="text-xs text-gray-500">{s.description}</div>
      </td>
      <td className="py-2 pr-3 text-xs text-gray-400">{String(s.global_value)}</td>
      <td className="py-2 pr-3">{renderControl(s)}</td>
      <td className="py-2 pr-3">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.is_overridden ? 'text-amber-700 bg-amber-100' : 'text-gray-500 border border-gray-200'}`}>
          {s.is_overridden ? 'OVERRIDDEN' : 'INHERITED'}
        </span>
      </td>
      <td className="py-2 text-right">
        {s.is_overridden && (
          <button className="text-xs text-blue-600 hover:underline" onClick={() => resetSetting.mutate({ id: repoId, key: s.key })}>
            Reset
          </button>
        )}
      </td>
    </tr>
  );

  return (
    <div className="p-4 bg-gray-50 border-t border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">Inherited fields follow the global default and track it live.</p>
        <div className="flex gap-2">
          <button className="text-xs text-gray-600 border border-gray-200 rounded px-2 py-1" onClick={() => resetAll.mutate(repoId)}>
            Reset all to global
          </button>
          <button className="text-xs text-gray-600 border border-gray-200 rounded px-2 py-1" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-gray-400">
            <th className="py-1 pr-3 font-semibold">Setting</th>
            <th className="py-1 pr-3 font-semibold">Global</th>
            <th className="py-1 pr-3 font-semibold">This repo</th>
            <th className="py-1 pr-3 font-semibold">Source</th>
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          <tr><td colSpan={5} className="pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Core review filters</td></tr>
          {core.map(row)}
          <tr><td colSpan={5} className="pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Auto-post &amp; retry</td></tr>
          {autopost.map(row)}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Add panel toggle state in `ReposSection`**

In `frontend/src/pages/Settings.tsx`, inside `ReposSection` (near the other `useState` hooks around line 463), add:

```tsx
  const [settingsRepoId, setSettingsRepoId] = useState<string | null>(null);
```

- [ ] **Step 4: Add a "Review Settings" button + conditional panel per repo**

In `ReposSection`, locate where each repo row renders its actions and its `CodingStandardsPanel` (search for `CodingStandardsPanel` in the file). Alongside the existing coding-standards toggle button, add a button:

```tsx
                <button
                  className="text-xs text-gray-600 hover:text-gray-900"
                  onClick={() => setSettingsRepoId(settingsRepoId === repo.id ? null : repo.id)}
                >
                  Review Settings
                </button>
```

and, next to where `CodingStandardsPanel` is conditionally rendered for the repo, add:

```tsx
              {settingsRepoId === repo.id && (
                <RepoReviewSettingsPanel repoId={repo.id} onClose={() => setSettingsRepoId(null)} />
              )}
```

> Match the exact JSX nesting used by the existing coding-standards panel so the new panel renders in the same container (inside the repo's row block). If the coding-standards panel uses a single-open-at-a-time state variable, mirror that pattern with `settingsRepoId`.

- [ ] **Step 5: Build the frontend**

Run: `npm --prefix frontend run build`
Expected: build succeeds.

- [ ] **Step 6: Manual smoke test**

Run the app (`npm run dev`), open **Settings → Tracked Repositories**, click **Review Settings** on a repo. Verify:
- All 8 settings render, grouped Core / Auto-post & retry, all `INHERITED`.
- Click **Override** on Max Files Changed, set a value → row turns amber, badge `OVERRIDDEN`.
- Reload the page → the override persists.
- Click **Reset** → row returns to `INHERITED` showing the global value.
- Change the global Max Files Changed in the Configuration section → an inherited repo's Global column reflects it.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Settings.tsx
git commit -m "feat: per-repo review settings panel in Settings page"
```

---

## Final Verification

- [ ] Run the full backend suite: `npx vitest run`
- [ ] Typecheck: `npx tsc --noEmit`
- [ ] Frontend build: `npm --prefix frontend run build`
- [ ] Manual smoke test from Task 8 Step 6 passes.

## Self-Review Notes (author)

- **Spec coverage:** every spec section maps to a task — data model (T1), registry flag (T2), 3-tier resolution + cache invalidation (T3), poller threading + flagged behavior change (T4), reviewer threading + graceful deleted-repo fallback (T5), 4 API endpoints (T6), UI Option B table with per-type controls + Reset all (T7–T8), tests in every task.
- **Reset = delete:** enforced in `resetForRepo`/`resetAllForRepo` (T3) and the DELETE routes (T6); the UI "Reset" calls DELETE, never a PUT of the global value (T8).
- **Global unchanged:** `get(key)` with no `repoId` keeps its exact tier-2/tier-3 path; existing `config.service.test.ts` is updated only for the new constructor arg and must stay green (T3 Step 6).
