import { describe, expect, test } from 'bun:test'
import { TOOL_TEMPLATES, applyTemplate } from '@ayooda/shared'
import { validateToolInput } from './validate'

const SAMPLE: Record<string, string> = { shop: 'my-store', apiVersion: '2024-01', subdomain: 'mycompany', baseUrl: 'https://api.example.com' }

describe('applyTemplate', () => {
  test('substitutes {{setup}} and leaves {param} intact', () => {
    const shopify = TOOL_TEMPLATES.find((t) => t.id === 'shopify_order_lookup')!
    const applied = applyTemplate(shopify, SAMPLE)
    expect(applied.urlTemplate).toBe('https://my-store.myshopify.com/admin/api/2024-01/orders.json?status=any&name={orderNumber}')
    expect(applied.auth).toEqual({ type: 'header', headerName: 'X-Shopify-Access-Token' })
    expect(applied.name).toBe('shopify_order_lookup')
  })
  test('handles a template with no setup fields', () => {
    const stripe = TOOL_TEMPLATES.find((t) => t.id === 'stripe_customer_lookup')!
    expect(applyTemplate(stripe, {}).urlTemplate).toBe('https://api.stripe.com/v1/customers?email={email}')
  })
  test('substitutes a base-url setup field for the generic template', () => {
    const generic = TOOL_TEMPLATES.find((t) => t.id === 'generic_rest_get')!
    expect(applyTemplate(generic, SAMPLE).urlTemplate).toBe('https://api.example.com/{id}')
  })
})

describe('catalog validity', () => {
  test('every template produces a payload that passes validateToolInput', () => {
    const failures = TOOL_TEMPLATES
      .filter((t) => !validateToolInput({ ...applyTemplate(t, SAMPLE), writeEnabled: false, enabled: true }).ok)
      .map((t) => t.id)
    expect(failures).toEqual([])
  })
  test('ships the five expected templates', () => {
    expect(TOOL_TEMPLATES.map((t) => t.id).sort()).toEqual(
      ['generic_rest_get', 'hubspot_contact_lookup', 'shopify_order_lookup', 'stripe_customer_lookup', 'zendesk_ticket_lookup'],
    )
  })
})
