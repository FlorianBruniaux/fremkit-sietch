import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { THEME_LIMITS, swatch } from '../theme.js'
import { limitsOf, readAll, readAllThemes, readThemePackage } from '../validate.js'
import { build, packageZip, zipName } from '../build.js'
import { RegistryIndexSchema } from '../schema.js'
import { renderPage } from '../page.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'themes-')) })

const theme = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'nuit', version: '1.0.0', author: 'someone',
  name: { fr: 'Nuit', en: 'Night' },
  description: { fr: 'Sombre et bleuté', en: 'Dark and blue' },
  tokens: { accent: '#d9b36a', bg: '#0b0d10', surface: '#151a21', text: '#e6e8eb', border: '#1f2329' },
  ...over,
})

/**
 * A theme folder. It gets a changelog documenting its own version unless `extra` names one:
 * publishing a new version without an entry is refused, and that rule has its own tests.
 */
async function folder(id: string, file: unknown = theme({ id }), extra: Record<string, string> = {}): Promise<void> {
  await mkdir(join(root, id), { recursive: true })
  if (file !== undefined) {
    await writeFile(join(root, id, 'theme.json'), typeof file === 'string' ? file : JSON.stringify(file))
  }
  const version = typeof file === 'object' && file !== null ? (file as { version?: string }).version : undefined
  if (!('CHANGELOG.md' in extra) && version) {
    await writeFile(join(root, id, 'CHANGELOG.md'), `## ${version}\n\n- Something changed.\n`)
  }
  for (const [name, body] of Object.entries(extra)) await writeFile(join(root, id, name), body)
}

describe('limitsOf', () => {
  it('holds a theme to its own, much smaller ceilings', () => {
    expect(limitsOf('theme')).toBe(THEME_LIMITS)
    expect(limitsOf('theme').maxCompressedBytes).toBeLessThan(limitsOf('widget').maxCompressedBytes)
  })
})

