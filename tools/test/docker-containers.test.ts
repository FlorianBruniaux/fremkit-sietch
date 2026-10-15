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
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', hidden: false, style: { setProperty() {} }, setAttribute(this:any,name:string,value:string) { this[name]=value },
      addEventListener(type: string, cb: any) { handlers[id + ':' + type] = cb } })
    return elements.get(id)
  }
  const api = { locale, compact: false, slot: null, size: { px: { width: 800, height: 600 } },
    esc: (value: any) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)),
    t: (value: any, params: any = {}) => String(value[api.locale] || value.en).replace(/\{(\w+)\}/g, (_, k) => String(params[k])),
    whenReady: (cb: any) => cb(), onLocale: (cb: any) => { callbacks.locale = cb }, onResize: (cb: any) => { callbacks.resize = cb },
    subscribe: (channel: string, cb: any) => { channels.push(channel); callbacks.data = cb; if (data !== undefined) cb(data); return () => {} },
    sendCommand: (...args: any[]) => { commands.push(args); return typeof result === 'function' ? result() : Promise.resolve(result) } }
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '', {
    Fremkit: api, document: { getElementById: element, documentElement: { lang: 'en', style: { setProperty() {} } } },
    Date: class extends Date { static now() { return now } }, console,
  })
  return { elements, commands, channels, api, update: (d: any) => callbacks.data?.(d),
    language: (lang: string) => { api.locale = lang; callbacks.locale?.() },
    text: () => [...elements.values()].filter(e => !e.hidden).map(e => e.textContent + e.innerHTML).join(' '),
    filter: (id: string) => handlers[id + ':click']?.({}),
    click: (id: string) => handlers['list:click']?.({ target: { closest: () => ({ getAttribute: () => id }) } }) }
}


describe('Docker tile',()=>{
 it('defaults to running containers, preserves the filter across updates, and never sends commands',()=>{
  const rows=[{id:'a',name:'running-example',image:'image',state:'running',status:'Up',stats:null},{id:'b',name:'stopped-example',image:'image',state:'exited',status:'Exited',stats:null}]
  const w=load('docker-containers',{data:{containers:rows},stale:false,error:null},'fr')
  expect(w.elements.get('list').innerHTML).toContain('running-example');expect(w.elements.get('list').innerHTML).not.toContain('stopped-example')
  expect(w.elements.get('filter-active')['aria-pressed']).toBe('true')
  w.filter('filter-all');expect(w.elements.get('list').innerHTML).toContain('stopped-example');expect(w.elements.get('filter-all')['aria-pressed']).toBe('true')
  w.update({data:{containers:rows},stale:true,error:'offline'});expect(w.elements.get('list').innerHTML).toContain('stopped-example');expect(w.text()).toContain('Données anciennes')
  w.filter('filter-active');expect(w.elements.get('list').innerHTML).not.toContain('stopped-example');expect(w.commands).toEqual([])
 })
 it('does not invent zero counts while loading',()=>{
  const w=load('docker-containers',undefined,'fr');expect(w.elements.get('filter-active').textContent).toBe('Actifs');expect(w.elements.get('filter-all').textContent).toBe('Tous')
 })
 it('shows an empty active filter without losing stopped containers in All',()=>{
  const w=load('docker-containers',{data:{containers:[{id:'a',name:'stopped-only',image:'image',state:'exited',status:'Exited',stats:null}]},stale:false,error:null},'fr')
  expect(w.elements.get('empty').textContent).toBe('Aucun conteneur actif');expect(w.elements.get('empty').hidden).toBe(false)
  w.filter('filter-all');expect(w.elements.get('empty').hidden).toBe(true);expect(w.elements.get('list').innerHTML).toContain('stopped-only')
 })
 it('renders stopped containers as stopped with unknown usage',()=>{
  const w=load('docker-containers',{data:{containers:[{id:'abcd',name:'example',image:'example:latest',state:'exited',status:'Exited',stats:null}]},stale:false,error:null},'fr');w.filter('filter-all');expect(w.text()).toContain('Arrêté');expect(w.text()).toContain('example');expect(w.text()).toContain('Aucun conteneur actif');expect(w.elements.get('list').innerHTML).toContain('aria-label="CPU : ?"');expect(w.elements.get('list').innerHTML).toContain('aria-label="Mémoire : ?"');expect(w.elements.get('list').innerHTML).not.toContain('Inconnu');expect(w.commands).toEqual([])
 })
 it('filters stopped containers without classifying paused or restarting containers as stopped',()=>{
  const rows=['running','exited','dead','created','paused','restarting'].map(state=>({id:state,name:'example-'+state,image:'image',state,status:state,stats:null}))
  const w=load('docker-containers',{data:{containers:rows},stale:false,error:null},'fr')
  expect(w.elements.get('filter-stopped').textContent).toBe('Arrêtés (3)')
  w.filter('filter-stopped')
  for(const state of ['exited','dead','created'])expect(w.elements.get('list').innerHTML).toContain('example-'+state)
  for(const state of ['running','paused','restarting'])expect(w.elements.get('list').innerHTML).not.toContain('example-'+state)
  expect(w.elements.get('filter-stopped')['aria-pressed']).toBe('true')
  expect(w.elements.get('filter-active')['aria-pressed']).toBe('false')
  w.update({data:{containers:rows},stale:true,error:null});expect(w.elements.get('filter-stopped')['aria-pressed']).toBe('true')
  w.filter('filter-all');for(const row of rows)expect(w.elements.get('list').innerHTML).toContain(row.name)
  expect(w.commands).toEqual([])
 })
 it('shows the stopped empty state and translates the stopped filter',()=>{
  const w=load('docker-containers',{data:{containers:[]},stale:false,error:null},'fr');w.filter('filter-stopped')
  expect(w.elements.get('empty').textContent).toBe('Aucun conteneur arrêté');expect(w.elements.get('empty').hidden).toBe(false)
  w.language('en');expect(w.elements.get('filter-stopped').textContent).toBe('Stopped (0)');expect(w.elements.get('empty').textContent).toBe('No stopped containers')
 })
 it('uses labelled CPU and memory icons while preserving measured values',()=>{
  const w=load('docker-containers',{data:{containers:[{id:'a',name:'example',image:'image',state:'running',status:'Up',stats:{cpu:'2%',memory:'1MiB / 2GiB',netIO:'0B',blockIO:'0B'}}]},stale:false,error:null},'fr')
  const card=w.elements.get('list').innerHTML
  expect(card).toContain('aria-label="CPU : 2%"');expect(card).toContain('aria-label="Mémoire : 1MiB / 2GiB"');expect(card).toContain('class="metric-icon cpu-icon"');expect(card).toContain('class="metric-icon memory-icon"')
  expect(card).not.toContain('<span>CPU ');expect(card).not.toContain('<span>Mémoire ')
 })
 it('escapes arbitrary names while preserving stale indicators',()=>{
  const w=load('docker-containers',{data:{containers:[{id:'abcd',name:'<img src=x>',image:'example',state:'running',stats:{cpu:'2%',memory:'1MiB / 2GiB',memoryPercent:'1%',pids:'2',netIO:'0B',blockIO:'0B'}}]},stale:true,error:'offline'},'fr');expect(w.text()).toContain('&lt;img src=x&gt;');expect(w.text()).toContain('Données anciennes');expect(w.text()).toContain('2%')
 })
})
