import { describe, expect, test } from 'bun:test'
import { isWidgetPathRule, widgetPathMatches, widgetVisibleOnPath } from './index'

describe('widget path targeting', () => {
  test('validates safe route patterns', () => {
    expect(isWidgetPathRule('/pricing')).toBe(true)
    expect(isWidgetPathRule('/help/*')).toBe(true)
    expect(isWidgetPathRule('pricing')).toBe(false)
    expect(isWidgetPathRule('/bad path')).toBe(false)
  })

  test('supports wildcard path matching', () => {
    expect(widgetPathMatches('/help/getting-started', '/help/*')).toBe(true)
    expect(widgetPathMatches('/help', '/help/*')).toBe(false)
    expect(widgetPathMatches('/product/a', '/product/?')).toBe(true)
    expect(widgetPathMatches('/product/ab', '/product/?')).toBe(false)
  })

  test('lets exclusions override inclusions', () => {
    expect(widgetVisibleOnPath('/help/article', ['/help/*'], ['/help/private*'])).toBe(true)
    expect(widgetVisibleOnPath('/help/private-article', ['/help/*'], ['/help/private*'])).toBe(false)
    expect(widgetVisibleOnPath('/pricing', [], [])).toBe(true)
    expect(widgetVisibleOnPath('/account', ['/pricing'], [])).toBe(false)
  })
})
