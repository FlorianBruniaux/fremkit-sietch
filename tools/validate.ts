/**
 * What a folder must be to get into the index.
 *
 * These rules exist twice on purpose: here, so an author learns at pull-request time, and in
 * Fremkit's installer, so a user is protected whatever a registry — this one, a fork, a
 * compromised Pages deployment — chose to publish. The installer is the one that matters; this
 * is the one that is kind. Neither is allowed to trust the other.
 *
 * Everything below is a property of the *package*, not of what it does: nothing here runs a
 * widget, and nothing here can tell whether the code inside does what it says. That is what the
 * human review in CONTRIBUTING is for.
 *
 * Two kinds live here. A **widget** is code, and carries the whole list. A **theme** is a JSON
 * file of colours: no code, no permissions, nothing to consent to — so its rules are about shape
 * and size, and they are short. The parts they share — walking a folder, the names an entry may
 * carry, the ceilings — are shared, and the parts they do not are not.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { ManifestSchema, type WidgetManifest } from './vendor/widgets/manifest.js'
import { isPrivateLiteral } from './vendor/net/private.js'
import { BUILTIN_THEME_IDS, THEME_ENTRY, THEME_LIMITS, ThemeFileSchema, type ThemeFile } from './theme.js'
import { CHANGELOG_ENTRY, parseChangelog, type ChangelogEntry } from './changelog.js'

/** What a folder at the repository root holds. The root name *is* the kind. */
export type Kind = 'widget' | 'theme'

/** Root folder → kind. `validate` and `build` walk both and dispatch on which one they are in. */
export const ROOTS: Record<string, Kind> = { widgets: 'widget', themes: 'theme' }

/** A package is small: these are ceilings, not budgets, and nothing here is near them. */
export const LIMITS = {
  maxFiles: 200,
  /** The zip, as downloaded. */
  maxCompressedBytes: 5 * 1024 * 1024,
  /** Everything the zip unpacks to, which is what a disk actually pays. */
  maxUncompressedBytes: 20 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
} as const

/** One file of a package: the path it is stored under, and its bytes. */
export interface PackageFile { name: string; data: Buffer }

export interface WidgetPackage {
  kind: 'widget'
  id: string
  version: string
  manifest: WidgetManifest
  /** Sorted by name, so the zip built from them is byte-identical from one run to the next. */
  files: PackageFile[]
  /** Every version the folder's `CHANGELOG.md` documents, empty when it ships none. */
  changelog: ChangelogEntry[]
}

export interface ThemePackage {
  kind: 'theme'
  id: string
  version: string
  theme: ThemeFile
  files: PackageFile[]
  changelog: ChangelogEntry[]
}

/** Either kind, told apart by `kind`. */
export type Package = WidgetPackage | ThemePackage

/** The ceilings of one kind. A theme is a JSON file; a widget is a page and its assets. */
export function limitsOf(kind: Kind): { maxFiles: number; maxCompressedBytes: number; maxUncompressedBytes: number; maxFileBytes: number } {
  return kind === 'theme' ? THEME_LIMITS : LIMITS
}

export class ValidationError extends Error {
  constructor(readonly id: string, message: string) {
    super(`${id}: ${message}`)
    this.name = 'ValidationError'
  }
}

/**
 * Names a package may not carry, whatever the filesystem it was built on allows.
 *
 * A dotfile is the author's tooling, never the widget's: `.git`, `.DS_Store`, an `.env` that
 * should never have existed. An absolute or climbing path is an attempt to write outside the
 * widget's folder when it is unpacked. A backslash is the same attempt spelled for Windows,
 * where it is a separator and here it would not be. A nested archive is a payload nothing in
 * the chain looks inside.
 */
const FORBIDDEN_SUFFIX = ['.zip', '.gz', '.tgz', '.tar', '.7z', '.rar', '.xz', '.bz2']

