export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (!process.env.BETTERSTACK_SOURCE_TOKEN) return

  const { installBetterStackLogging } = await import('@ayooda/shared')
  installBetterStackLogging({
    service: 'ayooda-web',
    sourceToken: process.env.BETTERSTACK_SOURCE_TOKEN,
    ingestingHost: process.env.BETTERSTACK_INGESTING_HOST ?? '',
  })
}
