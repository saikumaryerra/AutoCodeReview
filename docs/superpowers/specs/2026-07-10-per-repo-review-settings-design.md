# Per-Repo Review Settings — Design

**Date:** 2026-07-10
**Status:** Approved (design) — pending implementation plan

## 1. Summary

Today all review settings are **global**: every setting is a flat lookup
(`configService.get<T>('review.maxFilesChanged')`) with no repo context. This
feature lets each tracked repository **override a subset of review settings**,
while unset settings continue to follow the global default.

The model is **inherit-with-override**: a repo stores *only* the settings it
explicitly overrides. "Following global" is represented by the **absence** of a
stored value, not by a copied value — so a repo that hasn't overridden a key
tracks changes to the global default live.

## 2. Scope

### In scope — 8 overridable `review.*` keys

**Core review filters**
- `review.skipDrafts`
- `review.maxFilesChanged`
- `review.maxDiffSize`
- `review.prStateFilter`

**Auto-post & retry**
- `review.autoPostComment`
- `review.autoPostSkipClean`
- `review.retryEnabled`
- `review.maxRetryAttempts`

### Out of scope (stay global-only, for all repos)

`claude.model`, `claude.reviewTimeoutSeconds`, `polling.intervalSeconds`,
`review.retentionDays`, and every non-`review` key (`github.token`,
`storage.*`, `server.*`, etc.). These are not exposed in the per-repo UI.

### Non-goals (YAGNI)

- No per-repo override for the out-of-scope keys above.
- No settings history / audit UI (the `updated_at` / `updated_by` columns exist
  but are not surfaced).
- No import/export or "copy settings from another repo".

## 3. Data Model

New table, added to `src/database/schema.ts`. It mirrors the existing global
`settings` table but is keyed by repo and stored **sparsely** (a row exists
only for an explicit override).

```sql
CREATE TABLE IF NOT EXISTS repo_settings (
    repo_id     TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,          -- JSON, same encoding as settings.value
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by  TEXT NOT NULL DEFAULT 'ui',
    PRIMARY KEY (repo_id, key)
);
```

**Why a table (Approach A), not a JSON column or per-key columns:**
- Sparse storage is exactly what inherit-with-override needs.
- It is the same shape the codebase already uses for globals, so
  `RepoSettingsRepository` mirrors `SettingsRepository` almost line-for-line.
- `ON DELETE CASCADE` auto-cleans overrides when a repo is deleted.
- Per-key `updated_at` / `updated_by` audit, and no read-modify-write races.

**Migration is additive with zero backfill.** `connection.ts` runs
`db.exec(getSchemaSQL())` (all `CREATE ... IF NOT EXISTS`) on startup, so
existing databases pick up the table automatically. An empty `repo_settings`
table means every repo follows global — identical to today's behavior. Fully
backward compatible.

## 4. Config Registry — overridable flag

Add one field to `ConfigKeyMetadata` in `src/config/config.schema.ts`:

```ts
perRepoOverridable: boolean;
```

Set it `true` on the 8 keys above and `false` (or omit with a default of
`false`) everywhere else. The API and UI derive the overridable set by filtering
the registry — **no hardcoded key lists** anywhere.

## 5. Resolution — 3-tier fallback in `ConfigService`

Extend the getter with an optional repo scope. Global behavior is **unchanged**
when `repoId` is omitted.

```ts
get<T>(key: string, repoId?: string): T
//  repoId present AND key.perRepoOverridable → repo_settings[repoId][key]
//    → (fall through) settings[key]
//    → (fall through) env default
//  repoId absent, OR key not overridable → settings[key] → env default  (as today)
```

### Cache

The cache key becomes scope-qualified: `` `${repoId ?? '~global'}:${key}` ``.

**Cross-scope invalidation (correctness-critical):** when a *global* value
changes, every repo that *inherits* that key must observe the new value.
Therefore:

- `set(key, value)` (global) — upsert `settings`, then invalidate **all** cache
  entries whose key portion is `key` (both `~global:key` and every
  `<repoId>:key`), and notify listeners (unchanged).
- `setForRepo(repoId, key, value)` — validate `perRepoOverridable` + run
  `meta.validation.safeParse(value)`; upsert `repo_settings`; invalidate only
  `` `${repoId}:${key}` ``.
- `resetForRepo(repoId, key)` — **delete** the `repo_settings` row; invalidate
  `` `${repoId}:${key}` ``. (Reset = delete; never copy the global value in.)
- `resetAllForRepo(repoId)` — delete all `repo_settings` rows for the repo;
  invalidate every cache entry prefixed `` `${repoId}:` ``.

### Listeners

The existing `onChange` listeners are wired to global keys that have runtime
side effects (`polling.intervalSeconds` reschedules the cron, `claude.model`
updates the executor). None of the 8 overridable keys have such listeners, and
repo-level changes are re-read fresh by the poller/reviewer each cycle — so
`setForRepo` / `resetForRepo` do **not** fire listeners.

### New read helper for the API

```ts
getAllForRepo(repoId): Array<{
  key, label, description, category, type, enumValues?,
  global_value, repo_value | null, effective_value, is_overridden
}>
```
Filters the registry to `perRepoOverridable` keys and, per key, reads the
global value and the repo override to compute `effective_value` and
`is_overridden`. (None of the 8 keys are `sensitive`, so no masking is needed.)

## 6. Call-Site Threading

The only edits to existing review logic — each call site already has the repo
in hand.

### Poller — `src/poller/poller.service.ts`

Today `skipDrafts` and `prStateFilter` are read **once** before the repo loop
(lines ~175–180). Move them **inside** `pollSingleRepo`, resolved per repo:

