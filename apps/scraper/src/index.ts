// Ayooda Scraper — Cloud Run Job entry point
// Environment variables set by the triggering API:
//   WORKSPACE_ID, DOC_ID, URL

async function main() {
  const workspaceId = process.env.WORKSPACE_ID
  const docId = process.env.DOC_ID
  const url = process.env.URL

  if (!workspaceId || !docId || !url) {
    console.error('Missing required env vars: WORKSPACE_ID, DOC_ID, URL')
    process.exit(1)
  }

  console.log(`Scraping ${url} for workspace ${workspaceId}`)
  // Full implementation added in subsequent steps:
  // 1. Update Firestore doc status to 'processing'
  // 2. Launch Puppeteer, crawl URL + linked pages
  // 3. Extract and clean text content
  // 4. Chunk text (~500 tokens, 50-token overlap)
  // 5. Embed chunks via Google text-embedding-004
  // 6. Upsert to Pinecone (namespace: workspace_{workspaceId})
  // 7. Update Firestore doc status to 'indexed' with chunkCount
}

main().catch((err) => {
  console.error('Scraper failed:', err)
  process.exit(1)
})
