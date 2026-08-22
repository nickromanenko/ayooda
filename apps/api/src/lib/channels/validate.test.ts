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
})
