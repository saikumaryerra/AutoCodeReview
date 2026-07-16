# Spec Change Log

Per `CLAUDE.md`, `spec/` is the source of truth and must not be edited. Deviations
discovered during implementation are recorded here instead.

---

## 2026-07-13 — Development container removed (`Dockerfile.dev`, `docker-compose.dev.yml`)

**Spec:** `spec/14-deployment.md` §14.5 ("Docker Compose — Development") and §14.6
("Development Dockerfile") define both files; `spec/04-directory-structure.md:10,12`
lists them in the project tree.

**Removed, and why.** Docker is the production path only; development runs on the
host (`npm run dev` for the API, `cd frontend && npm run dev` for the SPA). The two
dev files were scaffolded at init and touched exactly once since, while
`docker-compose.yml` evolved across five commits — the dev path was not exercised
and drifted silently. Concretely, `docker-compose.dev.yml` loaded the whole `.env`
via `env_file:`, so the build-time `APP_BASE=/autocodereview/` leaked into the Vite
**dev server**, which then served at `/autocodereview/` while its dev proxy still
only matched `/api` — every dev API call would have returned the SPA shell instead
of JSON. Nobody noticed, which is the point: unexercised deployment config rots and
misleads.

**Consequence:** there is no containerized development environment. Host dev now
requires Node >= 20 and the Claude CLI in PATH (previously the dev image supplied
both). `scripts/setup.sh` (spec/04:108) is retained — it sets up host development,
which is now the only dev path. `README.md` and `CLAUDE.md` were updated to drop the
`docker compose -f docker-compose.dev.yml up` instruction.

**If the dev container is ever wanted back,** re-add it from spec §14.5/§14.6 and
pin `APP_BASE: "/"` in its `environment:` block so the prod subpath cannot leak in.

---

## 2026-07-12 — PR-reviews endpoint takes `repo` as a query param, not a `%2F` path segment

**Spec:** `spec/09-api-specification.md:80-84` defines
`GET /api/v1/reviews/pr/:repoFullName/:prNumber` where `repoFullName` is a
"URL-encoded repo name, e.g. `myorg%2Fbackend-api`".

**Problem:** encoding the repo's slash as `%2F` inside a path segment is not
portable across reverse proxies. nginx (with a URI in `proxy_pass`), Apache, and
most cloud load balancers decode `%2F` → `/` before forwarding, which turns the
single `repoFullName` segment into two segments and breaks route matching. The
request then falls through to the SPA catch-all and returns `index.html`, so the
UI shows "Failed to load PR details." The same failure hits the frontend deep
link `/pr/owner%2Frepo/:n` on refresh.

**Implemented:** the endpoint is now `GET /api/v1/reviews/pr?repo=<owner/repo>&pr=<number>`.
`repo` travels in the query string (never path-normalized by proxies) and `pr` is
a clean integer path-free value; both are validated with Zod (`validateQuery`).
The frontend route became `/pr/:prNumber` with `?repo=` (see
`frontend/src/utils/routes.ts#prDetailPath`). Response shape is unchanged.

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
