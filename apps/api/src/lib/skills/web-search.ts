import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { FieldValue } from 'firebase-admin/firestore'
import type { WebSearchConfig } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { registerSkill } from './registry'
import type { SkillContext, SkillModule } from './types'

export const MAX_SEARCHES_PER_CONVERSATION = 3
export const CAP_MESSAGE = 'Search limit reached for this conversation.'
const TAVILY_URL = 'https://api.tavily.com/search'

export interface SearchResult { title: string; url: string; content: string }

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.'
  return results.map((r) => `${r.title}\n${r.url}\n${r.content}`).join('\n\n')
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
export interface SearchDeps { apiKey: string; fetch: FetchLike }

/** Never throws — every failure returns text the model can read and work around. */
export async function runSearch(query: string, maxResults: number, deps: SearchDeps): Promise<string> {
  if (!deps.apiKey) return 'Web search is unavailable right now.'
  try {
    const res = await deps.fetch(TAVILY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: deps.apiKey, query, max_results: maxResults }),
    })
    if (!res.ok) return `Web search failed (status ${res.status}).`
    const body = (await res.json()) as { results?: SearchResult[] }
    return formatSearchResults(body.results ?? [])
  } catch {
    return 'Web search failed.'
  }
}

export const webSearchSkill: SkillModule<WebSearchConfig> = {
  id: 'web_search',

  async contributeTools(ctx: SkillContext<WebSearchConfig>): Promise<ToolSet> {
    const convRef = adminDb.doc(`workspaces/${ctx.workspaceId}/conversations/${ctx.conversationId}`)
    return {
      web_search: tool({
        description: 'Search the public web for current information that is not in the knowledge base.',
        inputSchema: z.object({ query: z.string().describe('The search query') }),
        execute: async ({ query }: { query: string }) => {
          const span = ctx.trace.span({ name: 'skill:web_search:call', input: { query } })
          try {
            const snap = await convRef.get()
            const used = (snap.data()?.searchCallCount as number | undefined) ?? 0
            if (used >= MAX_SEARCHES_PER_CONVERSATION) {
              span.end({ output: { capped: true } })
              return CAP_MESSAGE
            }
            await convRef.update({ searchCallCount: FieldValue.increment(1) })
            const text = await runSearch(query, ctx.config.maxResults, {
              apiKey: process.env.TAVILY_API_KEY ?? '',
              fetch: globalThis.fetch,
            })
            span.end({ output: { chars: text.length } })
            return text
          } catch {
            span.end({ output: { error: true } })
            return 'Web search failed.'
          }
        },
      }),
    }
  },
}

registerSkill(webSearchSkill)
