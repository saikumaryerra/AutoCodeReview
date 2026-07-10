# Task: Claude model selection from the UI

## Goal
Let users pick which Claude model the reviewer uses, from the Settings UI,
applied at runtime (no restart) — via a dropdown of stable CLI aliases.

## Decision
- UI control: **dropdown of aliases** — `default`, `opus`, `sonnet`, `haiku`.
  `default` = no `--model` flag (CLI chooses). Consistent with the existing
  `review.prStateFilter` enum (raw lowercase values, no frontend change).
- Applied at runtime via the existing `configService.onChange(...)` pattern
  (same as the poller's interval) — `requiresRestart: false`.

## Plan
- [x] config.schema.ts: make `claude.model` editable, runtime-applied, and an
      enum (`default|opus|sonnet|haiku`); update label/description/validation.
- [x] ClaudeCliExecutor: make `model` mutable + add `setModel()`.
- [x] CodingStandardsGenerator: make `model` mutable + add `setModel()`.
- [x] index.ts: add `resolveModel()` sentinel helper; build executors from the
      effective config value (`configService.get`) not raw env (fixes restart
      override bug); register `onChange('claude.model', ...)` to push changes to
      both executors at runtime.
- [x] Frontend: none needed — the existing enum `<select>` renderer handles it.
- [x] Tests: added src/config/config.service.test.ts covering the new behavior.
- [x] Verify: `tsc --noEmit` (back + front) clean, 34/34 tests pass, build OK.

## Review
- `claude.model` is now editable from Settings → Configuration → claude as a
  dropdown (`default`/`opus`/`sonnet`/`haiku`), applied immediately (no restart).
- `default` and empty map to "no --model flag" via `resolveModel()`, so the CLI
  picks its own model — preserving prior behavior.
- Both the review executor and the coding-standards generator react to changes
  through one `configService.onChange('claude.model', ...)` listener, matching
  the poller's interval-reload pattern.
- Fixed a latent bug: executors now initialise from `configService.get(...)`
  (DB override > env) instead of raw env, so a UI-saved model survives restarts.
- Env `CLAUDE_MODEL` may still pin any model ID (bypasses the enum); only the UI
  is constrained to the curated aliases.
- New unit tests: enum metadata shape, valid set + listener notification,
  invalid value rejected, reset restores env default + notifies.
