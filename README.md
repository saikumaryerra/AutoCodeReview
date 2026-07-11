# AutoCodeReview

AI-powered pull request review system. It polls your GitHub and Azure DevOps repositories for open PRs, runs a structured code review using the **Claude CLI** on a local checkout of each PR, stores the results in SQLite, and serves them through a React dashboard. Reviews can optionally be posted back to the PR as a summary comment.

## How It Works

```
Poller (cron)  ──▶  Queue  ──▶  Reviewer (Claude CLI on local checkout)  ──▶  SQLite  ──▶  API  ──▶  React UI
```

1. The **poller** checks each configured repo on an interval for open PRs and new commits.
2. New/updated PRs are enqueued and reviewed **one at a time** to avoid overloading the host.
3. The **reviewer** clones/updates the repo locally and spawns the `claude` CLI so it can read the full project — follow imports, grep, and glob — for a deeper review than a raw diff allows.
4. Structured findings (severity, file, line, message) are parsed and stored in SQLite.
5. The **API** and **React frontend** expose the reviews; results can be posted back to the PR.

Each review is uniquely identified by `(repository, pr_number, commit_sha)`.

## Tech Stack

- **Backend:** TypeScript, Node.js ≥ 20, Express, better-sqlite3, Zod, Winston, node-cron
- **Frontend:** React 18, Vite, TailwindCSS, React Query, React Router
- **Providers:** GitHub (Octokit), Azure DevOps (azure-devops-node-api)
- **Testing:** Vitest
- **External requirement:** the `claude` CLI must be installed and available in `PATH`

## Prerequisites

- Node.js ≥ 20
- The [Claude CLI](https://docs.claude.com/en/docs/claude-code) installed and authenticated (`claude` in your `PATH`)
- A GitHub Personal Access Token (`repo` scope) and/or an Azure DevOps PAT (Code: Read)

## Getting Started

```bash
# 1. Install backend dependencies
npm install

# 2. Install frontend dependencies
cd frontend && npm install && cd ..

# 3. Configure environment
cp .env.example .env   # then edit .env (see Configuration below)

# 4. Run in development (hot-reload)
npm run dev            # backend
cd frontend && npm run dev   # frontend (separate terminal)
```

The backend serves the API on `API_PORT` (default `3001`); the Vite dev server runs on `FRONTEND_PORT` (default `5173`).

## Configuration

Configure at least one provider (GitHub or Azure DevOps) in `.env`. See [.env.example](.env.example) for the full list.

| Variable | Description | Default |
| --- | --- | --- |
| `GITHUB_TOKEN` | GitHub PAT with `repo` scope | — |
| `GITHUB_REPOS` | Comma-separated `owner/repo` list | — |
| `AZURE_DEVOPS_TOKEN` | Azure DevOps PAT (Code: Read) | — |
| `AZURE_DEVOPS_ORG_URL` | e.g. `https://dev.azure.com/myorg` | — |
| `AZURE_DEVOPS_REPOS` | Comma-separated `Project/Repo` list | — |
| `POLL_INTERVAL_SECONDS` | How often to poll for PRs | `3600` |
| `CLAUDE_CLI_PATH` | Path to the `claude` binary | `claude` |
| `CLAUDE_REVIEW_TIMEOUT_SECONDS` | Max time per review | `300` |
| `CLAUDE_MODEL` | Specific model to pass to the CLI (blank = default) | — |
| `API_PORT` / `FRONTEND_PORT` | Server ports | `3001` / `5173` |
| `DB_PATH` / `REPOS_DIR` | SQLite file and local clone directory | `./data/reviews.db` / `./data/repos` |
| `PR_STATE_FILTER` | Which PR states to review (`open`/`closed`/`all`) | `open` |
| `SKIP_DRAFTS` | Skip draft PRs | `true` |
| `MAX_FILES_CHANGED` / `MAX_DIFF_SIZE` | Skip oversized PRs | `50` / `100000` |
| `REVIEW_RETRY_ENABLED` / `REVIEW_MAX_RETRY_ATTEMPTS` | Retry failed reviews | `true` / `10` |
| `REVIEW_RETENTION_DAYS` | Auto-delete reviews older than N days (`0` = keep forever) | `90` |

**Two-tier config:** environment variables set the defaults, and the settings table allows UI-driven overrides at runtime without a restart.

## Scripts

```bash
npm run dev        # run backend with hot-reload
npm run build      # compile TypeScript to dist/
npm start          # run compiled build
npm test           # run the Vitest suite
npm run typecheck  # type-check without emitting

# Frontend (in frontend/)
npm run dev        # Vite dev server
npm run build      # production build
```

## Docker

```bash
docker compose up                              # production
docker compose -f docker-compose.dev.yml up    # development
```

## Project Structure

```
src/              # Backend
  database/       # SQLite schema, connection, repositories
  config/         # Env + runtime config (Zod)
  poller/         # PR polling, GitProvider implementations, queue, retry
  reviewer/       # Claude CLI executor, repo manager, prompt, parser, comment formatter
  api/            # Express server, routes, middleware
  shared/         # Types, logger, errors
  utils/          # Git & shell helpers
frontend/         # React SPA (Dashboard, PR Detail, Review Detail, Search, Settings)
spec/             # Design & specification documents (01–17)
data/             # Runtime: SQLite DB + local clones (not committed)
```

## API

REST endpoints are grouped under `src/api/routes/`: `status`, `repos`, `prs`, `reviews`, `poll`, `settings`, and `cleanup`. Notably, `POST /reviews/:id/post-comment` posts a review summary back to the PR (GitHub and Azure DevOps), upserting an existing AutoCodeReview comment if one is present.

## Roadmap

Planned enhancements (see [spec/17-future-enhancements.md](spec/17-future-enhancements.md)):

- Automatic / inline (line-level) review comments and GitHub Check Runs
- Webhook receiver as a lower-latency alternative to polling
- Custom per-repo review rules
- Slack/email notifications for critical findings
- GitLab and Bitbucket providers
- Review diffing across commits, team analytics, and multi-user auth

## License

Released under the [MIT License](LICENSE).
