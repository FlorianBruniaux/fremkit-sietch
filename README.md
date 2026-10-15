<p align="center"><img src="https://raw.githubusercontent.com/fdussert/fremkit/main/brand/social/fremkit-social-1280x640.png" alt="Fremkit — widget dashboard for the Corsair Xeneon Edge" width="800"></p>

# Fremkit sietch

The widget registry for [Fremkit](https://github.com/fdussert/fremkit), the widget dashboard
for the Corsair Xeneon Edge on macOS. A *sietch* is where the Fremen keep the tribe's reserves,
and where a newcomer is admitted once the tribe has seen what they bring — which is what this
repository does with widgets. One folder per widget under `widgets/`; a workflow packs
each folder into a zip, computes its hash and publishes an `index.json` on GitHub Pages that the
Fremkit admin browses, installs from and checks for updates against.

- Registry: <https://fdussert.github.io/fremkit-sietch/index.json>
- Writing a widget: [docs/writing-widgets.md](https://github.com/fdussert/fremkit/blob/main/docs/writing-widgets.md) in the main repository
- Publishing one here: [CONTRIBUTING.md](CONTRIBUTING.md)

A widget is plain HTML in a sandboxed iframe: it reaches the host only through the `Fremkit`
bridge, and only for the channels, commands and network hosts its manifest declares. The Fremkit
admin shows those permissions and asks for consent before installing, and again when a new
version asks for more.

## Widgets whose provider is in Fremkit

Most of what is published here needs nothing installed but Fremkit itself. A widget is HTML in a
sandbox; the thing that holds an address, a token or a password is a **provider** or a
**connection type**, and those stay in the core, where the secret can live in the keychain and
never reach a page. So a widget that talks to a printer, a hub or an API is published here while
the code that authenticates is already on the machine.

| Widget | What it shows | Needs |
|---|---|---|
| `bambu-job` | The current job of a Bambu Lab printer | a `bambu` connection |
| `homey-devices` | Homey devices, with a touch to switch or dim one | a `homey` connection |
| `homey-flows` | Homey flows as buttons | the same `homey` connection |
| `ado-pipelines` | Azure DevOps pipeline runs, and a touch to start one | an `azure-devops` connection |
| `github-actions` | Workflow runs of the repositories being watched | a `github` connection |
| `github-inbox` | Reviews, issues and notifications waiting on GitHub | the same `github` connection |
| `synology-storage` | Volumes, disk health and temperature of a NAS | a `synology` connection |
| `synology-system` | CPU, memory, network and uptime of a NAS | the same `synology` connection |
| `mutedeck` | Microphone, camera and screen sharing of the meeting in progress | nothing — MuteDeck on this Mac |
| `cleanshot` | Big touch targets for CleanShot X captures | nothing — CleanShot X on this Mac |

A connection is created once in the Fremkit admin, under Connections, and every widget of that
type reads it. The install dialog names the connection a widget needs before you agree to it.

## Layout

```
widgets/<id>/manifest.json   what the widget is, its version, the SDK it needs, its permissions
widgets/<id>/index.html      the widget
widgets/<id>/...             any asset it ships (images, fonts, scripts of its own)
themes/<id>/theme.json       a theme: colour tokens, no code, nothing to consent to
tools/                       the validator, the packer and the index builder (TypeScript, vitest)
tools/vendor/                byte-for-byte copies of Fremkit's manifest, zip and address rules
.github/workflows/           validate.yml on a pull request, publish.yml on main
```

The `index.json` and `dist/` are generated: never edit them by hand, never commit them.

## Building it locally

```bash
pnpm install
pnpm test          # the validator, the packer and the index builder
pnpm validate      # every rule, nothing written — what a pull request runs
pnpm build         # the same, plus dist/index.json, dist/widgets/*.zip and dist/index.html
pnpm check-vendor  # the vendored schema is still Fremkit's
```

The account-service manifest copy is pinned to [the Fremkit fork PR](https://github.com/fdussert/fremkit/pull/20) while that feature is in review. After it merges, update the pinned commit and source repository in `tools/check-vendor.ts` to the upstream commit.

`pnpm validate` and `pnpm build` read the index currently on Pages, so a version that does not go
up is refused before merge, and older releases stay downloadable for a rollback.

## What gets checked

A package is the widget's folder, zipped: `manifest.json` at the root, `index.html`, its assets.
The CI refuses a folder that

- holds a dotfile, a symlink, a nested archive, an absolute or climbing path, or anything that is
  not a regular file;
- is over 200 files, 5 MB zipped, 20 MB unpacked, or holds a file over 5 MB;
- has a `manifest.json` the Fremkit schema does not accept, or an `id` that is not the folder name;
- shows a text that is not a `{ "fr": …, "en": … }` pair — the name, the description, every
  setting label, every list item label, every enum option label. Fremkit accepts a bare string
  for the sake of older manifests; a registry read by both languages does not. **`description`
  is therefore required here**, although the Fremkit schema treats it as optional: an absent one
  is not a pair, so leaving it out fails the check (the message says so — `description is
  required`, not a type error);
- asks for the `config` channel, which carries the whole dashboard and no Fremkit will grant;
- declares a private, loopback, link-local or `.local`-style host in `permissions.network`;
- loads a `<script src=>` from outside the package — the widget CSP would block it anyway;
- reuses a published version, or goes backwards from it — and if the already-published index
  cannot be read at all, the build **fails** rather than guessing that nothing was published.

The zip is deterministic — sorted entries, a fixed timestamp, stored rather than compressed — so
rebuilding an unchanged widget produces the same bytes, the same `sha256`, and no pointless
update for anyone who already has it. The same folder packs to the same hash on any machine, in
any timezone.

## Testing the whole chain locally

Before anything is published there is nothing for a Fremkit to install from, so build the index
against a local origin and serve it:

```bash
FREMKIT_REGISTRY_BASE=http://127.0.0.1:8080 pnpm build
npx serve dist -l 8080
```

Then point a development Fremkit at it. The registry URL is a constant there, and the override
is honoured only under `FREMKIT_DEV=1`:

```bash
FREMKIT_DEV=1 FREMKIT_REGISTRY_URL=http://127.0.0.1:8080/index.json \
  FREMKIT_PORT=4301 FREMKIT_DATA_DIR=/tmp/fremkit-bench pnpm start
```

`FREMKIT_REGISTRY_BASE` matters because the index carries absolute URLs: without it the zips are
advertised on the Pages origin, which a local `dist/` is not. The build reads the published
index to check that a version only ever goes up, and tolerates the 404 it gets on a first run.

## Licence

MIT, for the registry and for every widget in it. By opening a pull request you publish your
widget under that licence.

Fremkit is not affiliated with or endorsed by Corsair or any of the services a widget talks to;
trademarks belong to their owners.