describe('readThemePackage', () => {
  it('requires an author, since the card credits one', async () => {
    const { author: _, ...withoutAuthor } = theme({ id: 'nuit' })
    await folder('nuit', withoutAuthor)
    await expect(readThemePackage(root, 'nuit')).rejects.toThrow(/author is required/)
  })

  it('reads a theme folder', async () => {
    await folder('nuit')
    const pkg = await readThemePackage(root, 'nuit')
    expect(pkg.kind).toBe('theme')
    expect(pkg.version).toBe('1.0.0')
    expect(pkg.files.map((f) => f.name)).toEqual(['CHANGELOG.md', 'theme.json'])
    expect(pkg.changelog).toEqual([{ version: '1.0.0', text: 'Something changed.' }])
    // Every token is carried, not only the four the card paints.
    expect(pkg.theme.tokens.border).toBe('#1f2329')
  })

  it('allows a README and a CHANGELOG beside it, and nothing else', async () => {
    await folder('nuit', theme({ id: 'nuit' }), {
      'README.md': 'why this theme exists',
      'CHANGELOG.md': '## 1.0.0\n\n- First one.\n',
    })
    expect((await readThemePackage(root, 'nuit')).files.map((f) => f.name))
      .toEqual(['CHANGELOG.md', 'README.md', 'theme.json'])

    // The changelog is read but never packed, so a theme folder holds three files and
    // publishes two.
    expect((await readThemePackage(root, 'nuit')).changelog).toEqual([{ version: '1.0.0', text: 'First one.' }])

    await folder('autre', theme({ id: 'autre' }), { 'preview.png': 'not really a png' })
    await expect(readThemePackage(root, 'autre')).rejects.toThrow(/at most a README/)
  })

  it('refuses a missing or unreadable theme.json', async () => {
    await mkdir(join(root, 'empty'), { recursive: true })
    await expect(readThemePackage(root, 'empty')).rejects.toThrow(/theme.json is missing/)
    await folder('bad', '{ not json')
    await expect(readThemePackage(root, 'bad')).rejects.toThrow(/not valid JSON/)
  })

  it('refuses an id that is not the folder name', async () => {
    await folder('nuit', theme({ id: 'other' }))
    await expect(readThemePackage(root, 'nuit')).rejects.toThrow(/does not match the folder/)
  })

  it('refuses the two ids Fremkit ships', async () => {
    for (const id of ['fremkit', 'edge']) {
      await folder(id, theme({ id }))
      await expect(readThemePackage(root, id), id).rejects.toThrow(/Fremkit ships/)
    }
  })

  it('requires a semver version', async () => {
    for (const version of ['1.0', 'latest', '']) {
      await folder('nuit', theme({ id: 'nuit', version }))
      await expect(readThemePackage(root, 'nuit'), version).rejects.toThrow(/invalid theme/)
    }
  })

  it('requires a { fr, en } pair on the name and the description', async () => {
    for (const over of [{ name: 'Night' }, { name: { en: 'Night' } }, { description: { fr: 'Sombre' } }]) {
      await folder('nuit', theme({ id: 'nuit', ...over }))
      await expect(readThemePackage(root, 'nuit'), JSON.stringify(over)).rejects.toThrow(/invalid theme/)
    }
  })

  it('requires the four tokens a card paints, and refuses one that is not a colour', async () => {
    await folder('nuit', theme({ id: 'nuit', tokens: { accent: '#d9b36a', bg: '#0b0d10' } }))
    await expect(readThemePackage(root, 'nuit')).rejects.toThrow(/invalid theme/)
    // A value that reached a `style` attribute unchecked could close it.
    await folder('nuit', theme({ id: 'nuit', tokens: { accent: '"><script>', bg: '#0b0d10', surface: '#151a21', text: '#fff' } }))
    await expect(readThemePackage(root, 'nuit')).rejects.toThrow(/invalid theme/)
  })

  it('holds every token to the shape its CSS property accepts, not just the four', async () => {
    // The whole reason `TokensSchema` is vendored: one expression per token, Fremkit's own, so a
    // pull request that passes here is an install that works there. Extending the schema to make
    // the four required had silently replaced their colour expression with a plain string —
    // which is what this asserts did not happen.
    const ok = { accent: '#d9b36a', bg: '#0b0d10', surface: '#151a21', text: '#e6e8eb' }
    for (const tokens of [
      { ...ok, shadow: '0 0 0 red, url(https://evil.example.net/x)' },
      { ...ok, font: 'url(https://evil.example.net/f.woff)' },
      { ...ok, 'radius-sm': '10' },
      { ...ok, 'text-scale': 99 },
      { ...ok, nuance: '#fff' },
    ]) {
      await folder('nuit', theme({ id: 'nuit', tokens }))
      await expect(readThemePackage(root, 'nuit'), JSON.stringify(tokens)).rejects.toThrow(/invalid theme/)
    }
  })

  it('carries every token Fremkit accepts, not only the four it paints', async () => {
    await folder('nuit', theme({ id: 'nuit', tokens: {
      accent: '#d9b36a', bg: '#0b0d10', surface: '#151a21', text: '#e6e8eb',
      'radius-sm': '10px', shadow: '0 10px 26px rgba(0, 0, 0, .55)', 'text-scale': 1.05,
    } }))
    const pkg = await readThemePackage(root, 'nuit')
    expect(pkg.theme.tokens['text-scale']).toBe(1.05)
  })

  it('applies the shared folder rules: no dotfile, no symlink, no huge file', async () => {
    await folder('nuit', theme({ id: 'nuit' }), { '.DS_Store': 'x' })
    await expect(readThemePackage(root, 'nuit')).rejects.toThrow(/dotfile/)

    await folder('link', theme({ id: 'link' }))
    await symlink('/etc/hosts', join(root, 'link', 'README.md'))
    await expect(readThemePackage(root, 'link')).rejects.toThrow(/symlink/)

    await folder('big', theme({ id: 'big' }), { 'README.md': 'x'.repeat(THEME_LIMITS.maxFileBytes + 1) })
    await expect(readThemePackage(root, 'big')).rejects.toThrow(/file over/)
  })
})

describe('readAll', () => {
  it('dispatches on the kind it is given', async () => {
    await folder('nuit')
    await folder('brume', theme({ id: 'brume' }))
    const themes = await readAll(root, 'theme')
    expect(themes.map((p) => p.id)).toEqual(['brume', 'nuit'])
    expect(themes.every((p) => p.kind === 'theme')).toBe(true)
    // The same folders read as widgets are not widgets.
    await expect(readAll(root, 'widget')).rejects.toThrow(/manifest.json is missing/)
  })

  it('answers nothing for a root that does not exist, because themes/ starts empty', async () => {
    expect(await readAllThemes(join(root, 'nope'))).toEqual([])
  })

  it('skips the README the root itself holds', async () => {
    await folder('nuit')
    await writeFile(join(root, 'README.md'), 'what goes in here')
    expect((await readAllThemes(root)).map((p) => p.id)).toEqual(['nuit'])
  })
})

