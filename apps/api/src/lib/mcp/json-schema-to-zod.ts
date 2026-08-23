import { z } from 'zod'

/**
 * Convert an MCP tool's JSON Schema `inputSchema` into a Zod schema the AI SDK
 * `tool()` can use. Covers the common subset real MCP servers expose —
 * object properties, string/number/integer/boolean, arrays, enums, local $ref,
 * nullability and descriptions. Anything unrecognised degrades to z.unknown()
 * rather than throwing, so a single exotic tool never breaks a whole turn.
 */

type Defs = Record<string, unknown>

function enumToZod(values: unknown[]): z.ZodTypeAny {
  const parts: z.ZodTypeAny[] = []
  const hasNull = values.some((v) => v === null)
  for (const v of values) {
    if (v === null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      parts.push(z.literal(v))
    } else {
      // Non-primitive enum member (rare) — represent it as its JSON text.
      parts.push(z.literal(JSON.stringify(v)))
    }
  }
  if (hasNull) parts.push(z.null())
  if (parts.length === 0) return z.unknown()
  if (parts.length === 1) return parts[0]!
  return z.union(parts as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
}

function objectToZod(s: Record<string, unknown>, defs: Defs): z.ZodTypeAny {
  const mergedDefs: Defs = { ...defs }
  const localDefs = (s.$defs ?? s.definitions) as Record<string, unknown> | undefined
  if (localDefs && typeof localDefs === 'object') Object.assign(mergedDefs, localDefs)

  const properties = (s.properties ?? {}) as Record<string, unknown>
  const required = new Set(
    Array.isArray(s.required) ? (s.required as unknown[]).filter((r): r is string => typeof r === 'string') : [],
  )

  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, propSchema] of Object.entries(properties)) {
    let prop = jsonSchemaToZod(propSchema, mergedDefs)
    if (!required.has(key)) prop = prop.optional()
    shape[key] = prop
  }
  return z.object(shape)
}

export function jsonSchemaToZod(schema: unknown, defs: Defs = {}): z.ZodTypeAny {
  if (schema === undefined || schema === null) return z.unknown()
  if (schema === true) return z.unknown()
  if (schema === false) return z.unknown()
  if (typeof schema !== 'object' || Array.isArray(schema)) return z.unknown()

  const s = schema as Record<string, unknown>

  // Local $ref (e.g. "#/$defs/Order" or "#/definitions/Order").
  if (typeof s.$ref === 'string' && s.$ref.startsWith('#/')) {
    const key = s.$ref.split('/').pop()!
    if (defs[key] !== undefined) return jsonSchemaToZod(defs[key], defs)
    return z.unknown()
  }

  const desc = typeof s.description === 'string' && s.description.length > 0 ? s.description : undefined
  const rawType = s.type
  const typeList: unknown[] = Array.isArray(rawType) ? rawType : typeof rawType === 'string' ? [rawType] : []
  const nullable = typeList.includes('null')
  const types = typeList.filter((t) => t !== 'null')

  let base: z.ZodTypeAny
  if (Array.isArray(s.enum)) {
    base = enumToZod(s.enum as unknown[])
  } else if (types.length === 0) {
    base = s.properties && typeof s.properties === 'object' ? objectToZod(s, defs) : z.unknown()
  } else {
    switch (types[0]) {
      case 'string':
        base = z.string()
        break
      case 'number':
        base = z.number()
        break
      case 'integer':
        base = z.number().int()
        break
      case 'boolean':
        base = z.boolean()
        break
      case 'null':
        base = z.null()
        break
      case 'array':
        base = z.array(s.items !== undefined ? jsonSchemaToZod(s.items, defs) : z.unknown())
        break
      case 'object':
        base = objectToZod(s, defs)
        break
      default:
        base = z.unknown()
    }
  }

  if (desc) base = base.describe(desc)
  if (nullable) base = base.nullable()
  return base
}
