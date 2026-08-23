import type { ToolMethod, ToolParamType, ToolAuthType, ToolKind, ToolParam, ToolBodyEncoding } from '@ayooda/shared'

export interface ValidatedTool {
  name: string
  description: string
  method: ToolMethod
  urlTemplate: string
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>
  bodyTemplate?: string
  bodyEncoding?: ToolBodyEncoding
  auth: { type: ToolAuthType; headerName?: string }
  secret?: string
  kind: ToolKind
  writeEnabled: boolean
  enabled: boolean
}

const NAME_RE = /^[a-zA-Z0-9_-]{1,48}$/
const PARAM_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const METHODS: ToolMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const PARAM_TYPES: ToolParamType[] = ['string', 'number', 'boolean']
const AUTH_TYPES: ToolAuthType[] = ['none', 'bearer', 'header']
const BODY_ENCODINGS: ToolBodyEncoding[] = ['json', 'form']
const FORBIDDEN_HEADERS = new Set(['host', 'content-length'])
const BODY_METHODS: ToolMethod[] = ['POST', 'PUT', 'PATCH']
const MAX_BODY_TEMPLATE_CHARS = 16_384

type Fail = { ok: false; error: string }
const fail = (error: string): Fail => ({ ok: false, error })

export function validateToolInput(
  raw: unknown,
): { ok: true; value: ValidatedTool } | Fail {
  if (!raw || typeof raw !== 'object') return fail('Invalid request body.')
  const o = raw as Record<string, unknown>

  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!NAME_RE.test(name)) return fail('Name must be 1–48 chars: letters, numbers, _ or -.')

  const description = typeof o.description === 'string' ? o.description.trim() : ''
  if (description.length < 1 || description.length > 1024) return fail('Description must be 1–1024 characters.')

  const method = o.method as ToolMethod
  if (!METHODS.includes(method)) return fail('Method must be one of GET, POST, PUT, PATCH, DELETE.')

  const urlTemplate = typeof o.urlTemplate === 'string' ? o.urlTemplate.trim() : ''
  let url: URL
  try { url = new URL(urlTemplate.replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, 'x')) } catch { return fail('URL is not valid.') }
  if (url.protocol !== 'https:') return fail('URL must use https://.')

  const rawParams = Array.isArray(o.params) ? o.params : []
  if (rawParams.length > 20) return fail('A tool may have at most 20 parameters.')
  const params: ToolParam[] = []
  const seen = new Set<string>()
  for (const p of rawParams) {
    if (!p || typeof p !== 'object') return fail('Each parameter must be an object.')
    const pp = p as Record<string, unknown>
    const pname = typeof pp.name === 'string' ? pp.name.trim() : ''
    if (!PARAM_RE.test(pname)) return fail(`Parameter name "${pname}" is invalid.`)
    if (seen.has(pname)) return fail(`Duplicate parameter name "${pname}".`)
    seen.add(pname)
    const ptype = pp.type as ToolParamType
    if (!PARAM_TYPES.includes(ptype)) return fail(`Parameter "${pname}" has an invalid type.`)
    const pdesc = typeof pp.description === 'string' ? pp.description.trim() : ''
    if (pdesc.length > 256) return fail(`Parameter "${pname}" description is too long.`)
    params.push({ name: pname, type: ptype, description: pdesc, required: pp.required === true })
  }

  // Every {placeholder} in the URL must be a declared param.
  const placeholders = [...urlTemplate.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!)
  for (const ph of placeholders) {
    if (!seen.has(ph)) return fail(`URL placeholder {${ph}} has no matching parameter.`)
  }

  const rawHeaders = Array.isArray(o.headers) ? o.headers : []
  if (rawHeaders.length > 20) return fail('A tool may have at most 20 headers.')
  const headers: Array<{ key: string; value: string }> = []
  for (const h of rawHeaders) {
    if (!h || typeof h !== 'object') return fail('Each header must be an object.')
    const hh = h as Record<string, unknown>
    const key = typeof hh.key === 'string' ? hh.key.trim() : ''
    const value = typeof hh.value === 'string' ? hh.value : ''
    if (!key) return fail('Header keys cannot be empty.')
    if (FORBIDDEN_HEADERS.has(key.toLowerCase())) return fail(`Header "${key}" cannot be overridden.`)
    headers.push({ key, value })
  }

  const bodyTemplate = typeof o.bodyTemplate === 'string' && o.bodyTemplate.trim()
    ? o.bodyTemplate.trim()
    : undefined
  let bodyEncoding: ToolBodyEncoding | undefined
  if (bodyTemplate) {
    if (!BODY_METHODS.includes(method)) return fail('A request body is only supported for POST, PUT, or PATCH tools.')
    if (bodyTemplate.length > MAX_BODY_TEMPLATE_CHARS) return fail('Body template is too long.')
    try { JSON.parse(bodyTemplate) } catch { return fail('Body template must be valid JSON.') }
    bodyEncoding = o.bodyEncoding === undefined ? 'json' : o.bodyEncoding as ToolBodyEncoding
    if (!BODY_ENCODINGS.includes(bodyEncoding)) return fail('Body encoding must be json or form.')

    const bodyPlaceholders = [...bodyTemplate.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!)
    for (const ph of bodyPlaceholders) {
      if (!seen.has(ph)) return fail(`Body placeholder {${ph}} has no matching parameter.`)
    }

    if (bodyEncoding === 'form') {
      const parsed = JSON.parse(bodyTemplate) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((v) => v !== null && typeof v === 'object')) {
        return fail('Form body template must be a flat JSON object.')
      }
    }
  } else if (o.bodyEncoding !== undefined && !BODY_ENCODINGS.includes(o.bodyEncoding as ToolBodyEncoding)) {
    return fail('Body encoding must be json or form.')
  }

  const rawAuth = (o.auth ?? { type: 'none' }) as Record<string, unknown>
  const authType = rawAuth.type as ToolAuthType
  if (!AUTH_TYPES.includes(authType)) return fail('Auth type must be none, bearer, or header.')
  const auth: ValidatedTool['auth'] = { type: authType }
  if (authType === 'header') {
    const headerName = typeof rawAuth.headerName === 'string' ? rawAuth.headerName.trim() : ''
    if (!headerName) return fail('Header auth requires a header name.')
    auth.headerName = headerName
  }
  const secret = typeof rawAuth.secret === 'string' && rawAuth.secret.length > 0 ? rawAuth.secret : undefined

  const kind = o.kind as ToolKind
  if (kind !== 'read' && kind !== 'write') return fail('Kind must be read or write.')
  const writeEnabled = kind === 'write' && o.writeEnabled === true
  const enabled = o.enabled === undefined ? true : o.enabled === true

  return {
    ok: true,
    value: {
      name, description, method, urlTemplate, params, headers,
      ...(bodyTemplate ? { bodyTemplate, bodyEncoding } : {}),
      auth, secret, kind, writeEnabled, enabled,
    },
  }
}
