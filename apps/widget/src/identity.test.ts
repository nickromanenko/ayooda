import { describe, expect, test } from 'bun:test'
import { escapeHtmlAttribute, safeAgentPhotoURL } from './identity'

describe('widget agent identity', () => {
  test('accepts web-hosted agent photos', () => {
    expect(safeAgentPhotoURL('https://cdn.example.com/agent photo.png')).toBe(
      'https://cdn.example.com/agent%20photo.png',
    )
  })

  test('rejects executable and malformed image URLs', () => {
    expect(safeAgentPhotoURL('javascript:alert(1)')).toBeNull()
    expect(safeAgentPhotoURL('not a URL')).toBeNull()
  })

  test('escapes identity values used in widget markup', () => {
    expect(escapeHtmlAttribute('Kim "Support" <team>')).toBe('Kim &quot;Support&quot; &lt;team&gt;')
  })
})
