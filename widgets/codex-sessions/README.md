# Codex sessions

Requires Fremkit 0.3.0 and SDK 1. Enable **Codex history sources** in Screen settings, Privacy. The widget subscribes to `codex` and `codex-live`, and sends only the `codex/open` command. It has no direct network permission or credential access.

It shows at most 50 stored sessions grouped by the working-directory basename supplied by `codex-live`. The group label is a folder name, not a saved Codex project identity: unrelated directories with the same basename can appear together. Sessions without a live observation use an unknown-directory group. Counts refer to the loaded subset; pagination remains disclosed. Group collapse state stays in iframe memory and closes an open agent panel.

Each card can show the observed model, thinking effort, turn duration, source and direct subagents. Missing or old observations remain unknown. Opening requires a fresh `navigation: localChat` record and sends the exact stored UUID to the host for validation. CLI or terminal focus is unavailable without a proven mapping. Stale history and records without supported navigation cannot open.

Both layouts use host theme colors and text scaling. The compact layout is a read-only count. The full layout keeps 56 px group targets and 44 px agent buttons.

Run from the registry root: `pnpm exec vitest run tools/test/codex-sessions.test.ts`. Tests use synthetic history and observation snapshots. Physical touch and real Codex navigation require separate validation.
