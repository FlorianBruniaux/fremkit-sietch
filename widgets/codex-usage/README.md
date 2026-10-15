# Codex usage

Requires Fremkit SDK 1 and the opt-in `codex` core provider. Codex must be installed and its account must be configured outside this widget. This package contains original MIT-licensed code and no external assets or credential access.

Reads quota buckets and five supplied account summary fields. Missing data remains unknown; zero remains zero. Shows at most six quota buckets with a disclosure. Reset timestamps are protocol epoch seconds; source freshness timestamps are milliseconds. Daily buckets are not rendered in this minimal release. Quotas and usage retain independent status messages and stale values. No commands or network permissions.

Both layouts use host theme tokens, transparent backgrounds and navigation slot alignment. Compact mode is a read-only summary; its full-tile popover is controlled by the host. Loading, unconfigured, unauthorized, unsupported, invalid and offline states are translated into French and English.

Run from the registry root: `pnpm exec vitest run tools/test/codex-widgets.test.ts`. Tests run the delivered widget script with synthetic provider snapshots. Real account comparison, native touch opening and desktop live activity are unverified.
