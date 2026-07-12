import { GoogleGenerativeAI, type EmbedContentRequest } from '@google/generative-ai'
import type { LangfuseTrace } from './langfuse'

let _genAI: GoogleGenerativeAI | null = null

export function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  }
  return _genAI
}

const EMBEDDING_MODEL = 'gemini-embedding-001'
const EMBEDDING_DIMENSIONS = 768 // must match the 768-dim Pinecone index

/**
 * Embed a single text string.
 * Returns a 768-dimension float array.
 */
export async function embedText(text: string, trace?: LangfuseTrace): Promise<number[]> {
  const generation = trace?.generation({
    name: 'embed-text',
    model: EMBEDDING_MODEL,
    input: text,
  })
  try {
    const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL })
    const request = {
      content: { parts: [{ text }], role: 'user' },
      outputDimensionality: EMBEDDING_DIMENSIONS,
    } as unknown as EmbedContentRequest
    const result = await model.embedContent(request)
    generation?.end({ output: { dimensions: result.embedding.values.length } })
    return result.embedding.values
  } catch (err) {
    generation?.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/**
 * Embed multiple texts in one batched API call.
 * Splits into chunks of 100 (API limit) and concatenates.
 */
export async function embedBatch(texts: string[], trace?: LangfuseTrace): Promise<number[][]> {
  const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL })
  const BATCH_SIZE = 100
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const generation = trace?.generation({
      name: 'embed-batch',
      model: EMBEDDING_MODEL,
      input: { count: batch.length, offset: i },
    })
    try {
      const res = await model.batchEmbedContents({
        requests: batch.map(
          (text) =>
            ({
              content: { parts: [{ text }], role: 'user' },
              outputDimensionality: EMBEDDING_DIMENSIONS,
            }) as unknown as EmbedContentRequest,
        ),
      })
      results.push(...res.embeddings.map((e) => e.values))
      generation?.end({ output: { embedded: res.embeddings.length } })
    } catch (err) {
      generation?.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  return results
}
