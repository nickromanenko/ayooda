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
/** Same budget executeTool gives a customer webhook — see chat/tools.ts. */
const TIMEOUT_MS = 10_000

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
  // Undici's default header timeout is ~300s: without an abort the model — and the visitor's
  // open SSE stream — would sit on a hung Tavily connection for minutes, up to three times
  // per conversation. Same AbortController shape and budget as executeTool in chat/tools.ts.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await deps.fetch(TAVILY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: deps.apiKey, query, max_results: maxResults }),
      signal: controller.signal,
    })
    if (!res.ok) return `Web search failed (status ${res.status}).`
    const body = (await res.json()) as { results?: SearchResult[] }
    return formatSearchResults(body.results ?? [])
  } catch {
    // Includes AbortError: a timeout reads to the model as any other failure, never a throw.
    return 'Web search failed.'
  } finally {
    clearTimeout(timer)
  }
}

export const webSearchSkill: SkillModule<WebSearchConfig> = {
  id: 'web_search',

  async contributeTools(ctx: SkillContext<WebSearchConfig>): Promise<ToolSet> {
    // No key, no tool: exposing one that can only answer "unavailable" burns an LLM round trip
    // per attempt in a misconfigured deploy. Checked per turn rather than at module load so a
    // key added later takes effect without a restart.
    if (!process.env.TAVILY_API_KEY) {
      console.warn('[skills] web_search: TAVILY_API_KEY is not set — tool not exposed this turn')
      return {}
    }
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
