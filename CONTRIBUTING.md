# Publishing a widget

1. Write it against the main repository's guide,
   [docs/writing-widgets.md](https://github.com/fdussert/fremkit/blob/main/docs/writing-widgets.md),
   and run it from a local `widgets/` folder until it behaves.
2. Give the manifest a `version` (semver), an `sdk` (the bridge version it needs) and an `author`
   (your handle, shown on the widget's card; `"you, them"` when two of you wrote it), and declare
   every channel, command and network host it uses — nothing else is granted. A widget with no
   `author` is refused.
3. Copy the folder to `widgets/<id>/` here, `<id>` being the manifest's `id`, and open a pull
   request. The CI validates the manifest, refuses private or local network hosts, checks the
   size, and builds the index on merge.
4. Keep the pull request to one widget, in English, with no personal data (hosts, tokens, names,
   screenshots of your own dashboard) — placeholders and the `192.0.2.x` documentation range only.

A new version is the same pull request with `version` bumped. A version that asks for a
permission the previous one did not is shown to every user as a new consent.

**Every new version needs a line in `CHANGELOG.md`**, beside the manifest:

```markdown
## 1.1.0 — 2026-09-21

### Added
- A setting for the refresh interval.
```

[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) shape: `## <version>` headings, newest
first, optional `###` subsections, bullets. The CI refuses a version with no entry for it — the
first release included, where "Initial release" is a perfectly good line.

The entry is what the Fremkit admin shows somebody before they press Update, so write it for
them rather than for a reviewer: what changed for a person looking at the tile. The registry
lifts it into `index.json` as **plain text** (markdown stripped, links lose their URL, 500
characters), so a long entry is cut on the card and stays whole in the file.

The file is *not* part of the package — it is never zipped, and the bytes of a version do not
change when you write its entry. That is deliberate: you can document a release that went out
months ago by adding a heading for it, and nothing is republished.

Reviews look at what the widget asks for and what it does with remote data (escape it with
`Fremkit.esc`), not at taste. Security concerns: see [SECURITY.md](SECURITY.md).

## Publishing a theme

A theme is colour tokens and nothing else: no code, no permissions, nothing for a user to
consent to. It is the easiest thing to publish here and the safest thing to install.

1. Copy `themes/fremkit/theme.json` from the [main
   repository](https://github.com/fdussert/fremkit) — it mirrors the dashboard's own
   `tokens.css`, so every token a theme can set is already in it.
2. Change `id`, `name`, `description` and the values. `id` is the folder name,
   `[a-z0-9_-]+`; `name` and `description` are `{ "fr": …, "en": … }` pairs; `version` is semver
   and only ever goes up. `author` is required, your handle as on a widget; `license` and
   `homepage` are optional. All three are shown on the card.
3. Drop it at `themes/<id>/theme.json` here — that folder and at most a `README.md`, nothing
   else — and run `pnpm validate`.

`fremkit` and `edge` ship with Fremkit so a fresh install has a choice with no network; those
two ids are refused here.

A theme folder holds `theme.json`, and at most a `README.md` and a `CHANGELOG.md`. The changelog
rule is the widget's: every new version needs an entry, and the file is never packed.

The four tokens `accent`, `bg`, `surface` and `text` are published in the index, which is what
the admin paints as a swatch strip — so a theme needs no preview image. They are the only four
that are *required*; every other token is optional and falls back to the built-in theme's value.

**Every token is checked against the shape its CSS property accepts** — one expression per token,
from Fremkit's own `TokensSchema`, vendored here as `tools/vendor/themes/theme.ts`. A colour has
to be a hex colour, a length has to carry a unit, a shadow is offsets and a colour and nothing
that could fetch. A token Fremkit does not have is refused rather than passed through, so a typo
is something you are told about here instead of something that silently paints nothing. It is
the same schema the installer applies to the downloaded package, which is what makes a pull
request that passes here an install that works there.

## Running the checks before you open it

```bash
pnpm install
pnpm validate
```

That is exactly what the pull request runs. The full list of what it refuses is in the
[README](README.md#what-gets-checked); the two easiest to trip over are that every text a user
sees must be a `{ "fr": …, "en": … }` pair, and that `version` must be greater than the one
already published.

To see your widget actually install, build and serve the index locally and point a development
Fremkit at it — [Testing the whole chain locally](README.md#testing-the-whole-chain-locally).
The packed bytes are reproducible, so the hash you get is the hash CI will get.

## About `tools/vendor/`

The manifest schema is Fremkit's, not this repository's: `tools/vendor/widgets/manifest.ts`,
`net/private.ts` and `backup/zip.ts` are byte-for-byte copies of the files of the same name in
[fdussert/fremkit](https://github.com/fdussert/fremkit). A copy rather than a submodule, so a
clone builds with nothing but `pnpm install` — and `pnpm check-vendor`, which both workflows run,
fetches the upstream files and fails the run on any difference. Never edit them here: change them
upstream, then copy them over in their own commit.
