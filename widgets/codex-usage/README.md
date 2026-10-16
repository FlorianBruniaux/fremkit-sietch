# Codex usage

Requires Fremkit 0.3.0 and SDK 1. Enable **Read Codex account quotas and usage** in Screen settings, Privacy. Codex must be installed and signed in on the Mac. The widget has no network permission or credential access.

The account section shows only the type and plan provided by Fremkit. The core does not provide an email. Quotas are available with ChatGPT sign-in; API key and Amazon Bedrock modes display an explanation instead. The widget reads up to six quota buckets and five account usage fields. Missing values remain unknown, while zero remains zero. Stale values retain their status and timestamp. Reset timestamps are epoch seconds; provider update timestamps are milliseconds. Daily usage buckets are not rendered.

Both layouts use host theme colors and text scaling. Compact mode shows available quota windows. The widget sends no commands.

Run from the registry root: `pnpm exec vitest run tools/test/codex-usage.test.ts`. Tests use synthetic provider snapshots. Real account data and physical touch are not verified by those tests.
