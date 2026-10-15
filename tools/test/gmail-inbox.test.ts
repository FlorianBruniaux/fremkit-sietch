import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const now = Date.parse('2026-10-10T12:00:00Z')
const unavailable = { available: false, reason: 'accountRoutingUnverified' }
const message = (id = 'same-id', receivedAt: number | null = now) => ({ id, threadId: 'thread-' + id, sender: 'Sender <sender@example.com>', subject: 'Shared subject', date: null, receivedAt, labels: ['UNREAD'], open: unavailable })
const mail = (connectionId = 'account-a', messages: any[] | null = [message()]) => ({ connectionId, account: { email: connectionId + '@example.com' }, messages, loadedCount: messages?.length ?? null, estimatedUnreadCount: messages?.length ?? null, truncated: false, updatedAt: now, checkedAt: now, freshness: 'fresh', error: null })
const event = (connectionId = 'account-a', calendarId = 'primary', id = 'same-id', start = now + 60000) => ({ id, connectionId, calendarId, calendarLabel: 'Work', title: 'Shared event', start, end: start + 3600000, allDay: false, startDate: null, endDate: null, timeZone: 'Europe/Paris', recurringEventId: null, color: '#335577', open: unavailable, join: { available: true, reason: null } })
const agenda = (connectionId = 'account-a', events: any[] | null = [event(connectionId)]) => ({ connectionId, account: { email: connectionId + '@example.com' }, calendars: [{ id: 'primary', label: 'Work', timeZone: 'Europe/Paris', selected: true, events, truncated: false, updatedAt: now, freshness: 'fresh', error: null }], events, window: { start: now, end: now + 86400000 }, truncated: false, updatedAt: now, checkedAt: now, freshness: 'fresh', error: null })

// Execute the delivered code; replace only the iframe's DOM and provider boundaries.
function load(id: string, fixtures: Record<string, any> = {}, locale = 'en', result: any = { ok: true }, compact = false) {
  const path = new URL(`../../widgets/${id}/index.html`, import.meta.url)
  const html = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const elements = new Map<string, any>(), handlers: Record<string, any> = {}, subscriptions: any[] = [], callbacks: any = {}, commands: any[] = []
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', hidden: false, value: '', style: { setProperty() {} },
      addEventListener(type: string, cb: any) { handlers[id + ':' + type] = cb } })
    return elements.get(id)
  }
  const api = { locale, compact, slot: 'right', settings: { accounts: ['account-a', 'account-b'], max: 8 }, size: { px: { width: 800, height: compact ? 80 : 600 } },
    esc: (value: any) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)),
    t: (value: any, params: any = {}) => String(value[api.locale] || value.en).replace(/\{(\w+)\}/g, (_, k) => String(params[k])),
    whenReady: (cb: any) => cb(), onLocale: (cb: any) => { callbacks.locale = cb }, onResize: (cb: any) => { callbacks.resize = cb }, onSettings: (cb: any) => { callbacks.settings = cb },
    subscribe: (channel: string, cb: any) => { const sub = { channel, cb, stopped: false }; subscriptions.push(sub); if (channel in fixtures) cb(fixtures[channel]); return () => { sub.stopped = true } },
    sendCommand: (...args: any[]) => { commands.push(args); return typeof result === 'function' ? result() : Promise.resolve(result) } }
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '', {
    Fremkit: api, document: { getElementById: element, documentElement: { lang: 'en', style: { setProperty() {} } } },
    Date: class extends Date { static now() { return now } }, Intl, setInterval() {}, console,
  })
  const family = id === 'gmail-inbox' ? 'gmail' : 'google-calendar'
  return { elements, commands, subscriptions,
    update: (account: string, data: any) => subscriptions.filter(s => s.channel === family + ':' + account).at(-1)?.cb(data),
    settings: (accounts: string[]) => callbacks.settings?.({ accounts, max: 8 }),
    language: (lang: string) => { api.locale = lang; callbacks.locale?.(lang) },
    filter: (which: string, value: string) => { element(which).value = value; handlers[which + ':change']?.({ target: element(which) }) },
    text: () => [...elements.values()].filter(e => !e.hidden).map(e => e.textContent + e.innerHTML).join(' '),
    rows: () => elements.get('list')?.innerHTML || '',
    click: (action: string, connectionId = 'account-a', itemId = 'same-id', calendarId = 'primary') => handlers['list:click']?.({ target: { closest: () => ({ getAttribute: (key: string) => ({ 'data-action': action, 'data-connection': connectionId, 'data-id': itemId, 'data-calendar': calendarId }[key]) }) } }) }
}
const settle = () => new Promise(resolve => setImmediate(resolve))


