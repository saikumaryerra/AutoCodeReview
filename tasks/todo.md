# Config/Settings Real-Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four confirmed bugs in the config/settings subsystem where the code silently does nothing or leaks a secret.

**Architecture:** Three of the four bugs share one root cause — values read from the env-derived `AppConfig` at construction time, where a `configService.get()` plus an `onChange()` listener belongs (the pattern `claude.model` and `polling.intervalSeconds` already use). We fix `claude.reviewTimeoutSeconds` by adopting that pattern, and we fix the tokens by going the *other* direction: they become non-editable and are never returned over the API, because a PAT has no business on an unauthenticated read path. The fourth bug (shutdown) is independent.

**Tech Stack:** TypeScript, Node >= 20, Express, better-sqlite3, Zod, Vitest, React 18 + Vite.

## Global Constraints

- All code is TypeScript. No plain JavaScript files.
- **Do NOT add `Co-Authored-By` lines to git commit messages** (per `CLAUDE.md`; this overrides any default harness behavior).
- Use Zod for validation, Winston (`createModuleLogger`) for logging with module-level tags.
- Do not modify anything in `spec/`. If implementation reveals a needed spec change, log it in `spec_change_log.md` at the project root.
- Verification commands, run from the repo root:
  - Backend types: `npx tsc --noEmit`
  - Frontend types: `cd frontend && npx tsc --noEmit`
  - Tests: `npx vitest run`

## Pre-flight

The working tree has **unrelated uncommitted changes** in `src/reviewer/repo-manager.ts` and `src/utils/git.ts`. Do not fold them into these commits. Either commit them separately first or `git stash` them before starting.

## Scope

**In scope** — the four confirmed bugs:
1. `github.token` / `azureDevOps.token` are UI-editable but never read back (and are returned, masked, over an unauthenticated API).
2. `claude.reviewTimeoutSeconds` overrides never apply — neither live nor after restart.
3. The masked sensitive value seeds the Settings input and can be persisted as a credential.
4. `ReviewerService.startProcessing()` is an unstoppable `while (true)`; `shutdown()` calls `db.close()` under it.

**Explicitly out of scope** (identified but not fixed here): `POST /api/settings/:key/reset` accepting unknown keys, `ConfigService.set()` throwing bare `Error` instead of `ValidationError`, the cleanup cron's comment/schedule/log disagreement, `requires_restart` never rendering in the UI, `CLAUDE_STANDARDS_TIMEOUT_SECONDS` being undocumented, and `retentionDays`' `??`-vs-`||` coercion.

---

### Task 0: Branch

- [ ] **Step 1: Create the working branch**

```bash
git checkout -b fix/config-settings-real-bugs
git status --short   # expect: clean, or only the two unrelated files you stashed
```

---

### Task 1: ConfigService stops returning secrets

Fixes the read half of bug #1 and structurally kills bug #3 at the source: if the API never emits the token, no UI field can ever seed from it.

**Files:**
- Modify: `src/config/config.service.ts:155-203` (the `getAll()` method and its return type)
- Test: `src/config/config.service.sensitive.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ConfigService.getAll()` gains `is_set: boolean` in each element, and for any entry with `sensitive: true` both `current_value` and `default_value` are `null`. Task 3 (frontend) depends on exactly these names.

- [ ] **Step 1: Write the failing test**

Create `src/config/config.service.sensitive.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/config/config.service.sensitive.test.ts`
Expected: FAIL. `current_value` is the mask `ghp_****alue`, not `null`; `is_set` is `undefined`; the `'ghp_'` assertion fails.

- [ ] **Step 3: Rewrite `getAll()`**

In `src/config/config.service.ts`, replace the whole `getAll()` method (currently lines 155-203) with:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/config/config.service.sensitive.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass. If `src/config/config.schema.test.ts` or `src/config/config.service.test.ts` assert on a masked `current_value` for a token, update those assertions to the new `null` + `is_set` contract — do not restore masking.

- [ ] **Step 6: Commit**

