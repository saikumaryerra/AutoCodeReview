# Spec Change Log

Per `CLAUDE.md`, `spec/` is the source of truth and must not be edited. Deviations
discovered during implementation are recorded here instead.

---

## 2026-07-10 — Sensitive config values are omitted, not masked

**Spec:** `spec/08-runtime-config.md:31` — `sensitive: boolean; // If true, value is masked in API responses (for tokens)`
and `spec/08-runtime-config.md:137` — `sensitive: true, // Value is masked in API responses`

**Implemented instead:** `ConfigService.getAll()` returns `current_value: null` and
`default_value: null` for any registry entry with `sensitive: true`, plus a new
`is_set: boolean` field indicating only whether a value is configured.

**Why:** The API (`src/api/server.ts`) is unauthenticated and mounts open CORS. A mask
of the form `ghp_****wxyz` still discloses the token's prefix, length class, and last
four characters. It also round-tripped: the Settings UI seeded its input from the masked
`current_value`, so saving the form could persist the mask string as if it were a
credential. Omitting the value entirely removes both problems, and `is_set` preserves the
only thing the UI actually needs to render.

**Spec impact:** `spec/08-runtime-config.md` should replace "masked" with "omitted" in
both places, and add `is_set: boolean` to the settings API response shape.

---

## 2026-07-10 — `ConfigService.reset()` returns values and lacks guards

**Spec:** `spec/08-runtime-config.md:208` — `reset(key: string): void`

**Found in implementation:** `reset()` returns `{ previousValue, restoredValue }`, and
`POST /api/settings/:key/reset` serializes both into the response body and the Winston
log. Combined with the absence of any registry-existence or `editable` guard, this meant
`POST /api/settings/github.token/reset` returned the live PAT in cleartext over the
unauthenticated API. Reproduced against the real `ConfigService`.

**Implemented (Task 2b):** `reset()` keeps its current return type (the settings route and
its tests depend on it) but now throws `NotFoundError` for an unknown key and
`ValidationError` for a non-editable or sensitive key. The route no longer logs values.

**Spec impact:** Either the spec's `void` signature should be updated to match the
implementation's return type, or the implementation should be narrowed to `void` and the
route's `previous_value` / `restored_value` response fields dropped. Flagging rather than
deciding — the API contract in `spec/09-api.md` may depend on those fields.

---

## 2026-07-10 — Registry drift: tokens were `editable: true`

**Spec:** `spec/08-runtime-config.md:126-137` lists `github.token` under
"Non-editable settings (shown in UI as read-only)" with `editable: false`.

**Found in implementation:** both `github.token` and `azureDevOps.token` had
`editable: true` in `CONFIG_REGISTRY`, so the Settings UI offered an editable field whose
value nothing ever read back (`ProviderFactory` reads the env-derived `AppConfig`).

**Implemented (Task 2):** restored `editable: false` for both, matching the spec. No spec
change needed — this entry records that the code had drifted, not the spec.
