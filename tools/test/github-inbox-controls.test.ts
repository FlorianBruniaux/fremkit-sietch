import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

type RowKind = 'notification' | 'review' | 'pull'
const notice = (id: string) => ({ id, title: `Notice ${id}`, type: 'issue', repo: 'owner/repo', updatedAt: Date.now() })
const snapshot = (notifications: unknown[] = [], reviews: unknown[] = []) => ({ notifications, reviewRequests: reviews, myPrs: [] })

function load(data: unknown, commandResult: unknown = { ok: true }) {
  const html = readFileSync(new URL('../../widgets/github-inbox/index.html', import.meta.url), 'utf8')
  const elements = new Map<string, any>()
  const handlers: Record<string, Record<string, (event: any) => void>> = {}
  const callbacks: Record<string, (data: any) => void> = {}
  const timers: (() => void)[] = []
  const intervals: (() => void)[] = []
  const commands: unknown[][] = []
  let now = Date.now()
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { hidden: false, style: { setProperty() {} }, classList: { toggle() {} },
      addEventListener(type: string, handler: (event: any) => void) { (handlers[id] ??= {})[type] = handler } })
    return elements.get(id)
  }
  const document: any = { activeElement: null, getElementById: element, documentElement: { style: { setProperty() {} } } }
  const scroll = element('scroll')
  let listHtml = ''
  let replacements = 0
  Object.defineProperty(scroll, 'innerHTML', { get: () => listHtml, set: (value: string) => { listHtml = value; replacements++; if (document.activeElement?.inScroll) document.activeElement = null } })
  scroll.contains = (item: any) => item?.inScroll === true
  scroll.querySelectorAll = (selector: string) => {
    if (selector !== 'button[data-focus]') return []
    return [...listHtml.matchAll(/<button\b[^>]*data-focus="([^"]+)"/g)].map(match => ({
      inScroll: true,
      getAttribute: (name: string) => name === 'data-focus' ? match[1] : null,
      focus() { document.activeElement = this }
    }))
  }
  const api = {
    locale: 'en', compact: false, settings: { connection: 'gh-test' }, size: { px: { height: 500 } },
    t: (text: {en: string}, params: Record<string, unknown> = {}) => text.en.replace(/\{(\w+)\}/g, (_, key) => String(params[key])),
    esc: (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!),
    whenReady: (fn: () => void) => fn(), onLocale() {}, onResize() {}, onSettings() {},
    subscribe: (_channel: string, fn: (data: any) => void) => { callbacks.snapshot = fn; fn(data); return () => {} },
    sendCommand: (...args: unknown[]) => { commands.push(args); return Promise.resolve(commandResult) },
  }
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], {
    Fremkit: api, document,
    Date: { now: () => now }, setInterval(fn: () => void) { intervals.push(fn) }, setTimeout(fn: () => void) { timers.push(fn) },
  })
  function click(kind: RowKind, id: string, open = false) {
    const row = { getAttribute: (name: string) => ({ 'data-kind': kind, 'data-id': id })[name] ?? null }
    const target = { closest: (selector: string) => {
      if (selector === '[data-open]' && open) return { getAttribute: () => kind, closest: () => row }
      if (selector === '[data-mark]' && kind === 'notification' && !open) return { closest: () => row }
      if (selector === 'button.row' && kind !== 'notification') return row
      return null
    } }
    handlers.scroll.click({ target })
  }
  return {
    html, elements, commands, click,
    markAll: () => handlers.markAll.click({}),
    advance: (ms: number) => { now += ms; timers.splice(0).forEach(fn => fn()) },
    tick: () => intervals.forEach(fn => fn()),
    focus: (key: string) => { document.activeElement = scroll.querySelectorAll('button[data-focus]').find((item: any) => item.getAttribute('data-focus') === key) },
    focused: () => document.activeElement?.getAttribute('data-focus'),
    replacements: () => replacements,
  }
}

async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('GitHub inbox actions', () => {
  it('keeps notification tap-to-mark-read and exposes a separate open button', async () => {
    const widget = load(snapshot([notice('101')]))
    widget.click('notification', '101')
    await settle()
    expect(widget.commands).toEqual([['github:gh-test', 'markRead', { id: '101' }]])
    expect(widget.elements.get('scroll').innerHTML).not.toContain('Notice 101')
    widget.click('notification', '101', true)
    await settle()
    expect(widget.commands.at(-1)).toEqual(['github:gh-test', 'open', { kind: 'notification', id: '101' }])
    expect(widget.html).not.toContain('<h2>GitHub inbox</h2>')
    expect(widget.elements.get('scroll').innerHTML).not.toContain('role="button"')
  })

  it('retains the focused Open control and card elements on a timer tick', () => {
    const widget = load(snapshot([notice('101')]))
    widget.focus('open:101')
    const before = widget.replacements()
    widget.tick()
    expect(widget.replacements()).toBe(before)
    expect(widget.focused()).toBe('open:101')
  })

  it.each(['review', 'pull'] as const)('opens a saved %s row by id', async kind => {
    const widget = load(snapshot())
    widget.click(kind, '201')
    await settle()
    expect(widget.commands).toEqual([['github:gh-test', 'open', { kind, id: '201' }]])
  })

  it('restores an unread notification and hides the error after five seconds on refusal', async () => {
    const widget = load(snapshot([notice('101')]), { ok: false })
    widget.click('notification', '101')
    await settle()
    expect(widget.elements.get('scroll').innerHTML).toContain('Notice 101')
    expect(widget.elements.get('actionError').hidden).toBe(false)
    widget.advance(5000)
    expect(widget.elements.get('actionError').hidden).toBe(true)
  })

  it('uses one command to mark every notification, leaving reviews visible', async () => {
    const widget = load(snapshot([notice('101')], [{ id: '201', title: 'Review', repo: 'owner/repo', updatedAt: Date.now() }]))
    widget.markAll()
    await settle()
    expect(widget.commands).toEqual([['github:gh-test', 'markAllRead', {}]])
    expect(widget.elements.get('scroll').innerHTML).not.toContain('Notice 101')
    expect(widget.elements.get('scroll').innerHTML).toContain('Review')
  })
})
