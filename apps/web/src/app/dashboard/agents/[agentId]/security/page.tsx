'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Eye, EyeOff, KeyRound, Loader2, Lock, ServerCog, ShieldCheck, Trash2 } from 'lucide-react'
import type { AgentAccessEntry, CustomEndpointStatus, GatewayKeyStatus } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { Loading } from '@/components/dashboard/Loading'
import { card, label, muted, errorText } from '@/components/dashboard/ui'
import styles from './page.module.css'

export default function AgentSecurityPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)
  const [people, setPeople] = useState<AgentAccessEntry[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [gateway, setGateway] = useState<GatewayKeyStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keyBusy, setKeyBusy] = useState<'save' | 'remove' | ''>('')
  const [keyError, setKeyError] = useState('')
  const [keySuccess, setKeySuccess] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [custom, setCustom] = useState<CustomEndpointStatus | null>(null)
  const [customBaseURL, setCustomBaseURL] = useState('')
  const [customModelId, setCustomModelId] = useState('')
  const [customApiKey, setCustomApiKey] = useState('')
  const [customKeyless, setCustomKeyless] = useState(false)
  const [showCustomKey, setShowCustomKey] = useState(false)
  const [customBusy, setCustomBusy] = useState<'save' | 'remove' | ''>('')
  const [customError, setCustomError] = useState('')
  const [customSuccess, setCustomSuccess] = useState('')
  const [confirmRemoveCustom, setConfirmRemoveCustom] = useState(false)

  const load = useCallback(async () => {
    try {
      const [accessRes, keyRes, customRes] = await Promise.all([
        apiRequest(`/agents/${agentId}/access`),
        apiRequest(`/agents/${agentId}/gateway-key`),
        apiRequest(`/agents/${agentId}/custom-endpoint`),
      ])
      if (accessRes.status === 403 || keyRes.status === 403 || customRes.status === 403) { setForbidden(true); return }
      if (!accessRes.ok || !keyRes.ok || !customRes.ok) { setError('Could not load security settings for this agent.'); return }
      const [access, keyStatus, customStatus] = await Promise.all([
        accessRes.json() as Promise<{ people: AgentAccessEntry[] }>,
        keyRes.json() as Promise<GatewayKeyStatus>,
        customRes.json() as Promise<CustomEndpointStatus>,
      ])
      setPeople(access.people)
      setGateway(keyStatus)
      setCustom(customStatus)
      setCustomBaseURL(customStatus.baseURL ?? '')
      setCustomModelId(customStatus.modelId ?? '')
      setCustomKeyless(customStatus.configured && !customStatus.hasApiKey)
    } catch {
      setError('Could not load security settings for this agent.')
    }
  }, [agentId])

  useEffect(() => { void load() }, [load])

  async function toggle(entry: AgentAccessEntry, next: boolean) {
    setBusy(entry.uid); setError('')
    try {
      const res = await apiRequest(`/agents/${agentId}/access/${entry.uid}`, {
        method: next ? 'PUT' : 'DELETE',
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setError(d.error ?? 'Could not change access.')
        return
      }
      await load()
    } finally { setBusy('') }
  }

  async function saveGatewayKey() {
    const trimmed = apiKey.trim()
    if (!trimmed) return
    setKeyBusy('save'); setKeyError(''); setKeySuccess(''); setConfirmRemove(false)
    try {
      const res = await apiRequest(`/agents/${agentId}/gateway-key`, {
        method: 'PUT',
        body: JSON.stringify({ apiKey: trimmed }),
      })
      const data = await res.json().catch(() => ({})) as GatewayKeyStatus & { error?: string }
      if (!res.ok) { setKeyError(data.error ?? 'Could not verify this key.'); return }
      setGateway(data)
      setApiKey('')
      setShowKey(false)
      setKeySuccess('Key verified and saved. New agent activity will use it immediately.')
    } catch {
      setKeyError('Could not reach the server. Please try again.')
    } finally { setKeyBusy('') }
  }

  async function removeGatewayKey() {
    setKeyBusy('remove'); setKeyError(''); setKeySuccess('')
    try {
      const res = await apiRequest(`/agents/${agentId}/gateway-key`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({})) as GatewayKeyStatus & { error?: string }
      if (!res.ok) { setKeyError(data.error ?? 'Could not remove this key.'); return }
      setGateway(data)
      setConfirmRemove(false)
      setKeySuccess(data.source === 'platform'
        ? 'Agent key removed. This agent now uses the platform key.'
        : 'Agent key removed. Add another key before running the agent.')
    } catch {
      setKeyError('Could not reach the server. Please try again.')
    } finally { setKeyBusy('') }
  }

  async function saveCustomEndpoint() {
    const baseURL = customBaseURL.trim()
    const modelId = customModelId.trim()
    if (!baseURL || !modelId) return
    setCustomBusy('save'); setCustomError(''); setCustomSuccess(''); setConfirmRemoveCustom(false)
    try {
      const res = await apiRequest(`/agents/${agentId}/custom-endpoint`, {
        method: 'PUT',
        body: JSON.stringify({
          baseURL,
          modelId,
          ...(customKeyless ? { apiKey: null } : customApiKey.trim() ? { apiKey: customApiKey.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({})) as CustomEndpointStatus & { error?: string }
      if (!res.ok) { setCustomError(data.error ?? 'Could not verify this endpoint.'); return }
      setCustom(data)
      setCustomBaseURL(data.baseURL ?? baseURL)
      setCustomModelId(data.modelId ?? modelId)
      setCustomApiKey('')
      setCustomKeyless(!data.hasApiKey)
      setShowCustomKey(false)
      setCustomSuccess('Endpoint verified and activated. New chat, Copilot, and skill activity will use it immediately.')
    } catch {
      setCustomError('Could not reach the server. Please try again.')
    } finally { setCustomBusy('') }
  }

  async function removeCustomEndpoint() {
    setCustomBusy('remove'); setCustomError(''); setCustomSuccess('')
    try {
      const res = await apiRequest(`/agents/${agentId}/custom-endpoint`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({})) as CustomEndpointStatus & { error?: string }
      if (!res.ok) { setCustomError(data.error ?? 'Could not remove this endpoint.'); return }
      setCustom(data)
      setCustomBaseURL('')
      setCustomModelId('')
      setCustomApiKey('')
      setCustomKeyless(false)
      setShowCustomKey(false)
      setConfirmRemoveCustom(false)
      setCustomSuccess('Custom endpoint removed. This agent now uses its AI Gateway configuration.')
    } catch {
      setCustomError('Could not reach the server. Please try again.')
    } finally { setCustomBusy('') }
  }

  if (forbidden) {
    return (
      <p style={{ ...muted, margin: 0 }}>
        Only the workspace owner can manage who configures this agent.
      </p>
    )
  }
  if (!people && !error) {
    return <Loading />
  }

  const members = people?.filter((p) => !p.locked) ?? []
  const canReuseCustomKey = !!custom?.hasApiKey && customBaseURL.trim().replace(/\/$/, '') === custom.baseURL

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 20 }}>
        Control who can configure this agent and which secure model connection handles its AI activity.
      </p>

      {error && <p style={{ ...errorText, marginBottom: 12 }}>{error}</p>}

      {custom && (
        <section className={`${styles.gatewayCard} ${styles.customCard}`} aria-labelledby="custom-endpoint-title">
          <div className={styles.gatewayHeader}>
            <div className={styles.gatewayTitleRow}>
              <span className={`${styles.gatewayIcon} ${styles.customIcon}`}><ServerCog size={16} /></span>
              <div>
                <h2 id="custom-endpoint-title" className={styles.gatewayTitle}>OpenAI-compatible endpoint</h2>
                <p className={styles.gatewayDescription}>
                  Connect this agent directly to a public HTTPS endpoint. When active, it overrides AI Gateway for chat, Copilot, and background skills.
                </p>
              </div>
            </div>
            <span className={`${styles.statusBadge} ${custom.configured ? styles.statusAgent : styles.statusInactive}`}>
              {custom.configured && <ShieldCheck size={12} />}
              {custom.configured ? 'Custom endpoint active' : 'AI Gateway active'}
            </span>
          </div>

          <form onSubmit={(event) => { event.preventDefault(); void saveCustomEndpoint() }}>
            <div className={styles.endpointFields}>
              <div className={styles.fullField}>
                <label htmlFor="custom-base-url" className={styles.fieldLabel}>Base URL</label>
                <input
                  id="custom-base-url"
                  type="url"
                  className={styles.keyInput}
                  value={customBaseURL}
                  onChange={(event) => { setCustomBaseURL(event.target.value); setCustomError(''); setCustomSuccess('') }}
                  placeholder="https://models.example.com/v1"
                  maxLength={2048}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                />
              </div>
              <div>
                <label htmlFor="custom-model-id" className={styles.fieldLabel}>Model ID</label>
                <input
                  id="custom-model-id"
                  className={styles.keyInput}
                  value={customModelId}
                  onChange={(event) => { setCustomModelId(event.target.value); setCustomError(''); setCustomSuccess('') }}
                  placeholder="your-model-id"
                  maxLength={200}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                />
              </div>
              <div>
                <label htmlFor="custom-api-key" className={styles.fieldLabel}>
                  API key {canReuseCustomKey && !customKeyless ? '(leave blank to keep current)' : ''}
                </label>
                <div className={styles.keyField}>
                  <input
                    id="custom-api-key"
                    type={showCustomKey ? 'text' : 'password'}
                    className={styles.keyInput}
                    value={customApiKey}
                    onChange={(event) => { setCustomApiKey(event.target.value); setCustomError(''); setCustomSuccess('') }}
                    placeholder={customKeyless ? 'Not required' : canReuseCustomKey ? 'Stored securely' : 'Paste the endpoint API key'}
                    maxLength={4096}
                    autoComplete="new-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={customKeyless}
                  />
                  <button
                    type="button"
                    className={styles.revealButton}
                    onClick={() => setShowCustomKey((current) => !current)}
                    aria-label={showCustomKey ? 'Hide custom endpoint API key' : 'Show custom endpoint API key'}
                    disabled={customKeyless}
                  >
                    {showCustomKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>

            <div className={styles.endpointFooter}>
              <label className={styles.keylessOption}>
                <input
                  type="checkbox"
                  checked={customKeyless}
                  onChange={(event) => {
                    setCustomKeyless(event.target.checked)
                    if (event.target.checked) { setCustomApiKey(''); setShowCustomKey(false) }
                    setCustomError(''); setCustomSuccess('')
                  }}
                />
                This endpoint does not require an API key
              </label>
              <button
                type="submit"
                className={`btn btn-primary ${styles.actionButton}`}
                disabled={!customBaseURL.trim() || !customModelId.trim() || (!customKeyless && !customApiKey.trim() && !canReuseCustomKey) || customBusy !== ''}
              >
                {customBusy === 'save' ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Verifying…</> : custom.configured ? 'Verify & update' : 'Verify & activate'}
              </button>
            </div>
            <div className={styles.helperRow}>
              <p className={styles.helperText}>Verification checks the endpoint&apos;s <code>/models</code> response for this model ID. It does not generate content.</p>
              <a className={styles.docsLink} href="https://ai-sdk.dev/providers/openai-compatible-providers" target="_blank" rel="noreferrer">
                Compatibility guide <ExternalLink size={11} />
              </a>
            </div>
          </form>

          <div aria-live="polite">
            {customError && <p className={`${styles.feedback} ${styles.error}`}>{customError}</p>}
            {customSuccess && <p className={`${styles.feedback} ${styles.success}`}>{customSuccess}</p>}
          </div>

          {custom.configured && (
            <>
              <div className={styles.keyActions}>
                <p className={styles.configuredCopy}>
                  Requests are restricted to <code>{custom.baseURL}</code>. Removing this connection restores the agent&apos;s AI Gateway configuration.
                </p>
                <button type="button" className={`btn btn-ghost ${styles.actionButton} ${styles.dangerButton}`} onClick={() => setConfirmRemoveCustom(true)} disabled={customBusy !== ''}>
                  <Trash2 size={13} /> Remove endpoint
                </button>
              </div>
              {confirmRemoveCustom && (
                <div className={styles.confirmBox}>
                  <p className={styles.confirmCopy}>Remove this custom endpoint and its stored secret? The original secret cannot be recovered.</p>
                  <div className={styles.confirmButtons}>
                    <button type="button" className={`btn btn-ghost ${styles.actionButton}`} onClick={() => setConfirmRemoveCustom(false)} disabled={customBusy !== ''}>Cancel</button>
                    <button type="button" className={`btn btn-ghost ${styles.actionButton} ${styles.dangerButton}`} onClick={() => void removeCustomEndpoint()} disabled={customBusy !== ''}>
                      {customBusy === 'remove' ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Removing…</> : 'Confirm removal'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {gateway && (
        <section className={styles.gatewayCard} aria-labelledby="gateway-key-title">
          <div className={styles.gatewayHeader}>
            <div className={styles.gatewayTitleRow}>
              <span className={styles.gatewayIcon}><KeyRound size={15} /></span>
              <div>
                <h2 id="gateway-key-title" className={styles.gatewayTitle}>AI Gateway key</h2>
                <p className={styles.gatewayDescription}>
                  {custom?.configured
                    ? 'Ready as the fallback connection while the custom endpoint is active. The key is encrypted at rest and never shown again.'
                    : 'Used by this agent for customer chat, Copilot, and background skills. The key is encrypted at rest and never shown again.'}
                </p>
              </div>
            </div>
            <span className={`${styles.statusBadge} ${gateway.source === 'agent' ? styles.statusAgent : gateway.source === 'platform' ? styles.statusPlatform : styles.statusNone}`}>
              {gateway.source === 'agent' && <ShieldCheck size={12} />}
              {gateway.source === 'agent' ? (custom?.configured ? 'Agent key on standby' : 'Agent key active') : gateway.source === 'platform' ? (custom?.configured ? 'Platform key on standby' : 'Platform key active') : 'No key available'}
            </span>
          </div>

          <form onSubmit={(event) => { event.preventDefault(); void saveGatewayKey() }}>
            <label htmlFor="gateway-key" className={styles.fieldLabel}>
              {gateway.hasAgentKey ? 'Replace agent key' : 'Add agent key'}
            </label>
            <div className={styles.keyRow}>
              <div className={styles.keyField}>
                <input
                  id="gateway-key"
                  type={showKey ? 'text' : 'password'}
                  className={styles.keyInput}
                  value={apiKey}
                  onChange={(event) => { setApiKey(event.target.value); setKeyError(''); setKeySuccess('') }}
                  placeholder={gateway.hasAgentKey ? 'Paste a new key to replace the current one' : 'Paste your Vercel AI Gateway key'}
                  maxLength={4096}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className={styles.revealButton}
                  onClick={() => setShowKey((current) => !current)}
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <button
                type="submit"
                className={`btn btn-primary ${styles.actionButton}`}
                disabled={!apiKey.trim() || keyBusy !== ''}
              >
                {keyBusy === 'save' ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Verifying…</> : 'Verify & save'}
              </button>
            </div>
            <div className={styles.helperRow}>
              <p className={styles.helperText}>Verification checks the authenticated credit endpoint and does not generate content or spend tokens.</p>
              <a className={styles.docsLink} href="https://vercel.com/docs/ai-gateway/authentication-and-byok" target="_blank" rel="noreferrer">
                Create a Gateway key <ExternalLink size={11} />
              </a>
            </div>
          </form>

          <div aria-live="polite">
            {keyError && <p className={`${styles.feedback} ${styles.error}`}>{keyError}</p>}
            {keySuccess && <p className={`${styles.feedback} ${styles.success}`}>{keySuccess}</p>}
          </div>

          {gateway.hasAgentKey && (
            <>
              <div className={styles.keyActions}>
                <p className={styles.configuredCopy}>
                  The saved key is write-only. Replace it above, or remove it to {gateway.platformAvailable ? 'return to the platform key' : 'disable model access until another key is added'}.
                </p>
                <button type="button" className={`btn btn-ghost ${styles.actionButton} ${styles.dangerButton}`} onClick={() => setConfirmRemove(true)} disabled={keyBusy !== ''}>
                  <Trash2 size={13} /> Remove key
                </button>
              </div>
              {confirmRemove && (
                <div className={styles.confirmBox}>
                  <p className={styles.confirmCopy}>
                    Remove this agent&apos;s stored key? The original secret cannot be recovered.
                  </p>
                  <div className={styles.confirmButtons}>
                    <button type="button" className={`btn btn-ghost ${styles.actionButton}`} onClick={() => setConfirmRemove(false)} disabled={keyBusy !== ''}>Cancel</button>
                    <button type="button" className={`btn btn-ghost ${styles.actionButton} ${styles.dangerButton}`} onClick={() => void removeGatewayKey()} disabled={keyBusy !== ''}>
                      {keyBusy === 'remove' ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Removing…</> : 'Confirm removal'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <div style={card}>
        <p style={label}>Access</p>

        {people?.filter((p) => p.locked).map((p) => (
          <div key={p.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{p.displayName || p.email}</p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{p.email}</p>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-mute)' }}>
              <Lock size={11} /> owner
            </span>
          </div>
        ))}

        {members.length === 0 ? (
          <p style={{ ...muted, marginTop: 12, marginBottom: 0 }}>
            No other people in this workspace yet.{' '}
            <Link href="/dashboard/team" style={{ color: 'var(--accent)' }}>Invite someone →</Link>
          </p>
        ) : members.map((p) => (
          <label
            key={p.uid}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)', cursor: 'pointer' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{p.displayName || p.email}</p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{p.email}</p>
            </div>
            {busy === p.uid
              ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--ink-mute)' }} />
              : <input
                  type="checkbox"
                  checked={p.hasAccess}
                  onChange={(e) => void toggle(p, e.target.checked)}
                  aria-label={`Let ${p.displayName || p.email} configure this agent`}
                />}
          </label>
        ))}
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: 0 }}>
        Everyone in the workspace can see the Inbox and Copilot regardless. Creating, deleting and
        re-defaulting agents stays with the owner.
      </p>
    </>
  )
}
