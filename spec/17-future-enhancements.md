## 17. Future Enhancements (Out of Scope for V1)

These features are explicitly **not** part of the initial build but should be kept in mind during architecture so they can be added later without major refactoring:

- **Post review comments back to GitHub/Azure DevOps** as PR review comments or check runs.
- **GitLab and Bitbucket support** — the `GitProvider` interface is already in place, so adding new providers is a matter of implementing the interface.
- **Webhook receiver** as an alternative to polling, for lower latency on repositories that support it.
- **Review diffing** — show what changed between two reviews on the same PR.
- **Team analytics** — aggregate review data per author, per repo, per time period.
- **Custom review rules** — let teams provide additional review instructions (e.g., "always check for SQL injection in this repo").
- **Notification system** — send Slack/email alerts when a critical review is found.
- **Multi-user auth** — add login and role-based access to the web UI.
- **Horizontal scaling** — replace SQLite with Postgres and the in-memory queue with Redis to support multiple container replicas.

---

## End of Specification

This document contains everything needed to generate the complete codebase. Each section maps directly to one or more source files in the directory structure defined in Section 4. The implementation should follow the TypeScript interfaces exactly as defined, use the database schema as written, implement every API endpoint described, and build the frontend pages with the specified components and behaviors.
