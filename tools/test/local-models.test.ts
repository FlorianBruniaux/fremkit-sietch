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


describe('Local model tile',()=>{
 it('distinguishes installed from loaded and does not claim inference activity from a process',()=>{
  const part=(data:any)=>({data,stale:false,error:null});const w=load('local-models',{installed:part([{name:'example',size:100}]),loaded:part([]),mlx:part([])},'fr');expect(w.text()).toContain('Aucun modèle chargé');expect(w.text()).toContain('example');expect(w.text()).toContain('Aucun processus MLX détecté');expect(w.commands).toEqual([])
 })
})