export function checkEntryName(id: string, name: string): void {
  if (name === '') throw new ValidationError(id, 'an entry has no name')
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw new ValidationError(id, `absolute path: ${name}`)
  if (name.includes('\\')) throw new ValidationError(id, `backslash in a path: ${name}`)
  if (name.includes('\0')) throw new ValidationError(id, 'a path holds a null byte')
  const parts = name.split('/')
  if (parts.some((p) => p === '..' || p === '.')) throw new ValidationError(id, `path escapes the folder: ${name}`)
  if (parts.some((p) => p.startsWith('.'))) throw new ValidationError(id, `dotfile: ${name}`)
  const lower = name.toLowerCase()
  if (FORBIDDEN_SUFFIX.some((s) => lower.endsWith(s))) throw new ValidationError(id, `nested archive: ${name}`)
}

/**
 * Names that only ever mean "this machine or this LAN".
 *
 * Fremkit judges a *name* by resolving it, at request time, in `resolvesToPrivate` — which is
 * the only correct place, since a name can be pointed anywhere after publication. The registry
 * cannot resolve anything meaningfully (it runs on a GitHub runner, on the wrong network, and
 * the answer would be stale by the time anyone installed the widget), but these few names have
 * no other reading, and a widget declaring one is broken for every user. Refusing it here tells
 * the author instead of shipping something that will only ever fail.
 */
const LOCAL_SUFFIX = ['.localhost', '.local', '.internal', '.home.arpa', '.lan']

export function isLocalName(host: string): boolean {
  const lower = host.toLowerCase().replace(/\.$/, '')
  return lower === 'localhost' || LOCAL_SUFFIX.some((s) => lower.endsWith(s))
}

/**
 * Every text a manifest shows a user, with the path to say where it was found.
 *
 * The schema accepts a bare string or any record, because Fremkit has to keep reading the
 * manifests that were written before the `{ fr, en }` pair existed. A registry has no such
 * history: a widget published here is read by French and English dashboards both, and one that
 * declares only `fr` leaves half of them with a label they cannot read. So the pair is required
 * here and nowhere else.
 */
export function localizedTexts(manifest: WidgetManifest): { path: string; value: unknown }[] {
  const texts: { path: string; value: unknown }[] = [
    { path: 'name', value: manifest.name },
    { path: 'description', value: manifest.description },
  ]
  for (const [key, field] of Object.entries(manifest.settingsSchema)) {
    texts.push({ path: `settingsSchema.${key}.label`, value: field.label })
    for (const [itemKey, item] of Object.entries(field.itemSchema ?? {})) {
      texts.push({ path: `settingsSchema.${key}.itemSchema.${itemKey}.label`, value: item.label })
      for (const [i, option] of (item.options ?? []).entries()) {
        if (typeof option === 'object') texts.push({ path: `settingsSchema.${key}.itemSchema.${itemKey}.options[${i}].label`, value: option.label })
      }
    }
    for (const [i, option] of (field.options ?? []).entries()) {
      if (typeof option === 'object') texts.push({ path: `settingsSchema.${key}.options[${i}].label`, value: option.label })
    }
  }
  return texts
}

/** A `{ fr, en }` pair with something in both. A bare string is not one. */
export function isBilingual(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const pair = value as Record<string, unknown>
  return typeof pair.fr === 'string' && pair.fr.trim() !== ''
    && typeof pair.en === 'string' && pair.en.trim() !== ''
}

/**
 * `<script src=` pointing anywhere but at the package itself.
 *
 * The widget CSP is `script-src 'self'`, so the browser would refuse to load it and the widget
 * would simply be broken. Refusing it here is not defence — it is telling the author now rather
 * than letting a user install something that silently does nothing.
 */
const SCRIPT_SRC_RE = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi

export function offPackageScripts(html: string): string[] {
  const found: string[] = []
  for (const m of html.matchAll(SCRIPT_SRC_RE)) {
    const src = (m[2] ?? m[3] ?? m[4] ?? '').trim()
    if (src === '') continue
    // `/fremkit.js` is the bridge, injected by the server into every widget; an author who
    // writes the tag themselves gets the same one, and it is not off-package.
    if (src === '/fremkit.js') continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('/')) found.push(src)
  }
  return found
}

/**
 * Reads a folder into sorted files, holding every entry to the name and size rules of its kind.
 *
 * The half both kinds share. What is in the files is the caller's business.
 */
