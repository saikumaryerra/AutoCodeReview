## 4. Directory & File Structure

```
pr-review-system/
├── package.json                    # Root workspace config
├── tsconfig.json                   # Base TypeScript config
├── .env.example                    # Template for environment variables
├── README.md                       # Setup and usage instructions
├── Dockerfile                      # Multi-stage production image
├── Dockerfile.dev                  # Development image with hot-reload
├── docker-compose.yml              # Production deployment (single command)
├── docker-compose.dev.yml          # Development with volume mounts and hot-reload
├── .dockerignore                   # Excludes node_modules, data/, .env, .git
│
├── src/
│   ├── index.ts                    # Application entry point — starts all services
│   │
│   ├── database/
│   │   ├── schema.ts               # SQLite table definitions and migrations
│   │   ├── connection.ts           # Database singleton and initialization
│   │   ├── reviews.repository.ts   # All review CRUD operations
│   │   ├── repos.repository.ts     # Tracked repository CRUD operations
│   │   ├── settings.repository.ts  # CRUD for the settings table (UI-editable config)
│   │   └── cleanup.repository.ts   # Retention cleanup queries (delete old reviews + seen_commits)
│   │
│   ├── config/
│   │   ├── config.ts               # Reads .env, merges with DB overrides, exports live config
│   │   ├── config.service.ts       # Runtime config manager — applies UI changes without restart
│   │   └── config.schema.ts        # Zod schemas for all config keys + metadata (descriptions, types, editable flag)
│   │
│   ├── poller/
│   │   ├── poller.service.ts       # Cron-based polling loop
│   │   ├── provider.interface.ts   # GitProvider interface — the abstraction contract
│   │   ├── github.provider.ts      # GitHub implementation of GitProvider (uses Octokit)
│   │   ├── azuredevops.provider.ts # Azure DevOps implementation of GitProvider
│   │   ├── provider.factory.ts     # Factory: returns the right provider for a given repo config
│   │   ├── queue.ts                # In-memory review job queue
│   │   └── reconciliation.ts      # Startup reconciliation — re-enqueues orphaned reviews
│   │
│   ├── reviewer/
│   │   ├── reviewer.service.ts     # Orchestrates the review process
│   │   ├── claude-cli.executor.ts  # Spawns claude CLI and captures output
│   │   ├── repo-manager.ts         # Local git clone/checkout management
│   │   ├── prompt.ts               # The review prompt template sent to Claude
│   │   └── parser.ts               # Parses Claude CLI output into structured data
│   │
│   ├── api/
│   │   ├── server.ts               # Express app setup and middleware
│   │   ├── routes/
│   │   │   ├── reviews.routes.ts   # GET /reviews, GET /reviews/:prNumber, etc.
│   │   │   ├── repos.routes.ts     # CRUD for tracked repositories
│   │   │   ├── settings.routes.ts  # GET/PATCH settings, config management from UI
│   │   │   ├── cleanup.routes.ts   # POST cleanup trigger, GET preview
│   │   │   └── status.routes.ts    # System health and queue status
│   │   └── middleware/
│   │       ├── error-handler.ts    # Global error handling middleware
│   │       └── validate.ts         # Zod-based request validation
│   │
│   ├── shared/
│   │   ├── types.ts                # Shared TypeScript interfaces and types
│   │   ├── logger.ts               # Winston logger configuration
│   │   └── errors.ts               # Custom error classes
│   │
│   └── utils/
│       ├── git.ts                  # Git command helpers (clone, checkout, pull)
│       └── shell.ts                # Generic child_process wrapper with timeout
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── index.html
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx                # React entry point
│       ├── App.tsx                 # Router and layout
│       ├── api/
│       │   └── client.ts           # Axios instance and API call functions
│       ├── hooks/
│       │   ├── useReviews.ts       # React Query hook for fetching reviews
│       │   └── useStatus.ts        # Hook for system status polling
│       ├── pages/
│       │   ├── Dashboard.tsx       # Landing page — recent reviews, stats
│       │   ├── PRDetail.tsx        # All reviews for a specific PR number
│       │   ├── ReviewDetail.tsx    # Single review (PR + commit) full view
│       │   ├── Search.tsx          # Search by PR number, commit SHA, repo
│       │   └── Settings.tsx        # View/manage tracked repositories
│       ├── components/
│       │   ├── Layout.tsx          # App shell with sidebar/header
│       │   ├── ReviewCard.tsx      # Compact review summary card
│       │   ├── ReviewBody.tsx      # Full review renderer with code blocks
│       │   ├── SeverityBadge.tsx   # Color-coded severity indicator
│       │   ├── SearchBar.tsx       # Unified search input component
│       │   ├── PRTimeline.tsx      # Commit-by-commit review history for a PR
│       │   ├── StatusIndicator.tsx # Polling health dot
│       │   └── EmptyState.tsx      # Friendly empty/no-results view
│       └── styles/
│           └── globals.css         # Tailwind base + custom styles
│
├── data/                           # Created at runtime, persisted via Docker volume
│   ├── reviews.db                  # SQLite database file
│   └── repos/                      # Local git clones live here
│       ├── github__owner__repo/    # One folder per tracked repo (provider-prefixed)
│       └── ...
│
└── scripts/
    ├── setup.sh                    # One-command project setup
    ├── docker-entrypoint.sh        # Container entrypoint — validates Claude CLI, starts app
    └── seed.ts                     # Optional: seed DB with sample data for dev
```

---
