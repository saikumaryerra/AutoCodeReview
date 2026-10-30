# Lessons

## 2026-07-10 — Config/settings real-bug fixes

- **A "contract bug" can be a security bug in disguise.** During analysis I classified
  `POST /api/settings/:key/reset` accepting unknown keys as a mere contract nit and scoped it
  out. I missed that `reset()` *returns the value it restored* — so on an unauthenticated API
  it was leaking the raw PAT in cleartext. The Task 1 review caught it. Lesson: when a config
  path lacks a guard, trace what it *returns* and *logs*, not just what it validates.

- **"Masking" a secret in an API response is not protection.** `ghp_****wxyz` still discloses
  prefix, length class, and last four chars, and here it round-tripped through the UI input so
  the mask could be persisted as a credential. Omitting the value entirely (+ an `is_set`
  boolean) is the correct pattern for an unauthenticated read path.

- **Flipping a field to read-only can expose a worse bug elsewhere.** Making the tokens
  `editable: false` would have rendered the raw token as plaintext in the Settings page's
  read-only branch (`String(setting.current_value)`) had the backend still returned it. The
  backend omission (Task 1) and the frontend render (Task 3) had to land together, not
  independently. Watch for render paths that assume a field is safe to print.

- **On graceful shutdown, don't close a live DB handle — exiting is safer.** SQLite is
  crash-safe, so exiting mid-write and letting startup reconciliation re-enqueue is strictly
  safer than calling `db.close()` under an in-flight write. The instinct to "clean up on the
  way out" is wrong when cleanup races the work.

- **Check the SDD ledger's *identity*, not just its presence.** The `.superpowers/sdd/progress.md`
  at start belonged to a previous merged project; its "Task 1-9 complete" lines could have been
  mistaken for this plan's. Archive a stale ledger and stale task briefs/reports before starting,
  or a reviewer may read a prior project's report by mistake.

## 2026-10-29 — Regenerate 500

- **A Vitest hook that returns a function registers it as teardown.** `beforeEach(() => mock.mockReset())`
  returns the mock, which Vitest then *calls* after each test — with a rejecting mock this fails the
  test with the mock's own error. Use a block body in hooks.
- **Check stored secrets for whitespace before blaming expiry.** A "401 since today" looked like an
  expired PAT; it was a freshly pasted token with trailing spaces. Inspect length/char classes (never
  print the value) and retry trimmed before telling the user to rotate.
