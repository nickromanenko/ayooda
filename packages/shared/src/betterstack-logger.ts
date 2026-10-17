// Ships existing console.log/info/warn/error calls to a BetterStack log source,
// on top of the normal console output. No call sites change — this patches the
// global console once at process startup.

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error'

const LEVEL_FOR: Record<ConsoleMethod, string> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
}

export interface BetterStackLoggerOptions {
  /** Tag applied to every shipped log line, e.g. "ayooda-api". */
  service: string
  /** BetterStack source write token. */
  sourceToken: string
  /** BetterStack source ingesting host, e.g. "s123456.us-west-2a.betterstackdata.com". */
  ingestingHost: string
}

declare global {
  // eslint-disable-next-line no-var
  var __betterstackLoggingInstalled: boolean | undefined
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? arg.message
  if (typeof arg === 'string') return arg
  return safeStringify(arg)
}

/** Idempotent: safe to call once per process at startup. */
export function installBetterStackLogging({ service, sourceToken, ingestingHost }: BetterStackLoggerOptions): void {
  if (globalThis.__betterstackLoggingInstalled) return
  if (!sourceToken || !ingestingHost) {
    console.warn(`[betterstack] missing source token or ingesting host; skipping log shipping for "${service}"`)
    return
  }

  const endpoint = `https://${ingestingHost}/`
  const original: Record<ConsoleMethod, (...args: unknown[]) => void> = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }

  function ship(method: ConsoleMethod, args: unknown[]) {
    const message = args.map(formatArg).join(' ')
    fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sourceToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dt: new Date().toISOString(), level: LEVEL_FOR[method], service, message }),
    }).catch((err: unknown) => original.error('[betterstack] failed to ship log:', err))
  }

  for (const method of Object.keys(original) as ConsoleMethod[]) {
    console[method] = (...args: unknown[]) => {
      original[method](...args)
      ship(method, args)
    }
  }

  globalThis.__betterstackLoggingInstalled = true
}
