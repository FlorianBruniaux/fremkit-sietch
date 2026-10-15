import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const now = 1800000000000
const first = '00000000-0000-4000-8000-000000000001'
const second = '00000000-0000-4000-8000-000000000002'
const part = (data: any, freshness = 'fresh', error: string | null = null) => ({ data, freshness, error, updatedAt: now })
const thread = (id = first, navigation: string | undefined = 'localChat') => ({ id, title: 'Shared title', sourceKind: 'appServer', createdAt: 1799999990, updatedAt: 1799999999, liveActivity: null, navigation })
const snapshot = (threads = [thread()]) => ({ sourceKind: 'localAppServer', authMode: 'chatgpt', checkedAt: now, error: null,
  history: part({ threads, nextCursor: null, truncated: false }), quotas: part({ buckets: [] }),
  usage: part({ summary: { lifetimeTokens: null, peakDailyTokens: null, currentStreakDays: null, longestStreakDays: null, longestRunningTurnSec: null }, dailyUsageBuckets: null }) })

// Runs the delivered inline widget, substituting only its iframe host/DOM boundary.
function load(id: string, data?: any, locale = 'en', result: any = { ok: true }) {
  const path = new URL(`../../widgets/${id}/index.html`, import.meta.url)
  const html = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const elements = new Map<string, any>(), handlers: Record<string, any> = {}, callbacks: Record<string, any> = {}, commands: any[] = [], channels: string[] = []
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', hidden: false, style: { setProperty() {} },
      addEventListener(type: string, cb: any) { handlers[id + ':' + type] = cb } })
    return elements.get(id)
  }
  const api = { locale, compact: false, slot: null, size: { px: { width: 800, height: 600 } },
    esc: (value: any) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)),
    t: (value: any, params: any = {}) => String(value[api.locale] || value.en).replace(/\{(\w+)\}/g, (_, k) => String(params[k])),
    whenReady: (cb: any) => cb(), onLocale: (cb: any) => { callbacks.locale = cb }, onResize: (cb: any) => { callbacks.resize = cb },
    subscribe: (channel: string, cb: any) => { channels.push(channel); callbacks[channel] = cb; if (channel === 'codex' && data !== undefined) cb(data); return () => {} },
    sendCommand: (...args: any[]) => { commands.push(args); return typeof result === 'function' ? result() : Promise.resolve(result) } }
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '', {
    Fremkit: api, document: { getElementById: element, documentElement: { lang: 'en', style: { setProperty() {} } } },
    Date: class extends Date { static now() { return now } }, console,
  })
  return { elements, commands, channels, api, update: (d: any) => callbacks.codex?.(d),
    language: (lang: string) => { api.locale = lang; callbacks.locale?.() },
    text: () => [...elements.values()].filter(e => !e.hidden).map(e => e.textContent + e.innerHTML).join(' '),
    observations: (d: any) => callbacks['codex-live']?.(d),
    group: (key: string) => handlers['list:click']?.({target:{closest:(selector:string)=>selector.includes('data-group')?{getAttribute:()=>key}:null}}),
    agents: (id: string) => handlers['list:click']?.({target:{closest:(selector:string)=>selector.includes('data-parent')?{getAttribute:()=>id}:null}}),
    click: (id: string) => handlers['list:click']?.({ target: { closest: (selector:string) => selector.includes('data-id') ? ({ getAttribute: () => id }) : null } }) }
}

