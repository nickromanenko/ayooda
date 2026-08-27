import { describe, expect, it } from 'bun:test'
import { resolveWidgetLocale, widgetStrings } from './strings'

describe('widget strings', () => {
  it('uses the configured locale', () => expect(widgetStrings('es').send).toBe('Enviar'))
  it('detects supported browser locales', () => expect(resolveWidgetLocale('auto', 'fr-CA')).toBe('fr'))
  it('falls back to English', () => expect(resolveWidgetLocale('auto', 'ja-JP')).toBe('en'))
})
