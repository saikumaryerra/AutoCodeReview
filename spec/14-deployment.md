## 14. Deployment (Docker)

The entire application — backend, frontend, Claude CLI, and all dependencies — runs inside a single Docker container. Docker Compose orchestrates the build, environment configuration, and volume management so that deploying the system is a single-command operation.

### 14.1 Why a Single Container

This application is a single Node.js process that runs the API server, the poller, and the reviewer together. There is no benefit to splitting these into separate containers because they share an in-memory queue and a SQLite database file (which cannot be shared across containers safely). The Claude CLI is also a local binary that needs filesystem access to the cloned repos. A single container keeps all of this simple and avoids inter-container networking and volume-sharing complexity.

### 14.2 Dockerfile (Production Multi-Stage Build)

```dockerfile
# ============================================================
# Stage 1: Build the backend and frontend
# ============================================================
FROM node:20-slim AS builder

WORKDIR /app

# -- Backend dependencies --
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

# -- Frontend dependencies --
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

# -- Backend source and compile --
COPY src/ ./src/
RUN npm run build

# -- Frontend source and compile --
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ============================================================
# Stage 2: Production runtime image
# ============================================================
FROM node:20-slim AS runtime

# -- System dependencies --
# Git is required for cloning and diffing repos.
# curl and unzip are needed to install Claude CLI.
RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl unzip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# -- Install Claude CLI --
# Claude CLI is installed via npm globally. The specific install method
# may change — check https://docs.anthropic.com for the latest instructions.
# The entrypoint script will verify the installation at startup.
RUN npm install -g @anthropic-ai/claude-code

# -- Create non-root user --
# The app runs as a non-root user for security. The data directories
# are created here and owned by this user.
RUN groupadd -r prreview && useradd -r -g prreview -m -s /bin/bash prreview && \
    mkdir -p /app/data/repos /app/data/logs && \
    chown -R prreview:prreview /app

WORKDIR /app

# -- Copy build artifacts from builder stage --
COPY --from=builder --chown=prreview:prreview /app/dist/ ./dist/
COPY --from=builder --chown=prreview:prreview /app/frontend/dist/ ./frontend/dist/
COPY --from=builder --chown=prreview:prreview /app/node_modules/ ./node_modules/
COPY --from=builder --chown=prreview:prreview /app/package.json ./

# -- Copy entrypoint script --
COPY --chown=prreview:prreview scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# -- Declare the volume mount point for persistent data --
# This is where the SQLite DB, cloned repos, and log files live.
# A Docker volume ensures data survives container restarts and upgrades.
VOLUME ["/app/data"]

# -- Default environment --
ENV NODE_ENV=production
ENV DB_PATH=/app/data/reviews.db
ENV REPOS_DIR=/app/data/repos
ENV API_PORT=3001

EXPOSE 3001

USER prreview

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
```

### 14.3 Docker Entrypoint Script (`scripts/docker-entrypoint.sh`)

The entrypoint script runs before the application starts. Its job is to validate that the environment is correctly configured, that Claude CLI is installed and authenticated, and that the data directories exist with correct permissions.

```bash
#!/bin/bash
set -e

echo "=== PR Review System — Container Startup ==="

# ── Verify Claude CLI installation ──
if ! command -v claude &> /dev/null; then
    echo "ERROR: Claude CLI (claude) is not installed or not in PATH."
    echo "The Docker image should have installed it. Check the Dockerfile."
    exit 1
fi

echo "Claude CLI version: $(claude --version 2>/dev/null || echo 'unknown')"

# ── Verify Claude CLI authentication ──
# Claude CLI stores its auth config in ~/.claude/. If the container was
# started without mounting the auth config, claude will not be authenticated.
# We do a lightweight check here — the actual auth validation happens when
# the first review runs, but this gives an early warning.
CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ ! -d "$CLAUDE_CONFIG_DIR" ]; then
    echo "WARNING: Claude CLI config directory ($CLAUDE_CONFIG_DIR) not found."
    echo "Claude CLI may not be authenticated. Make sure to mount your"
    echo "Claude CLI credentials via a volume or environment variable."
    echo "See: ANTHROPIC_API_KEY environment variable or mount ~/.claude/"
fi

# ── Ensure data directories exist ──
mkdir -p /app/data/repos /app/data/logs

# ── Verify required environment variables ──
# The application's config.ts does full validation, but we check the basics
# here for a friendlier startup error message.
if [ -z "$GITHUB_TOKEN" ] && [ -z "$AZURE_DEVOPS_TOKEN" ]; then
    echo "WARNING: Neither GITHUB_TOKEN nor AZURE_DEVOPS_TOKEN is set."
    echo "At least one provider token is required."
fi

echo "Data directory: /app/data"
echo "Database path: ${DB_PATH:-/app/data/reviews.db}"
echo "API port: ${API_PORT:-3001}"
echo "=== Starting application ==="

# ── Execute the main command (passed as CMD) ──
exec "$@"
```

