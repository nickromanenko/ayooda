import { embedText } from '../gemini'
import { namespaceFor } from '../pinecone'
import type { LangfuseTrace } from '../langfuse'

export interface RetrievedContext {
  contextBlocks: string[]
  sources: Array<{ docId: string; source: string; score: number }>
}

const TOP_K = 5
const SCORE_THRESHOLD = 0.6

type Match = { score?: number; metadata?: Record<string, unknown> }

/** Pure: the threshold and mapping applied to raw Pinecone matches. */
export function selectMatches(matches: Match[] | undefined): RetrievedContext {
  const good = (matches ?? []).filter((m) => (m.score ?? 0) > SCORE_THRESHOLD)
  return {
    sources: good.map((m) => ({
      docId: (m.metadata?.docId as string) ?? '',
      source: (m.metadata?.source as string) ?? '',
      score: m.score ?? 0,
    })),
    contextBlocks: good.map((m) => (m.metadata?.text as string) ?? '').filter(Boolean),
  }
}

export interface RetrievalDeps {
  embed: (text: string, trace: LangfuseTrace) => Promise<number[]>
  query: (namespace: string, vector: number[]) => Promise<{ matches?: Match[] }>
}

const defaultDeps: RetrievalDeps = {
  embed: (text, trace) => embedText(text, trace),
  query: (namespace, vector) =>
    namespaceFor(namespace).query({ vector, topK: TOP_K, includeMetadata: true }) as Promise<{ matches?: Match[] }>,
}

/** Never rejects — retrieval is non-fatal, and a turn without context beats no reply. */
export async function retrieveContext(
  namespace: string,
  message: string,
  trace: LangfuseTrace,
  deps: RetrievalDeps = defaultDeps,
): Promise<RetrievedContext> {
  try {
    const vector = await deps.embed(message, trace)
    const span = trace.span({ name: 'pinecone-query', input: { topK: TOP_K } })
    const results = await deps.query(namespace, vector)
    span.end({ output: { matches: results.matches?.length ?? 0 } })
    return selectMatches(results.matches)
  } catch (err) {
    console.warn('[agent-turn] RAG retrieval failed:', err)
    return { contextBlocks: [], sources: [] }
  }
}
