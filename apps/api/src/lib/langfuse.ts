import { Langfuse } from 'langfuse'

let _langfuse: Langfuse | null = null

export function getLangfuse(): Langfuse {
  if (!_langfuse) {
    _langfuse = new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
    })
  }
  return _langfuse
}

export type LangfuseTrace = ReturnType<Langfuse['trace']>