### 14.4 Docker Compose — Production (`docker-compose.yml`)

This is the primary deployment method. A single `docker compose up -d` brings the entire system online.

```yaml
# docker-compose.yml — Production deployment

services:
  pr-review:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: pr-review-system
    restart: unless-stopped

    ports:
      - "${API_PORT:-3001}:3001"       # Web UI and API

    env_file:
      - .env                           # All configuration from .env file

    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/reviews.db
      - REPOS_DIR=/app/data/repos

    volumes:
      # ── Persistent data ──
      # The "pr-review-data" volume stores the SQLite database, cloned repos,
      # and log files. This volume survives container rebuilds and restarts,
      # so review history is never lost.
      - pr-review-data:/app/data

      # ── Claude CLI authentication ──
      # Mount the host's Claude CLI config so the container can authenticate.
      # Option A: Mount the config directory (contains session tokens)
      - ${HOME}/.claude:/home/prreview/.claude:ro

      # Option B (alternative): If using ANTHROPIC_API_KEY instead of
      # interactive auth, just set it in .env and remove the volume above.
      # The application passes this env var through to the claude CLI process.

    # ── Health check ──
    # Pings the status endpoint every 30 seconds. If it fails 3 times in a
    # row, Docker marks the container as unhealthy (useful for orchestrators).
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/v1/status"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s

    # ── Resource limits ──
    # Claude CLI can be memory-intensive when analyzing large repos.
    # Adjust these based on the size of the repos being reviewed.
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: "2.0"
        reservations:
          memory: 1G
          cpus: "0.5"

    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"

volumes:
  # Named volume for persistent data — survives container rebuilds
  pr-review-data:
    driver: local
```

### 14.5 Docker Compose — Development (`docker-compose.dev.yml`)

The development compose file mounts the local source code into the container so changes are reflected immediately via hot-reload. It does not use the multi-stage build — instead it runs `tsx --watch` directly.

```yaml
# docker-compose.dev.yml — Development with hot-reload

services:
  pr-review-dev:
    build:
      context: .
      dockerfile: Dockerfile.dev
    container_name: pr-review-dev
    restart: unless-stopped

    ports:
      - "3001:3001"     # Backend API
      - "5173:5173"     # Vite dev server (frontend)

    env_file:
      - .env

    environment:
      - NODE_ENV=development
      - DB_PATH=/app/data/reviews.db
      - REPOS_DIR=/app/data/repos

    volumes:
      # ── Source code (hot-reload) ──
      # Mount the entire project so code changes are picked up immediately.
      # node_modules are excluded via a named volume to avoid host/container
      # mismatch (different OS, different native binaries).
      - .:/app
      - /app/node_modules
      - /app/frontend/node_modules

      # ── Persistent dev data ──
      - pr-review-dev-data:/app/data

      # ── Claude CLI auth ──
      - ${HOME}/.claude:/home/prreview/.claude:ro

volumes:
  pr-review-dev-data:
    driver: local
```

### 14.6 Development Dockerfile (`Dockerfile.dev`)

```dockerfile
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl unzip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# Create user
RUN groupadd -r prreview && useradd -r -g prreview -m -s /bin/bash prreview && \
    mkdir -p /app/data/repos /app/data/logs && \
    chown -R prreview:prreview /app

WORKDIR /app

# Install dependencies (will be overridden by volume mount, but needed for first build)
COPY package.json package-lock.json ./
RUN npm install

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm install

COPY . .

RUN chown -R prreview:prreview /app

USER prreview

EXPOSE 3001 5173

# Run both backend (tsx watch) and frontend (vite dev) concurrently
# Uses npx concurrently to manage both processes
CMD ["npx", "concurrently", \
     "--names", "api,ui", \
     "--prefix-colors", "blue,green", \
     "npx tsx watch src/index.ts", \
     "cd frontend && npx vite --host 0.0.0.0"]
```

