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

describe('GitHub mark all read', () => {
  it('hides unread notifications immediately and leaves requested reviews visible', async () => {
    const widget = load('github-inbox', {
      runs: [], notifications: [{id: '101', title: 'Unread notice', type: 'issue', repo: 'o/r', updatedAt: Date.now()}],
      reviewRequests: [{id: '201', title: 'Requested review', repo: 'o/r', updatedAt: Date.now()}], myPrs: [],
    })
    expect(widget.elements.get('scroll').innerHTML).toContain('Unread notice')
    widget.markAll()
    await Promise.resolve()
    expect(widget.commands).toEqual([['github:gh-test', 'markAllRead', {}]])
    expect(widget.elements.get('scroll').innerHTML).not.toContain('Unread notice')
    expect(widget.elements.get('scroll').innerHTML).toContain('Requested review')
  })
})

describe('GitHub mark-read feedback', () => {
  it('explains the notification-only action after GitHub accepts it', async () => {
    const widget = load('github-inbox', { runs: [], notifications: [{id: '101', title: 'Unread notice', type: 'issue', repo: 'o/r', updatedAt: Date.now()}], reviewRequests: [], myPrs: [] })
    expect(widget.elements.get('markAll').textContent).toBe('Mark notifications read')
    widget.markAll()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise(resolve => setImmediate(resolve))
    expect(widget.elements.get('markFeedback').hidden).toBe(false)
    expect(widget.elements.get('markFeedback').textContent).toContain('Review requests remain')
  })
  it('restores unread notifications and shows a visible error when GitHub refuses the request', async () => {
    const widget = load('github-inbox', { runs: [], notifications: [{id: '101', title: 'Unread notice', type: 'issue', repo: 'o/r', updatedAt: Date.now()}], reviewRequests: [], myPrs: [] }, Promise.resolve({ok: false}))
    widget.markAll()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise(resolve => setImmediate(resolve))
    expect(widget.elements.get('scroll').innerHTML).toContain('Unread notice')
    expect(widget.elements.get('markFeedback').hidden).toBe(false)
    expect(widget.elements.get('markFeedback').textContent).toContain('Could not mark')
  })
})


describe('GitHub inbox local icons',()=>{
 it('marks a capped review list as a lower bound',()=>{
  const w=load('github-inbox',{runs:[],notifications:[],reviewRequests:Array.from({length:25},(_,i)=>({id:String(i),title:'Review',repo:'owner/repo',updatedAt:Date.now()})),myPrs:[]})
  expect(w.elements.get('counts').textContent).toBe('0 unread · 25+ reviews')
 })
 it('draws GitHub and notification icons without altering exact row destinations',()=>{
  const w=load('github-inbox',{runs:[],notifications:[{id:'1',type:'issue',title:'Issue',repo:'owner/repo',updatedAt:Date.now()}],reviewRequests:[],myPrs:[]})
  expect(w.html).toContain('service-icon')
  expect(w.elements.get('scroll').innerHTML).toContain('<svg')
  w.click({'data-id':'1','data-kind':'notification'})
  expect(w.commands).toEqual([['github:gh-test','open',{kind:'notification',id:'1'}]])
 })
})



describe('GitHub inbox destination', () => {
  it.each(['notification', 'review', 'pull'])('opens %s rows without marking notifications read', kind => {
    const widget = load('github-inbox')
    widget.click({ 'data-id': '123', 'data-kind': kind })
    expect(widget.commands).toEqual([['github:gh-test', 'open', { kind, id: '123' }]])
  })
})

describe('GitHub inbox repository filters', () => {
  it('narrows notifications by owner without losing other accounts', () => {
    const notice = (id: string, repo: string) => ({ id, repo, title: 'Notice ' + id, type: 'issue', updatedAt: Date.now() })
    const widget = load('github-inbox', { runs: [], notifications: [notice('1', 'alpha/api'), notice('2', 'beta/web')], reviewRequests: [], myPrs: [] })
    widget.filter('ownerFilter', 'alpha')
    expect(widget.elements.get('counts').textContent).toContain('1 unread')
    expect(widget.elements.get('scroll').innerHTML).toContain('Notice 1')
    expect(widget.elements.get('scroll').innerHTML).not.toContain('Notice 2')
    widget.filter('ownerFilter', '')
    expect(widget.elements.get('scroll').innerHTML).toContain('Notice 2')
  })
})

describe('GitHub inbox filtered mark-read', () => {
  it('marks only unread notifications matching the active owner', async () => {
    const notice = (id: string, repo: string) => ({ id, repo, title: 'Notice ' + id, type: 'issue', updatedAt: Date.now() })
    const widget = load('github-inbox', { runs: [], notifications: [notice('1', 'alpha/api'), notice('2', 'beta/web')], reviewRequests: [], myPrs: [] })
    widget.filter('ownerFilter', 'alpha')
    widget.markAll()
    await new Promise(resolve => setImmediate(resolve))
    expect(widget.commands).toEqual([['github:gh-test', 'markRead', { id: '1' }]])
    widget.filter('ownerFilter', '')
    expect(widget.elements.get('scroll').innerHTML).toContain('Notice 2')
    expect(widget.elements.get('scroll').innerHTML).not.toContain('Notice 1')
  })
})
