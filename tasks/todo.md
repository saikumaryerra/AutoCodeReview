# Deployment Strategy Fixes — Detailed Subagent-Driven Implementation Plan

Scope: fix deployment discrepancies **#2, #3, #4, #5, #7, #8**.

**OUT OF SCOPE:**
- **#1 (API auth / TLS)** — needs an architecture decision.
- **#6 (better-sqlite3 native build)** — deferred at user request. We rely on
  `better-sqlite3`'s prebuilt binary exactly as the current build already does.

**Confirmed decision:** canonical ports = **9998 prod / 3001 dev**.

---

## Brainstorming & rationale

**Why partition subagents by file, not by issue.** The port fix (#3) alone spans
5 files, and #2 also edits the Dockerfile, #4/#7 the compose file, #5 the
entrypoint. If we assigned one agent per *issue* they'd write the same files
concurrently and clobber each other. Assigning one agent per *file* makes every
agent's write set disjoint, so all four run in parallel with zero conflict risk.

**#2 approach — a dedicated prod-deps stage.** The runtime image currently copies
the builder's `node_modules`, which `npm ci` populated with devDependencies
(typescript, tsx, vitest, concurrently, supertest, all the `@types/*`). Cleanest
fix: add a small third stage `prod-deps` that runs `npm ci --omit=dev`, and have
the runtime stage copy `node_modules` from *there* instead of from `builder`. The
builder keeps its full deps (it needs `tsc` + `vite`). Because `prod-deps` uses
the same `node:20-slim` base and arch as runtime, `better-sqlite3`'s native
binary stays compatible — and since that stage installs the same way the builder
already does today, we introduce **no new native-build risk** (that's why #6 can
stay out of scope).

**#8 approach — env-driven CORS, off by default in prod.** In production the
Express process serves the SPA same-origin ([server.ts:164-174]), so no CORS is
needed at all. In dev the Vite server is a different origin, so we allow it.
Design: honor a `CORS_ORIGINS` allowlist env var; if unset, allow the Vite origin
in dev and add **no** CORS middleware in prod. No `any`, keeps `tsc` clean.

**#5 approach — make UID alignment non-fatal, don't remove it.** The block is
load-bearing (a mode-600 credentials file is only readable by a UID-matched
process). We keep the mechanism but wrap `groupmod`/`usermod` so a failure logs a
warning and continues instead of aborting boot under `set -e`.

---

## Subagent assignments (parallel, disjoint file ownership)

### SA-1 — owns `Dockerfile`  (fixes #2, #3)

**#2 — Add a prod-deps stage and copy prod-only node_modules into runtime.**

Insert a new stage after the builder (before the runtime stage at line 35):

```dockerfile
# ---------------------------------------------------------------------------
# Stage 1b: Production dependencies only
# Separate from the builder so the runtime image never ships devDependencies
# (typescript, tsx, vitest, etc.). Same base/arch as runtime so the
# better-sqlite3 native binary stays compatible.
# ---------------------------------------------------------------------------
FROM node:20-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
```

Then in the runtime stage, change the node_modules copy (currently line 60):

```dockerfile
# BEFORE
COPY --from=builder --chown=prreview:prreview /app/node_modules/ ./node_modules/
# AFTER
COPY --from=prod-deps --chown=prreview:prreview /app/node_modules/ ./node_modules/
```

Leave the `dist/`, `frontend/dist/`, and `package.json` copies pointing at
`builder` — those are correct.

**#3 — Port.** Confirm `ENV API_PORT=9998` (line 74) and `EXPOSE 9998` (line 76)
are present and unchanged. (They already are — just verify, no edit expected.)

**Comment truth-up.** The header comment (line 6-7) already claims "only
production deps" — after #2 that becomes accurate, so no wording change needed,
but confirm it reads correctly.

**Verify:** the runtime stage's only `node_modules` source is `prod-deps`; no
`--from=builder ... node_modules`.

---

### SA-2 — owns `docker-compose.yml` + `docker-compose.dev.yml`  (fixes #3, #4, #7)

All three edits are in **`docker-compose.yml`**. `docker-compose.dev.yml` needs
**no change** (dev port 3001 is already correct) — just confirm it.

**#4 — Fix the false "read-only" header comment.** Header block, line ~6:

```yaml
# BEFORE
# Claude CLI auth is mounted read-only from the host user's home directory.
# AFTER
# Claude CLI auth is mounted read-write from the host user's home directory so
# the container can refresh OAuth tokens; refreshes are visible to the host.
```

Do **not** touch the actual `~/.claude:/mnt/claude-auth` volume mount — RW is
required and correct.

**#7 — Healthcheck start_period.** Line 38:

```yaml
# BEFORE
start_period: 15s
# AFTER
start_period: 40s   # first boot: native module + DB init can exceed 15s
```

**#3 — Port.** Confirm the `ports:` mapping (line 18) and healthcheck URL (line
34) both default to `9998` (`${API_PORT:-9998}`). Already correct — verify only.

---

### SA-3 — owns `scripts/docker-entrypoint.sh`  (fixes #3, #5)

**#3 — Startup-summary port default.** Line 141:

```bash
# BEFORE
echo "  API port: ${API_PORT:-3001}"
# AFTER
echo "  API port: ${API_PORT:-9998}"
```

**#5 — Make UID/GID alignment non-fatal.** Lines 43-46, replace:

