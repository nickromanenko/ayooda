import { describe, expect, test } from 'bun:test'
import { TOOL_BUNDLES, setupFieldsForToolBundle, templatesForToolBundle } from '@ayooda/shared'
import { planToolBundleInstall, prepareToolBundle, toolBundleDocumentId } from './bundles'

const setupFor = (bundle: (typeof TOOL_BUNDLES)[number]) => Object.fromEntries(
  setupFieldsForToolBundle(bundle).map((field) => [
    field.key,
    field.key === 'webhookUrl' ? 'https://hooks.zapier.com/hooks/catch/1/example' : field.key === 'apiVersion' ? '2026-07' : 'example',
  ]),
)

describe('connector bundle preparation', () => {
  test('every catalog bundle resolves and produces validating tools', () => {
    for (const bundle of TOOL_BUNDLES) {
      const templates = templatesForToolBundle(bundle)
      expect(templates).toHaveLength(bundle.templateIds.length)
      const result = prepareToolBundle({ bundleId: bundle.id, setup: setupFor(bundle), secret: 'secret' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.tools).toHaveLength(bundle.templateIds.length)
        expect(result.tools.every((tool) => tool.value.enabled)).toBe(true)
        expect(result.tools.filter((tool) => tool.value.kind === 'write').every((tool) => !tool.value.writeEnabled)).toBe(true)
      }
    }
  })

  test('applies shared setup to every action in a provider bundle', () => {
    const result = prepareToolBundle({
      bundleId: 'shopify',
      setup: { shop: 'my-store', apiVersion: '2026-07' },
      secret: 'shpat_example',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tools.every((tool) => tool.value.urlTemplate.includes('my-store.myshopify.com/admin/api/2026-07'))).toBe(true)
      expect(result.tools.every((tool) => tool.value.secret === 'shpat_example')).toBe(true)
    }
  })

  test('requires known bundles, setup fields, and credentials', () => {
    expect(prepareToolBundle({ bundleId: 'unknown' })).toEqual({ ok: false, error: 'Unknown connector bundle.' })
    expect(prepareToolBundle({ bundleId: 'shopify', setup: {}, secret: 'x' })).toEqual({ ok: false, error: 'Store subdomain is required.' })
    expect(prepareToolBundle({ bundleId: 'stripe', setup: {} })).toEqual({ ok: false, error: 'Stripe secret key (sk_…) is required.' })
  })

  test('accepts only the matching shared provider credential', () => {
    const connected = prepareToolBundle({ bundleId: 'linear', setup: {}, credentialId: 'linear' })
    expect(connected.ok).toBe(true)
    if (connected.ok) {
      expect(connected.credentialId).toBe('linear')
      expect(connected.tools[0]!.value.secret).toBeUndefined()
    }
    expect(prepareToolBundle({ bundleId: 'linear', setup: {}, credentialId: 'notion' }))
      .toEqual({ ok: false, error: 'Connector credential does not match this provider.' })
  })

  test('provider setup cannot escape its expected host or format', () => {
    expect(prepareToolBundle({
      bundleId: 'shopify', setup: { shop: 'store.example.com/path', apiVersion: 'latest' }, secret: 'x',
    })).toMatchObject({ ok: false, error: expect.stringContaining('subdomain') })
    expect(prepareToolBundle({
      bundleId: 'zapier', setup: { webhookUrl: 'https://example.com/capture' },
    })).toEqual({ ok: false, error: 'Zapier webhook URL: Webhook URL must be a Zapier HTTPS Catch Hook URL.' })
  })

  test('a credential-free Zapier bundle uses its guarded webhook URL', () => {
    const result = prepareToolBundle({
      bundleId: 'zapier',
      setup: { webhookUrl: 'https://hooks.zapier.com/hooks/catch/1/example' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tools[0]!.value.auth.type).toBe('none')
      expect(result.tools[0]!.value.urlTemplate).toBe('https://hooks.zapier.com/hooks/catch/1/example')
    }
  })

  test('duplicate names and deterministic ids are skipped while missing actions remain installable', () => {
    const prepared = prepareToolBundle({ bundleId: 'shopify', setup: { shop: 'store', apiVersion: '2026-07' }, secret: 'x' })
    if (!prepared.ok) throw new Error(prepared.error)
    const plan = planToolBundleInstall(prepared.tools, [
      { id: 'manual', name: 'shopify_order_lookup' },
      { id: toolBundleDocumentId('shopify_refund'), name: 'renamed_refund' },
    ])
    expect(plan.install.map((tool) => tool.templateId)).toEqual(['shopify_transactions_lookup'])
    expect(plan.skippedTemplateIds.sort()).toEqual(['shopify_order_lookup', 'shopify_refund'])
  })
})
