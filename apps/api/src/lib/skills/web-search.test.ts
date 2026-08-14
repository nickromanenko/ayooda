import { describe, expect, test } from 'bun:test'
import {
  formatSearchResults, runSearch, webSearchSkill,
  MAX_SEARCHES_PER_CONVERSATION, CAP_MESSAGE, type FetchLike,
} from './web-search'
import type { SkillContext } from './types'
import type { WebSearchConfig } from '@ayooda/shared'

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

  test('gives the request an abort signal, so a hung Tavily cannot stall the stream', async () => {
    let seen: RequestInit | undefined
    const capture: FetchLike = async (_url, init) => { seen = init; return ok() }
    await runSearch('q', 3, { apiKey: 'k', fetch: capture })
    expect(seen?.signal).toBeInstanceOf(AbortSignal)
    expect(seen?.signal?.aborted).toBe(false)
  })

  test('an aborted request returns the same readable string as any other failure', async () => {
    const aborts: FetchLike = async () => {
      // What fetch rejects with once the AbortController fires.
      const err = new Error('The operation was aborted.')
      err.name = 'AbortError'
      throw err
    }
    expect(await runSearch('q', 3, { apiKey: 'k', fetch: aborts })).toBe('Web search failed.')
  })
})

describe('contributeTools', () => {
  const ctx = {
    workspaceId: 'w', agentId: 'a', conversationId: 'c', visitorId: 'v',
    message: 'hi', config: { maxResults: 3 },
    trace: { span: () => ({ end: () => {} }) } as any,
  } as SkillContext<WebSearchConfig>

  const withKey = async (value: string | undefined, fn: () => Promise<void>) => {
    const prev = process.env.TAVILY_API_KEY
    if (value === undefined) delete process.env.TAVILY_API_KEY
    else process.env.TAVILY_API_KEY = value
    try { await fn() } finally {
      if (prev === undefined) delete process.env.TAVILY_API_KEY
      else process.env.TAVILY_API_KEY = prev
    }
  }

  test('contributes no tool when TAVILY_API_KEY is unset, so the model never calls it', async () => {
    await withKey(undefined, async () => {
      expect(Object.keys(await webSearchSkill.contributeTools!(ctx))).toEqual([])
    })
  })

  test('an empty TAVILY_API_KEY counts as unset', async () => {
    await withKey('', async () => {
      expect(Object.keys(await webSearchSkill.contributeTools!(ctx))).toEqual([])
    })
  })

  test('contributes web_search once the key is present — no restart needed', async () => {
    await withKey('tvly-test', async () => {
      expect(Object.keys(await webSearchSkill.contributeTools!(ctx))).toEqual(['web_search'])
    })
  })
})

describe('cap', () => {
  test('the cap is three searches per conversation', () => {
    expect(MAX_SEARCHES_PER_CONVERSATION).toBe(3)
    expect(CAP_MESSAGE).toContain('limit')
  })
})
