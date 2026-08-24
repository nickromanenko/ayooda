import {
  TOOL_BUNDLES,
  applyTemplate,
  setupFieldsForToolBundle,
  templatesForToolBundle,
  type ToolBundle,
} from '@ayooda/shared'
import { validateToolInput, type ValidatedTool } from './validate'

const MAX_SETUP_VALUE_LENGTH = 2_048
const MAX_SECRET_LENGTH = 8_192

type Fail = { ok: false; error: string }
export type PreparedBundleTool = { templateId: string; value: ValidatedTool }
type Prepared = { ok: true; bundle: ToolBundle; tools: PreparedBundleTool[]; credentialId?: string }

const fail = (error: string): Fail => ({ ok: false, error })

function invalidSetupValue(key: string, value: string): string | null {
  if ((key === 'shop' || key === 'subdomain') && !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(value)) {
    return 'Use only the provider subdomain, with letters, numbers, and hyphens.'
  }
  if (key === 'apiVersion' && !/^\d{4}-\d{2}$/.test(value)) return 'API version must use YYYY-MM.'
  if (key === 'webhookUrl') {
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' || url.hostname !== 'hooks.zapier.com' || !url.pathname.startsWith('/hooks/catch/')) {
        return 'Webhook URL must be a Zapier HTTPS Catch Hook URL.'
      }
    } catch {
      return 'Webhook URL must be a Zapier HTTPS Catch Hook URL.'
    }
  }
  return null
}

export function prepareToolBundle(raw: unknown): Prepared | Fail {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Invalid bundle request.')
  const input = raw as Record<string, unknown>
  const bundle = TOOL_BUNDLES.find((item) => item.id === input.bundleId)
  if (!bundle) return fail('Unknown connector bundle.')

  const templates = templatesForToolBundle(bundle)
  if (templates.length !== bundle.templateIds.length) return fail('Connector bundle configuration is incomplete.')

  const rawSetup = input.setup
  const setupInput = rawSetup && typeof rawSetup === 'object' && !Array.isArray(rawSetup)
    ? rawSetup as Record<string, unknown>
    : {}
  const setup: Record<string, string> = {}
  for (const field of setupFieldsForToolBundle(bundle)) {
    const rawValue = setupInput[field.key]
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!value) return fail(`${field.label} is required.`)
    if (value.length > MAX_SETUP_VALUE_LENGTH) return fail(`${field.label} is too long.`)
    const setupError = invalidSetupValue(field.key, value)
    if (setupError) return fail(`${field.label}: ${setupError}`)
    setup[field.key] = value
  }

  const needsSecret = templates.some((template) => template.auth.type !== 'none')
  const secret = typeof input.secret === 'string' ? input.secret : ''
  const credentialId = typeof input.credentialId === 'string' ? input.credentialId.trim() : ''
  if (credentialId && credentialId !== bundle.id) return fail('Connector credential does not match this provider.')
  if (needsSecret && !secret.trim() && !credentialId) return fail(`${templates[0]!.secretLabel} is required.`)
  if (secret.length > MAX_SECRET_LENGTH) return fail('Connector credential is too long.')

  const tools: PreparedBundleTool[] = []
  for (const template of templates) {
    const applied = applyTemplate(template, setup)
    const parsed = validateToolInput({
      ...applied,
      auth: {
        ...applied.auth,
        ...(applied.auth.type !== 'none' ? { secret } : {}),
      },
      enabled: true,
      // Bundle installs never silently enable provider mutations.
      writeEnabled: false,
    })
    if (!parsed.ok) return fail(`${template.label}: ${parsed.error}`)
    tools.push({ templateId: template.id, value: parsed.value })
  }

  return { ok: true, bundle, tools, ...(credentialId ? { credentialId } : {}) }
}

export function toolBundleDocumentId(templateId: string): string {
  return `bundle_${templateId}`
}

export function planToolBundleInstall(
  tools: PreparedBundleTool[],
  existing: Array<{ id: string; name: string }>,
): { install: PreparedBundleTool[]; skippedTemplateIds: string[] } {
  const names = new Set(existing.map((tool) => tool.name))
  const ids = new Set(existing.map((tool) => tool.id))
  const install: PreparedBundleTool[] = []
  const skippedTemplateIds: string[] = []
  for (const tool of tools) {
    if (names.has(tool.value.name) || ids.has(toolBundleDocumentId(tool.templateId))) skippedTemplateIds.push(tool.templateId)
    else install.push(tool)
  }
  return { install, skippedTemplateIds }
}