describe('Codex history widget', () => {
  it('opens duplicate titles by their distinct stored UUIDs through the core command', () => {
    const widget = load('codex-sessions', snapshot([thread(first), thread(second)]))
    widget.click(first); widget.click(second)
    expect(widget.commands).toEqual([['codex', 'open', { threadId: first }], ['codex', 'open', { threadId: second }]])
  })
  it.each(['unavailable', undefined])('refuses a record with navigation %s even with an appServer source', navigation => {
    const item = thread(); item.navigation = navigation as any
    const widget = load('codex-sessions', snapshot([item]))
    widget.click(first)
    expect(widget.commands).toEqual([])
    expect(widget.text()).toContain('Opening unavailable')
  })
  it('refuses stale records and keeps their history visible', () => {
    const data = snapshot(); data.history = part(data.history.data, 'stale', 'offline')
    const widget = load('codex-sessions', data); widget.click(first)
    expect(widget.commands).toEqual([])
    expect(widget.text()).toContain('Shared title'); expect(widget.text()).toContain('Stale')
  })
  it('refuses old or unknown IDs rather than relying on rendered attributes', () => {
    const data = snapshot(); data.history.updatedAt = now - 120001
    const widget = load('codex-sessions', data); widget.click(first); widget.click('untrusted')
    expect(widget.commands).toEqual([])
  })
  it('labels history and unknown project/live activity without claiming idle', () => {
    const widget = load('codex-sessions', snapshot())
    expect(widget.channels).toEqual(['codex-live','codex'])
    expect(widget.text()).toContain('History'); expect(widget.text()).toContain('Project: unknown')
    expect(widget.text()).toContain('Live activity: unknown'); expect(widget.text()).not.toContain('Idle')
  })
  it('escapes stored titles and bounds displayed history with a disclosure', () => {
    const data = snapshot(Array.from({ length: 51 }, (_, i) => ({ ...thread(first), title: i === 0 ? '<img src=x>' : 'Title ' + i })))
    data.history.data.truncated = true
    const widget = load('codex-sessions', data)
    const list = widget.elements.get('list')?.innerHTML || ''
    expect(list).toContain('&lt;img src=x&gt;'); expect(list).not.toContain('<img src=x>')
    expect(list.match(/class="row/g)?.length).toBe(50)
    expect(widget.text()).toContain('Showing 50 of 51'); expect(widget.text()).toContain('More history available')
  })
  it('opens cards beyond the old eight-session limit and rejects records outside the displayed bound', () => {
    const ids = Array.from({ length: 51 }, (_, i) => '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'))
    const widget = load('codex-sessions', snapshot(ids.map(id => thread(id))))
    widget.click(ids[8]); widget.click(ids[49]); widget.click(ids[50]); widget.click('untrusted')
    expect(widget.commands).toEqual([['codex', 'open', { threadId: ids[8] }], ['codex', 'open', { threadId: ids[49] }]])
  })
  it('distinguishes fresh empty history from stale empty history', () => {
    const data = snapshot([]), widget = load('codex-sessions', data)
    expect(widget.text()).toContain('No stored history')
    widget.update({ ...data, history: part(data.history.data, 'stale', 'offline') })
    expect(widget.text()).toContain('Stale'); expect(widget.text()).not.toContain('No stored history')
  })
  it('reports a core opening refusal', async () => {
    const widget = load('codex-sessions', snapshot(), 'en', { ok: false, error: 'unavailable' }); widget.click(first)
    await new Promise(resolve => setImmediate(resolve))
    expect(widget.text()).toContain('Could not open this stored session')
  })
})

for (const id of ['codex-sessions']) {
  describe(id + ' availability and language', () => {
    it('shows loading before a snapshot', () => { expect(load(id).text()).toContain('Loading') })
    it.each([['unconfigured', 'Not configured'], ['unauthorized', 'Account authorization required'], ['unsupported', 'Method unsupported'], ['offline', 'Offline'], ['invalid', 'Invalid provider data']])('distinguishes %s', (error, label) => {
      const data = snapshot(); data.history = part(null, 'unavailable', error); data.quotas = part(null, 'unavailable', error); data.usage = part(null, 'unavailable', error)
      expect(load(id, data).text()).toContain(label)
    })
    it('updates labels on a French locale change', () => {
      const widget = load(id); widget.language('fr')
      expect(widget.text()).toContain('Chargement')
    })
  })
}

describe('Codex current action feedback', () => {
  it('shows opening and host success for the exact UUID', async () => {
    let resolve: any
    const widget=load('codex-sessions',snapshot(),'en',()=>new Promise(r=>{resolve=r}))
    widget.click(second);expect(widget.commands).toEqual([])
    widget.click(first);expect(widget.text()).toContain('Opening on the Mac')
    expect(widget.commands).toEqual([['codex','open',{threadId:first}]])
    resolve({ok:true});await new Promise(r=>setImmediate(r))
    expect(widget.text()).toContain('Session opened on the Mac')
    widget.language('fr');expect(widget.text()).toContain('Session ouverte sur le Mac')
  })
  it('drops obsolete feedback when a new snapshot replaces the selected history', async () => {
    let resolve: any
    const widget=load('codex-sessions',snapshot(),'en',()=>new Promise(r=>{resolve=r}))
    widget.click(first);widget.update(snapshot([thread(second)]));resolve({ok:false})
    await new Promise(r=>setImmediate(r))
    expect(widget.text()).not.toContain('Could not open this stored session')
    expect(widget.text()).not.toContain('Opening on the Mac')
  })
})
describe('Codex observed session cards',()=>{
 const observed=(extra:any={})=>({id:first,parentId:null,state:'working',turnId:'turn-a',startedAt:now-420000,finishedAt:null,lastEventAt:now,model:'gpt-example',effort:'high',modelSource:'turn',durationMs:null,project:'example-project',branch:'main',nickname:null,role:null,agentName:null,subagents:[],agentsTruncated:false,...extra})
 const live=(sessions:any[])=>({sessions,updatedAt:now,error:null,truncated:false})
 it('shows the observed model, effort, project and elapsed turn time rather than session age',()=>{const w=load('codex-sessions',snapshot(),'fr');w.observations(live([observed()]));const html=w.elements.get('list').innerHTML;expect(html).toContain('gpt-example');expect(html).toContain('thinking high');expect(html).toContain('example-project @ main');expect(html).toContain('Tour : 7 min');expect(html).toContain('En travail');expect(w.text()).not.toContain('Projet : inconnu');w.click(first);expect(w.commands).toEqual([['codex','open',{threadId:first}]])})
 it('opens a separate child panel without navigating the parent or sending a prompt',()=>{const w=load('codex-sessions',snapshot(),'fr');w.observations(live([observed({subagents:[observed({id:second,parentId:first,agentName:'check',nickname:'Example Agent',role:'worker',model:'gpt-child',state:'done',durationMs:120000,finishedAt:now})]})]));expect(w.elements.get('agents').hidden).toBe(true);w.agents(first);expect(w.elements.get('agents').hidden).toBe(false);expect(w.elements.get('agentList').innerHTML).toContain('gpt-child');expect(w.elements.get('agentList').innerHTML).toContain('Terminé');expect(w.elements.get('agentList').innerHTML).toContain('2 min');expect(w.commands).toEqual([]);w.agents(first);expect(w.elements.get('agents').hidden).toBe(true)})
 it('does not paint cached or old observations as current work and keeps the completed duration finite',()=>{const w=load('codex-sessions',snapshot());w.observations({...live([observed()]),updatedAt:now-16000});expect(w.elements.get('list').innerHTML).toContain('Unknown activity');expect(w.elements.get('list').innerHTML).not.toContain('>Working<');w.observations(live([observed({state:'done',durationMs:420000,finishedAt:now-100000})]));expect(w.elements.get('list').innerHTML).toContain('Turn: 7 min');expect(w.elements.get('list').innerHTML).toContain('Finished')})
 it('escapes agent names, models and project data, including the detail panel',()=>{const w=load('codex-sessions',snapshot());w.observations(live([observed({project:'<img>',model:'<script>',subagents:[observed({id:second,agentName:'<b>agent</b>',model:'<script>'})]})]));w.agents(first);expect(w.elements.get('list').innerHTML).toContain('&lt;script&gt;');expect(w.elements.get('agentList').innerHTML).toContain('&lt;b&gt;agent&lt;/b&gt;');expect(w.elements.get('agentList').innerHTML).not.toContain('<script>')})
 it('shows the exact agent count and identifies a partial detail list',()=>{const w=load('codex-sessions',snapshot(),'fr');w.observations(live([observed({subagentCount:27,agentsTruncated:true,subagents:[observed({id:second,agentName:'check'})]})]));expect(w.elements.get('list').innerHTML).toContain('27 agents');w.agents(first);expect(w.elements.get('agentsTitle').textContent).toContain('1 sur 27 agents');expect(w.elements.get('agentsNote').textContent).toBe('Liste des agents partielle');expect(w.commands).toEqual([])})
 it('removes the expanded panel when its parent is no longer present and localizes model labels',()=>{const w=load('codex-sessions',snapshot());w.observations(live([observed({subagents:[observed({id:second})]})]));w.agents(first);w.observations(live([]));expect(w.elements.get('agents').hidden).toBe(true);w.observations(live([observed({modelSource:'stored'})]));w.language('fr');expect(w.elements.get('list').innerHTML).toContain('Dernier modèle enregistré')})
})


describe('Codex repository groups',()=>{
 const live=(sessions:any[])=>({sessions,updatedAt:now,error:null,truncated:false})
 const observed=(id:string,extra:any={})=>({id,parentId:null,state:'working',startedAt:now-60000,finishedAt:null,lastEventAt:now,model:'example-model',effort:'high',project:'Client App',projectId:'repo-a',branch:'main',subagents:[],...extra})
 it('groups using the saved project ID/name, preserving history order inside each group and exact opening',()=>{
  const third='00000000-0000-4000-8000-000000000003',w=load('codex-sessions',snapshot([thread(first),thread(second),thread(third)]))
  w.observations(live([observed(first),observed(second,{project:'Tools',projectId:'repo-b'}),observed(third)]))
  const html=w.elements.get('list').innerHTML;expect(html.match(/class="repo-group"/g)).toHaveLength(2);expect(html).toContain('Client App');expect(html).toContain('2 sessions');expect(html.indexOf('data-id="'+first)).toBeLessThan(html.indexOf('data-id="'+third));expect(html.indexOf('data-id="'+third)).toBeLessThan(html.indexOf('data-id="'+second));w.click(third);expect(w.commands).toEqual([['codex','open',{threadId:third}]])
 })
 it('does not merge identically named projects or confuse unknown metadata with projectless',()=>{
  const third='00000000-0000-4000-8000-000000000003',fourth='00000000-0000-4000-8000-000000000004',w=load('codex-sessions',snapshot([thread(first),thread(second),thread(third),thread(fourth)]),'fr')
  w.observations(live([observed(first),observed(second,{projectId:'repo-b'}),observed(third,{projectId:null})]));const html=w.elements.get('list').innerHTML;expect(html.match(/class="repo-group"/g)).toHaveLength(4);expect(html).toContain('Sans projet');expect(html).toContain('Projet inconnu')
 })
 it('collapses a group without navigation, closes its agent panel and preserves collapse through updates',()=>{
  const w=load('codex-sessions',snapshot());w.observations(live([observed(first,{subagents:[observed(second)]})]));w.agents(first);expect(w.elements.get('agents').hidden).toBe(false);w.group('project:repo-a');expect(w.elements.get('list').innerHTML).toContain('aria-expanded="false"');expect(w.elements.get('agents').hidden).toBe(true);w.click(first);expect(w.commands).toEqual([]);w.observations(live([observed(first)]));expect(w.elements.get('list').innerHTML).toContain('id="repo-cards-0" hidden');w.group('project:repo-a');w.click(first);expect(w.commands).toEqual([['codex','open',{threadId:first}]])
 })
 it('keeps old host directory labels, escapes project names and refreshes renamed labels',()=>{
  const w=load('codex-sessions',snapshot());w.observations(live([observed(first,{project:'<img src=x>',projectId:undefined})]));expect(w.elements.get('list').innerHTML).toContain('&lt;img src=x&gt;');expect(w.elements.get('list').innerHTML).not.toContain('<img src=x>');w.observations(live([observed(first,{project:'Renamed'})]));expect(w.elements.get('list').innerHTML).toContain('Renamed')
 })
})
