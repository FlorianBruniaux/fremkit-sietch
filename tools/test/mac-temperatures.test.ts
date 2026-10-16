import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function load() {
  const html = readFileSync(new URL('../../widgets/mac-temperatures/index.html', import.meta.url), 'utf8')
  const elements = new Map<string, any>()
  let receive: any
  let localeChange: any
  let resize: any
  const api = {
    locale: 'fr',
    size: { px: { height: 80 } },
    t: (label: any) => label[api.locale],
    whenReady: (fn: any) => fn(),
    subscribe: (channel: string, fn: any) => {
      expect(channel).toBe('system')
      receive = fn
    },
    onLocale: (fn: any) => { localeChange = fn },
    onResize: (fn: any) => { resize = fn },
  }
  const document = {
    documentElement: { lang: 'en', style: { setProperty() {} } },
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, { textContent: '' })
      return elements.get(id)
    },
  }
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], {
    Fremkit: api, document, Intl,
  })
  return {
    html,
    elements,
    update: (data: any) => receive(data),
    language: (value: string) => { api.locale = value; localeChange() },
    resize: () => resize(),
  }
}

const sample = (temp: any = 67.5, tempSource = 'macmon', tempError: string | null = null) => ({
  cpu: { temp, tempSource, tempError },
})

describe('Mac temperature display on Fremkit 0.3.0', () => {
  it('shows the CPU reading and source in both locales', () => {
    const widget = load()
    widget.update(sample())
    expect(widget.elements.get('cpu').textContent).toBe('67,5')
    expect(widget.elements.get('source').textContent).toContain('macmon')
    widget.language('en')
    expect(widget.elements.get('cpu').textContent).toBe('67.5')
    widget.update(sample(52.2, 'system'))
    expect(widget.elements.get('source').textContent).toBe('Source: system sensor')
  })

  it.each([null, 0, -1, NaN, Infinity, 150, '70'])('keeps invalid or missing readings explicit: %s', value => {
    const widget = load()
    widget.update(sample(value))
    expect(widget.elements.get('cpu').textContent).toBe('?')
  })

  it.each([
    ['unconfigured', 'Installer macmon'],
    ['unsupported', 'Apple Silicon uniquement'],
    ['offline', 'Mesure indisponible'],
    ['invalid', 'Mesure indisponible'],
  ])('shows guidance for %s', (error, expected) => {
    const widget = load()
    widget.update(sample(null, 'macmon', error))
    expect(widget.elements.get('status').textContent).toContain(expected)
  })

  it('explains the privacy opt-in when no sensor reading or error exists', () => {
    const widget = load()
    widget.update(sample(null, null as any))
    expect(widget.elements.get('status').textContent).toContain('Confidentialité')
    expect(widget.elements.get('status').textContent).toContain('Fremkit 0.3.0')
    expect(widget.elements.get('status').textContent).toContain('Lire la température du CPU avec macmon')
  })

  it('keeps a valid cached reading free of an unavailable warning', () => {
    const widget = load()
    widget.update(sample(67.5, 'macmon', 'offline'))
    expect(widget.elements.get('cpu').textContent).toBe('67,5')
    expect(widget.elements.get('status').textContent).toBe('')
  })

  it('uses the host title and provides a compact layout without a GPU claim', () => {
    const widget = load()
    expect(widget.html).not.toContain('id="heading"')
    expect(widget.html).not.toContain('id="gpu"')
    expect(widget.html).toContain('html.compact')
    expect(widget.html).toContain('var(--text-scale, 1)')
    widget.resize()
  })
})
