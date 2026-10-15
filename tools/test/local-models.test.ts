import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const html = readFileSync(new URL('../../widgets/local-models/index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
const part = (data: unknown, error: string | null = null, stale = false) => ({ data, error, stale })

function widget(initial?: unknown, locale = 'en') {
  const elements = new Map<string, { textContent: string; innerHTML: string }>()
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '' })
    return elements.get(id)!
  }
  let update: (value: unknown) => void = () => {}
  let localeChange: () => void = () => {}
  let compatibilityCheck: () => void = () => {}
  const api = {
    locale,
    esc: (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!),
    t: (translations: Record<string, string>) => translations[api.locale] ?? translations.en,
    whenReady: (cb: () => void) => cb(),
    subscribe: (_channel: string, cb: (value: unknown) => void) => { update = cb; if (initial !== undefined) cb(initial) },
    onLocale: (cb: () => void) => { localeChange = cb }
  }
  runInNewContext(script, {
    Fremkit: api,
    document: { getElementById: element, documentElement: { lang: 'en' } },
    setTimeout: (cb: () => void) => { compatibilityCheck = cb },
    console
  })
  return { element, update, compatibilityCheck, changeLocale: (next: string) => { api.locale = next; localeChange() } }
}

describe('Local model widget', () => {
  it('keeps Ollama installed and loaded separate and leaves MLX visible when Ollama is offline', () => {
    const view = widget({ loaded: part(null, 'offline'), installed: part(null, 'offline'), mlx: part([{ model: 'mlx-test', backend: 'mlx', pid: 42, cpu: 1.05, memoryBytes: 1073741824, port: 8000 }]) })
    expect(view.element('loadedStatus').textContent).toBe('Ollama is not running')
    expect(view.element('installedStatus').textContent).toBe('')
    expect(view.element('mlx').innerHTML).toContain('mlx-test')
    expect(view.element('mlx').innerHTML).toContain('CPU 1.1%')
  })

  it('shows stale, invalid and offline states independently', () => {
    const view = widget({ loaded: part([], 'invalid', true), installed: part([], null), mlx: part(null, 'offline') }, 'fr')
    expect(view.element('loadedStatus').textContent).toBe('Données anciennes · Données illisibles')
    expect(view.element('installed').innerHTML).toContain('Aucun modèle installé')
    expect(view.element('mlxStatus').textContent).toBe('Service indisponible')
  })

  it('uses backend and port when an MLX model has no name and escapes provider fields', () => {
    const view = widget({ loaded: part([]), installed: part([{ name: '<script>alert(1)</script>', size: 100 }]), mlx: part([{ model: null, backend: '<b>mlx</b>', pid: 4, cpu: null, memoryBytes: null, port: 9000 }]) })
    expect(view.element('mlx').innerHTML).toContain('&lt;b&gt;mlx&lt;/b&gt; · port 9000')
    expect(view.element('mlx').innerHTML).toContain('CPU ?')
    expect(view.element('installed').innerHTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(view.element('installed').innerHTML).not.toContain('<script>')
  })

  it('shows a compatibility message only if an older host never sends a snapshot', () => {
    const view = widget()
    expect(view.element('loadedStatus').textContent).toBe('Loading…')
    view.compatibilityCheck()
    expect(view.element('loadedStatus').textContent).toBe('Needs a newer Fremkit')
    view.update({ loaded: part([]), installed: part([]), mlx: part([]) })
    expect(view.element('loadedStatus').textContent).toBe('')
    view.changeLocale('fr')
    expect(view.element('mlx').innerHTML).toContain('Aucun processus MLX détecté')
  })
})
