import { describe, expect, it } from 'vitest'
import {
  normalizeWidgetHexColor,
  widgetAccessibleAccent,
  widgetContrastRatio,
  widgetForeground,
} from './widget-color'

describe('widget colours', () => {
  it('normalizes short and long hex values', () => {
    expect(normalizeWidgetHexColor(' #AbC ')).toBe('#aabbcc')
    expect(normalizeWidgetHexColor('#6366F1')).toBe('#6366f1')
    expect(normalizeWidgetHexColor('red')).toBeNull()
  })

  it('chooses readable header text for light and dark brands', () => {
    expect(widgetForeground('#fff')).toBe('#18181b')
    expect(widgetForeground('#111827')).toBe('#ffffff')
  })

  it('makes light accents readable on white', () => {
    const accent = widgetAccessibleAccent('#fef08a')
    expect(widgetContrastRatio(accent, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})
