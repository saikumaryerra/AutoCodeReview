## 8. Runtime Configuration Service

### 8.1 The Two-Tier Config Architecture

The application has two sources of configuration, and understanding how they interact is essential. The **first tier** is the `.env` file (and environment variables), which provides defaults and contains secrets. The **second tier** is the `settings` table in the SQLite database, which stores overrides made through the UI. When the application needs a config value, the `ConfigService` checks the database first — if a key exists there, its value wins. If not, the `.env` default is used.

This two-tier approach solves a real operational problem: with `.env`-only config, changing the polling interval or retention period requires SSH access to the server, editing a file, and restarting the container. With UI-editable config, an administrator can adjust operational settings from their browser and see the changes take effect immediately, without any deployment or restart.

Not all settings are editable from the UI. Settings are divided into two categories:

**UI-editable settings** are operational parameters that can safely change at runtime without restarting the process. These include: `polling.intervalSeconds`, `review.skipDrafts`, `review.maxFilesChanged`, `review.maxDiffSize`, `review.retentionDays`, `review.prStateFilter`, and `claude.reviewTimeoutSeconds`.

**Environment-only settings** are infrastructure and security settings that either require a restart to take effect or are too dangerous to expose in a web UI. These include: `github.token`, `azureDevOps.token`, `azureDevOps.orgUrl`, `github.repos`, `azureDevOps.repos`, `claude.cliPath`, `claude.model`, `server.apiPort`, `storage.dbPath`, and `storage.reposDir`. Secrets (tokens) are never stored in the database and are never returned by the API.

### 8.2 Config Schema (`src/config/config.schema.ts`)

This file is the source of truth for what config keys exist, what types they are, what their constraints are, and whether they can be edited from the UI. It also provides human-readable metadata (labels, descriptions, categories) that the frontend uses to dynamically render the settings form.

```typescript
interface ConfigKeyMetadata {
    key: string;                    // Dotted path, e.g. "polling.intervalSeconds"
    label: string;                  // Human-readable name for UI, e.g. "Polling Interval"
    description: string;            // Explanation shown as help text in UI
    category: "polling" | "review" | "claude" | "storage" | "server" | "providers";
    type: "number" | "boolean" | "string" | "enum";
    enumValues?: string[];          // If type is "enum", the allowed values
    default: unknown;               // Default value (from .env or hardcoded)
    editable: boolean;              // Can this be changed from the UI?
    requiresRestart: boolean;       // If true, change takes effect only after restart
    validation: z.ZodType<unknown>; // Zod schema for validating new values
    sensitive: boolean;             // If true, value is masked in API responses (for tokens)
}

// The full registry of all config keys
export const CONFIG_REGISTRY: ConfigKeyMetadata[] = [
    {
        key: "polling.intervalSeconds",
        label: "Polling Interval",
        description: "How often to check for new PRs and commits, in seconds. " +
                     "Lower values mean faster detection but more API calls.",
        category: "polling",
        type: "number",
        default: 120,
        editable: true,
        requiresRestart: false,
        validation: z.number().min(30).max(3600),
        sensitive: false,
    },
    {
        key: "review.retentionDays",
        label: "Review Retention Period",
        description: "Reviews older than this many days are automatically deleted. " +
                     "Set to 0 to keep reviews indefinitely.",
        category: "review",
        type: "number",
        default: 90,
        editable: true,
        requiresRestart: false,
        validation: z.number().min(0).max(3650),
        sensitive: false,
    },
    {
        key: "review.skipDrafts",
        label: "Skip Draft PRs",
        description: "When enabled, draft pull requests are ignored during polling.",
        category: "review",
        type: "boolean",
        default: true,
        editable: true,
        requiresRestart: false,
        validation: z.boolean(),
        sensitive: false,
    },
    {
        key: "review.maxFilesChanged",
        label: "Max Files Changed",
        description: "PRs with more changed files than this are skipped. " +
                     "Prevents extremely large PRs from overwhelming the reviewer.",
        category: "review",
        type: "number",
        default: 50,
        editable: true,
        requiresRestart: false,
        validation: z.number().min(1).max(500),
        sensitive: false,
    },
    {
        key: "review.maxDiffSize",
        label: "Max Diff Size (characters)",
        description: "PRs with a diff larger than this are skipped.",
        category: "review",
        type: "number",
        default: 100000,
        editable: true,
        requiresRestart: false,
        validation: z.number().min(1000).max(1000000),
        sensitive: false,
    },
    {
        key: "review.prStateFilter",
        label: "PR State Filter",
        description: "Which PR states to review: open (active PRs only), " +
                     "closed (completed PRs only), or all.",
        category: "review",
        type: "enum",
        enumValues: ["open", "closed", "all"],
        default: "open",
        editable: true,
        requiresRestart: false,
        validation: z.enum(["open", "closed", "all"]),
        sensitive: false,
    },
    {
        key: "claude.reviewTimeoutSeconds",
        label: "Review Timeout",
        description: "Maximum seconds to wait for Claude CLI to complete a review. " +
                     "Increase for large repositories that need more context-gathering time.",
        category: "claude",
        type: "number",
        default: 300,
        editable: true,
        requiresRestart: false,
        validation: z.number().min(60).max(1800),
        sensitive: false,
    },
    // --- Non-editable settings (shown in UI as read-only) ---
    {
        key: "github.token",
        label: "GitHub Token",
        description: "Personal Access Token for GitHub API access.",
        category: "providers",
        type: "string",
        default: "",
        editable: false,
        requiresRestart: true,
        validation: z.string(),
        sensitive: true,     // Value is masked in API responses
    },
    // ... similar entries for azureDevOps.token, claude.cliPath,
    //     server.apiPort, storage.dbPath, etc.
];
```