export async function readFolder(root: string, id: string, kind: Kind): Promise<PackageFile[]> {
  const limits = limitsOf(kind)
  const folder = join(root, id)
  const files: PackageFile[] = []
  let total = 0

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      const name = relative(folder, full).split(sep).join('/')
      checkEntryName(id, name)
      // Not `entry.isFile()`: a symlink to a regular file answers false to isDirectory() and
      // would be read through, publishing whatever it points at on the build machine.
      if (entry.isSymbolicLink()) throw new ValidationError(id, `symlink: ${name}`)
      if (entry.isDirectory()) { await walk(full); continue }
      if (!entry.isFile()) throw new ValidationError(id, `not a regular file: ${name}`)
      const size = (await stat(full)).size
      if (size > limits.maxFileBytes) throw new ValidationError(id, `file over ${limits.maxFileBytes} bytes: ${name}`)
      total += size
      files.push({ name, data: await readFile(full) })
    }
  }
  await walk(folder)

  if (files.length > limits.maxFiles) throw new ValidationError(id, `over ${limits.maxFiles} files`)
  if (total > limits.maxUncompressedBytes) throw new ValidationError(id, `over ${limits.maxUncompressedBytes} bytes unpacked`)
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return files
}

/**
 * Reads one `themes/<id>/` folder.
 *
 * Short, because a theme is short: the folder holds `theme.json` and at most a `README.md`, the
 * file parses, the id is the folder's, and the id is not one Fremkit ships. The tokens
 * themselves are read by shape until Fremkit's `TokensSchema` is vendored — see theme.ts.
 */
export async function readThemePackage(root: string, id: string): Promise<ThemePackage> {
  const files = await readFolder(root, id, 'theme')
  const allowed = new Set([THEME_ENTRY, 'README.md', CHANGELOG_ENTRY])
  for (const file of files) {
    if (!allowed.has(file.name)) {
      throw new ValidationError(id, `a theme folder holds ${THEME_ENTRY} and at most a README.md and a ${CHANGELOG_ENTRY}, not ${file.name}`)
    }
  }
  const entry = files.find((f) => f.name === THEME_ENTRY)
  if (!entry) throw new ValidationError(id, `${THEME_ENTRY} is missing`)

  let json: unknown
  try { json = JSON.parse(entry.data.toString('utf8')) }
  catch { throw new ValidationError(id, `${THEME_ENTRY} is not valid JSON`) }
  const parsed = ThemeFileSchema.safeParse(json)
  if (!parsed.success) {
    throw new ValidationError(id, `invalid theme: ` + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  const theme = parsed.data
  if (theme.id !== id) throw new ValidationError(id, `theme id "${theme.id}" does not match the folder`)
  // Fremkit ships these two so a fresh install has a choice with no network, and its installer
  // refuses them; saying so here tells an author before they open a pull request.
  if (BUILTIN_THEME_IDS.has(id)) throw new ValidationError(id, 'this id belongs to a theme Fremkit ships')
  checkAuthor(id, theme.author)

  return { kind: 'theme', id, version: theme.version, theme, files, changelog: changelogOf(id, files) }
}

/**
 * A published package names whoever wrote it: that is what its card shows next to the licence.
 * The vendored schema leaves `author` optional because a widget built into Fremkit has nobody
 * to credit; here somebody always wrote it, and two widgets once reached the admin reading only
 * "MIT" because a pull request left it out.
 */
export function checkAuthor(id: string, author: string | undefined): void {
  if (!author?.trim()) throw new ValidationError(id, 'author is required: the handle of whoever wrote it, shown on its card')
}

/** Reads one `widgets/<id>/` folder and holds it to every rule above. */
export async function readPackage(root: string, id: string): Promise<WidgetPackage> {
  const files = await readFolder(root, id, 'widget')

  if (!files.some((f) => f.name === 'manifest.json')) throw new ValidationError(id, 'manifest.json is missing')
  if (!files.some((f) => f.name === 'index.html')) throw new ValidationError(id, 'index.html is missing')

  let json: unknown
  try { json = JSON.parse(files.find((f) => f.name === 'manifest.json')!.data.toString('utf8')) }
  catch { throw new ValidationError(id, 'manifest.json is not valid JSON') }

  const parsed = ManifestSchema.safeParse(json)
  if (!parsed.success) {
    throw new ValidationError(id, 'invalid manifest: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  const manifest = parsed.data
  if (manifest.id !== id) throw new ValidationError(id, `manifest id "${manifest.id}" does not match the folder`)
  checkAuthor(id, manifest.author)

  // The schema already refuses the literals; saying it again keeps the rule true if the vendored
  // copy ever lags behind, and this is the one rule a widget cannot be published without.
  for (const host of manifest.permissions.network) {
    if (isPrivateLiteral(host) || isLocalName(host)) throw new ValidationError(id, `private or local network host: ${host}`)
  }

  for (const { path, value } of localizedTexts(manifest)) {
    if (isBilingual(value)) continue
    // `description` is optional in the schema and defaults to `''`, so an *absent* one arrives
    // here as an empty string rather than as a missing key. "must be a pair" would send an
    // author looking for a type error in something they never wrote; say it is missing.
    if (value === '' || value === undefined) throw new ValidationError(id, `${path} is required`)
    throw new ValidationError(id, `${path} must be a { "fr": …, "en": … } pair`)
  }

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.html')) continue
    const off = offPackageScripts(file.data.toString('utf8'))
    if (off.length) throw new ValidationError(id, `${file.name} loads a script from outside the package: ${off.join(', ')}`)
  }

  return { kind: 'widget', id, version: manifest.version, manifest, files, changelog: changelogOf(id, files) }
}

/**
 * The folder's changelog, parsed, or nothing when it ships none.
 *
 * Whether *this* version needs an entry is not decided here: the answer depends on what is
 * already published, which only the build knows. See `release()` in build.ts.
 */
function changelogOf(id: string, files: PackageFile[]): ChangelogEntry[] {
  const file = files.find((f) => f.name === CHANGELOG_ENTRY)
  if (!file) return []
  const entries = parseChangelog(file.data.toString('utf8'))
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.version)) throw new ValidationError(id, `${CHANGELOG_ENTRY} documents ${entry.version} twice`)
    seen.add(entry.version)
  }
  return entries
}

