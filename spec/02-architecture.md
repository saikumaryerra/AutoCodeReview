## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                         PR Review System                              │
│                                                                       │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │  Poller      │───▶│ Review Engine │───▶│  SQLite Database         │  │
│  │  (cron-based)│    │ (Claude CLI)  │    │                          │  │
│  └──────┬───────┘    └──────────────┘    └───────────┬──────────────┘  │
│         │                                            │                 │
│         │ GitProvider Interface                       │                 │
│         ▼                                            ▼                 │
│  ┌─────────────────────────┐              ┌──────────────────────┐    │
│  │  Provider Implementations│              │  Express API Server   │    │
│  │  ┌─────────┬───────────┐│              └──────────┬───────────┘    │
│  │  │ GitHub  │ Azure     ││                         │                 │
│  │  │ Client  │ DevOps    ││              ┌──────────▼───────────┐    │
│  │  │         │ Client    ││              │  React Frontend       │    │
│  │  └─────────┴───────────┘│              │  (Vite + SPA)         │    │
│  └─────────────────────────┘              └──────────────────────┘    │
└───────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Breakdown

The system consists of five major components, each of which becomes a distinct module in the codebase:

**Poller Service** — A background process that runs on a configurable interval (default: every 2 minutes). It iterates over all tracked repositories, uses the appropriate **GitProvider** implementation (GitHub or Azure DevOps) to list open PRs and their commits, compares the latest commit SHA against what has already been reviewed, and enqueues any new work into a review queue. The poller is the only component that talks to external git hosting APIs.

**Review Engine** — The core of the system. When a new commit needs reviewing, this component checks out the correct branch locally, then spawns a `claude` CLI process in non-interactive mode with a carefully crafted prompt. It captures Claude CLI's stdout, parses the structured review output (JSON), and writes it to the database. Reviews are performed one at a time to avoid overwhelming the system.

**Database Layer** — SQLite via `better-sqlite3` for zero-configuration persistence. The schema is designed so that every review is uniquely identified by the combination of `(repository, pr_number, commit_sha)`. This means you can look up exactly what Claude said about any specific commit on any PR.

**API Server** — An Express.js REST API that the frontend calls. It provides endpoints for listing reviews, fetching a specific review by PR number, fetching a review by commit SHA, and getting system status (polling health, queue depth, etc.).

**Frontend** — A React single-page application built with Vite. It provides a dashboard of recent reviews, a search/filter interface, and a detailed review viewer that renders Claude's feedback with syntax-highlighted code snippets.

---