```ts
const skipDrafts    = this.configService.get<boolean>('review.skipDrafts', repo.id);
const prStateFilter = this.configService.get<'open'|'closed'|'all'>('review.prStateFilter', repo.id);
```

> **Behavior change to flag:** each repo is now filtered by *its own*
> `skipDrafts` / `prStateFilter` instead of a single global value applied to the
> whole poll pass. This is the intended effect of the feature, but it is a real
> change from current behavior and must be called out in the plan/tests.

### Reviewer — `src/reviewer/reviewer.service.ts`

`ReposRepository` is already injected (constructor line 69). When a job begins
processing, resolve the id **once**:

```ts
const repoId = this.reposRepo.getByFullName(job.repoFullName)?.id;
```

Thread `repoId` into the settings reads:
- Skip-conditions block (~245–246): `review.maxFilesChanged`, `review.maxDiffSize`
- `maybeAutoPostComment` (~374–377): `review.autoPostComment`, `review.autoPostSkipClean`
- `scheduleRetryOrGiveUp` (~419–420): `review.retryEnabled`, `review.maxRetryAttempts`

**Graceful fallback:** if the repo was deleted while a past review is still
referenced, `getByFullName` returns `undefined` → `repoId` is `undefined` →
`get()` falls through to the global value. Correct by construction.

## 7. API

New sub-routes on the existing repos router (`src/api/routes/repos.routes.ts`),
mirroring the coding-standards sub-routes. All keyed by repo UUID `:id`.

| Method & path | Purpose |
|---|---|
| `GET /repos/:id/settings` | List the 8 overridable keys with `global_value`, `repo_value`, `effective_value`, `is_overridden` (via `getAllForRepo`). |
| `PUT /repos/:id/settings/:key` | Set one override. Body `{ value }`, Zod-validated against that key's registry `validation`. |
| `DELETE /repos/:id/settings/:key` | Clear one override → revert to global. |
| `DELETE /repos/:id/settings` | Clear **all** overrides for the repo ("Reset all to global"). |

**Validation / errors:**
- Unknown `:id` → 404.
- `:key` not in the registry, or `perRepoOverridable === false` → 404 (not a
  settable per-repo key).
- Body value fails `meta.validation` → 400 with the Zod message.

## 8. Frontend

### Data layer

Add hooks (in `frontend/src/hooks/`, alongside `useRepos`):
`useRepoSettings(repoId)`, `useSetRepoSetting`, `useResetRepoSetting`,
`useResetAllRepoSettings`. Mutations invalidate the `repoSettings(repoId)`
query.

### UI — Option B (compact table), per-repo panel

Rendered inside `ReposSection` in `frontend/src/pages/Settings.tsx`, opened per
repo the same way `CodingStandardsPanel` is today (a second per-repo panel /
tab: "Review Settings" next to "Coding Standards").

New component `RepoReviewSettingsPanel` renders a table grouped into
**Core review filters** and **Auto-post & retry**:

- Columns: **Setting**, **Global**, **This repo**, **Source**, action.
- **Inherited row:** *This repo* shows the greyed global value; **Source** badge
  = `INHERITED`; action = **Override**.
- **Overridden row:** amber-tinted; *This repo* renders the **live control
  matched to the setting `type`** — number input (`number`), on/off switch
  (`boolean`), dropdown from `enumValues` (`enum`); **Source** badge =
  `OVERRIDDEN`; action = **Reset**.
- Header: **Reset all to global** button (→ `DELETE /repos/:id/settings`).
- Clicking **Override** turns the cell into the control pre-filled with the
  global value and persists via `PUT`. Number inputs enforce the same Zod bounds
  as the global setting.

Only the 8 overridable keys appear; non-overridable keys are **not shown** in
this panel (they remain on the global Configuration section).

## 9. Testing

- **`RepoSettingsRepository`**: `upsert` / `get` / `delete` / `deleteAllForRepo`
  / `listByRepo`; `ON DELETE CASCADE` removes overrides when the repo is deleted.
- **`ConfigService`**:
  - `get(key)` with no `repoId` is byte-for-byte unchanged (regression guard).
  - repo override wins over global; unset repo key falls through to global.
  - `resetForRepo` reverts to global; a subsequent **global** change is then
    observed by the (now-inheriting) repo — proves cross-scope cache
    invalidation.
  - `resetAllForRepo` clears every override for the repo.
  - Cache isolation: repo A's value never leaks into repo B.
- **Poller / reviewer integration**: repo B's override does not affect repo A in
  the same poll pass / review; deleted-repo fallback resolves to global.
- **API routes**: happy paths for all four endpoints; 404 for unknown repo /
  non-overridable key; 400 for out-of-bounds value.

## 10. Files Touched (implementation checklist preview)

- `src/database/schema.ts` — add `repo_settings` table.
- `src/database/repo-settings.repository.ts` — **new** repository class.
- `src/config/config.schema.ts` — add `perRepoOverridable` flag + set on 8 keys.
- `src/config/config.service.ts` — repo-aware `get`, `setForRepo`,
  `resetForRepo`, `resetAllForRepo`, `getAllForRepo`, scoped cache +
  cross-scope invalidation.
- `src/poller/poller.service.ts` — resolve `skipDrafts` / `prStateFilter` per
  repo inside the loop.
- `src/reviewer/reviewer.service.ts` — resolve `repoId` once, thread into the 6
  settings reads.
- `src/api/routes/repos.routes.ts` — 4 new sub-routes + Zod schemas.
- `frontend/src/hooks/useRepoSettings.ts` — **new** React Query hooks.
- `frontend/src/pages/Settings.tsx` — `RepoReviewSettingsPanel` in
  `ReposSection`.
- Tests alongside each of the above.