/**
 * Every folder in `root`, validated as `kind`, in id order.
 *
 * A root that does not exist answers nothing: `themes/` is empty until the first one is
 * published, and a repository with no widgets is a legitimate state too.
 */
export async function readAll(root: string, kind: Kind): Promise<Package[]> {
  let ids: string[] = []
  try { ids = await readdir(root) } catch { return [] }
  const packages: Package[] = []
  for (const id of ids.sort()) {
    // Each root holds a README of its own explaining what goes in it.
    if (!(await stat(join(root, id))).isDirectory()) continue
    packages.push(kind === 'theme' ? await readThemePackage(root, id) : await readPackage(root, id))
  }
  return packages
}

/**
 * Refuses an id that both a widget and a theme claim.
 *
 * Fremkit records what is installed in one map keyed by id, across both kinds — so two packages
 * of the same name can never both be installed, whatever this repository thinks of them. The
 * install would be refused there, on somebody's machine, after the download; this says it here,
 * to the author, before the pull request is opened.
 */
export function assertNoSharedIds(widgets: { id: string }[], themes: { id: string }[]): void {
  const widgetIds = new Set(widgets.map((w) => w.id))
  const shared = themes.map((t) => t.id).filter((id) => widgetIds.has(id))
  if (shared.length) {
    throw new Error(`a widget and a theme cannot share an id: ${shared.join(', ')} — Fremkit records both under one key`)
  }
}

/** Every widget folder in `root`, validated, in id order. */
export async function readAllPackages(root: string): Promise<WidgetPackage[]> {
  return (await readAll(root, 'widget')) as WidgetPackage[]
}

/** Every theme folder in `root`, validated, in id order. */
export async function readAllThemes(root: string): Promise<ThemePackage[]> {
  return (await readAll(root, 'theme')) as ThemePackage[]
}
