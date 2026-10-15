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


describe('Calendar presentation', () => {
  it('opens Join by the exact account/calendar/recurrence-instance tuple', async () => {
    const a = event(), b = { ...event('account-b', 'team', 'instance-2'), recurringEventId: 'series' }
    const other = agenda('account-b', [b]); other.calendars = [{ ...other.calendars[0], id: 'team', events: [b] }]
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda(), 'google-calendar:account-b': other })
    widget.click('join'); widget.click('join', 'account-b', 'instance-2', 'team'); await settle()
    expect(widget.commands).toEqual([['google-calendar:account-a', 'join', { connectionId: 'account-a', calendarId: 'primary', eventId: 'same-id' }], ['google-calendar:account-b', 'join', { connectionId: 'account-b', calendarId: 'team', eventId: 'instance-2' }]])
    expect(widget.rows()).toContain('account-b@example.com'); expect(widget.rows()).toContain('Recurring instance')
    widget.click('open'); expect(widget.commands).toHaveLength(2)
    expect(widget.text()).toContain('Browser account routing is unverified')
  })
  it('keeps overlapping events in start order and displays the next timed meeting countdown', () => {
    const events = [{ ...event('account-a', 'primary', 'later', now + 120000), title: 'Later' }, { ...event('account-a', 'primary', 'earlier', now + 60000), title: 'Earlier' }]
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda('account-a', events) })
    expect(widget.rows().indexOf('Earlier')).toBeLessThan(widget.rows().indexOf('Later'))
    expect(widget.elements.get('next')?.textContent).toContain('Earlier'); expect(widget.text()).toContain('In 1 min')
  })
  it('uses date-only all-day bounds unchanged and source time zone for timed events', () => {
    const day = { ...event('account-a', 'primary', 'day'), allDay: true, start: Date.parse('2026-10-10T00:00:00Z'), end: Date.parse('2026-10-12T00:00:00Z'), startDate: '2026-10-10', endDate: '2026-10-12', join: { available: false, reason: 'unsupportedDestination' } }
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda('account-a', [day, event()]) })
    expect(widget.rows()).toContain('2026-10-10'); expect(widget.rows()).toContain('2026-10-12'); expect(widget.rows()).toContain('exclusive end')
    expect(widget.rows()).toContain('14:01'); expect(widget.rows()).toContain('Europe/Paris')
    expect(widget.elements.get('next')?.textContent).toContain('In 1 min')
  })
  it('expires all-day events on the exclusive date in their own time zone', () => {
    const day = { ...event(), allDay: true, start: Date.parse('2026-10-10T00:00:00Z'), end: Date.parse('2026-10-11T00:00:00Z'), startDate: '2026-10-10', endDate: '2026-10-11', title: 'Local day' }
    const auckland = { ...day, timeZone: 'Pacific/Auckland' }
    const la = { ...day, timeZone: 'America/Los_Angeles' }
    const expired = load('google-calendar', { 'google-calendar:account-a': agenda('account-a', [auckland]) })
    expect(expired.rows()).not.toContain('Local day')
    const current = load('google-calendar', { 'google-calendar:account-a': agenda('account-a', [la]) })
    expect(current.rows()).toContain('Local day')
  })
  it.each([['absent', { available: false, reason: null }], ['invalid', { available: false, reason: 'unsupportedDestination' }]])('disables Join when the meeting destination is %s', (_, join) => {
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda('account-a', [{ ...event(), join }]) })
    widget.click('join'); expect(widget.commands).toEqual([]); expect(widget.rows()).toContain('No validated Meet link')
  })
  it('disables stale/old actions while an independent healthy calendar can join', () => {
    const data = agenda(); const bad = { ...data.calendars[0], id: 'failed', label: 'Failed calendar', freshness: 'stale', error: 'offline', events: [event('account-a', 'failed', 'old')] }
    data.calendars.push(bad as any); data.events = [event(), event('account-a', 'failed', 'old')]; data.freshness = 'stale'; data.error = 'offline' as any
    const widget = load('google-calendar', { 'google-calendar:account-a': data })
    widget.click('join', 'account-a', 'old', 'failed'); widget.click('join')
    expect(widget.commands).toHaveLength(1); expect(widget.text()).toContain('Failed calendar'); expect(widget.text()).toContain('Stale')
    const old = agenda(); old.updatedAt = now - 120001; old.calendars[0].updatedAt = now - 120001
    widget.update('account-a', old)
    widget.click('join'); expect(widget.commands).toHaveLength(1)
  })
  it('ignores unknown tuple, mismatched connection identity and ended events', () => {
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda() })
    widget.click('join', 'account-b'); widget.click('join', 'account-a', 'same-id', 'wrong')
    expect(widget.commands).toEqual([])
    widget.click('join'); expect(widget.commands).toHaveLength(1)
    widget.update('account-a', agenda('account-a', [{ ...event(), end: now - 1 }]))
    widget.click('join'); expect(widget.commands).toHaveLength(1)
    widget.update('account-a', agenda('account-b')); expect(widget.rows()).not.toContain('Shared event')
  })
  it('filters the exact calendar tuple rather than a duplicate label', () => {
    const data = agenda(); data.calendars.push({ ...data.calendars[0], id: 'second', events: [{ ...event('account-a', 'second', 's'), title: 'Second calendar event' }] })
    data.events = [...data.events!, ...data.calendars[1].events!]
    const widget = load('google-calendar', { 'google-calendar:account-a': data })
    widget.filter('calendarFilter', JSON.stringify(['account-a', 'second']))
    expect(widget.rows()).toContain('Second calendar event'); expect(widget.rows()).not.toContain('Shared event')
    widget.click('join'); expect(widget.commands).toEqual([])
  })
  it('does not call an all-day-only agenda empty in full or compact views', () => {
    const day = { ...event(), allDay: true, startDate: '2026-10-10', endDate: '2026-10-11', title: 'Planning day' }
    const data = agenda('account-a', [day])
    const widget = load('google-calendar', { 'google-calendar:account-a': data }, 'en', { ok: true }, true)
    widget.settings(['account-a'])
    expect(widget.elements.get('next')?.textContent).toContain('All day')
    expect(widget.elements.get('compact')?.textContent).toContain('Planning day')
    expect(widget.text()).not.toContain('No upcoming events')
  })
  it('preserves a 1024-character recurrence-instance ID in the exact Join payload', () => {
    const id = 'i'.repeat(1024)
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda('account-a', [event('account-a', 'primary', id)]) })
    widget.click('join', 'account-a', id)
    expect(widget.commands[0]).toEqual(['google-calendar:account-a', 'join', { connectionId: 'account-a', calendarId: 'primary', eventId: id }])
  })
  it('reports known empty for an exact calendar filter despite a different unknown account', () => {
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda('account-a', []) })
    widget.filter('calendarFilter', JSON.stringify(['account-a', 'primary']))
    expect(widget.elements.get('next')?.textContent).toContain('No upcoming events')
  })
  it('distinguishes connected empty agenda from unknown and unauthorized', () => {
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda('account-a', []) })
    widget.settings(['account-a']); expect(widget.text()).toContain('No upcoming events')
    widget.update('account-a', { ...agenda('account-a', null), freshness: 'unavailable', error: 'unauthorized' })
    expect(widget.text()).not.toContain('No upcoming events'); expect(widget.text()).toContain('Authorization required')
  })
  it.each(['success', 'failure', 'rejection'])('suppresses obsolete Join %s after a calendar filter round trip', async outcome => {
    let resolve: any, reject: any
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda() }, 'en', () => new Promise((yes, no) => { resolve = yes; reject = no }))
    widget.click('join'); expect(widget.commands).toHaveLength(1)
    widget.filter('calendarFilter', JSON.stringify(['account-a', 'primary']))
    widget.filter('calendarFilter', '')
    if (outcome === 'rejection') reject(new Error('synthetic failure'))
    else resolve({ ok: outcome === 'success' })
    await settle()
    expect(widget.elements.get('feedback')?.hidden).toBe(true)
    expect(widget.text()).not.toMatch(/Could not open meeting|Meeting opened on the Mac/)
  })
  it('ignores late Join feedback after a snapshot replacement', async () => {
    let resolve: any
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda() }, 'en', () => new Promise(yes => { resolve = yes }))
    widget.click('join'); expect(widget.commands).toHaveLength(1)
    widget.update('account-a', agenda())
    resolve({ ok: false }); await settle()
    expect(widget.elements.get('feedback')?.hidden).toBe(true)
  })
  it.each(['unavailable', 'removed'])('keeps the filtered account status and healthy data reachable when its calendar is %s', kind => {
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda(), 'google-calendar:account-b': agenda('account-b', [{ ...event('account-b'), title: 'Healthy account meeting' }]) })
    widget.filter('calendarFilter', JSON.stringify(['account-a', 'primary']))
    const data: any = { ...agenda(), calendars: kind === 'unavailable' ? null : [], events: kind === 'unavailable' ? null : [], account: kind === 'unavailable' ? null : { email: 'account-a@example.com' }, updatedAt: kind === 'unavailable' ? null : now, freshness: kind === 'unavailable' ? 'unavailable' : 'fresh', error: kind === 'unavailable' ? 'unauthorized' : null }
    widget.update('account-a', data)
    expect(widget.elements.get('accounts')?.innerHTML).toContain('account-a')
    expect(widget.text()).toContain(kind === 'unavailable' ? 'Authorization required' : 'Selected calendar unavailable')
    expect(widget.text()).not.toMatch(/No account selected|Showing 0 of 0 loaded/)
    expect(widget.elements.get('calendarFilter')?.value).toBe('')
    expect(widget.rows()).toContain('Healthy account meeting')
    widget.click('join', 'account-b'); expect(widget.commands[0]).toEqual(['google-calendar:account-b', 'join', { connectionId: 'account-b', calendarId: 'primary', eventId: 'same-id' }])
  })
  it('removes the unavailable-calendar notice when that exact calendar recovers', () => {
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda() })
    widget.filter('calendarFilter', JSON.stringify(['account-a', 'primary']))
    widget.update('account-a', { ...agenda(), calendars: null, events: null, updatedAt: null, freshness: 'unavailable', error: 'unauthorized' })
    expect(widget.text()).toContain('Selected calendar unavailable')
    widget.update('account-a', agenda())
    expect(widget.text()).not.toContain('Selected calendar unavailable')
    expect(widget.rows()).toContain('Shared event')
  })
  it('labels a failed sole selected calendar as unknown rather than loaded zero', () => {
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda() })
    widget.settings(['account-a']); widget.filter('calendarFilter', JSON.stringify(['account-a', 'primary']))
    widget.update('account-a', { ...agenda(), calendars: null, events: null, account: null, updatedAt: null, freshness: 'unavailable', error: 'unauthorized' })
    expect(widget.elements.get('summary')?.textContent).toContain('Data unknown')
    expect(widget.text()).toContain('Authorization required')
    expect(widget.text()).not.toMatch(/No account selected|Showing 0 of 0 loaded|No upcoming events/)
  })
  it('reports Join failure but ignores late command feedback after account replacement', async () => {
    let resolve: any
    const widget = load('google-calendar', { 'google-calendar:account-a': agenda() }, 'en', () => new Promise(r => { resolve = r }))
    widget.click('join'); widget.settings(['account-b']); resolve({ ok: false }); await settle()
    expect(widget.text()).not.toContain('Could not open meeting')
    const failing = load('google-calendar', { 'google-calendar:account-a': agenda() }, 'en', { ok: false })
    failing.click('join'); await settle(); expect(failing.text()).toContain('Could not open meeting')
  })
})

