/**
 * Refuses to let the vendored schema drift from Fremkit's.
 *
 * `tools/vendor/` holds byte-for-byte copies of three files from the main repository (see its
 * README). A copy is the simplest thing that makes this repository build on its own, and the
 * worst thing to leave unattended: a schema that lags behind publishes widgets the Fremkit
 * installer then refuses, and a schema that runs ahead promises authors a field no released
 * Fremkit reads. Either way the person who finds out is a user with a failed install.
 *
 * So both workflows run this. It fetches the upstream files and compares them; a difference
 * fails the run and names the file to copy over.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
/**
 * The Fremkit commit the vendored files were copied from.
 *
 * A commit, not `main`. Comparing against a moving branch means this check starts failing the
 * moment somebody touches the schema upstream — on a pull request that has nothing to do with
 * it, for a reason its author cannot fix here. Pinned, the check answers one question with one
 * answer: are these copies the ones that were taken. Bumping it is part of the commit that
 * copies new files over, and that commit is where the decision belongs.
 */
// Until fdussert/fremkit#20 lands, pin the exact reviewed fork commit that supplies this schema.
const VENDOR_REPO = 'FlorianBruniaux/fremkit'
const VENDOR_REF = 'e713bd22145066132a82be67b9c1847861e5bbe1'

/**
 * Where the upstream files are read from. The default is the raw view of the pinned commit,
 * which is what CI uses. A local path works too, so the owner can check a Fremkit change against
 * this repository *before* pushing it — which is the only moment the answer can still be acted
 * on cheaply, and the only way to run this at all before the commit exists on GitHub.
 */
const UPSTREAM = process.env.FREMKIT_RAW_BASE || `https://raw.githubusercontent.com/${VENDOR_REPO}/${VENDOR_REF}`

/** local path under tools/vendor → path under the main repository. */
const COPIES: Record<string, string> = {
  'widgets/manifest.ts': 'server/src/widgets/manifest.ts',
  'net/private.ts': 'server/src/net/private.ts',
  'backup/zip.ts': 'server/src/backup/zip.ts',
  'themes/theme.ts': 'server/src/themes/theme.ts',
}

/**
 * Copies whose upstream file does not exist yet.
 *
 * Empty: `themes/theme.ts` sat here while Fremkit's theme pull request was open, and moved into
 * `COPIES` the day it landed — which is exactly what the entry was written early for. The
 * mechanism stays for the next one.
 *
 * A 404 is the only tolerated outcome. A file that exists and differs is a failure like any
 * other, and so is a network error: "not there yet" has to be a fact, not a guess.
 */
const PENDING: Record<string, string> = {}

/**
 * The shims are not copies, so they are checked by what they must agree on rather than by
 * their text: one regular expression, spelled the same way on both sides.
 */
const CONSTANTS: { local: string; upstream: string; name: string }[] = [
  { local: 'config/schema.ts', upstream: 'server/src/config/schema.ts', name: 'WIDGET_ID_RE' },
]

async function upstream(path: string): Promise<string> {
  const base = UPSTREAM.replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) return readFile(join(base, path), 'utf8')
  const url = `${base}/${path}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`could not read ${url}: HTTP ${res.status}`)
  return res.text()
}

/** `null` when the upstream file is demonstrably not there; throws on anything else. */
async function upstreamIfPresent(path: string): Promise<string | null> {
  const base = UPSTREAM.replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) {
    return readFile(join(base, path), 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null
      throw err
    })
  }
  const url = `${base}/${path}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`could not read ${url}: HTTP ${res.status}`)
  return res.text()
}

function declaration(source: string, name: string): string | null {
  const m = new RegExp(`^export const ${name} = (.+)$`, 'm').exec(source)
  return m ? m[1].trim() : null
}

async function main(): Promise<void> {
  const problems: string[] = []

  for (const [local, path] of Object.entries(COPIES)) {
    const mine = await readFile(join(root, 'tools', 'vendor', local), 'utf8')
    const theirs = await upstream(path)
    if (mine === theirs) { console.log(`ok   tools/vendor/${local}`); continue }
    problems.push(`tools/vendor/${local} differs from ${path} upstream — copy it over in its own commit`)
  }

  for (const [local, path] of Object.entries(PENDING)) {
    const mine = await readFile(join(root, 'tools', 'vendor', local), 'utf8').catch(() => null)
    const theirs = await upstreamIfPresent(path)
    if (theirs === null) {
      console.log(`skip tools/vendor/${local} — ${path} does not exist upstream yet`)
      continue
    }
    if (mine !== null && mine === theirs) { console.log(`ok   tools/vendor/${local}`); continue }
    problems.push(`${path} exists upstream now: copy it to tools/vendor/${local} and move the entry out of PENDING`)
  }

  for (const { local, upstream: path, name } of CONSTANTS) {
    const mine = declaration(await readFile(join(root, 'tools', 'vendor', local), 'utf8'), name)
    const theirs = declaration(await upstream(path), name)
    if (mine !== null && mine === theirs) { console.log(`ok   ${name}`); continue }
    problems.push(`${name} is ${mine ?? 'missing'} here and ${theirs ?? 'missing'} in ${path}`)
  }

  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`)
    process.exit(1)
  }
  console.log(`vendored schema is in step with ${VENDOR_REPO}@${VENDOR_REF.slice(0, 12)}`)
}

main().catch((err: Error) => {
  console.error(err.message)
  process.exit(1)
})
