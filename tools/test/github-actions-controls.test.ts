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

describe('GitHub Actions readable summary',()=>{
  const run=(id:string,status:string,conclusion?:string,repo='owner/repo')=>({id,status,conclusion,repo,name:'Workflow',branch:'main',updatedAt:Date.now()})
  it('counts loaded runs from selected repositories before row display limits',()=>{
    const runs=[run('1','running'),run('2','queued'),run('3','completed','success'),run('4','completed','failure'),run('5','completed','timed_out'),run('6','completed','cancelled'),run('7','completed','failure','other/repo')]
    const w=load('github-actions',{runs,notifications:[],reviewRequests:[],myPrs:[]},undefined,{repos:['owner/repo'],max:1,history:1},'fr')
    expect(w.elements.get('runningCount').textContent).toBe('1')
    expect(w.elements.get('queuedCount').textContent).toBe('1')
    expect(w.elements.get('successCount').textContent).toBe('1')
    expect(w.elements.get('failureCount').textContent).toBe('2')
    expect(w.elements.get('summaryNote').textContent).toBe('6 exécutions chargées · 2 affichées')
    expect(w.elements.get('scroll').innerHTML).toContain('En cours')
    expect(w.commands).toEqual([])
  })
  it('uses unknown counters when the runs source is unavailable, while preserving old rows',()=>{
    const data={runs:[run('1','completed','failure')],notifications:[],reviewRequests:[],myPrs:[],errors:{runs:'forbidden'}}
    const w=load('github-actions',data)
    expect(w.elements.get('failureCount').textContent).toBe('?')
    expect(w.elements.get('summaryNote').textContent).toContain('unavailable')
    expect(w.elements.get('scroll').innerHTML).toContain('Workflow')
  })
  it('labels success and timeout with icons and text, independent of color',()=>{
    const w=load('github-actions',{runs:[run('1','completed','success'),run('2','completed','timed_out')],notifications:[],reviewRequests:[],myPrs:[]},undefined,{},'fr')
    expect(w.elements.get('scroll').innerHTML).toContain('Réussi')
    expect(w.elements.get('scroll').innerHTML).toContain('Délai dépassé')
    expect(w.elements.get('scroll').innerHTML).toContain('<svg')
    expect(w.html).toContain('service-icon')
  })
  it('shows fresh empty counts as zero without guessing failures',()=>{
    const w=load('github-actions')
    expect(w.elements.get('failureCount').textContent).toBe('0')
    expect(w.elements.get('summaryNote').textContent).toBe('0 loaded runs · 0 shown')
  })
})


describe('GitHub Actions destination', () => {
  it('opens a saved run through the host command', () => {
    const widget = load('github-actions')
    widget.click({ 'data-id': '123', 'data-kind': 'run' })
    expect(widget.commands).toEqual([['github:gh-test', 'open', { kind: 'run', id: '123' }]])
  })
})

describe('GitHub Actions repository filters', () => {
  it('narrows runs by owner and repository before counting', () => {
    const run = (id: string, repo: string) => ({ id, repo, name: 'Workflow ' + id, status: 'completed', conclusion: 'success', branch: 'main', updatedAt: Date.now() })
    const widget = load('github-actions', { runs: [run('1', 'alpha/api'), run('2', 'beta/web')], notifications: [], reviewRequests: [], myPrs: [] })
    widget.filter('ownerFilter', 'alpha')
    expect(widget.elements.get('summaryNote').textContent).toContain('1 loaded runs')
    expect(widget.elements.get('scroll').innerHTML).toContain('alpha/api')
    expect(widget.elements.get('scroll').innerHTML).not.toContain('beta/web')
  })
})