describe('Gmail presentation', () => {
  it('does not declare an incomplete empty page to be an empty inbox', () => {
    const incomplete = { ...mail('account-a', []), truncated: true, estimatedUnreadCount: 75 }
    const widget = load('gmail-inbox', { 'gmail:account-a': incomplete })
    expect(widget.text()).toContain('More mail available')
    expect(widget.text()).not.toContain('No unread mail')
  })
  it('merges by received time, keeps account identities and never renders bodies, snippets or credentials', () => {
    const a = mail(), b = mail('account-b', [{ ...message('same-id', now + 1000), subject: 'Newer <script>', body: 'PRIVATE BODY', snippet: 'PRIVATE SNIPPET', credentials: 'PRIVATE TOKEN' }])
    const widget = load('gmail-inbox', { 'gmail:account-a': a, 'gmail:account-b': b })
    expect(widget.rows()).toContain('account-a@example.com'); expect(widget.rows()).toContain('account-b@example.com')
    expect(widget.rows().indexOf('Newer &lt;script&gt;')).toBeLessThan(widget.rows().indexOf('Shared subject'))
    expect(widget.text()).not.toMatch(/PRIVATE|<script>/)
    widget.click('open'); widget.click('open', 'account-b')
    expect(widget.commands).toEqual([]); expect(widget.text()).toContain('Browser account routing is unverified')
    expect(widget.rows()).toContain('disabled')
  })
  it('puts missing dates last without treating them as current', () => {
    const widget = load('gmail-inbox', { 'gmail:account-a': mail('account-a', [{ ...message('unknown', null), subject: 'Unknown date' }, { ...message('known', now - 100), subject: 'Known date' }]) })
    expect(widget.rows().indexOf('Known date')).toBeLessThan(widget.rows().indexOf('Unknown date'))
    expect(widget.rows()).toContain('Date unknown')
  })
  it('keeps healthy rows when another account is unauthorized', () => {
    const widget = load('gmail-inbox', { 'gmail:account-a': mail(), 'gmail:account-b': { ...mail('account-b', null), account: null, freshness: 'unavailable', error: 'unauthorized' } })
    expect(widget.rows()).toContain('Shared subject'); expect(widget.text()).toContain('Authorization required')
    expect(widget.text()).toContain('Connections'); expect(widget.text()).not.toContain('No unread mail')
  })
  it('distinguishes zero unread, unknown estimates, and retained stale data', () => {
    const widget = load('gmail-inbox', { 'gmail:account-a': mail('account-a', []) })
    widget.settings(['account-a'])
    expect(widget.text()).toContain('No unread mail'); expect(widget.text()).toContain('Unread estimate: 0')
    widget.update('account-a', { ...mail(), estimatedUnreadCount: null })
    expect(widget.text()).toContain('Unread estimate unknown')
    widget.update('account-a', { ...mail('account-a', []), freshness: 'stale', error: 'offline' })
    expect(widget.text()).toContain('Stale'); expect(widget.text()).not.toContain('No unread mail')
  })
  it('keeps the failed account reason visible in compact mode with retained headers', () => {
    const data = { ...mail('account-b'), freshness: 'stale', error: 'unauthorized' }
    const widget = load('gmail-inbox', { 'gmail:account-a': mail(), 'gmail:account-b': data }, 'en', { ok: true }, true)
    expect(widget.elements.get('compact')?.textContent).toContain('Authorization required')
    expect(widget.elements.get('compact')?.textContent).toContain('account-b@example.com')
  })
  it('bounds rows and discloses truncation without claiming an exact count', () => {
    const widget = load('gmail-inbox', { 'gmail:account-a': { ...mail('account-a', Array.from({ length: 12 }, (_, i) => message('m' + i))), truncated: true, estimatedUnreadCount: 40 } })
    expect(widget.rows().match(/class="row/g)?.length).toBe(8)
    expect(widget.text()).toContain('Showing 8 of 12 loaded'); expect(widget.text()).toContain('More mail available')
    expect(widget.text()).toContain('Unread estimate: 40')
  })
})


for (const [id, family, data] of [['gmail-inbox', 'gmail', mail]] as const) {
  describe(id + ' account lifecycle', () => {
    it('clears internal snapshots immediately, unsubscribes every old channel and ignores late callbacks', () => {
      const fixtures: Record<string, any> = { [family + ':account-a']: data() }
      const widget = load(id, fixtures)
      delete fixtures[family + ':account-a']
      const old = [...widget.subscriptions]
      widget.settings(['account-b'])
      expect(widget.rows()).not.toContain('Shared'); expect(widget.text()).toContain('Loading')
      expect(old.every(s => s.stopped)).toBe(true)
      old[0].cb(data()); expect(widget.rows()).not.toContain('Shared')
      widget.settings(['account-a']); old[0].cb(data()); expect(widget.rows()).not.toContain('Shared')
    })
    it('account filter resubscribes only the selected account and drops old data', () => {
      const widget = load(id, { [family + ':account-a']: data(), [family + ':account-b']: data('account-b') })
      const old = [...widget.subscriptions]
      widget.filter('accountFilter', 'account-b')
      expect(old.every(s => s.stopped)).toBe(true)
      expect(widget.subscriptions.at(-1).channel).toBe(family + ':account-b')
      expect(widget.rows()).not.toContain('account-a@example.com'); expect(widget.rows()).toContain('account-b@example.com')
    })
    it('translates loading/setup and compact summary without treating missing snapshots as empty', () => {
      const widget = load(id, {}, 'en', { ok: true }, true)
      expect(widget.text()).toContain('Loading'); widget.language('fr'); expect(widget.text()).toContain('Chargement')
      widget.settings([]); expect(widget.text()).toContain('Connexions'); expect(widget.commands).toEqual([])
    })
  })
}

describe('Google enabled open actions', () => {
  const enabled = { available: true, reason: null }
  it('Gmail sends only the selected account and exact message ID and reports success visibly', async () => {
    const a = mail('account-a', [{ ...message(), open: enabled }]), b = mail('account-b', [{ ...message(), open: enabled }])
    const widget = load('gmail-inbox', { 'gmail:account-a': a, 'gmail:account-b': b })
    widget.click('open', 'account-b'); await settle()
    expect(widget.commands).toEqual([['gmail:account-b','open',{ connectionId:'account-b',messageId:'same-id' }]])
    expect(widget.elements.get('feedback')?.hidden).toBe(false)
    expect(widget.text()).toContain('Mail opened on the Mac')
    widget.click('open','unknown'); expect(widget.commands).toHaveLength(1)
  })
  it('Gmail refuses stale opening and ignores feedback after a filter/account change', async () => {
    const stale = { ...mail('account-a', [{ ...message(), open: enabled }]), freshness:'stale',error:'offline' }
    const denied = load('gmail-inbox', { 'gmail:account-a': stale }); denied.click('open'); expect(denied.commands).toEqual([])
    let resolve:any
    const pending = load('gmail-inbox', { 'gmail:account-a':mail('account-a',[{...message(),open:enabled}]) }, 'en', () => new Promise(r=>{resolve=r}))
    pending.click('open'); expect(pending.commands).toHaveLength(1); expect(pending.text()).toContain('Opening on the Mac')
    pending.settings(['account-b']); resolve({ok:true}); await settle(); expect(pending.text()).not.toContain('Mail opened on the Mac')
  })
  it('Gmail reports rejected opening without pretending it succeeded', async () => {
    const widget=load('gmail-inbox',{'gmail:account-a':mail('account-a',[{...message(),open:enabled}])},'en',{ok:false})
    widget.click('open'); await settle();expect(widget.text()).toContain('Could not open mail');expect(widget.text()).not.toContain('Mail opened on the Mac')
  })
  it('keeps pending feedback when another account refreshes, then clears it when the opened account changes', async () => {
    let resolve: any
    const opened = mail('account-a', [{ ...message(), open: enabled }])
    const widget = load('gmail-inbox', { 'gmail:account-a': opened, 'gmail:account-b': mail('account-b') }, 'en', () => new Promise(r => { resolve = r }))
    widget.click('open')
    widget.update('account-b', mail('account-b'))
    expect(widget.text()).toContain('Opening on the Mac')
    resolve({ ok: true }); await settle()
    expect(widget.text()).toContain('Mail opened on the Mac')
    widget.update('account-a', mail('account-a', [{ ...message(), open: enabled }]))
    expect(widget.elements.get('feedback')?.hidden).toBe(true)
  })
})

for (const [id, family, data] of [['gmail-inbox', 'gmail', mail]] as const) {
  describe(id + ' account color identity', () => {
    it('keeps each supplied account color attached to its own rows and filter', () => {
      const a = {...data(), account:{email:'account-a@example.com',color:'#336699'}}, b = {...data('account-b'),account:{email:'account-b@example.com',color:'#cc5500'}}
      const widget = load(id,{[family+':account-a']:a,[family+':account-b']:b})
      const accounts = widget.elements.get('accounts')?.innerHTML
      expect(accounts).toMatch(/--account-color:#336699[^]*?account-a@example.com/)
      expect(accounts).toMatch(/--account-color:#cc5500[^]*?account-b@example.com/)
      expect(widget.rows()).toContain('--account-color:#336699'); expect(widget.rows()).toContain('--account-color:#cc5500')
      widget.filter('accountFilter','account-b')
      expect(widget.rows()).toContain('--account-color:#cc5500'); expect(widget.rows()).not.toContain('#336699')
      expect(widget.rows()).toContain('account-b@example.com'); expect(widget.commands).toEqual([])
    })
    it.each(['red; background:url(https://example.com/tracker)', '#abc', '#abcdef\" onclick=\"x', null])('rejects unsafe or unsupported account color %s while escaping identity', color => {
      const a = {...data(),account:{email:'<img src=x onerror=evil>',color}}
      const widget = load(id,{[family+':account-a']:a})
      expect(widget.rows()).toContain('--account-color:var(--accent,#d9b36a)')
      expect(widget.rows()).toContain('&lt;img src=x onerror=evil&gt;')
      expect([...widget.elements.values()].map(e=>e.innerHTML).join(' ')).not.toMatch(/background:url|onclick=|<img src=x/)
      expect(widget.elements.get('compact')?.textContent).toContain('<img src=x onerror=evil>') // textContent keeps this inert
    })
    it('keeps state labels next to state accents when stale or unauthorized', () => {
      const widget=load(id,{[family+':account-a']:{...data(),freshness:'stale',error:'unauthorized'}})
      expect(widget.elements.get('accounts')?.innerHTML).toContain('data-state="stale"')
      expect(widget.text()).toContain('Stale');expect(widget.text()).toContain('Authorization required')
      widget.language('fr');expect(widget.text()).toContain('Autorisation requise')
    })
  })
}
