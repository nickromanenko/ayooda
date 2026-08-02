import { Pinecone } from '@pinecone-database/pinecone'

let _client: Pinecone | null = null

export function getPinecone(): Pinecone {
  if (!_client) {
    _client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! })
  }
  return _client
}

export function getIndex() {
  return getPinecone().index(process.env.PINECONE_INDEX!)
}

/** Namespace for a Pinecone-isolated vector set. Pass the full namespace string
 * (e.g. an agent's stored knowledgeNamespace). */
export function namespaceFor(namespace: string) {
  return getIndex().namespace(namespace)
}