### 8.3 Config Service (`src/config/config.service.ts`)

The `ConfigService` is a singleton that the rest of the application uses to read configuration values. It replaces direct references to the static `config` object from `.env`. The key difference is that it reads from the database's `settings` table first, falling back to the `.env` default only when no override exists. It also caches database lookups in memory and invalidates the cache when a setting is changed through the API.

```typescript
class ConfigService {
    private cache: Map<string, unknown> = new Map();
    private settingsRepo: SettingsRepository;
    private envConfig: typeof import('./config').config;  // The parsed .env values

    constructor(db: Database, envConfig: typeof import('./config').config);

    // Gets the current effective value for a config key.
    // Lookup order: in-memory cache → database → .env default.
    //
    // Every module in the application calls this instead of reading from
    // the static config object. For example, the poller calls
    // configService.get('polling.intervalSeconds') before each cycle,
    // which means a UI change to the polling interval takes effect on
    // the very next poll without any restart.
    get<T>(key: string): T {
        // Check cache first
        if (this.cache.has(key)) return this.cache.get(key) as T;

        // Check database
        const dbValue = this.settingsRepo.get(key);
        if (dbValue !== null) {
            const parsed = JSON.parse(dbValue.value);
            this.cache.set(key, parsed);
            return parsed as T;
        }

        // Fall back to .env default
        const envValue = this.resolveEnvKey(key);
        this.cache.set(key, envValue);
        return envValue as T;
    }

    // Updates a config value. Validates against the schema, writes to the
    // database, invalidates the cache, and calls any registered change
    // listeners (see below).
    //
    // Throws if the key is not editable or if validation fails.
    set(key: string, value: unknown, updatedBy: string = 'ui'): void {
        const meta = CONFIG_REGISTRY.find(m => m.key === key);
        if (!meta) throw new Error(`Unknown config key: ${key}`);
        if (!meta.editable) throw new Error(`Config key ${key} is not editable at runtime`);

        // Validate the new value
        const result = meta.validation.safeParse(value);
        if (!result.success) throw new Error(`Invalid value for ${key}: ${result.error.message}`);

        // Write to database
        this.settingsRepo.upsert(key, JSON.stringify(value), updatedBy);

        // Invalidate cache
        this.cache.delete(key);

        // Notify listeners (e.g., the poller reschedules itself when interval changes)
        this.notifyListeners(key, value);
    }

    // Resets a config key back to its .env default by deleting the
    // database override. The next get() call will return the .env value.
    reset(key: string): void {
        this.settingsRepo.delete(key);
        this.cache.delete(key);
        this.notifyListeners(key, this.resolveEnvKey(key));
    }

    // Returns all settings with their current effective values, metadata,
    // and whether they are overridden from the default.
    // Used by the GET /api/v1/settings endpoint to populate the UI.
    getAll(): Array<{
        key: string;
        label: string;
        description: string;
        category: string;
        type: string;
        enumValues?: string[];
        currentValue: unknown;          // The effective value right now
        defaultValue: unknown;          // The .env value
        isOverridden: boolean;          // true if DB has an override
        editable: boolean;
        requiresRestart: boolean;
        sensitive: boolean;
    }>;

    // ── Change Listeners ──
    // Modules register callbacks to react to config changes in real time.
    // For example, the poller calls:
    //   configService.onChange('polling.intervalSeconds', (newVal) => {
    //       this.reschedule(newVal);
    //   });
    //
    // This is how the poller changes its interval without a restart.

    private listeners: Map<string, Array<(value: unknown) => void>> = new Map();

    onChange(key: string, callback: (value: unknown) => void): void {
        const list = this.listeners.get(key) || [];
        list.push(callback);
        this.listeners.set(key, list);
    }

    private notifyListeners(key: string, value: unknown): void {
        const list = this.listeners.get(key) || [];
        for (const cb of list) {
            try { cb(value); }
            catch (err) { logger.error(`Config change listener error for ${key}`, err); }
        }
    }

    // Resolves a dotted key like "polling.intervalSeconds" to the
    // corresponding value in the static envConfig object.
    private resolveEnvKey(key: string): unknown;
}
```

