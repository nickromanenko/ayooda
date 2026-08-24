import { describe, expect, test } from 'bun:test'
import { TOOL_BUNDLES, TOOL_TEMPLATES, applyTemplate } from '@ayooda/shared'
import { validateToolInput } from './validate'

const SAMPLE: Record<string, string> = {
  shop: 'my-store', apiVersion: '2024-01', subdomain: 'mycompany',
  baseUrl: 'https://api.example.com', webhookUrl: 'https://hooks.zapier.com/hooks/catch/1/abc',
}

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
  test('carries provider-specific body templates and encodings', () => {
    const stripe = TOOL_TEMPLATES.find((t) => t.id === 'stripe_customer_update')!
    const applied = applyTemplate(stripe, {})
    expect(applied.bodyEncoding).toBe('form')
    expect(JSON.parse(applied.bodyTemplate!)).toEqual({ email: '{email}' })
    expect(applied.kind).toBe('write')
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
  test('ships lookup and write actions for the four built-in providers', () => {
    expect(TOOL_TEMPLATES.map((t) => t.id).sort()).toEqual(
      [
        'generic_rest_get',
        'hubspot_contact_lookup', 'hubspot_contact_update',
        'intercom_contact_lookup', 'linear_issue_lookup', 'notion_search',
        'shopify_order_lookup', 'shopify_refund', 'shopify_transactions_lookup',
        'stripe_customer_lookup', 'stripe_customer_update',
        'zapier_webhook_action',
        'zendesk_ticket_lookup', 'zendesk_ticket_resolve',
      ],
    )
  })
  test('every provider action belongs to exactly one connector bundle', () => {
    const bundled = TOOL_BUNDLES.flatMap((bundle) => bundle.templateIds)
    expect(new Set(bundled).size).toBe(bundled.length)
    expect(bundled.sort()).toEqual(TOOL_TEMPLATES.filter((template) => template.id !== 'generic_rest_get').map((template) => template.id).sort())
  })
})
