import { describe, expect, test, afterEach } from 'bun:test'
import { triggerCloudRunJob } from './scraper'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('triggerCloudRunJob', () => {
  test('fetches a metadata access token and attaches it as a Bearer header', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('metadata.google.internal')) {
        return new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 })
      }
      return new Response('', { status: 200 })
    }) as typeof fetch

    await triggerCloudRunJob('https://run.googleapis.com/v2/projects/p/locations/us-central1/jobs/j:run', {
      workspaceId: 'ws1',
      docId: 'doc1',
      docType: 'webpage',
      url: 'https://example.com',
      agentId: 'agent1',
      namespace: 'ws_ws1',
    })

    // First call obtains the token from the metadata server.
    expect(calls[0].url).toContain('metadata.google.internal')
    expect((calls[0].init?.headers as Record<string, string>)['Metadata-Flavor']).toBe('Google')

    // Second call is the job trigger, carrying the Bearer token + env overrides.
    const jobCall = calls[1]
    expect(jobCall.url).toContain('/jobs/j:run')
    expect((jobCall.init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
    const body = JSON.parse(String(jobCall.init?.body))
    const env: Array<{ name: string; value: string }> = body.overrides.containerOverrides[0].env
    expect(env).toContainEqual({ name: 'WORKSPACE_ID', value: 'ws1' })
    expect(env).toContainEqual({ name: 'DOC_ID', value: 'doc1' })
    expect(env).toContainEqual({ name: 'PINECONE_NAMESPACE', value: 'ws_ws1' })
  })

  test('throws when the metadata server returns no token', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch

    await expect(
      triggerCloudRunJob('https://run.googleapis.com/v2/projects/p/locations/us-central1/jobs/j:run', {
        workspaceId: 'ws1',
        docId: 'doc1',
        docType: 'webpage',
      }),
    ).rejects.toThrow('missing access_token')
  })
})
