# ============================================================================
# AutoCodeReview — Production Multi-Stage Dockerfile
# ============================================================================
# Stage 1 (builder): Installs deps and compiles both backend (tsc) and
#   frontend (vite build) into static artifacts.
# Stage 2 (runtime): Minimal image with only production deps, compiled
#   output, git (for cloning repos), and Claude CLI.
# ============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app

# Backend dependencies — cached unless package files change
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

# Frontend dependencies — cached independently
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

# Compile backend TypeScript to dist/
COPY src/ ./src/
RUN npm run build

# Build frontend SPA to frontend/dist/
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ---------------------------------------------------------------------------
# Stage 2: Runtime
# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime

# Install runtime system dependencies:
#   git   — required to clone and checkout PR branches
#   curl  — healthcheck probe and general debugging
#   unzip — some Claude CLI install paths need it
#   ca-certificates — HTTPS connectivity
RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl unzip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install Claude CLI globally — the core review engine
RUN npm install -g @anthropic-ai/claude-code

# Create a non-root user for runtime security (Principle of Least Privilege)
RUN groupadd -r prreview && \
    useradd -r -g prreview -m -s /bin/bash prreview && \
    mkdir -p /app/data/repos /app/data/logs && \
    chown -R prreview:prreview /app

WORKDIR /app

# Copy compiled backend, frontend build, production node_modules, and manifest
COPY --from=builder --chown=prreview:prreview /app/dist/ ./dist/
COPY --from=builder --chown=prreview:prreview /app/frontend/dist/ ./frontend/dist/
COPY --from=builder --chown=prreview:prreview /app/node_modules/ ./node_modules/
COPY --from=builder --chown=prreview:prreview /app/package.json ./

# Copy and prepare the entrypoint script
COPY --chown=prreview:prreview scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Persistent data volume: SQLite DB, cloned repos, logs
VOLUME ["/app/data"]

# Runtime environment defaults
ENV NODE_ENV=production
ENV DB_PATH=/app/data/reviews.db
ENV REPOS_DIR=/app/data/repos
ENV API_PORT=3001

EXPOSE 3001

# Run as non-root
USER prreview

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
