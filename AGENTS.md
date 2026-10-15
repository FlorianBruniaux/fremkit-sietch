# Working on Fremkit sietch with a coding agent

This repository publishes Fremkit widgets and themes. Read [CONTRIBUTING.md](CONTRIBUTING.md)
for the publishing rules and [README.md](README.md) for the registry architecture. Fremkit's
widget API is documented in its [writing-widgets guide](https://github.com/fdussert/fremkit/blob/main/docs/writing-widgets.md).

## Boundaries

- Work in an isolated branch or worktree. Do not edit a user's Fremkit checkout, dashboard data,
  installed helper or credentials to test a registry change.
- Keep a widget pull request to one widget. Keep its `manifest.json`, `index.html`, assets and
  `CHANGELOG.md` entry together. Bump the widget version for every published change. Theme
  changes follow the same version and changelog rule.
- Keep secrets and personal data out of source, fixtures, logs, screenshots and pull requests.
  Use `example.com` and documentation IP ranges when examples need an address.
- Declare only the channels, commands and network hosts the widget actually uses. Escape text
  from external services with `Fremkit.esc`; provide French and English for user-facing labels.
- Let the host frame draw the widget title. Do not paint a second title or a service logo
  inside the widget; `Fremkit.showTitle` is described in the writing-widgets guide.
- Keep one changelog entry for each version actually published. Collapse intermediate versions
  that never reached the registry into the entry for the version users will install.
- State when a widget needs a core command or channel that has not been released. The manifest's
  `sdk` checks the bridge generation, not provider features: wait for a Fremkit release and
  handle an older host's unknown-command reply without leaving the tile broken.
- `tools/vendor/` mirrors Fremkit's schemas and packer. Change the source in Fremkit first, then
  copy the released files here in a separate commit. Do not adjust the vendored files to make a
  local check pass.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm check-vendor
pnpm validate
```

These are the pull request checks. `pnpm validate` reads the published registry index, so it
needs network access and may refuse a version that was already published. `pnpm build` writes
`dist/`; use it when changing packaging or the generated index. For an end-to-end install,
follow [Testing the whole chain locally](README.md#testing-the-whole-chain-locally) with a
separate Fremkit server and data directory.

Stage only the files for the change. Do not commit generated `dist/` or unrelated work. Report
which checks ran and distinguish a local validation from an install on the Xeneon Edge.