```bash
git add src/config/config.service.ts src/config/config.service.sensitive.test.ts
git commit -m "fix(config): never return secret values from getAll(), add is_set"
```

---

### Task 2: Tokens become non-editable, and stale rows are purged

Fixes the write half of bug #1. `ConfigService.set()` already throws for `editable: false`, and the settings `PATCH` route catches per-key errors into its `rejected` array — so flipping the flag is sufficient to close the write path with a clear message, no route change needed.

A settings row may already exist from the buggy period, possibly containing a real plaintext PAT *or* a persisted mask string. It was never read, so deleting it changes no behavior — and it's the only way to get the secret out of the SQLite file.

**Files:**
- Modify: `src/config/config.schema.ts:162-185` (`github.token`, `azureDevOps.token`)
- Modify: `src/index.ts:81` (immediately after `configService` is constructed)
- Test: `src/config/config.service.sensitive.test.ts` (extend)

**Interfaces:**
- Consumes: `getAll()` from Task 1, which returns `editable` and `is_set`.
- Produces: `github.token` and `azureDevOps.token` both have `editable: false`. `ConfigService.set()` on either throws `Error('Config key <key> is not editable at runtime')` (existing message from `config.service.ts:78`).

- [ ] **Step 1: Write the failing test**

Append to `src/config/config.service.sensitive.test.ts`, inside the existing `describe` block:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/config/config.service.sensitive.test.ts`
Expected: FAIL — `set()` succeeds instead of throwing, and `editable` is `true` for both keys.

- [ ] **Step 3: Flip the flag in the registry**

In `src/config/config.schema.ts`, change `editable: true` to `editable: false` in the `github.token` entry (line ~169) and the `azureDevOps.token` entry (line ~181). Leave `requiresRestart: true` and `sensitive: true` as they are. Update both descriptions to say where the value actually comes from:

```typescript
    {
        key: 'github.token',
        label: 'GitHub Token',
        description: 'Personal Access Token for GitHub API access. Set via the GITHUB_TOKEN environment variable; requires a restart.',
        category: 'providers',
        type: 'string',
        default: '',
        editable: false,
        requiresRestart: true,
        validation: z.string(),
        sensitive: true,
    },
    {
        key: 'azureDevOps.token',
        label: 'Azure DevOps Token',
        description: 'Personal Access Token for Azure DevOps API access. Set via the AZURE_DEVOPS_TOKEN environment variable, or per-repo when adding a repository; requires a restart.',
        category: 'providers',
        type: 'string',
        default: '',
        editable: false,
        requiresRestart: true,
        validation: z.string(),
        sensitive: true,
    },
```

- [ ] **Step 4: Purge any stale token rows at startup**

In `src/index.ts`, directly after the `configService` is constructed (line 81, `const configService = new ConfigService(...)`), insert:

```typescript
    // 5b. Purge token rows written by the pre-fix Settings UI. These were
    // never read by ProviderFactory, so deleting them changes no behavior —
    // but a real PAT (or a persisted mask) may be sitting in the DB in
    // plaintext. Tokens now come only from env / the repos table.
    for (const key of ['github.token', 'azureDevOps.token'] as const) {
        if (settingsRepo.get(key) !== null) {
            settingsRepo.delete(key);
            logger.warn(
                `Removed stale '${key}' row from the settings table. This value was ` +
                `never used. Configure the token via the environment instead.`
            );
        }
    }