```bash
# BEFORE
        groupmod -g "${HOST_GID}" prreview
        usermod -u "${HOST_UID}" -g "${HOST_GID}" prreview
        # Reset ownership of files created under the old uid
        chown -R "${HOST_UID}:${HOST_GID}" "${TARGET_HOME}" /app 2>/dev/null || true
# AFTER
        if groupmod -g "${HOST_GID}" prreview 2>/dev/null && \
           usermod -u "${HOST_UID}" -g "${HOST_GID}" prreview 2>/dev/null; then
            # Reset ownership of files created under the old uid
            chown -R "${HOST_UID}:${HOST_GID}" "${TARGET_HOME}" /app 2>/dev/null || true
        else
            echo "[entrypoint] WARNING: could not align prreview uid/gid to ${HOST_UID}:${HOST_GID}; Claude credentials may be unreadable"
        fi
```

Keeps the mechanism; a failure now warns and continues instead of aborting boot
under `set -e`. The existing `userdel`/`groupdel || true` lines above stay.

**Verify:** `bash -n scripts/docker-entrypoint.sh` passes.

---

### SA-4 — owns `src/api/server.ts` + `.env.example` + `README.md`  (fixes #8, #3)

**#8 — Scope CORS.** In `src/api/server.ts`, replace line 67:

```typescript
// BEFORE
app.use(cors());
// AFTER
// CORS: the SPA is served same-origin in production, so cross-origin access is
// off by default there. In development the Vite dev server is a different
// origin, so allow it. Override anywhere with CORS_ORIGINS (comma-separated).
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
if (corsOrigins.length > 0) {
    app.use(cors({ origin: corsOrigins }));
} else if (process.env.NODE_ENV !== 'production') {
    app.use(cors({ origin: `http://localhost:${process.env.FRONTEND_PORT ?? 5173}` }));
}
// Production with no CORS_ORIGINS → no CORS middleware (same-origin only).
```

The `import cors from 'cors'` (line 2) stays. Must keep `npx tsc --noEmit` clean
and use no `any`.

**#3 — Port docs.** In `.env.example`, the `# ── Server ──` block (lines 22-24):

```bash
# BEFORE
# ── Server ──────────────────────────────────────────
API_PORT=3001
FRONTEND_PORT=5173
# AFTER
# ── Server ──────────────────────────────────────────
# API_PORT default: 3001 for local/dev; the production Docker image defaults to 9998.
API_PORT=3001
FRONTEND_PORT=5173
# CORS_ORIGINS (optional): comma-separated allowlist. Leave blank in production
# (SPA is served same-origin). Only needed for cross-origin API access.
CORS_ORIGINS=
```

In `README.md`:
- Line 50 — after "(default `3001`)" add a note that the production Docker image
  listens on `9998`.
- Line 67 table row — clarify `API_PORT` default is `3001` local / `9998` in the
  prod Docker image.
- Docker section (line 91-96) — one line noting the prod container serves on
  `9998` (SPA + API same-origin).

---

## Execution order

1. **Fan out** SA-1..SA-4 in a single message (parallel, disjoint files).
2. **Verify (inline or SA-5):**
   - `npx tsc --noEmit` — server.ts CORS change compiles clean.
   - `npm run build`.
   - `docker compose -f docker-compose.yml config` and `-f docker-compose.dev.yml config` — YAML + port interpolation sanity.
   - `git diff` — port value identical across all files; no stray edits; auth mount unchanged.
3. **Adversarial review subagent:** confirm
   - runtime image copies `node_modules` only from `prod-deps` (no dev deps),
   - port is uniform (9998 prod / 3001 dev) across every file,
   - the RW auth mount is unchanged (only its comment),
   - the entrypoint UID block cannot abort boot,
   - CORS is closed in prod-with-no-allowlist.

## What we are NOT doing
- Not changing the RW Claude-auth mount (required) — only its misleading comment.
- Not adding API auth/TLS (#1) or native-build tooling (#6).
- Not restructuring the dev bind-mount / anonymous-volume pattern.

## Review

Executed subagent-driven: four parallel `general-purpose` agents on disjoint
files (Dockerfile / compose / entrypoint / server.ts+docs), then an adversarial
review agent. All six fixes landed; no cross-file conflicts.

**Shipped:**
- **#2** — new `prod-deps` stage (`npm ci --omit=dev`); runtime `node_modules`
  now sourced only from it. Runtime image no longer ships typescript/tsx/vitest.
- **#3** — port unified: 9998 prod (Dockerfile ENV/EXPOSE, compose ports +
  healthcheck, entrypoint summary), 3001 dev; `.env.example` + README clarified.
- **#4** — corrected the false "read-only" auth-mount comment (mount unchanged).
- **#5** — entrypoint UID/GID alignment wrapped so a `groupmod`/`usermod` failure
  warns and continues instead of aborting boot under `set -e`.
- **#7** — healthcheck `start_period` 15s → 40s.
- **#8** — `app.use(cors())` → `CORS_ORIGINS` allowlist; no CORS in prod
  (same-origin SPA), Vite origin allowed in dev.

**Verification (all green):** `npx tsc --noEmit`, `npm run build`,
`docker compose config` (prod + dev), `bash -n` entrypoint, `git diff` scope +
port-grep. Adversarial reviewer confirmed: no dev-dep leak, mounts byte-for-byte
unchanged, entrypoint boot-safe, CORS closed in prod, no runtime dep on a
devDependency, scope limited to the six files.

**Known nuance (by design, not a bug):** prod compose uses `env_file: .env`, so a
`.env` copied from `.env.example` (which sets `API_PORT=3001`) makes the prod
container run on 3001, not 9998 — the Dockerfile's `ENV API_PORT=9998` is only the
unset fallback. Everything stays internally consistent (ports/healthcheck/binding
all derive from the same `${API_PORT}`). Documented in `.env.example`.

**Out of scope (unchanged):** #1 (API auth/TLS), #6 (native-build tooling).

**Not committed** — left in the working tree for review.
