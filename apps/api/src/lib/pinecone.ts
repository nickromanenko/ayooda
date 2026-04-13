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

/** Namespace per workspace to keep vectors isolated */
export function namespaceFor(workspaceId: string) {
  return getIndex().namespace(`ws_${workspaceId}`)
}
