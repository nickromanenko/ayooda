import { describe, expect, test } from 'bun:test'
import { formatSearchResults, runSearch, MAX_SEARCHES_PER_CONVERSATION, CAP_MESSAGE } from './web-search'

describe('formatSearchResults', () => {
  test('renders title, url and content per result', () => {
    const out = formatSearchResults([{ title: 'Docs', url: 'https://x.dev', content: 'How to install' }])
    expect(out).toContain('Docs')
    expect(out).toContain('https://x.dev')
    expect(out).toContain('How to install')
  })
  test('reports no results rather than returning an empty string', () => {
    expect(formatSearchResults([])).toBe('No results found.')
  })
})

describe('runSearch', () => {
  const ok = async () => new Response(JSON.stringify({
    results: [{ title: 'T', url: 'https://u', content: 'C' }],
  }), { status: 200 })

  test('returns formatted results on success', async () => {
    expect(await runSearch('q', 3, { apiKey: 'k', fetch: ok })).toContain('T')
  })
  test('returns a string, not a throw, when the key is missing', async () => {
    expect(await runSearch('q', 3, { apiKey: '', fetch: ok })).toContain('unavailable')
  })
  test('returns a string, not a throw, on a non-200', async () => {
    const bad = async () => new Response('nope', { status: 500 })
    expect(await runSearch('q', 3, { apiKey: 'k', fetch: bad })).toContain('failed')
  })
  test('returns a string, not a throw, when fetch rejects', async () => {
    const boom = async () => { throw new Error('network down') }
    expect(await runSearch('q', 3, { apiKey: 'k', fetch: boom })).toContain('failed')
  })
})

describe('cap', () => {
  test('the cap is three searches per conversation', () => {
    expect(MAX_SEARCHES_PER_CONVERSATION).toBe(3)
    expect(CAP_MESSAGE).toContain('limit')
  })
})