### 8.4 How Modules Consume Live Config

The important architectural point is that modules read config through the `ConfigService` at the moment they need it, not once at startup. This is what makes UI changes take effect without a restart.

**Poller example — the polling interval can change while the app is running:**

The poller's cron job is initially scheduled based on the startup value of `polling.intervalSeconds`. It also registers a change listener so that if the interval is updated from the UI, the cron job is destroyed and re-created with the new interval. This happens seamlessly — the current poll cycle finishes, and the next cycle uses the new timing.

```typescript
class PollerService {
    private cronJob: cron.ScheduledTask;

    constructor(private db: Database, private queue: ReviewQueue, private configService: ConfigService) {
        // Schedule the initial cron job
        this.schedule(configService.get<number>('polling.intervalSeconds'));

        // React to interval changes from the UI
        configService.onChange('polling.intervalSeconds', (newInterval) => {
            logger.info(`Polling interval changed to ${newInterval}s — rescheduling`);
            this.cronJob.stop();
            this.schedule(newInterval as number);
        });
    }

    private schedule(intervalSeconds: number): void {
        // node-cron doesn't support arbitrary second intervals directly,
        // so we use setInterval for sub-minute precision and cron for >= 60s.
        // The implementation detail is flexible — the key point is that
        // this method can be called multiple times to reschedule.
    }

    async poll(): Promise<void> {
        // On each poll cycle, read skip/filter settings from configService
        // so UI changes to skipDrafts, prStateFilter, etc. take immediate effect.
        const skipDrafts = this.configService.get<boolean>('review.skipDrafts');
        const stateFilter = this.configService.get<string>('review.prStateFilter');
        // ... rest of polling logic
    }
}
```

**Reviewer example — timeout and size limits are read per-review:**

```typescript
class ReviewerService {
    async processReview(job: ReviewJob): Promise<void> {
        // Read these fresh for every review, so a UI change applies
        // to the very next review without waiting for a restart.
        const timeout = this.configService.get<number>('claude.reviewTimeoutSeconds');
        const maxFiles = this.configService.get<number>('review.maxFilesChanged');
        const maxDiff = this.configService.get<number>('review.maxDiffSize');
        // ... rest of review logic
    }
}
```

---

