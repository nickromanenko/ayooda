'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Loader2, Mail, Plus, RotateCcw, Send, TicketCheck, Trash2, Webhook } from 'lucide-react'
import { DEFAULT_TICKETING_CONFIG, TICKET_FIELD_TYPES, type TicketingConfig, type TicketIntakeField } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { Loading } from '@/components/dashboard/Loading'
import styles from './page.module.css'

function fieldId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40) || 'field'
}

type DeliveryHealth = { failed: number; lastSuccessfulAt: string | null }

function fingerprint(config: TicketingConfig): string {
  return JSON.stringify(config)
}

function configOnly(config: TicketingConfig): TicketingConfig {
  return {
    enabled: config.enabled,
    requireConfirmation: config.requireConfirmation,
    afterSubmission: config.afterSubmission,
    acknowledgementMessage: config.acknowledgementMessage,
    fields: config.fields,
    destination: config.destination,
  }
}

export default function TicketSettingsPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)
  const [config, setConfig] = useState<TicketingConfig | null>(null)
  const [loadingError, setLoadingError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | 'rotate' | ''>('')
  const [secret, setSecret] = useState('')
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [health, setHealth] = useState<DeliveryHealth>({ failed: 0, lastSuccessfulAt: null })
  const savedRef = useRef('')

  const load = useCallback(async () => {
    setLoadingError('')
    try {
      const response = await apiRequest(`/agents/${agentId}/ticketing`)
      const body = await response.json().catch(() => ({})) as TicketingConfig & { error?: string; deliveryHealth?: DeliveryHealth }
      if (!response.ok) throw new Error(response.status === 403 ? 'Only the workspace owner can configure ticket intake.' : body.error ?? 'Could not load ticket settings.')
      const next = configOnly(body)
      setConfig(next)
      savedRef.current = fingerprint(next)
      setHealth(body.deliveryHealth ?? { failed: 0, lastSuccessfulAt: null })
    } catch (cause) { setLoadingError(cause instanceof Error ? cause.message : 'Could not load ticket settings.') }
  }, [agentId])

  useEffect(() => { void load() }, [load])

  const dirty = Boolean(config && savedRef.current && fingerprint(config) !== savedRef.current)
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function updateField(index: number, patch: Partial<TicketIntakeField>) {
    if (!config) return
    setConfig({ ...config, fields: config.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field) })
    setNotice(''); setError('')
  }

  function addField() {
    if (!config || config.fields.length >= 10) return
    const base = `field_${config.fields.length + 1}`
    setConfig({ ...config, fields: [...config.fields, { id: base, label: '', description: '', type: 'text', required: false }] })
  }

  function moveField(index: number, direction: -1 | 1) {
    if (!config) return
    const target = index + direction
    if (target < 0 || target >= config.fields.length) return
    const fields = [...config.fields]
    ;[fields[index], fields[target]] = [fields[target]!, fields[index]!]
    setConfig({ ...config, fields })
  }

  async function save() {
    if (!config || busy) return
    setBusy('save'); setError(''); setNotice(''); setSecret('')
    try {
      const response = await apiRequest(`/agents/${agentId}/ticketing`, { method: 'PUT', body: JSON.stringify(config) })
      const body = await response.json().catch(() => ({})) as TicketingConfig & { error?: string; signingSecret?: string }
      if (!response.ok) throw new Error(body.error ?? 'Ticket settings could not be saved.')
      const next = configOnly(body)
      setConfig(next)
      savedRef.current = fingerprint(next)
      if (body.signingSecret) setSecret(body.signingSecret)
      setNotice('Ticket intake settings saved. New conversations will use them immediately.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Ticket settings could not be saved.') }
    finally { setBusy('') }
  }

  async function sendTest() {
    if (!config || config.destination.type === 'internal' || busy) return
    setBusy('test'); setError(''); setNotice('')
    try {
      const saveResponse = await apiRequest(`/agents/${agentId}/ticketing`, { method: 'PUT', body: JSON.stringify(config) })
      const saved = await saveResponse.json().catch(() => ({})) as TicketingConfig & { error?: string; signingSecret?: string }
      if (!saveResponse.ok) throw new Error(saved.error ?? 'Save the destination before testing it.')
      const next = configOnly(saved)
      setConfig(next)
      savedRef.current = fingerprint(next)
      if (saved.signingSecret) setSecret(saved.signingSecret)
      const response = await apiRequest(`/agents/${agentId}/ticketing/test`, { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Test delivery failed.')
      setNotice('Synthetic test ticket delivered successfully. No customer ticket was created.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Test delivery failed.') }
    finally { setBusy('') }
  }

  async function rotate() {
    if (busy) return
    if (!confirmRotate) { setConfirmRotate(true); return }
    setBusy('rotate'); setError(''); setNotice('')
    try {
      const response = await apiRequest(`/agents/${agentId}/ticketing/secret/rotate`, { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { secret?: string; error?: string }
      if (!response.ok || !body.secret) throw new Error(body.error ?? 'Signing secret could not be rotated.')
      setSecret(body.secret); setConfirmRotate(false)
      setNotice('Signing secret rotated. Update the receiving system before retrying failed deliveries.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Signing secret could not be rotated.') }
    finally { setBusy('') }
  }

  if (!config) return loadingError ? <div className={styles.errorPanel}><p>{loadingError}</p><button type="button" onClick={() => void load()}>Try again</button></div> : <Loading label="Loading ticket settings…" />

  return <div className={styles.page}>
    <header className={styles.intro}><div><h2>Support tickets</h2><p>Let this agent collect structured requests and keep a durable copy in Ayooda before optional external delivery.</p></div><span className={styles.status} data-enabled={config.enabled}>{config.enabled ? 'Intake enabled' : 'Intake off'}</span></header>

    {(error || notice) && <div className={error ? styles.error : styles.notice} role="status">{error || notice}</div>}

    <section className={styles.card} aria-labelledby="behavior-title">
      <div className={styles.cardHeader}><span className={styles.cardIcon}><TicketCheck size={18} /></span><div><h3 id="behavior-title">Agent behavior</h3><p>Tickets are created only when the customer asks for follow-up—not for ordinary questions.</p></div></div>
      <label className={styles.switchRow}><span><strong>Enable ticket intake</strong><small>Expose the trusted ticket tool in real customer conversations.</small></span><input type="checkbox" checked={config.enabled} onChange={(event) => setConfig({ ...config, enabled: event.target.checked })} /></label>
      <div className={styles.twoColumns}>
        <label className={styles.checkRow}><input type="checkbox" checked={config.requireConfirmation} onChange={(event) => setConfig({ ...config, requireConfirmation: event.target.checked })} /><span><strong>Require customer confirmation</strong><small>Recommended to prevent accidental submissions.</small></span></label>
        <label className={styles.field}><span>After submission</span><select value={config.afterSubmission} onChange={(event) => setConfig({ ...config, afterSubmission: event.target.value as TicketingConfig['afterSubmission'] })}><option value="continue">Continue helping</option><option value="handoff">Move to human queue</option></select></label>
      </div>
      <label className={styles.field}><span>Acknowledgement message</span><textarea rows={3} maxLength={500} value={config.acknowledgementMessage} onChange={(event) => setConfig({ ...config, acknowledgementMessage: event.target.value })} /><small>Use <code>{'{number}'}</code> where the ticket number should appear.</small></label>
    </section>

    <section className={styles.card} aria-labelledby="fields-title">
      <div className={styles.cardHeader}><div><h3 id="fields-title">Information to collect</h3><p>Subject, description, and priority are always collected. Add up to ten business-specific fields.</p></div><button className={styles.secondaryButton} type="button" onClick={addField} disabled={config.fields.length >= 10}><Plus size={15} /> Add field</button></div>
      {!config.fields.length ? <div className={styles.emptyFields}>No custom fields. The agent will collect only the standard ticket details.</div> : <div className={styles.fieldList}>{config.fields.map((field, index) => <div className={styles.fieldEditor} key={`${field.id}-${index}`}>
        <div className={styles.fieldEditorTop}>
          <label className={styles.field}><span>Label</span><input value={field.label} maxLength={60} placeholder="Order ID" onChange={(event) => updateField(index, { label: event.target.value, id: field.id.startsWith('field_') ? fieldId(event.target.value) : field.id })} /></label>
          <label className={styles.field}><span>Field ID</span><input value={field.id} maxLength={40} placeholder="order_id" onChange={(event) => updateField(index, { id: fieldId(event.target.value) })} /></label>
          <label className={styles.field}><span>Type</span><select value={field.type} onChange={(event) => updateField(index, { type: event.target.value as TicketIntakeField['type'], options: event.target.value === 'select' ? field.options ?? [''] : undefined })}>{TICKET_FIELD_TYPES.map((type) => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}</select></label>
          <div className={styles.fieldActions}><button className={styles.iconButton} type="button" onClick={() => moveField(index, -1)} disabled={index === 0} aria-label={`Move ${field.label || 'custom field'} up`} title="Move up"><ArrowUp size={15} /></button><button className={styles.iconButton} type="button" onClick={() => moveField(index, 1)} disabled={index === config.fields.length - 1} aria-label={`Move ${field.label || 'custom field'} down`} title="Move down"><ArrowDown size={15} /></button><button className={styles.iconButton} type="button" onClick={() => setConfig({ ...config, fields: config.fields.filter((_, fieldIndex) => fieldIndex !== index) })} aria-label={`Remove ${field.label || 'custom field'}`} title="Remove field"><Trash2 size={16} /></button></div>
        </div>
        <label className={styles.field}><span>Agent guidance</span><input value={field.description} maxLength={240} placeholder="Ask for the order number shown in the confirmation email." onChange={(event) => updateField(index, { description: event.target.value })} /></label>
        {field.type === 'select' && <label className={styles.field}><span>Choices</span><input value={(field.options ?? []).join(', ')} placeholder="Billing, Technical, Account" onChange={(event) => updateField(index, { options: event.target.value.split(',').map((value) => value.trim()) })} /><small>Separate choices with commas.</small></label>}
        <label className={styles.inlineCheck}><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} /> Required before submission</label>
      </div>)}</div>}
    </section>

    <section className={styles.card} aria-labelledby="delivery-title">
      <div className={styles.cardHeader}><span className={styles.cardIcon}><Send size={18} /></span><div><h3 id="delivery-title">Delivery</h3><p>Ayooda always keeps the ticket. Optionally send a copy to another support system.</p></div></div>
      <div className={styles.destinationPicker}>
        {([{ type: 'internal', label: 'Ayooda only', detail: 'Use the shared Inbox.', icon: TicketCheck }, { type: 'webhook', label: 'Webhook', detail: 'POST signed JSON to HTTPS.', icon: Webhook }, { type: 'email', label: 'Support email', detail: 'Send through a connected email channel.', icon: Mail }] as const).map((option) => <button key={option.type} type="button" data-selected={config.destination.type === option.type} onClick={() => setConfig({ ...config, destination: option.type === 'webhook' ? { type: 'webhook', url: '' } : option.type === 'email' ? { type: 'email', address: '' } : { type: 'internal' } })}><option.icon size={17} /><span><strong>{option.label}</strong><small>{option.detail}</small></span>{config.destination.type === option.type && <Check size={15} />}</button>)}
      </div>
      {config.destination.type === 'webhook' && <div className={styles.destinationConfig}>
        <label className={styles.field}><span>Webhook URL</span><input type="url" value={config.destination.url} placeholder="https://support.example.com/hooks/ayooda" onChange={(event) => setConfig({ ...config, destination: { type: 'webhook', url: event.target.value, hasSigningSecret: config.destination.type === 'webhook' ? config.destination.hasSigningSecret : undefined } })} /><small>HTTPS only. Redirects and private network addresses are blocked.</small></label>
        <div className={styles.secretRow}><div><strong>Signing secret</strong><small>{config.destination.hasSigningSecret ? 'Configured and stored encrypted.' : 'Generated when you save.'}</small></div><button className={styles.secondaryButton} type="button" onClick={() => void rotate()} disabled={busy === 'rotate'}><RotateCcw size={14} />{busy === 'rotate' ? 'Rotating…' : confirmRotate ? 'Confirm rotation' : 'Rotate'}</button></div>
        {secret && <div className={styles.secretReveal}><div><strong>Copy this secret now</strong><small>It will not be shown again.</small></div><code>{secret}</code><button className={styles.iconButton} type="button" onClick={() => void navigator.clipboard.writeText(secret)} aria-label="Copy signing secret" title="Copy"><Copy size={15} /></button></div>}
        <details className={styles.contract}><summary>Webhook contract and sample payload</summary><p>Verify <code>X-Ayooda-Signature</code> as HMAC-SHA256 of <code>{'timestamp.raw_body'}</code>. Deduplicate retries with <code>X-Ayooda-Event-Id</code>.</p><pre>{`{
  "id": "evt_…",
  "type": "ticket.created",
  "createdAt": "2026-09-03T12:00:00.000Z",
  "data": {
    "ticket": {
      "id": "…", "number": 1042,
      "status": "open", "priority": "normal",
      "subject": "…", "description": "…",
      "fields": {}, "customer": {}, "conversation": {}
    }
  }
}`}</pre></details>
      </div>}
      {config.destination.type === 'email' && <div className={styles.destinationConfig}><label className={styles.field}><span>Support email</span><input type="email" value={config.destination.address} placeholder="support@example.com" onChange={(event) => setConfig({ ...config, destination: { type: 'email', address: event.target.value } })} /><small>Requires an active email channel. Replies do not synchronize back to Ayooda in this version.</small></label></div>}
      {config.destination.type !== 'internal' && <div className={styles.testRow}><div><strong>Test with synthetic data</strong><small>No ticket or customer data is created.</small></div><button className={styles.secondaryButton} type="button" onClick={() => void sendTest()} disabled={Boolean(busy)}>{busy === 'test' ? <Loader2 size={14} className={styles.spin} /> : <ExternalLink size={14} />}{busy === 'test' ? 'Sending…' : 'Save & send test'}</button></div>}
      <div className={styles.healthRow}><div><strong>Delivery health</strong><small>{config.destination.type === 'internal' ? 'No external delivery configured.' : health.failed ? `${health.failed} ticket${health.failed === 1 ? '' : 's'} need delivery attention.` : health.lastSuccessfulAt ? `Last delivered ${new Date(health.lastSuccessfulAt).toLocaleString()}.` : 'No production deliveries yet.'}</small></div>{health.failed > 0 && <a href="/dashboard/inbox?filter=tickets">Open affected tickets <ExternalLink size={13} /></a>}</div>
    </section>

    <footer className={styles.saveBar}><p>{dirty ? 'You have unsaved changes.' : 'Ticket settings affect new agent turns immediately after saving.'}</p><button className={styles.primaryButton} type="button" onClick={() => void save()} disabled={Boolean(busy) || !dirty}>{busy === 'save' ? <Loader2 size={15} className={styles.spin} /> : <Check size={15} />}{busy === 'save' ? 'Saving…' : dirty ? 'Save ticket settings' : 'Saved'}</button></footer>
  </div>
}
