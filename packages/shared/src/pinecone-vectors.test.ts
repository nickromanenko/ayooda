import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDocumentVectors, documentVectorPrefix, type PrefixVectorIndex } from './pinecone-vectors'

describe('Pinecone document vector deletion', () => {
  test('lists every matching id page and deletes by id', async () => {
    const listCalls: Array<{ prefix: string; limit: number; paginationToken?: string }> = []
    const deleteCalls: string[][] = []
    const index: PrefixVectorIndex = {
      async listPaginated(options) {
        listCalls.push(options)
        if (!options.paginationToken) {
          return { vectors: [{ id: 'doc_0' }, { id: 'doc_1' }], pagination: { next: 'page-2' } }
        }
        return { vectors: [{ id: 'doc_2' }] }
      },
      async deleteMany(ids) { deleteCalls.push(ids) },
    }

    assert.equal(await deleteDocumentVectors(index, 'doc'), 3)
    assert.deepEqual(listCalls, [
      { prefix: 'doc_', limit: 100 },
      { prefix: 'doc_', limit: 100, paginationToken: 'page-2' },
    ])
    assert.deepEqual(deleteCalls, [['doc_0', 'doc_1', 'doc_2']])
  })

  test('does not issue an empty delete request for a new document', async () => {
    let deleted = false
    const index: PrefixVectorIndex = {
      async listPaginated() { return {} },
      async deleteMany() { deleted = true },
    }

    assert.equal(await deleteDocumentVectors(index, 'new-doc'), 0)
    assert.equal(deleted, false)
  })

  test('requires a non-empty document id', () => {
    assert.throws(() => documentVectorPrefix(''), /docId is required/)
  })
})
