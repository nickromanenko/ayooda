import { describe, expect, test } from 'bun:test'
import { csvCell } from './agent-usage'

describe('csvCell', () => {
  test('passes a plain value through', () => {
    expect(csvCell('hello')).toBe('hello')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(null)).toBe('')
  })

  test('quotes a value containing a comma', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
  })

  test('escapes embedded double quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
  })

  test('collapses newlines', () => {
    expect(csvCell('line1\nline2')).toBe('line1 line2')
  })
})
