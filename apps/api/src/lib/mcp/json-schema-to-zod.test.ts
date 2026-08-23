import { describe, expect, test } from 'bun:test'
import { jsonSchemaToZod } from './json-schema-to-zod'

const parse = (schema: unknown, value: unknown) => jsonSchemaToZod(schema).safeParse(value)

describe('jsonSchemaToZod', () => {
  test('converts an object with typed properties', () => {
    const schema = {
      type: 'object',
      properties: {
        orderNumber: { type: 'string' },
        amount: { type: 'number' },
        paid: { type: 'boolean' },
      },
      required: ['orderNumber'],
    }
    expect(parse(schema, { orderNumber: '#1001', amount: 9.5, paid: true }).success).toBe(true)
    expect(parse(schema, { amount: 9.5 }).success).toBe(false) // missing required
  })

  test('treats absent properties as optional', () => {
    const schema = { type: 'object', properties: { note: { type: 'string' } } }
    expect(parse(schema, {}).success).toBe(true)
  })

  test('handles integer, enum, and arrays', () => {
    const schema = {
      type: 'object',
      properties: {
        qty: { type: 'integer' },
        status: { type: 'string', enum: ['open', 'closed'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['qty', 'status', 'tags'],
    }
    expect(parse(schema, { qty: 3, status: 'open', tags: ['a', 'b'] }).success).toBe(true)
    expect(parse(schema, { qty: 3.5, status: 'open', tags: [] }).success).toBe(false) // non-integer
    expect(parse(schema, { qty: 3, status: 'nope', tags: [] }).success).toBe(false) // bad enum
  })

  test('supports nullable fields', () => {
    const schema = { type: 'object', properties: { email: { type: ['string', 'null'] } }, required: ['email'] }
    expect(parse(schema, { email: null }).success).toBe(true)
    expect(parse(schema, { email: 'a@b.com' }).success).toBe(true)
    expect(parse(schema, { email: 5 }).success).toBe(false)
  })

  test('supports nested objects and local $ref', () => {
    const schema = {
      type: 'object',
      $defs: { address: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
      properties: { shipping: { $ref: '#/$defs/address' } },
      required: ['shipping'],
    }
    expect(parse(schema, { shipping: { city: 'Berlin' } }).success).toBe(true)
    expect(parse(schema, { shipping: {} }).success).toBe(false)
  })

  test('degrades unknown shapes to permissive schemas instead of throwing', () => {
    expect(jsonSchemaToZod(null).safeParse({ anything: 1 }).success).toBe(true)
    expect(jsonSchemaToZod({ type: 'object' }).safeParse({}).success).toBe(true)
    expect(jsonSchemaToZod({ type: 'weird' }).safeParse(42).success).toBe(true)
  })
})
