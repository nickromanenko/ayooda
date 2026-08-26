export interface PrefixVectorIndex {
  listPaginated(options: {
    prefix: string
    limit: number
    paginationToken?: string
  }): Promise<{
    vectors?: Array<{ id?: string }>
    pagination?: { next?: string }
  }>
  deleteMany(ids: string[]): Promise<void>
}

const LIST_PAGE_SIZE = 100
const DELETE_BATCH_SIZE = 1_000

/** Vector ids are deterministic (`${docId}_${chunkIndex}`), so deleting by
 * their exact prefix works on serverless indexes where metadata-filter deletes
 * are not supported. */
export function documentVectorPrefix(docId: string): string {
  if (!docId) throw new Error('docId is required to delete document vectors')
  return `${docId}_`
}

export async function deleteDocumentVectors(index: PrefixVectorIndex, docId: string): Promise<number> {
  const prefix = documentVectorPrefix(docId)
  const ids: string[] = []
  const seenTokens = new Set<string>()
  let paginationToken: string | undefined

  do {
    const page = await index.listPaginated({
      prefix,
      limit: LIST_PAGE_SIZE,
      ...(paginationToken ? { paginationToken } : {}),
    })
    for (const vector of page.vectors ?? []) {
      if (vector.id?.startsWith(prefix)) ids.push(vector.id)
    }

    const next = page.pagination?.next
    if (next && seenTokens.has(next)) throw new Error('Pinecone returned a repeated pagination token')
    if (next) seenTokens.add(next)
    paginationToken = next
  } while (paginationToken)

  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    await index.deleteMany(ids.slice(i, i + DELETE_BATCH_SIZE))
  }
  return ids.length
}
