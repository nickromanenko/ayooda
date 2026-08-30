'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, History, Loader2, RotateCcw } from 'lucide-react'
import type { AgentDoc } from '@ayooda/shared'
import { apiRequestOrThrow } from '@/lib/api'
import styles from './version-history.module.css'

type CoreField = 'name' | 'description' | 'systemPrompt' | 'llmModel' | 'role'
type Version = {
  id: string
  snapshot: Pick<AgentDoc, 'name' | 'description' | 'systemPrompt' | 'llmModel' | 'role'>
  changedFields: CoreField[]
  createdAt: string | null
  createdByName: string
  reason: 'save' | 'restore'
}

const FIELD_LABELS: Record<CoreField, string> = {
  name: 'Name',
  description: 'Description',
  systemPrompt: 'Instructions',
  llmModel: 'Model',
  role: 'Role',
}

function versionDate(value: string | null): string {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function AgentVersionHistory({
  agentId,
  current,
  refreshKey,
  onRestored,
}: {
  agentId: string
  current: AgentDoc
  refreshKey: number
  onRestored: (agent: AgentDoc) => void
}) {
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await apiRequestOrThrow(`/agents/${agentId}/versions`, {}, 'Could not load configuration history.')
      const data = await response.json() as { versions: Version[] }
      setVersions(data.versions)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load configuration history.')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => { void load() }, [load, refreshKey])

  async function restore(version: Version) {
    const when = versionDate(version.createdAt)
    if (!window.confirm(`Restore the agent configuration from ${when}? Your current configuration will remain available in history.`)) return
    setRestoringId(version.id); setError('')
    try {
      const response = await apiRequestOrThrow(`/agents/${agentId}/versions/${version.id}/restore`, { method: 'POST' }, 'Could not restore this configuration.')
      onRestored(await response.json() as AgentDoc)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore this configuration.')
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="agent-history-title">
      <button type="button" className={styles.header} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls="agent-history-body">
        <span className={styles.icon}><History size={17} /></span>
        <span className={styles.heading}>
          <strong id="agent-history-title">Configuration history</strong>
          <small>{loading ? 'Loading saved configurations…' : versions.length ? `${versions.length} restorable ${versions.length === 1 ? 'version' : 'versions'}` : 'Previous configurations will appear after your next change.'}</small>
        </span>
        <ChevronDown size={16} className={styles.chevron} />
      </button>

      {expanded && (
        <div id="agent-history-body" className={styles.body}>
          {error && <div className={styles.error} role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div>}
          {loading ? <div className={styles.state}><Loader2 size={15} className={styles.spin} />Loading history…</div> : versions.length === 0 ? (
            <div className={styles.state}>Save a change to create the first restore point.</div>
          ) : versions.map((version) => {
            const changed = version.changedFields.filter((field): field is CoreField => field in FIELD_LABELS)
            const matchesCurrent = version.snapshot.name === current.name
              && version.snapshot.description === current.description
              && version.snapshot.systemPrompt === current.systemPrompt
              && version.snapshot.llmModel === current.llmModel
              && version.snapshot.role === current.role
            return (
              <article className={styles.version} key={version.id}>
                <div className={styles.versionCopy}>
                  <div className={styles.versionTitle}><strong>{versionDate(version.createdAt)}</strong>{version.reason === 'restore' && <span>Restore point</span>}</div>
                  <p>{version.snapshot.name} · {version.snapshot.llmModel}</p>
                  <small>Saved by {version.createdByName}{changed.length ? ` · ${changed.map((field) => FIELD_LABELS[field]).join(', ')}` : ''}</small>
                </div>
                <button type="button" className={styles.restore} onClick={() => void restore(version)} disabled={restoringId !== null || matchesCurrent} title={matchesCurrent ? 'This is the current configuration' : 'Restore this configuration'}>
                  {restoringId === version.id ? <Loader2 size={14} className={styles.spin} /> : <RotateCcw size={14} />}
                  {restoringId === version.id ? 'Restoring…' : matchesCurrent ? 'Current' : 'Restore'}
                </button>
              </article>
            )
          })}
          <p className={styles.note}>History covers name, description, instructions, role, and model. Knowledge, tools, workflows, and channels are unchanged when restoring.</p>
        </div>
      )}
    </section>
  )
}