describe('the index', () => {
  const BASE = 'https://example.github.io/fremkit-sietch'
  const NOW = new Date('2026-09-18T12:00:00.000Z')
  const opts = { registry: 'fremkit-sietch', baseUrl: BASE, now: NOW }

  it('lists a theme beside the widgets, with the four swatch tokens', async () => {
    await folder('nuit')
    const pkg = (await readAllThemes(root))[0]
    const result = await build({ widgets: [], themes: [pkg] }, opts)
    expect(RegistryIndexSchema.safeParse(result.index).success).toBe(true)
    expect(result.index.widgets).toEqual([])
    const entry = result.index.themes[0]
    expect(entry.id).toBe('nuit')
    expect(entry.url).toBe(`${BASE}/themes/nuit-1.0.0.zip`)
    expect(entry.tokens).toEqual({ accent: '#d9b36a', bg: '#0b0d10', surface: '#151a21', text: '#e6e8eb' })
    // A theme has no sdk, no permissions and nothing to consent to.
    expect(entry).not.toHaveProperty('sdk')
    expect(entry).not.toHaveProperty('permissions')
    expect([...result.files.keys()].sort()).toEqual(['index.json', 'themes/nuit-1.0.0.zip'])
  })

  it('keeps themes empty when there are none, rather than absent', async () => {
    const result = await build({ widgets: [], themes: [] }, opts)
    expect(result.index.themes).toEqual([])
    // The schema version does not move: nothing was installed from an index without the key.
    expect(result.index.schema).toBe(1)
  })

  it('puts a theme and a widget of the same id in different folders', () => {
    expect(zipName('theme', 'nuit', '1.0.0')).toBe('themes/nuit-1.0.0.zip')
    expect(zipName('widget', 'nuit', '1.0.0')).toBe('widgets/nuit-1.0.0.zip')
  })

  it('holds a theme to the same monotonicity as a widget', async () => {
    await folder('nuit')
    const first = await build({ widgets: [], themes: await readAllThemes(root) }, opts)

    await folder('nuit', theme({ id: 'nuit', version: '0.9.0' }))
    await expect(build({ widgets: [], themes: await readAllThemes(root) }, { ...opts, previous: first.index }))
      .rejects.toThrow(/older than the published/)

    await folder('nuit', theme({ id: 'nuit', description: { fr: 'Autre', en: 'Other' } }))
    await expect(build({ widgets: [], themes: await readAllThemes(root) }, { ...opts, previous: first.index }))
      .rejects.toThrow(/already published with different contents/)
  })

  it('carries a theme\'s previous release forward like a widget\'s', async () => {
    await folder('nuit')
    const first = await build({ widgets: [], themes: await readAllThemes(root) }, opts)
    const oldBytes = packageZip((await readAllThemes(root))[0])

    await folder('nuit', theme({ id: 'nuit', version: '1.1.0' }))
    const next = await build({ widgets: [], themes: await readAllThemes(root) }, {
      ...opts, previous: first.index, fetchPublished: async () => oldBytes,
    })
    expect(next.index.themes[0].previous.map((p) => p.version)).toEqual(['1.0.0'])
    expect(next.files.has('themes/nuit-1.0.0.zip')).toBe(true)
  })

  it('refuses to publish a URL off its own origin', async () => {
    await folder('nuit')
    const pkg = (await readAllThemes(root))[0]
    const previous = (await build({ widgets: [], themes: [pkg] }, opts)).index
    // A carried-forward release whose URL the previous index put on another host.
    previous.themes[0].url = 'https://evil.example.net/themes/nuit-1.0.0.zip'
    await folder('nuit', theme({ id: 'nuit', version: '1.1.0' }))
    await expect(build({ widgets: [], themes: await readAllThemes(root) }, {
      ...opts, previous, fetchPublished: async () => packageZip(pkg),
    })).rejects.toThrow(/off its own origin/)
  })
})

describe('renderPage', () => {
  const opts = { registry: 'fremkit-sietch', baseUrl: 'https://example.github.io/fremkit-sietch', now: new Date('2026-09-18T12:00:00.000Z') }

  it('shows a swatch strip built from the four tokens', async () => {
    await folder('nuit')
    const html = renderPage((await build({ widgets: [], themes: await readAllThemes(root) }, opts)).index)
    expect(html).toContain('Themes')
    expect(html).toContain('background:#0b0d10')
    expect(html).toContain('background:#d9b36a')
    expect(html).toContain('1 theme(s)')
  })

  it('says so when no theme is published', async () => {
    const html = renderPage((await build({ widgets: [], themes: [] }, opts)).index)
    expect(html).toContain('No theme published yet')
  })

  it('escapes a token rather than letting it near a style attribute', async () => {
    // The validator refuses this shape, so this is the second line: the page never trusts what
    // reached the index, whichever build wrote it.
    const index = (await build({ widgets: [], themes: [] }, opts)).index
    index.themes.push({
      id: 'x', version: '1.0.0', name: 'X', description: 'X',
      tokens: { accent: '" onload="alert(1)', bg: '#000', surface: '#111', text: '#fff' },
      size: 1, sha256: 'a'.repeat(64), url: `${opts.baseUrl}/themes/x-1.0.0.zip`,
      publishedAt: '2026-09-18T12:00:00.000Z', previous: [],
    })
    const html = renderPage(index)
    expect(html).not.toContain('onload="alert(1)')
    // Dropped entirely rather than escaped into the attribute.
    expect(html).not.toContain('&quot; onload')
  })
})
