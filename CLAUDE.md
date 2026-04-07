# CLAUDE.md

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
# Install dependencies
npm install

# Run in development (hot-reload)
npm run dev

# Build
npm run build

# Run tests
npx vitest

# Run single test file
npx vitest src/path/to/test.ts

# Type check
npx tsc --noEmit

# Docker (production)
docker compose up

# Docker (development)
docker compose -f docker-compose.dev.yml up
```

## Key Architecture Decisions

- **Claude CLI over API:** The system spawns `claude` CLI on local repo checkouts so it can read full project structure, follow imports, and use built-in tools (grep, glob) for deeper reviews.
- **Provider-agnostic design:** All git hosting logic is behind the `GitProvider` interface (`src/poller/provider.interface.ts`). The reviewer, database, API, and frontend are provider-agnostic.
- **Review identity:** Each review is uniquely identified by `(repository, pr_number, commit_sha)`.
- **Two-tier config:** Environment variables set defaults; the settings table allows UI-driven overrides without restart.
- **Sequential reviews:** Reviews are processed one at a time from an in-memory queue to avoid system overload.

## Coding Conventions

- All code is TypeScript — no plain JavaScript files
- Use Zod for all validation (request bodies, config, external data)
- Use Winston for logging with module-level tags
- Custom error classes in `src/shared/errors.ts` for domain errors
- Express error handling through global middleware, not per-route try/catch
- SQLite queries in repository classes, not scattered across services

## Spec Reference

The full specification lives in `spec/` (files 01 through 17). When implementing a feature, check the relevant spec file first — it contains exact interfaces, schemas, API contracts, and component behaviors.

**Do NOT modify any files in `spec/`.** The spec documents are the source of truth and must remain unchanged. If implementation reveals needed spec changes (corrections, clarifications, or additions), log them in `spec_change_log.md` at the project root instead of editing the spec files directly.
