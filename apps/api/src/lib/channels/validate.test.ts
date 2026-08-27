import { describe, expect, test } from 'bun:test'
import { validateWidgetAppearance } from './validate'

const base = {
  widgetColor: '#6366F1',
  widgetPosition: 'bottom-right',
  welcomeMessage: 'Hi there!',
  showBranding: true,
}

describe('validateWidgetAppearance', () => {
  test('accepts a well-formed appearance and lowercases the colour', () => {
    const r = validateWidgetAppearance(base)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.widgetColor).toBe('#6366f1')
  })

  test('accepts shorthand hex', () => {
    expect(validateWidgetAppearance({ ...base, widgetColor: '#0af' }).ok).toBe(true)
  })

  test('accepts bottom-left', () => {
    const r = validateWidgetAppearance({ ...base, widgetPosition: 'bottom-left' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.widgetPosition).toBe('bottom-left')
  })

  test('trims the welcome message', () => {
    const r = validateWidgetAppearance({ ...base, welcomeMessage: '  Hello  ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.welcomeMessage).toBe('Hello')
  })

  // The colour is interpolated into the widget's stylesheet, so anything that is
  // not a plain hex value must be refused rather than sanitised.
  test.each([
    'red',
    '#12345',
    '#6366f1; background: url(evil)',
    'rgb(1,2,3)',
    'javascript:alert(1)',
    '',
  ])('rejects colour %p', (widgetColor) => {
    expect(validateWidgetAppearance({ ...base, widgetColor }).ok).toBe(false)
  })

  test('rejects an unknown position', () => {
    expect(validateWidgetAppearance({ ...base, widgetPosition: 'top-left' }).ok).toBe(false)
  })

  test('rejects an empty welcome message', () => {
    expect(validateWidgetAppearance({ ...base, welcomeMessage: '   ' }).ok).toBe(false)
  })

  test('rejects an over-long welcome message', () => {
    expect(validateWidgetAppearance({ ...base, welcomeMessage: 'x'.repeat(201) }).ok).toBe(false)
  })

  test('rejects a non-object payload', () => {
    expect(validateWidgetAppearance(null).ok).toBe(false)
    expect(validateWidgetAppearance('nope').ok).toBe(false)
  })

  describe('showBranding', () => {
    test('accepts an explicit false', () => {
      const r = validateWidgetAppearance({ ...base, showBranding: false })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.showBranding).toBe(false)
    })

    // Attribution is the default: only a literal false turns it off, so an old
    // client that omits the field, or a junk value, still shows the line.
    test.each([undefined, null, 0, '', 'false', 'no'])(
      'treats %p as "show the line"',
      (showBranding) => {
        const r = validateWidgetAppearance({ ...base, showBranding })
        expect(r.ok).toBe(true)
        if (r.ok) expect(r.value.showBranding).toBe(true)
      },
    )

    test('defaults to true when the key is absent entirely', () => {
      const { showBranding: _omit, ...withoutKey } = base
      const r = validateWidgetAppearance(withoutKey)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.showBranding).toBe(true)
    })
  })

  describe('allowedDomains', () => {
    test('normalizes and deduplicates hostnames', () => {
      const r = validateWidgetAppearance({ ...base, allowedDomains: [' Example.com ', '*.example.com', 'example.com'] })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.allowedDomains).toEqual(['example.com', '*.example.com'])
    })

    test('allows existing clients to omit domains', () => {
      const r = validateWidgetAppearance(base)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.allowedDomains).toEqual([])
    })

    test('rejects URLs and paths', () => {
      expect(validateWidgetAppearance({ ...base, allowedDomains: ['https://example.com/path'] }).ok).toBe(false)
    })
  })

  describe('behavior and privacy', () => {
    test('adds safe defaults for older clients', () => {
      const r = validateWidgetAppearance(base)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value.theme).toBe('light')
        expect(r.value.enabled).toBe(true)
        expect(r.value.showOnMobile).toBe(true)
        expect(r.value.conversationPersistence).toBe('session')
      }
    })

    test('accepts valid visibility and persistence settings', () => {
      const r = validateWidgetAppearance({
        ...base,
        theme: 'auto',
        locale: 'es',
        includePaths: ['/help/*'],
        excludePaths: ['/help/private/*'],
        conversationPersistence: 'visitor',
        persistenceDays: 14,
      })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.includePaths).toEqual(['/help/*'])
    })

    test('normalizes localized copy and accepts older configs without it', () => {
      const older = { ...base } as Record<string, unknown>
      delete older.localizedContent
      const oldResult = validateWidgetAppearance(older)
      expect(oldResult.ok).toBe(true)
      if (oldResult.ok) expect(oldResult.value.localizedContent).toEqual({})

      const r = validateWidgetAppearance({
        ...base,
        localizedContent: {
          es: { welcomeMessage: '  ¡Hola!  ', inputPlaceholder: 'Escribe aquí' },
          fr: {},
        },
      })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.localizedContent).toEqual({ es: { welcomeMessage: '¡Hola!', inputPlaceholder: 'Escribe aquí' } })
    })

    test('rejects unsafe URLs and malformed path rules', () => {
      expect(validateWidgetAppearance({ ...base, privacyPolicyURL: 'javascript:alert(1)' }).ok).toBe(false)
      expect(validateWidgetAppearance({ ...base, includePaths: ['https://example.com/help'] }).ok).toBe(false)
    })

    test('rejects timing and offset values outside their bounds', () => {
      expect(validateWidgetAppearance({ ...base, autoOpenDelaySeconds: 90 }).ok).toBe(false)
      expect(validateWidgetAppearance({ ...base, horizontalOffset: 2 }).ok).toBe(false)
    })
  })
})