for (const [id, family, data] of [['google-calendar', 'google-calendar', agenda]] as const) {
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

  it('Calendar opens the exact event tuple and reports opening separately from Join', async () => {
    const widget=load('google-calendar',{'google-calendar:account-a':agenda('account-a',[{...event(),open:enabled}])})
    widget.click('open');await settle();expect(widget.commands).toEqual([['google-calendar:account-a','open',{connectionId:'account-a',calendarId:'primary',eventId:'same-id'}]])
    expect(widget.text()).toContain('Event opened on the Mac');expect(widget.text()).not.toContain('Meeting opened on the Mac')
  })
  it('Calendar does not offer a Join button for an event without a meeting', () => {
    const widget=load('google-calendar',{'google-calendar:account-a':agenda('account-a',[{...event(),open:enabled,join:{available:false,reason:'unsupportedDestination'}}])})
    expect(widget.rows()).not.toContain('data-action="join"');expect(widget.rows()).toContain('No validated Meet link')
    widget.click('join');expect(widget.commands).toEqual([])
  })
})

for (const [id, family, data] of [['google-calendar', 'google-calendar', agenda]] as const) {
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

describe('Calendar repeated display identities', () => {
  it('shows one identical verified email in each identity while preserving its exact command tuple', () => {
    const email='account-a@example.com', data=agenda('account-a',[{...event('account-a',email),open:{available:true,reason:null}}])
    data.calendars=[{...data.calendars[0],id:email,label:email,events:data.events}]
    const widget=load('google-calendar',{'google-calendar:account-a':data})
    widget.settings(['account-a'])
    const identity=widget.rows().match(/class="meta identity">([^]*?)<\/div>/)?.[1]||''
    expect(identity.split(email)).toHaveLength(2)
    expect(widget.elements.get('accounts')?.innerHTML.split(email)).toHaveLength(2)
    expect(widget.elements.get('next')?.textContent.split(email)).toHaveLength(2)
    expect(widget.elements.get('compact')?.textContent.split(email)).toHaveLength(2)
    const options=widget.elements.get('calendarFilter')?.innerHTML
    expect(options).toContain('>'+email+'</option>')
    widget.click('open','account-a','same-id',email)
    expect(widget.commands).toEqual([['google-calendar:account-a','open',{connectionId:'account-a',calendarId:email,eventId:'same-id'}]])
  })
  it('retains every distinct calendar name and identifier alongside the verified account email', () => {
    const data=agenda('account-a',[event('account-a','team@example.com')])
    data.calendars=[{...data.calendars[0],id:'team@example.com',label:'Team planning',events:data.events}]
    const widget=load('google-calendar',{'google-calendar:account-a':data})
    const identity=widget.rows().match(/class="meta identity">([^]*?)<\/div>/)?.[1]||''
    expect(identity).toContain('account-a@example.com · Team planning · team@example.com')
    expect(widget.elements.get('accounts')?.innerHTML).toContain('Team planning')
    expect(widget.elements.get('next')?.textContent).toContain('account-a@example.com · Team planning')
    expect(widget.elements.get('calendarFilter')?.innerHTML).toContain('account-a@example.com · Team planning · team@example.com')
  })
})