### 14.7 `.dockerignore`

```
node_modules/
frontend/node_modules/
dist/
frontend/dist/
data/
.env
.git/
*.log
.DS_Store
```

### 14.8 Claude CLI Authentication in Docker

This is the trickiest part of the Docker setup because Claude CLI needs to be authenticated, and there are three ways to handle this depending on your environment.

**Option A — Mount the host's Claude config directory (recommended for single-server deployments):**

Run `claude` interactively on the host machine once to complete authentication. This creates a `~/.claude/` directory containing session tokens. Mount this directory read-only into the container as shown in the docker-compose files above. This is the simplest approach and works well for a single deployment.

**Option B — Pass `ANTHROPIC_API_KEY` as an environment variable (recommended for CI/CD and headless environments):**

If you have a direct Anthropic API key, set it as an environment variable. Claude CLI will use this key automatically without needing interactive authentication. Add it to your `.env` file:

```bash
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
```

Then in `docker-compose.yml`, ensure it is passed through:

```yaml
environment:
  - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
```

This is the preferred approach for automated/headless deployments because it has no dependency on a host filesystem path.

**Option C — Docker secrets (recommended for Swarm / orchestrated environments):**

For Docker Swarm or Kubernetes deployments, use the platform's secrets management to inject the API key. In Swarm:

```yaml
services:
  pr-review:
    secrets:
      - anthropic_api_key
    environment:
      - ANTHROPIC_API_KEY_FILE=/run/secrets/anthropic_api_key

secrets:
  anthropic_api_key:
    external: true
```

The entrypoint script would read the secret file and export it as an environment variable before starting the application.

### 14.9 Deployment Commands

All deployment operations are single commands from the project root:

```bash
# ── First-time setup ──
cp .env.example .env
# Edit .env with your tokens and repo list

# ── Production: build and start ──
docker compose up -d --build

# ── Production: view logs ──
docker compose logs -f pr-review

# ── Production: stop ──
docker compose down

# ── Production: stop and remove data (WARNING: deletes all review history) ──
docker compose down -v

# ── Production: rebuild after code changes ──
docker compose up -d --build

# ── Development: start with hot-reload ──
docker compose -f docker-compose.dev.yml up --build

# ── Check health ──
docker inspect --format='{{.State.Health.Status}}' pr-review-system

# ── Shell into running container for debugging ──
docker exec -it pr-review-system bash

# ── Backup the database ──
docker cp pr-review-system:/app/data/reviews.db ./backup-reviews.db
```

### 14.10 Upgrading

To upgrade the application to a new version without losing data:

```bash
# Pull latest code
git pull origin main

# Rebuild and restart — the pr-review-data volume is NOT affected
docker compose up -d --build
```

Because the SQLite database lives on a named Docker volume (`pr-review-data`), it survives container rebuilds. The `docker compose down` command (without `-v`) stops and removes the container but preserves the volume. Only `docker compose down -v` destroys the data volume.

### 14.11 Non-Docker Deployment (Alternative)

For environments where Docker is not available, the application can be run directly on the host machine. The host needs **Node.js >= 20**, **Git**, and **Claude CLI (authenticated)** installed.

```bash
# Clone and install
git clone <repo-url> pr-review-system
cd pr-review-system
npm install && cd frontend && npm install && cd ..

# Configure
cp .env.example .env
# Edit .env

# Build
npm run build && cd frontend && npm run build && cd ..

# Create data directories
mkdir -p data/repos data/logs

# Start (production)
node dist/index.js

# Or use pm2 for auto-restart
pm2 start dist/index.js --name pr-review
```

For development without Docker, run the backend and frontend separately:

```bash
# Terminal 1: Backend with hot-reload
npm run dev

# Terminal 2: Frontend with Vite dev server
cd frontend && npm run dev
```

The Vite config must include a proxy rule so the frontend can reach the backend during development:

```typescript
// frontend/vite.config.ts
export default defineConfig({
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:3001'
        }
    }
});
```

---
