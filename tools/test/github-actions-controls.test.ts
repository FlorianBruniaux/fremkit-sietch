import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function load(id: string, snapshot = { runs: [] as any[], notifications: [] as any[], reviewRequests: [] as any[], myPrs: [] as any[] }, commandResult = Promise.resolve({ ok: true }), settings: Record<string,unknown> = {}, locale = 'en') {
  const html = readFileSync(new URL(`../../widgets/${id}/index.html`, import.meta.url), 'utf8')
  const handlers: Record<string, Record<string, (event: any) => void>> = {}
  const elements = new Map<string, any>()
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { hidden: false, style: { setProperty() {} }, classList: { toggle() {} },
      querySelectorAll() { return [] },
      addEventListener(type: string, handler: any) { (handlers[id] ??= {})[type] = handler } })
    return elements.get(id)
  }
  const callbacks: Record<string, any> = {}
  const ticks: (() => void)[] = []
  const commands: any[] = []
  const api = { locale, settings: { connection: 'gh-test', ...settings }, size: { px: { height: 500, width: 800 }, cells: { width: 20, height: 10 } },
    t: (text: any, params: Record<string,unknown> = {}) => (text[locale] ?? text.en).replace(/\{(\w+)\}/g, (_:string,k:string)=>String(params[k])), esc: (value: any) => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)), whenReady: (fn: any) => fn(), onLocale(fn:any) {callbacks.locale=fn}, onResize() {}, onSettings(fn:any) {callbacks.settings=fn},
    subscribe: (_channel: string, fn: any) => { callbacks.snapshot=fn; fn(snapshot); return () => {} },
    sendCommand: (...args: any[]) => { commands.push(args); return commandResult } }
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], {
    Fremkit: api, document: { getElementById: element, documentElement: { style: { setProperty() {} } } },
    setInterval(fn: () => void) { ticks.push(fn) }, setTimeout() {}, console,
  })
  return { commands, ticks, elements, html,
    update: (data:any)=>callbacks.snapshot(data),
    language: (lang:string)=>{locale=lang;api.locale=lang;callbacks.locale?.(lang)},
    settings: (data:any)=>callbacks.settings?.(data),
    filter: (id:string,value:string)=>handlers[id]?.change?.({target:{value}}),
    markAll: () => handlers.markAll?.click?.({}), click: (attributes: Record<string, string>) => handlers.scroll?.click?.({ target: {
    closest: () => ({ getAttribute: (name: string) => attributes[name] ?? null }) } }) }
}

describe('GitHub Actions touch stability', () => {
  it('keeps row elements in place when the elapsed-time timer ticks', () => {
    const widget = load('github-actions')
    const scroll = widget.elements.get('scroll')
    let replacements = 0
    Object.defineProperty(scroll, 'innerHTML', { set() { replacements++ } })
    widget.ticks[0]!()
    expect(replacements).toBe(0)
  })
})

describe('GitHub Actions destination', () => {
  it('opens a saved run through the host command', () => {
    const widget = load('github-actions')
    widget.click({ 'data-id': '123', 'data-kind': 'run' })
    expect(widget.commands).toEqual([['github:gh-test', 'open', { kind: 'run', id: '123' }]])
  })
  it('keeps each row as a large button without drawing a second tile title', () => {
    const run = { id: '123', repo: 'owner/repo', name: 'Workflow', status: 'completed', conclusion: 'success', branch: 'main', updatedAt: Date.now() }
    const widget = load('github-actions', { runs: [run], notifications: [], reviewRequests: [], myPrs: [] })
    expect(widget.elements.get('scroll').innerHTML).toContain('<button type="button" class="row')
    expect(widget.html).not.toContain('<h2>GitHub Actions</h2>')
  })
})
