import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const html = readFileSync(new URL('../../widgets/docker-containers/index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''

interface Container {
  id: string
  name: string
  image: string
  state: string
  status: string
  stats: { cpu: string; memory: string; netIO: string; blockIO: string } | null
}
interface Snapshot {
  data: { containers: Container[] } | null
  stale: boolean
  error: string | null
}
interface Node {
  textContent: string
  innerHTML: string
  hidden: boolean
  attributes: Record<string, string>
  setAttribute(name: string, value: string): void
  addEventListener(type: string, callback: () => void): void
}

function container(state: string, name = state, stats: Container['stats'] = null): Container {
  return { id: state, name, image: 'example:latest', state, status: 'From Docker', stats }
}
function snapshot(containers: Container[] = [], error: string | null = null): Snapshot {
  return { data: { containers }, stale: false, error }
}
function load(initial?: Snapshot, locale = 'en') {
  const nodes = new Map<string, Node>()
  const handlers = new Map<string, () => void>()
  const timers: (() => void)[] = []
  let publish: ((data: Snapshot) => void) | undefined
  let changeLocale: (() => void) | undefined
  const get = (id: string): Node => {
    let node = nodes.get(id)
    if (!node) {
      node = {
        textContent: '', innerHTML: '', hidden: false, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value },
        addEventListener(type, callback) { handlers.set(id + ':' + type, callback) },
      }
      nodes.set(id, node)
    }
    return node
  }
  const api = {
    locale,
    esc(value: unknown) {
      return String(value ?? '').replace(/[&<>"']/g, (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
    },
    t(value: { en: string; fr: string }, params: Record<string, string | number> = {}) {
      return (value[api.locale as 'en' | 'fr'] ?? value.en)
        .replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''))
    },
    whenReady(callback: () => void) { callback() },
    onLocale(callback: () => void) { changeLocale = callback },
    subscribe(channel: string, callback: (data: Snapshot) => void) {
      expect(channel).toBe('docker-local')
      publish = callback
      if (initial) callback(initial)
      return () => {}
    },
  }
  runInNewContext(script, {
    Fremkit: api,
    document: { getElementById: get, documentElement: { lang: 'en' } },
    setTimeout: (callback: () => void) => { timers.push(callback) },
  })
  return {
    get,
    update(data: Snapshot) { publish?.(data) },
    filter(id: 'active' | 'stopped' | 'all') { handlers.get('filter-' + id + ':click')?.() },
    language(value: 'en' | 'fr') { api.locale = value; changeLocale?.() },
    runTimeout() { timers.shift()?.() },
    text() { return [...nodes.values()].filter((node) => !node.hidden).map((node) => node.textContent + node.innerHTML).join(' ') },
  }
}

describe('Docker containers widget', () => {
  it('filters running, stopped and all containers without sending commands', () => {
    const rows = [container('running'), container('exited'), container('paused')]
    const widget = load(snapshot(rows), 'fr')
    expect(widget.get('list').innerHTML).toContain('running')
    expect(widget.get('list').innerHTML).not.toContain('exited')
    widget.filter('stopped')
    expect(widget.get('list').innerHTML).toContain('exited')
    expect(widget.get('list').innerHTML).not.toContain('paused')
    expect(widget.get('filter-stopped').attributes['aria-pressed']).toBe('true')
    widget.filter('all')
    expect(widget.get('list').innerHTML).toContain('paused')
    widget.update({ ...snapshot(rows), stale: true })
    expect(widget.get('filter-all').attributes['aria-pressed']).toBe('true')
    expect(widget.text()).toContain('Données anciennes')
  })

  it('shows a compatibility message when an older host never publishes the channel', () => {
    const widget = load(undefined, 'fr')
    expect(widget.get('status').textContent).toBe('Chargement…')
    expect(widget.get('filter-active').textContent).toBe('Actifs')
    widget.runTimeout()
    expect(widget.get('status').textContent).toBe('Version plus récente de Fremkit nécessaire')
    widget.update(snapshot([container('running')]))
    expect(widget.get('status').textContent).toBe('')
  })

  it.each([
    ['unavailable', 'Docker n’est pas installé'],
    ['offline', 'Docker ne fonctionne pas'],
    ['invalid', 'Données Docker illisibles'],
  ])('distinguishes %s without data', (error, message) => {
    const widget = load({ data: null, stale: false, error }, 'fr')
    expect(widget.get('status').textContent).toBe(message)
    expect(widget.get('list').innerHTML).toBe('')
  })

  it('hides irrelevant filters for a remote Docker context', () => {
    const widget = load({ data: null, stale: false, error: 'remote-context' }, 'fr')
    expect(widget.get('status').textContent).toContain('Contexte Docker distant')
    expect(widget.get('filters').hidden).toBe(true)
  })

  it('translates container states, including paused, created and restarting', () => {
    const widget = load(snapshot(['running', 'exited', 'dead', 'created', 'paused', 'restarting']
      .map((state) => container(state))), 'fr')
    widget.filter('all')
    const cards = widget.get('list').innerHTML
    expect(cards).toContain('En pause')
    expect(cards).toContain('Créé')
    expect(cards).toContain('Redémarrage')
    expect(cards).not.toContain('>paused ·')
    widget.filter('stopped')
    expect(widget.get('filter-stopped').textContent).toBe('Arrêtés (3)')
    widget.language('en')
    expect(widget.get('filter-stopped').textContent).toBe('Stopped (3)')
  })

  it('keeps measured values and question marks beside labelled icons', () => {
    const stats = { cpu: '2%', memory: '1MiB / 2GiB', netIO: '0B', blockIO: '0B' }
    const widget = load(snapshot([container('running', 'measured', stats), container('exited', 'unknown')]), 'fr')
    expect(widget.get('list').innerHTML).toContain('aria-label="CPU : 2%"')
    expect(widget.get('list').innerHTML).toContain('aria-label="Mémoire : 1MiB / 2GiB"')
    widget.filter('all')
    expect(widget.get('list').innerHTML).toContain('aria-label="CPU : ?"')
  })

  it('escapes names, images, status and metrics from Docker', () => {
    const unsafe = container('running', '<img src=x>', { cpu: '<b>', memory: '2', netIO: '0', blockIO: '0' })
    unsafe.image = '"><img src=x>'
    unsafe.status = '<script>'
    const widget = load(snapshot([unsafe]))
    const card = widget.get('list').innerHTML
    expect(card).toContain('&lt;img src=x&gt;')
    expect(card).toContain('&lt;script&gt;')
    expect(card).toContain('&lt;b&gt;')
    expect(card).not.toContain('<script>')
  })

  it('uses the frame title and a compact default size', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/docker-containers/manifest.json', import.meta.url), 'utf8'))
    expect(html).not.toMatch(/<h2|service-icon/)
    expect(html).toContain('html.accent-fill .filters button[aria-pressed="true"]')
    expect(manifest.defaultSize).toEqual([32, 8])
    expect(manifest.subscriptions).toEqual(['docker-local'])
    expect(manifest.commands).toEqual([])
  })
})