```

- [ ] **Step 5: Run the tests and typecheck to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, including the two new tests.

- [ ] **Step 6: Commit**

```bash
git add src/config/config.schema.ts src/index.ts src/config/config.service.sensitive.test.ts
git commit -m "fix(config): make provider tokens non-editable and purge stale rows"
```

---

### Task 3: Frontend renders `is_set` instead of a value

Without this, the `!setting.editable` branch of `SettingField` renders `String(setting.current_value)` — which is now `null` — and a configured token would display as "Not set". This task also hardens the `sensitive` input branch so it can never again seed from a returned value, even if some future key is both sensitive and editable.

**Files:**
- Modify: `frontend/src/types/index.ts:178-193` (the `SettingItem` interface)
- Modify: `frontend/src/pages/Settings.tsx:199-232` (the `SettingField` component)

**Interfaces:**
- Consumes: `is_set: boolean`, `current_value: null` for sensitive keys — both from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Widen the `SettingItem` type**

In `frontend/src/types/index.ts`, replace the `current_value` / `default_value` lines and add `is_set`:

```typescript
export interface SettingItem {
  key: string;
  label: string;
  description: string;
  category: string;
  type: 'number' | 'boolean' | 'string' | 'enum';
  /** Always null for sensitive keys — the API never returns secrets. */
  current_value: string | number | boolean | null;
  default_value: string | number | boolean | null;
  /** Whether a value is configured. The only signal available for secrets. */
  is_set: boolean;
  is_overridden: boolean;
  editable: boolean;
  requires_restart: boolean;
  sensitive: boolean;
  enumValues?: string[];
  min?: number;
  max?: number;
}
```

- [ ] **Step 2: Run the frontend typecheck to see it fail**

Run: `cd frontend && npx tsc --noEmit`
Expected: FAIL in `Settings.tsx` — `String(currentVal)` and the `type="number"` / `type="enum"` branches now receive a possibly-`null` value.

- [ ] **Step 3: Fix the non-editable and sensitive branches**

In `frontend/src/pages/Settings.tsx`, replace the read-only display branch and the sensitive-input branch (lines 219-232) with:

```tsx
          {!setting.editable ? (
            <span className="inline-block rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-600 font-mono">
              {setting.sensitive
                ? setting.is_set
                  ? 'Set — configure via .env'
                  : 'Not set'
                : setting.current_value == null || setting.current_value === ''
                  ? 'Not set'
                  : String(setting.current_value)}
            </span>
          ) : setting.sensitive ? (
            // Never seed a secret input from server state — the API does not
            // return secrets, and a placeholder must never be persisted.
            <input
              type="password"
              value={String(editValue ?? '')}
              placeholder={setting.is_set ? 'Set — enter a new value to replace' : 'Enter new value'}
              onChange={(e) => onChange(e.target.value)}
              className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          ) : setting.type === 'boolean' ? (
```

- [ ] **Step 4: Guard the remaining branches against null**

Still in `SettingField`, the `number` and `enum` branches read `String(currentVal)`. Change line 200 so a null never reaches them:

```tsx
  const currentVal = editValue !== undefined ? editValue : (setting.current_value ?? '');
```

- [ ] **Step 5: Run the frontend typecheck to verify it passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS, no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/Settings.tsx
git commit -m "fix(ui): render is_set for secrets instead of a returned value"
```

---

### Task 4: `claude.reviewTimeoutSeconds` applies at runtime

The registry promises `requiresRestart: false`, but the executor is built from the raw env value and stores it `readonly`. Mirror exactly what `claude.model` already does two lines above.

**Files:**
- Modify: `src/reviewer/claude-cli.executor.ts:28-41`
- Modify: `src/index.ts:136-152`
- Test: `src/reviewer/claude-cli.executor.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ClaudeCliExecutor.setTimeoutSeconds(seconds: number): void`, mirroring the existing `setModel(model: string | undefined): void`.

- [ ] **Step 1: Write the failing test**

Create `src/reviewer/claude-cli.executor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execCommand } from '../utils/shell.js';
import { ClaudeCliExecutor } from './claude-cli.executor.js';

vi.mock('../utils/shell.js', () => ({
    execCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
}));

const mockExec = vi.mocked(execCommand);

describe('ClaudeCliExecutor — runtime timeout changes', () => {
    beforeEach(() => {
        mockExec.mockClear();
    });

    it('uses the constructor timeout for the first review', async () => {
        const executor = new ClaudeCliExecutor('claude', 300, undefined);

        await executor.executeReview('/tmp/repo', 'prompt');

        expect(mockExec).toHaveBeenCalledTimes(1);
        expect(mockExec.mock.calls[0][2]).toMatchObject({ timeoutMs: 300_000 });
    });

    it('applies a new timeout to subsequent reviews without reconstruction', async () => {
        const executor = new ClaudeCliExecutor('claude', 300, undefined);

        executor.setTimeoutSeconds(900);
        await executor.executeReview('/tmp/repo', 'prompt');

        expect(mockExec.mock.calls[0][2]).toMatchObject({ timeoutMs: 900_000 });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/reviewer/claude-cli.executor.test.ts`
Expected: FAIL — `executor.setTimeoutSeconds is not a function`. (The first test should already pass.)

- [ ] **Step 3: Make the timeout mutable**

In `src/reviewer/claude-cli.executor.ts`, change the constructor field and add the setter next to `setModel`:

```typescript
export class ClaudeCliExecutor {
    constructor(
        private readonly cliPath: string,
        private timeoutSeconds: number,
        private model: string | undefined,
    ) {}

    /**
     * Updates the model used for subsequent reviews. Called when the
     * `claude.model` setting changes at runtime. Pass `undefined` to let
     * the Claude CLI choose its own default.
     */
    setModel(model: string | undefined): void {
        this.model = model;
    }

    /**
     * Updates the per-review timeout. Called when the
     * `claude.reviewTimeoutSeconds` setting changes at runtime. Applies to
     * the next review; a review already in flight keeps its old timeout.
     */
    setTimeoutSeconds(seconds: number): void {
        this.timeoutSeconds = seconds;
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/reviewer/claude-cli.executor.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Wire it up in `index.ts`**

In `src/index.ts`, replace the executor construction (lines 134-152) so the timeout is read through `configService` — the same three-tier read `initialModel` already uses — and register a change listener:

```typescript
    const repoManager = new RepoManager(config.storage.reposDir);
    const initialModel = resolveModel(configService.get<string>('claude.model'));
    const initialTimeout = configService.get<number>('claude.reviewTimeoutSeconds');
    const claudeExecutor = new ClaudeCliExecutor(
        config.claude.cliPath,
        initialTimeout,
        initialModel
    );
    const standardsGenerator = new CodingStandardsGenerator(
        config.claude.cliPath,
        config.claude.standardsTimeoutSeconds,
        initialModel,
    );

    configService.onChange('claude.model', (value: unknown) => {
        const model = resolveModel(value as string | undefined);
        claudeExecutor.setModel(model);
        standardsGenerator.setModel(model);
        logger.info('Claude model changed', { model: model ?? 'default (CLI chooses)' });
    });

    configService.onChange('claude.reviewTimeoutSeconds', (value: unknown) => {
        const seconds = value as number;
        claudeExecutor.setTimeoutSeconds(seconds);
        logger.info('Claude review timeout changed', { timeoutSeconds: seconds });
    });
```

Note: `standardsGenerator` keeps `config.claude.standardsTimeoutSeconds`. `standardsTimeoutSeconds` has no `CONFIG_REGISTRY` entry, so there is nothing to override and nothing to listen for. That gap is out of scope for this plan.

- [ ] **Step 6: Verify the whole suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/reviewer/claude-cli.executor.ts src/reviewer/claude-cli.executor.test.ts src/index.ts
git commit -m "fix(reviewer): apply claude.reviewTimeoutSeconds at runtime"
```

---

### Task 5: Graceful shutdown of the review loop

`startProcessing()` is `while (true)` with no exit, and `shutdown()` calls `db.close()` while a review may be mid-write — so better-sqlite3 throws on the closed handle and the review is stranded in `in_progress`. `reconcileOrphanedReviews` exists to clean that up on the next boot, which means today it runs on *every* SIGTERM rather than only after a crash.

We add a stop flag plus an interruptible sleep (so an idle loop exits immediately, not up to 5s later), drain in-flight work with a bounded wait, and only close the DB if the drain actually finished. If it doesn't finish, we exit *without* closing — SQLite is crash-safe, and the next boot's reconciliation handles the orphan. Closing a live handle is the thing to avoid.

**Files:**
- Modify: `src/reviewer/reviewer.service.ts:52` (remove the module-level `sleep`), `:80-108` (the loop)
- Modify: `src/index.ts:166` (capture the loop promise), `:281-291` (the shutdown handler)
- Test: `src/reviewer/reviewer.service.shutdown.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ReviewerService.stop(): void`. `ReviewerService.startProcessing(): Promise<void>` now resolves once the loop exits, instead of never resolving.
- `ReviewerService`'s constructor order is unchanged: `(db, queue, providerFactory, configService, repoManager, claudeExecutor, reviewsRepo, reposRepo, standardsGenerator)`.

- [ ] **Step 1: Write the failing test**

Create `src/reviewer/reviewer.service.shutdown.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

// The loop under test never dequeues a job, so the provider/repo-manager/
// executor collaborators are never touched.
const ENV_CONFIG = { review: {}, claude: {} } as unknown as AppConfig;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms),
        ),
    ]);
}

describe('ReviewerService — graceful shutdown', () => {
    let db: Database.Database;
    let service: ReviewerService;

    beforeEach(() => {
        db = new Database(':memory:');
        db.exec(getSchemaSQL());
        const configService = new ConfigService(
            new SettingsRepository(db), ENV_CONFIG, new RepoSettingsRepository(db),
        );
        service = new ReviewerService(
            db,
            new ReviewQueue(),
            {} as never,          // providerFactory — unused on an empty queue
            configService,
            {} as never,          // repoManager
            {} as never,          // claudeExecutor
            new ReviewsRepository(db),
            new ReposRepository(db),
            {} as never,          // standardsGenerator
        );
    });

    afterEach(() => {
        db.close();
    });

    it('stop() ends an idle loop without waiting out the 5s poll sleep', async () => {
        const loop = service.startProcessing();
        service.stop();
        // 1000ms is far below the 5000ms idle sleep: proves the sleep is interrupted.
        await expect(withTimeout(loop, 1000)).resolves.toBeUndefined();
    });

    it('stop() before start means the loop body never runs', async () => {
        service.stop();
        await expect(withTimeout(service.startProcessing(), 1000)).resolves.toBeUndefined();
    });

    it('stop() is idempotent', async () => {
        const loop = service.startProcessing();
        service.stop();
        service.stop();
        await expect(withTimeout(loop, 1000)).resolves.toBeUndefined();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/reviewer/reviewer.service.shutdown.test.ts`
Expected: FAIL — `service.stop is not a function`.

- [ ] **Step 3: Make the loop stoppable**

In `src/reviewer/reviewer.service.ts`, delete the module-level `sleep` helper at line 52:

```typescript
function sleep(ms: number): Promise<void> {
```

(remove the whole function — it has no other callers, and `noUnusedLocals` will flag it)

Then add two private fields to the `ReviewerService` class body, alongside its existing fields:

```typescript
    private stopping = false;
    /** Resolves the current idle sleep early so stop() takes effect at once. */
    private wake: (() => void) | null = null;
```

And replace `startProcessing()` (lines 80-108) with:

```typescript
    /**
     * Processing loop. Dequeues one job at a time and sleeps for 5 seconds
     * when the queue is empty. Runs until stop() is called; resolves once
     * any in-flight review has finished, so shutdown can drain cleanly.
     */
    async startProcessing(): Promise<void> {
        logger.info('Review processing loop started');

        while (!this.stopping) {
            const job = this.queue.dequeue();
            if (job) {
                try {
                    await this.processReview(job);
                } catch (err) {
                    // This catch is a safety net. processReview has its own
                    // error handling, but if something truly unexpected happens
                    // (e.g., a bug in our code), we log and continue.
                    logger.error('Unhandled error in processReview', {
                        jobId: job.id,
                        repo: job.repoFullName,
                        pr: job.prNumber,
                        error: (err as Error).message,
                        stack: (err as Error).stack,
                    });
                }
            } else {
                await this.idleSleep(5000);
            }
        }

        logger.info('Review processing loop stopped');
    }

    /**
     * Signals the processing loop to exit after the current review (if any).
     * Safe to call more than once, and before startProcessing().
     */
    stop(): void {
        this.stopping = true;
        this.wake?.();
    }

    /** A sleep that stop() can cut short. */
    private idleSleep(ms: number): Promise<void> {
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.wake = null;
                resolve();
            }, ms);
            this.wake = () => {
                clearTimeout(timer);
                this.wake = null;
                resolve();
            };
        });
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/reviewer/reviewer.service.shutdown.test.ts`
Expected: PASS, 3 tests. Each should complete in well under a second — if one takes ~5s, `idleSleep` is not being interrupted.

- [ ] **Step 5: Drain the loop in `index.ts` before closing the DB**

In `src/index.ts`, capture the loop promise. Replace line 166 (`reviewerService.startProcessing(); // runs in background (not awaited)`) with:

```typescript
    const processingLoop = reviewerService.startProcessing().catch(err => {
        logger.error('Review processing loop crashed', { error: err });
    });
```

Then replace the shutdown handler (lines 281-291) with:

```typescript
    // Graceful shutdown. Stop feeding the queue, let the in-flight review
    // finish, then close the DB. If the drain times out we exit WITHOUT
    // closing: SQLite is crash-safe, and closing a handle out from under an
    // in-flight write is exactly the failure we are avoiding. Startup
    // reconciliation re-enqueues anything left in `in_progress`.
    const DRAIN_TIMEOUT_MS = 10_000;
    let shuttingDown = false;

    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;

        logger.info('Shutting down...');
        retryScheduler.stop();
        pollerService.stop();
        reviewerService.stop();

        const drained = await Promise.race([
            processingLoop.then(() => true),
            new Promise<boolean>(resolve => {
                setTimeout(() => resolve(false), DRAIN_TIMEOUT_MS).unref();
            }),
        ]);

        if (drained) {
            db.close();
            logger.info('Shutdown complete');
        } else {
            logger.warn(
                `Review still in flight after ${DRAIN_TIMEOUT_MS}ms; exiting without ` +
                `closing the database. It will be reconciled on next startup.`
            );
        }

        process.exit(0);
    };

    process.on('SIGTERM', () => { void shutdown(); });
    process.on('SIGINT', () => { void shutdown(); });
```

- [ ] **Step 6: Verify the full suite, typecheck, and build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all pass.

- [ ] **Step 7: Prove it end-to-end**

Run the dev server, then send it SIGINT with an empty queue and confirm the loop exits cleanly rather than being killed mid-sleep:

```bash
npm run dev
# In the same terminal, press Ctrl-C once.
```

Expected log order, with no `TypeError: The database connection is not open`:

```
[main] Shutting down...
[poller-service] Poller service stopped
[reviewer-service] Review processing loop stopped
[main] Shutdown complete
```

- [ ] **Step 8: Commit**

```bash
git add src/reviewer/reviewer.service.ts src/reviewer/reviewer.service.shutdown.test.ts src/index.ts
git commit -m "fix(reviewer): drain the review loop before closing the database"
```

---

## Final Verification

- [ ] `npx vitest run` — all tests pass, including the 9 new ones.
- [ ] `npx tsc --noEmit` — clean.
- [ ] `cd frontend && npx tsc --noEmit` — clean.
- [ ] `npm run build` — succeeds.
- [ ] `git diff main --stat` — touches only: `config.schema.ts`, `config.service.ts`, `claude-cli.executor.ts`, `reviewer.service.ts`, `index.ts`, `frontend/src/types/index.ts`, `frontend/src/pages/Settings.tsx`, plus three new test files. Nothing in `spec/`. Nothing in `repo-manager.ts` or `utils/git.ts`.
- [ ] Manual: start the app, open Settings → providers. Both tokens render as a locked read-only chip reading "Set — configure via .env" (or "Not set"), with no input. `curl -s localhost:3001/api/settings | grep -c ghp_` returns `0`.

## Review

_(To be filled in after execution, per `CLAUDE.md` § Task Management.)_
