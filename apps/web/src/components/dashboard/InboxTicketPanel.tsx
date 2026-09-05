'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, Loader2, Plus, RefreshCw, Ticket } from 'lucide-react'
import type { SupportTicket, TicketIntakeField, TicketPriority, TicketStatus } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { AppSelect } from '@/components/ui/AppSelect'
import styles from './InboxTicketPanel.module.css'

type Props = {
  conversationId: string
  agentId?: string | null
  ticketId?: string
  ticketNumber?: number
  suggestedSubject: string
  operators: Array<{ uid: string; displayName: string; email: string }>
  canRetryDelivery: boolean
}

export default function InboxTicketPanel({ conversationId, agentId, ticketId, ticketNumber, suggestedSubject, operators, canRetryDelivery }: Props) {
  const [open, setOpen] = useState(false)
  const [ticket, setTicket] = useState<SupportTicket | null>(null)
  const [fields, setFields] = useState<TicketIntakeField[]>([])
  const [subject, setSubject] = useState(suggestedSubject.slice(0, 160))
  const [description, setDescription] = useState(suggestedSubject.slice(0, 4000))
  const [priority, setPriority] = useState<TicketPriority>('normal')
  const [values, setValues] = useState<Record<string, string | number | boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadTicket = useCallback(async () => {
    if (!ticketId) { setTicket(null); return }
    const response = await apiRequest(`/tickets/${encodeURIComponent(ticketId)}`)
    if (response.ok) setTicket(await response.json() as SupportTicket)
  }, [ticketId])

  useEffect(() => {
    setOpen(false)
    setError('')
    setTicket(null)
    setSubject(suggestedSubject.slice(0, 160))
    setDescription(suggestedSubject.slice(0, 4000))
    setValues({})
    void loadTicket()
  }, [conversationId, suggestedSubject, loadTicket])

  async function begin() {
    if (!agentId) { setError('This conversation has no agent configuration.'); return }
    setBusy(true); setError('')
    try {
      const response = await apiRequest(`/tickets/intake/${encodeURIComponent(agentId)}`)
      const body = await response.json().catch(() => ({})) as { fields?: TicketIntakeField[]; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Ticket form could not be loaded.')
      setFields(body.fields ?? []); setOpen(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Ticket form could not be loaded.') }
    finally { setBusy(false) }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await apiRequest(`/conversations/${encodeURIComponent(conversationId)}/ticket`, {
        method: 'POST', body: JSON.stringify({ subject, description, priority, customerConfirmed: true, fields: values }),
      })
      const body = await response.json().catch(() => ({})) as { ticketId?: string; ticketNumber?: number; error?: string }
      if (!response.ok || !body.ticketId) throw new Error(body.error ?? 'Ticket could not be created.')
      setOpen(false)
      const ticketResponse = await apiRequest(`/tickets/${encodeURIComponent(body.ticketId)}`)
      if (ticketResponse.ok) setTicket(await ticketResponse.json() as SupportTicket)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Ticket could not be created.') }
    finally { setBusy(false) }
  }

  async function update(patch: { status?: TicketStatus; priority?: TicketPriority; assigneeUid?: string | null }) {
    if (!ticket || busy) return
    setBusy(true); setError('')
    try {
      const response = await apiRequest(`/tickets/${encodeURIComponent(ticket.id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
      const body = await response.json().catch(() => ({})) as SupportTicket & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Ticket could not be updated.')
      setTicket(body)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Ticket could not be updated.') }
    finally { setBusy(false) }
  }

  async function retryDelivery() {
    if (!ticket || busy) return
    setBusy(true); setError('')
    try {
      const response = await apiRequest(`/tickets/${encodeURIComponent(ticket.id)}/resend`, { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { ok?: boolean; outcome?: string; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Ticket delivery could not be retried.')
      await loadTicket()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Ticket delivery could not be retried.') }
    finally { setBusy(false) }
  }

  if (ticket || ticketId) {
    return <section className={styles.ticketSummary} aria-label={`Ticket ${ticket?.number ?? ticketNumber}`}>
      <span className={styles.ticketIcon}><Ticket size={15} /></span>
      <div className={styles.ticketIdentity}><strong>#{ticket?.number ?? ticketNumber} · {ticket?.subject ?? 'Support ticket'}</strong><small>{ticket?.deliveryState === 'failed' ? 'External delivery failed · ticket is safe in Ayooda' : ticket?.deliveryState === 'pending' ? 'External delivery pending' : ticket?.deliveryState === 'delivered' ? 'Delivered externally' : 'Stored in Ayooda'}</small></div>
      {ticket && <><AppSelect className={styles.ticketSelect} ariaLabel="Ticket assignee" value={ticket.assigneeUid ?? ''} disabled={busy} onChange={(value) => void update({ assigneeUid: value || null })} emptyLabel="Unassigned" options={operators.map((operator) => ({ value: operator.uid, label: operator.displayName || operator.email }))} /><AppSelect className={styles.ticketSelect} ariaLabel="Ticket priority" value={ticket.priority} disabled={busy} onChange={(value) => void update({ priority: value as TicketPriority })} options={[{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }]} /><AppSelect className={styles.ticketSelect} ariaLabel="Ticket status" value={ticket.status} disabled={busy} onChange={(value) => void update({ status: value as TicketStatus })} options={[{ value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'resolved', label: 'Resolved' }, { value: 'closed', label: 'Closed' }]} />{canRetryDelivery && ticket.deliveryState === 'failed' && <button className={styles.iconAction} type="button" onClick={() => void retryDelivery()} disabled={busy} aria-label="Retry external ticket delivery" title="Retry delivery"><RefreshCw size={15} /></button>}{ticket.externalUrl && <a href={ticket.externalUrl} target="_blank" rel="noreferrer" aria-label="Open external ticket" title="Open external ticket"><ExternalLink size={15} /></a>}</>}
      {busy && <Loader2 className={styles.spin} size={15} />}
      {error && <p className={styles.inlineError}>{error}</p>}
    </section>
  }

  return <section className={styles.createWrap}>
    {!open ? <button className={styles.createButton} type="button" onClick={() => void begin()} disabled={busy || !agentId}>{busy ? <Loader2 className={styles.spin} size={14} /> : <Plus size={14} />} Create support ticket</button> : <form className={styles.form} onSubmit={create}>
      <div className={styles.formHeader}><div><strong>Create support ticket</strong><small>A durable ticket will be linked to this conversation.</small></div><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
      <div className={styles.formGrid}><label><span>Subject</span><input required maxLength={160} value={subject} onChange={(event) => setSubject(event.target.value)} /></label><div className={styles.selectField}><span>Priority</span><AppSelect ariaLabel="Ticket priority" value={priority} onChange={(value) => setPriority(value as TicketPriority)} options={[{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }]} /></div></div>
      <label><span>Description</span><textarea required maxLength={4000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      {fields.map((field) => field.type === 'select' || field.type === 'boolean' ? <div className={styles.selectField} key={field.id}><span>{field.label}{field.required ? ' *' : ''}</span><AppSelect ariaLabel={field.label} value={values[field.id] === undefined ? '' : String(values[field.id])} onChange={(value) => setValues((current) => { const next = { ...current }; if (!value) delete next[field.id]; else next[field.id] = field.type === 'boolean' ? value === 'true' : value; return next })} placeholder="Choose…" emptyLabel={field.required ? undefined : 'Choose…'} required={field.required} options={field.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : (field.options ?? []).map((option) => ({ value: option, label: option }))} />{field.description && <small>{field.description}</small>}</div> : <label key={field.id}><span>{field.label}{field.required ? ' *' : ''}</span><input required={field.required} type={field.type === 'number' ? 'number' : 'text'} value={String(values[field.id] ?? '')} onChange={(event) => setValues((current) => { const next = { ...current }; if (field.type === 'number' && !event.target.value) delete next[field.id]; else next[field.id] = field.type === 'number' ? Number(event.target.value) : event.target.value; return next })} />{field.description && <small>{field.description}</small>}</label>)}
      {error && <p className={styles.formError}>{error}</p>}
      <button className={styles.submitButton} type="submit" disabled={busy}>{busy ? <Loader2 className={styles.spin} size={14} /> : <Check size={14} />}{busy ? 'Creating…' : 'Create ticket'}</button>
    </form>}
    {!open && error && <p className={styles.formError}>{error}</p>}
  </section>
}
