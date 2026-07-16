# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AutoCodeReview is an AI-powered pull request review system. It polls GitHub and Azure DevOps repositories for open PRs, uses Claude CLI to perform structured code reviews on local checkouts, stores results in SQLite, and serves them through a React frontend.

## Tech Stack

- **Backend:** TypeScript, Node.js >= 20, Express.js, better-sqlite3, Zod
- **Frontend:** React 18, Vite, TailwindCSS, React Query, React Router
- **Testing:** Vitest
- **External:** Claude CLI (must be installed and in PATH)
- **Git Providers:** GitHub (Octokit), Azure DevOps (azure-devops-node-api)

## Project Structure

```
src/              # Backend source
  database/       # SQLite schema, connection, repositories
  config/         # Environment + runtime config with Zod schemas
  poller/         # Cron-based PR polling, GitProvider interface + implementations, queue
  reviewer/       # Claude CLI executor, repo manager, prompt template, output parser
  api/            # Express server, routes, middleware
  shared/         # Types, logger, custom errors
  utils/          # Git and shell helpers
frontend/         # React SPA (Vite)
  src/pages/      # Dashboard, PRDetail, ReviewDetail, Search, Settings
  src/components/ # Layout, ReviewCard, ReviewBody, SeverityBadge, etc.
spec/             # Design & specification documents (01-17)
data/             # Runtime: SQLite DB + local git clones (not committed)
```

## Commands

```bash
# Install dependencies (backend and frontend are SEPARATE — install both)
npm install
cd frontend && npm install && cd ..

# Run in development (hot-reload; separate terminals)
npm run dev                    # backend API on API_PORT (default 3001)
cd frontend && npm run dev     # Vite dev server on FRONTEND_PORT (default 5173)

# Build
npm run build                  # backend (tsc → dist/)
cd frontend && npm run build   # frontend (tsc -b && vite build)

# Run tests (Vitest)
npm test                       # single run (vitest run)
npm run test:watch             # watch mode
npx vitest src/path/to/foo.test.ts   # single test file

# Type check
npm run typecheck              # tsc --noEmit

# Docker (production — image listens on 9998)
docker compose up

# Docker (development)
docker compose -f docker-compose.dev.yml up
```

> The Vitest config excludes `data/**` — those are gitignored runtime clones of
> the repos under review, and they carry their own test files that must never be
> collected by this project's run.

## Key Architecture Decisions

- **Claude CLI over API:** The system spawns `claude` CLI on local repo checkouts so it can read full project structure, follow imports, and use built-in tools (grep, glob) for deeper reviews.
- **Provider-agnostic design:** All git hosting logic is behind the `GitProvider` interface (`src/poller/provider.interface.ts`). The reviewer, database, API, and frontend are provider-agnostic.
- **Review identity:** Each review is uniquely identified by `(repository, pr_number, commit_sha)`.
- **Three-tier config:** `ConfigService` resolves each setting as repo override > DB global setting > env default. Env vars seed defaults; the `settings` table allows UI-driven global overrides without restart; `repo_settings` allows per-repo overrides. Live changes are pushed to consumers via `configService.onChange(...)` (e.g. the Claude model/timeout are updated on the running executors without a restart).
- **Sequential reviews:** Reviews are processed one at a time from an in-memory queue (`ReviewQueue`) to avoid overloading the host.

## Runtime Bootstrap (`src/index.ts`)

`main()` wires the whole system together in order, and this is the fastest way to understand how the pieces connect:

1. Load + validate config, verify the `claude` CLI is on PATH (reviews warn-and-fail without it), initialize the SQLite DB.
2. Construct repositories (one class per table) and the `ConfigService`.
3. Seed the `repos` table from `.env`, auto-detecting each repo's default branch via its provider.
4. **Startup reconciliation** (`reconcileOrphanedReviews`) re-enqueues any review left `in_progress` by a previous crash/shutdown.
5. Start the long-running services, all sharing the single `ReviewQueue`:
   - `ReviewerService.startProcessing()` — the continuous consumer loop (clone/update repo → run Claude CLI → parse → store).
   - `PollerService` — cron-based producer that finds new/updated PRs and enqueues them.
   - `RetryScheduler` — re-enqueues failed reviews whose backoff (`retry-policy.ts`) is due.
   - A daily cleanup cron: (1) delete reviews past `review.retentionDays`, (2) remove clones of untracked repos, (3) `git gc` active clones.
6. Start the Express API (`startApiServer`), which is handed every service/repo it needs by dependency injection.
7. **Graceful shutdown** on SIGTERM/SIGINT: stop producers, let the in-flight review drain (10s timeout), then close the DB — or exit without closing if the drain times out (SQLite is crash-safe; reconciliation recovers on next start).

## Coding Conventions

- Do not add `Co-Authored-By` lines for Claude in git commit messages
- All code is TypeScript — no plain JavaScript files
- Use Zod for all validation (request bodies, config, external data)
- Use Winston for logging with module-level tags
- Custom error classes in `src/shared/errors.ts` for domain errors
- Express error handling through global middleware, not per-route try/catch
- SQLite queries in repository classes, not scattered across services

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items.
2. **Verify Plan**: Check in before starting implementation.
3. **Track Progress**: Mark items complete as you go.
4. **Explain Changes**: High-level summary at each step.
5. **Document Results**: Add review section to `tasks/todo.md`.
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections.

## Demand Elegance (Balanced)

1. For non-trivial changes: pause and ask "is there a more elegant way?"
2. If a fix feels hacky: "Knowing everything I know now, implement the elegant solution."
3. Skip this for simple, obvious fixes — don't over-engineer.
4. Challenge your own work before presenting it.

## Verification & Blast Radius

1. **Verify Before Done**: Never mark a task complete without proving it works. Demonstrate correctness via logs, passing tests, or successful builds.
2. **Assess the Blast Radius**: Before altering any function, interface, or component, search the `src/` directory to identify every place it is used. Guarantee your changes don't break unrelated features.
3. **Update Tests**: Write or update unit/integration tests to cover new behavior or bug fixes whenever applicable.
4. **Diff Review**: Diff behavior between main and your changes to ensure no unintended side effects were introduced.

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.

## Spec Reference

The full specification lives in `spec/` (files 01 through 17). When implementing a feature, check the relevant spec file first — it contains exact interfaces, schemas, API contracts, and component behaviors.

**Do NOT modify any files in `spec/`.** The spec documents are the source of truth and must remain unchanged. If implementation reveals needed spec changes (corrections, clarifications, or additions), log them in `spec_change_log.md` at the project root instead of editing the spec files directly.

## Code Review Rules (enforced)

These rules are non-negotiable for any code review, refactor, or new code. They are imported below and loaded automatically:

@.claude/rules/decisions.md
