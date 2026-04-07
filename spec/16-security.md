## 16. Security Considerations

**GitHub Token Scope:** The token needs only `repo` read access. It should not have write permissions — this application never pushes code, merges PRs, or creates comments on GitHub. If the team wants to post review comments back to GitHub in a future version, that would require a separate token with write access, gated behind its own config flag.

**Azure DevOps Token Scope:** The PAT needs only `Code (Read)` scope. Like the GitHub token, it should have the minimum permissions necessary. Azure DevOps PATs are scoped to an organization, so each org requires its own token.

**Claude CLI Permissions:** The `--allowedTools` flag is critical. The application explicitly restricts Claude CLI to read-only tools: `View`, `GlobTool`, `GrepTool`, and `BatchTool`. This means even if the prompt were somehow manipulated (e.g., through a malicious PR that contains prompt injection in its code), Claude cannot write files, execute commands, or make network requests. This is a defense-in-depth measure.

**Docker Security:**

The container runs as a non-root user (`prreview`) to limit the blast radius if the process is compromised. The Claude CLI config directory is mounted read-only (`:ro`) so the container cannot modify the host's authentication state. Resource limits in the compose file prevent a runaway review from consuming all host memory or CPU. The API port (3001) is the only port exposed — if the container is deployed behind a reverse proxy (nginx, Traefik, Caddy), the port binding can be restricted to `127.0.0.1:3001:3001` so the app is only reachable through the proxy.

Secrets (GitHub tokens, Azure DevOps PATs, Anthropic API keys) are passed via the `.env` file or environment variables — they are never baked into the Docker image. The `.dockerignore` file excludes `.env` from the build context to prevent accidental inclusion in image layers. For production deployments using Docker Swarm or Kubernetes, use the platform's secrets management (Docker secrets, Kubernetes secrets) instead of environment variables.

**SQLite File Permissions:** Inside the container, the database file is owned by the `prreview` user and is not accessible to other users. On the host, the Docker volume's contents are owned by the UID of the `prreview` user inside the container.

**No Secrets in Logs:** The logger must never log the GitHub token, Azure DevOps PAT, or any API keys. The raw Claude CLI output is stored in the database (for debugging) but is not included in log files. Docker logging is capped at 50MB with 5 rotated files to prevent disk exhaustion.

**Input Validation:** All API inputs are validated with Zod schemas before processing. PR numbers must be positive integers, commit SHAs must be valid hex strings, repo names must match the `owner/repo` or `project/repo` pattern, and the `provider` field must be one of the known enum values.

---
