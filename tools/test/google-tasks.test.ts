import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const now = Date.parse('2026-10-12T12:00:00Z')
const task = (id = 'same') => ({ id, title: '<b>Example task</b>', status: 'needsAction', parent: null, dueDate: '2026-10-12', notes: 'Example notes', open: { available: true, reason: null } })
const snapshot = (id = 'a') => ({ connectionId: id, account: { email: id+'@example.com', color: '#335577' }, lists: [{ id: 'shared', title: 'Work', tasks: [task()], freshness: 'fresh', updatedAt: now, error: null, truncated: false }], freshness: 'fresh', updatedAt: now, error: null, truncated: false })
function load(fixtures: Record<string, any> = { a: snapshot(), b: snapshot('b') }, result: any = { ok: true }) {
  const html = readFileSync(new URL('../../widgets/google-tasks/index.html', import.meta.url), 'utf8')
  const elements = new Map<string, any>(), handlers: Record<string, any> = {}, callbacks: Record<string, any> = {}, subs: any[] = [], commands: any[] = []
  const el = (id: string) => { if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', hidden: false, value: '', addEventListener: (event: string, f: any) => { handlers[id+':'+event] = f } });return elements.get(id) }
  const api = { locale: 'en', settings: { accounts: ['a','b'] }, t: (value: any, params: Record<string,any> = {}) => String(value[api.locale] || value.en).replace(/\{(\w+)\}/g, (_, k) => String(params[k])), esc: (v: any) => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!)), whenReady: (f: any) => f(), onSettings: (f: any) => { callbacks.settings = f }, onLocale: (f: any) => { callbacks.locale = f }, subscribe: (channel: string, f: any) => { const s={ channel, f, stopped: false };subs.push(s);if (fixtures[channel.split(':')[1]])f(fixtures[channel.split(':')[1]]);return () => {s.stopped=true} }, sendCommand: (...args: any[]) => {commands.push(args);return typeof result==='function'?result():Promise.resolve(result)} }
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], { Fremkit: api, document: { getElementById: el, documentElement: { lang: 'en' } }, Date: class extends Date { static now() {return now} }, Intl, setInterval(){} })
  return { elements, commands, subs, board: () => el('board').innerHTML, text: () => [...elements.values()].filter(x=>!x.hidden).map(x=>x.innerHTML+x.textContent).join(' '), filter: (id: string,value: string) => {el(id).value=value;handlers[id+':change']({ target: el(id) })}, update: (id: string, data: any) => subs.filter(s=>s.channel==='google-tasks:'+id).at(-1)?.f(data), settings: (accounts: string[]) => callbacks.settings({accounts}), locale: (locale: string) => {api.locale=locale;callbacks.locale(locale)}, click: (id='a',list='shared',taskId='same') => handlers['board:click']({target:{closest:()=>({getAttribute:(k:string)=>({'data-connection':id,'data-list':list,'data-task':taskId}[k])})}}) }
}
const settle=()=>new Promise(r=>setImmediate(r))
describe('Google Tasks board',()=>{
  it('shows all selected accounts as separate list columns, escapes titles and preserves dates',()=>{
    const w=load();expect(w.board()).toContain('a@example.com');expect(w.board()).toContain('b@example.com');expect(w.board()).toContain('&lt;b&gt;Example task&lt;/b&gt;');expect(w.board()).toContain('12 Oct 2026');expect(w.board()).not.toContain('<b>Example task');expect(w.text()).toContain('2 tasks shown');expect(w.board()).toContain('--account-color:#335577')
  })
  it('filters identical list IDs by exact account/list tuple and resets the list when the account changes',()=>{
    const w=load();w.filter('listFilter',JSON.stringify(['b','shared']));expect(w.board()).not.toContain('a@example.com');expect(w.board()).toContain('b@example.com');w.filter('accountFilter','a');expect(w.board()).toContain('a@example.com');expect(w.board()).not.toContain('b@example.com')
  })
  it('supports pending, completed, all, today and past-date filters without modifying tasks',()=>{
    const a=snapshot();a.lists[0].tasks.push({...task('done'),status:'completed',title:'Finished'},{...task('old'),dueDate:'2026-10-10',title:'Past date'})
    const w=load({a});w.settings(['a']);expect(w.board()).not.toContain('Finished');w.filter('stateFilter','completed');expect(w.board()).toContain('Finished');expect(w.board()).not.toContain('Past date');w.filter('stateFilter','all');expect(w.board()).toContain('Past date');w.filter('stateFilter','today');expect(w.board()).not.toContain('Past date');w.filter('stateFilter','overdue');expect(w.board()).toContain('Past date');expect(w.board()).not.toContain('Example task');expect(w.commands).toEqual([])
  })
  it('keeps healthy accounts visible and explains missing authorization instead of an empty board',()=>{
    const w=load({a:snapshot(),b:{...snapshot('b'),lists:null,error:'forbidden',freshness:'unavailable',updatedAt:null}});expect(w.board()).toContain('Example task');expect(w.text()).toContain('Authorize Google Tasks');w.filter('accountFilter','b');expect(w.board()).toContain('Data unavailable');expect(w.board()).not.toContain('No lists')
  })
  it('shows per-list failures and loaded-empty separately, retaining healthy lists',()=>{
    const a=snapshot();a.lists.push({id:'bad',title:'Unavailable',tasks:null as any,freshness:'unavailable',updatedAt:null as any,error:'timeout' as any,truncated:false},{id:'empty',title:'Empty',tasks:[],freshness:'fresh',updatedAt:now,error:null,truncated:false})
    const w=load({a});w.settings(['a']);expect(w.board()).toContain('Request timed out');expect(w.board()).toContain('Data unavailable');expect(w.board()).toContain('No tasks matching this filter');expect(w.board()).toContain('Example task')
  })
  it('discloses incomplete results and disables unsupported or stale task opening',()=>{
    const a=snapshot();a.lists[0].truncated=true;a.lists[0].tasks[0].open={available:false,reason:'unsupportedDestination' as any};const w=load({a});w.settings(['a']);expect(w.text()).toContain('Partial view');expect(w.board()).toContain('disabled');w.click();expect(w.commands).toEqual([]);a.lists[0].tasks[0].open={available:true,reason:null};a.lists[0].updatedAt=now-120001;w.update('a',a);w.click();expect(w.commands).toEqual([]);expect(w.board()).toContain('Stale data')
  })
  it('opens the exact selected resource through its account service and reports feedback',async()=>{
    const w=load();w.click('b');await settle();expect(w.commands).toEqual([['google-tasks:b','open',{connectionId:'b',listId:'shared',taskId:'same'}]]);expect(w.text()).toContain('Task opened on the Mac')
  })
  it('suppresses late feedback after a filter change or account removal and late snapshots after removal',async()=>{
    let release!:(x:any)=>void;const w=load(undefined,()=>new Promise(r=>{release=r}));w.click();w.filter('accountFilter','b');release({ok:true});await settle();expect(w.text()).not.toContain('Task opened on the Mac');const old=w.subs[0];w.settings(['b']);old.f(snapshot());expect(w.board()).not.toContain('a@example.com')
  })
  it('rejects cross-account snapshot injection and ignores invalid filters and unselected clicks',()=>{
    const w=load();w.update('a',snapshot('b'));w.filter('accountFilter','unselected');w.click('unselected');expect(w.commands).toEqual([]);expect(w.board()).not.toContain('a@example.com');expect(w.board()).toContain('b@example.com')
  })
  it('renders translated setup and statuses in French',()=>{
    const w=load();w.locale('fr');expect(w.text()).toContain('Lecture seule');expect(w.board()).toContain('Prévue le 12 oct. 2026');expect(w.text()).toContain('Toutes les listes')
  })
})
