import { GoogleGenerativeAI } from '@google/generative-ai'

let _genAI: GoogleGenerativeAI | null = null

export function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  }
  return _genAI
}

const EMBEDDING_MODEL = 'text-embedding-004'

/**
 * Embed a single text string.
 * Returns a 768-dimension float array.
 */
export async function embedText(text: string): Promise<number[]> {
  const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL })
  const result = await model.embedContent(text)
  return result.embedding.values
}

/**
 * Embed multiple texts in one batched API call.
 * Splits into chunks of 100 (API limit) and concatenates.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL })
  const BATCH_SIZE = 100
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const res = await model.batchEmbedContents({
      requests: batch.map((text) => ({ content: { parts: [{ text }], role: 'user' } })),
    })
    results.push(...res.embeddings.map((e) => e.values))
  }

  return results
}
