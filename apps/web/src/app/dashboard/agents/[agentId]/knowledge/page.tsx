'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@heroui/react'
import { AlertCircle, AlertTriangle, Check, CheckCircle2, Database, FileText, Globe, Loader2, Plus, RefreshCw, RotateCw, Search, ShieldCheck, Trash2, X, XCircle } from 'lucide-react'
import type { KnowledgeDocStatus } from '@ayooda/shared'
import { apiRequest, apiRequestOrThrow } from '@/lib/api'
import { trackProductEvent } from '@/lib/product-analytics'
import { KnowledgeUpload } from '@/components/knowledge/KnowledgeUpload'
import { EmptyState, Loading } from '@/components/dashboard/Loading'
import { knowledgeDate, knowledgeHealth, summarizeKnowledge, type KnowledgeHealth, type KnowledgeTimestamp } from '@/lib/knowledge-health'
import { AppSelect } from '@/components/ui/AppSelect'
import { useAppConfirm } from '@/components/ui/AppInteractionProvider'
import { AppTooltip } from '@/components/ui/AppTooltip'
import { AppSearchField } from '@/components/ui/AppSearchField'
import styles from './page.module.css'

interface KnowledgeDoc {
  id: string
  type: 'webpage' | 'file'
  source: string
  status: KnowledgeDocStatus
  chunkCount: number
  errorMessage: string | null
  createdAt?: KnowledgeTimestamp
  indexedAt?: KnowledgeTimestamp
  autoSyncEnabled?: boolean
  syncIntervalHours?: 24 | 168 | 720 | null
  lastSyncedAt?: KnowledgeTimestamp
  nextSyncAt?: KnowledgeTimestamp
  syncFailures?: number
  syncError?: string | null
}

type SourceFilter = 'all' | 'ready' | 'processing' | 'attention'
const SYNC_INTERVAL_LABELS: Record<24 | 168 | 720, string> = { 24: 'Daily', 168: 'Weekly', 720: 'Monthly' }
const HEALTH_LABEL: Record<KnowledgeHealth, string> = { ready: 'Ready', processing: 'Indexing', error: 'Failed', empty: 'No content', stale: 'Needs refresh' }

function formatTimestamp(value: KnowledgeTimestamp | undefined): string | null {
  const date = knowledgeDate(value)
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : null
}

function formatRelative(value: KnowledgeTimestamp | undefined): string | null {
  const date = knowledgeDate(value)
  if (!date) return null
  const difference = date.getTime() - Date.now()
  const absolute = Math.abs(difference)
  const [amount, unit] = absolute >= 86_400_000
    ? [Math.round(difference / 86_400_000), 'day' as const]
    : absolute >= 3_600_000
      ? [Math.round(difference / 3_600_000), 'hour' as const]
      : [Math.round(difference / 60_000), 'minute' as const]
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit)
}

function hasActiveJobs(docs: KnowledgeDoc[]) {
  return docs.some((doc) => doc.status === 'pending' || doc.status === 'processing')
}

function HealthIcon({ health }: { health: KnowledgeHealth }) {
  if (health === 'ready') return <CheckCircle2 size={12} />
  if (health === 'processing') return <Loader2 size={12} className={styles.spin} />
  if (health === 'error') return <XCircle size={12} />
  return <AlertTriangle size={12} />
}

export default function AgentKnowledgePage({ params }: { params: Promise<{ agentId: string }> }) {
  const confirm = useAppConfirm()
  const { agentId } = use(params)
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [urlError, setUrlError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reindexingId, setReindexingId] = useState<string | null>(null)
  const [retryingIssues, setRetryingIssues] = useState(false)
  const [savingSyncId, setSavingSyncId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [query, setQuery] = useState('')

  const fetchDocs = useCallback(async () => {
    try {
      const response = await apiRequest(`/agents/${agentId}/knowledge`)
      if (!response.ok) throw new Error('Could not load knowledge sources.')
      setDocs(await response.json() as KnowledgeDoc[])
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not load knowledge sources.')
    }
  }, [agentId])

  useEffect(() => { setLoading(true); void fetchDocs().finally(() => setLoading(false)) }, [fetchDocs])
  useEffect(() => {
    if (!hasActiveJobs(docs)) return
    const timer = window.setInterval(() => void fetchDocs(), 4_000)
    return () => window.clearInterval(timer)
  }, [docs, fetchDocs])

  const summary = useMemo(() => summarizeKnowledge(docs), [docs])
  const visibleDocs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return docs.filter((doc) => {
      const health = knowledgeHealth(doc)
      const matchesFilter = filter === 'all' || filter === health || (filter === 'attention' && ['error', 'empty', 'stale'].includes(health))
      return matchesFilter && (!normalizedQuery || doc.source.toLowerCase().includes(normalizedQuery))
    })
  }, [docs, filter, query])

  async function handleAdd() {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    try {
      const url = new URL(trimmed)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error()
    } catch {
      setUrlError('Enter a complete website URL, including https://.')
      return
    }
    setAdding(true); setUrlError('')
    try {
      const response = await apiRequest(`/agents/${agentId}/knowledge/scrape`, { method: 'POST', body: JSON.stringify({ url: trimmed }) })
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Could not add this website.')
      }
      setUrlInput(''); setAddOpen(false)
      trackProductEvent('Knowledge Source Added', { source_type: 'website', context: 'dashboard' })
      await fetchDocs()
    } catch (cause) {
      setUrlError(cause instanceof Error ? cause.message : 'Could not add this website.')
    } finally { setAdding(false) }
  }

  async function handleDelete(doc: KnowledgeDoc) {
    if (!await confirm({ title: 'Delete this knowledge source?', description: `“${doc.source}” and all of its indexed content will be permanently removed.`, confirmLabel: 'Delete source' })) return
    setDeletingId(doc.id); setActionError('')
    try {
      await apiRequestOrThrow(`/agents/${agentId}/knowledge/${doc.id}`, { method: 'DELETE' }, 'Could not delete this source.')
      setDocs((current) => current.filter((item) => item.id !== doc.id))
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Could not delete this source.') }
    finally { setDeletingId(null) }
  }

  async function reindex(docId: string) {
    await apiRequestOrThrow(`/agents/${agentId}/knowledge/${docId}/reindex`, { method: 'POST' }, 'Could not start indexing.')
  }

  async function handleReindex(docId: string) {
    setReindexingId(docId); setActionError('')
    try { await reindex(docId); await fetchDocs() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Could not start indexing.') }
    finally { setReindexingId(null) }
  }

  async function handleRetryIssues() {
    const issueDocs = docs.filter((doc) => ['error', 'empty', 'stale'].includes(knowledgeHealth(doc)))
    if (!issueDocs.length) return
    setRetryingIssues(true); setActionError('')
    let failures = 0
    for (const doc of issueDocs) { try { await reindex(doc.id) } catch { failures++ } }
    await fetchDocs()
    if (failures) setActionError(`${failures} ${failures === 1 ? 'source' : 'sources'} could not be queued. Try them individually for details.`)
    setRetryingIssues(false)
  }

  async function handleSyncInterval(docId: string, value: string) {
    setSavingSyncId(docId); setActionError('')
    try {
      const response = await apiRequest(`/agents/${agentId}/knowledge/${docId}/sync`, { method: 'PATCH', body: JSON.stringify({ intervalHours: value ? Number(value) : null }) })
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Could not update automatic syncing.')
      }
      await fetchDocs()
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Could not update automatic syncing.') }
    finally { setSavingSyncId(null) }
  }

  return (
    <>
      <div className={styles.pageIntro}>
        <p>Manage the information this agent uses to answer customers. Health checks highlight gaps before they affect conversations.</p>
        <button type="button" className="btn btn-primary" onClick={() => setAddOpen((open) => !open)}>{addOpen ? <X size={14} /> : <Plus size={14} />}{addOpen ? 'Close' : 'Add knowledge'}</button>
      </div>

      {actionError && <p className={styles.error} role="alert"><AlertCircle size={13} />{actionError}</p>}

      {addOpen && (
        <section className={styles.addPanel} aria-labelledby="add-knowledge-title">
          <div className={styles.sectionHeading}><span className={styles.sectionIcon}><Plus size={15} /></span><div><h2 id="add-knowledge-title">Add knowledge</h2><p>Index a website or upload a document. New content stays out of answers until indexing completes.</p></div></div>
          <div className={styles.urlField}>
            <label htmlFor="knowledge-url">Website URL</label>
            <div className={styles.urlRow}>
              <div className={styles.inputShell} data-error={Boolean(urlError)}><Globe size={14} /><input id="knowledge-url" type="url" value={urlInput} onChange={(event) => { setUrlInput(event.target.value); setUrlError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void handleAdd() } }} placeholder="https://docs.example.com" aria-describedby="knowledge-url-help" aria-invalid={Boolean(urlError)} /></div>
              <button type="button" className="btn btn-primary" onClick={() => void handleAdd()} disabled={adding || !urlInput.trim()}>{adding ? <Loader2 size={14} className={styles.spin} /> : <Globe size={14} />}{adding ? 'Adding…' : 'Index website'}</button>
            </div>
            {urlError ? <small id="knowledge-url-help" className={styles.fieldError}><AlertCircle size={11} />{urlError}</small> : <small id="knowledge-url-help">We crawl the page and linked pages, up to 25 pages total.</small>}
          </div>
          <div className={styles.uploadDivider}><span>or upload a file</span></div>
          <KnowledgeUpload uploadPath={`/agents/${agentId}/knowledge/upload`} onUploaded={() => { trackProductEvent('Knowledge Source Added', { source_type: 'file', context: 'dashboard' }); setAddOpen(false); void fetchDocs() }} />
        </section>
      )}

      {!loading && docs.length > 0 && (
        <section className={styles.healthPanel} aria-labelledby="knowledge-health-title">
          <div className={styles.healthLead}>
            <span className={`${styles.healthIcon} ${summary.issues ? styles.healthWarning : summary.processing ? styles.healthProgress : styles.healthReady}`}>{summary.issues ? <AlertTriangle size={18} /> : summary.processing ? <Loader2 size={18} className={styles.spin} /> : <ShieldCheck size={18} />}</span>
            <div><h2 id="knowledge-health-title">{summary.issues ? 'Knowledge needs attention' : summary.processing ? 'Knowledge is updating' : 'Knowledge is ready'}</h2><p>{summary.issues ? `${summary.issues} ${summary.issues === 1 ? 'source has' : 'sources have'} stale, empty, or failed content.` : summary.processing ? `${summary.processing} ${summary.processing === 1 ? 'source is' : 'sources are'} currently being indexed.` : 'Every source is indexed and available to this agent.'}</p></div>
            {summary.issues > 0 && <button type="button" className="btn btn-ghost" onClick={() => void handleRetryIssues()} disabled={retryingIssues}>{retryingIssues ? <Loader2 size={13} className={styles.spin} /> : <RefreshCw size={13} />}{retryingIssues ? 'Queuing…' : `Refresh ${summary.issues}`}</button>}
          </div>
          <div className={styles.readiness}><div><span>Readiness</span><strong>{summary.readiness}%</strong></div><div className={styles.progressTrack} aria-label={`${summary.readiness}% of knowledge sources ready`}><span style={{ width: `${summary.readiness}%` }} /></div></div>
          <div className={styles.metrics}><div><Database size={13} /><span>Sources</span><strong>{summary.total}</strong></div><div><Check size={13} /><span>Ready</span><strong>{summary.ready}</strong></div><div><AlertTriangle size={13} /><span>Issues</span><strong>{summary.issues}</strong></div><div><FileText size={13} /><span>Chunks</span><strong>{summary.chunks.toLocaleString()}</strong></div></div>
        </section>
      )}

      {loading ? <Loading pad="32px 0" /> : docs.length === 0 ? (
        <button type="button" className={styles.emptyButton} onClick={() => setAddOpen(true)}><EmptyState icon={<Globe size={32} />} title="No knowledge added yet." hint="Add a website or document so this agent can answer with your information." /></button>
      ) : (
        <section className={styles.sources} aria-labelledby="knowledge-sources-title">
          <header className={styles.sourcesHeader}>
            <div><h2 id="knowledge-sources-title">Sources</h2><p>{visibleDocs.length === docs.length ? `${docs.length} total` : `${visibleDocs.length} of ${docs.length}`}</p></div>
            <div className={styles.filters} aria-label="Filter knowledge sources">{([['all', 'All'], ['ready', 'Ready'], ['processing', 'Indexing'], ['attention', 'Needs attention']] as const).map(([value, label]) => <button key={value} type="button" className={filter === value ? styles.filterActive : ''} onClick={() => setFilter(value)}>{label}{value === 'attention' && summary.issues > 0 ? <span>{summary.issues}</span> : null}</button>)}</div>
            <AppSearchField className={styles.search} value={query} onChange={setQuery} placeholder="Search sources" ariaLabel="Search knowledge sources" />
          </header>

          {visibleDocs.length === 0 ? <div className={styles.noResults}><Search size={18} /><p>No sources match this view.</p><button type="button" onClick={() => { setFilter('all'); setQuery('') }}>Clear filters</button></div> : (
            <div className={styles.sourceList}>{visibleDocs.map((doc) => {
              const health = knowledgeHealth(doc)
              const lastIndexed = formatRelative(doc.indexedAt ?? doc.lastSyncedAt)
              const exactIndexed = formatTimestamp(doc.indexedAt ?? doc.lastSyncedAt)
              return (
                <article key={doc.id} className={styles.sourceRow} data-health={health}>
                  <span className={styles.sourceIcon}>{doc.type === 'file' ? <FileText size={15} /> : <Globe size={15} />}</span>
                  <div className={styles.sourceCopy}>
                    <div className={styles.sourceTitle}><strong title={doc.source}>{doc.source}</strong><span className={`${styles.badge} ${styles[`badge_${health}`]}`}><HealthIcon health={health} />{HEALTH_LABEL[health]}</span></div>
                    <div className={styles.sourceMeta}><span>{doc.type === 'file' ? 'Document' : 'Website'}</span>{doc.chunkCount > 0 && <span>{doc.chunkCount.toLocaleString()} chunks</span>}{lastIndexed && <span title={exactIndexed ?? undefined}>Indexed {lastIndexed}</span>}{doc.type === 'webpage' && doc.autoSyncEnabled && doc.syncIntervalHours && <span>Syncs {SYNC_INTERVAL_LABELS[doc.syncIntervalHours].toLowerCase()}</span>}</div>
                    {health === 'error' && <p className={styles.sourceError}>{doc.syncError || doc.errorMessage || 'Indexing failed. Try refreshing this source.'}{doc.syncFailures ? ` · ${doc.syncFailures} failed ${doc.syncFailures === 1 ? 'attempt' : 'attempts'}` : ''}</p>}
                    {health === 'empty' && <p className={styles.sourceWarning}>No usable text was found. Check that this source contains readable content.</p>}
                    {health === 'stale' && <p className={styles.sourceWarning}>This website has not been refreshed in over 30 days. Refresh it or enable automatic syncing.</p>}
                    {doc.type === 'webpage' && doc.autoSyncEnabled && formatTimestamp(doc.nextSyncAt) && health !== 'error' && <p className={styles.nextSync}>Next sync {formatRelative(doc.nextSyncAt)} <span>· {formatTimestamp(doc.nextSyncAt)}</span></p>}
                  </div>
                  {doc.type === 'webpage' && <AppSelect className={styles.syncSelect} ariaLabel={`Automatic sync interval for ${doc.source}`} value={doc.autoSyncEnabled && doc.syncIntervalHours ? String(doc.syncIntervalHours) : ''} disabled={savingSyncId === doc.id} onChange={(value) => void handleSyncInterval(doc.id, value)} emptyLabel="Auto-sync off" options={[{ value: '24', label: 'Daily' }, { value: '168', label: 'Weekly' }, { value: '720', label: 'Monthly' }]} />}
                  {(doc.status === 'indexed' || doc.status === 'error') && <AppTooltip label={doc.type === 'webpage' ? 'Refresh now' : 'Re-index'}><Button className={styles.iconButton} onPress={() => void handleReindex(doc.id)} isDisabled={reindexingId === doc.id} aria-label={doc.type === 'webpage' ? `Refresh ${doc.source}` : `Re-index ${doc.source}`} isIconOnly>{reindexingId === doc.id ? <Loader2 size={14} className={styles.spin} /> : <RotateCw size={14} />}</Button></AppTooltip>}
                  <AppTooltip label="Delete source"><Button className={`${styles.iconButton} ${styles.deleteButton}`} onPress={() => void handleDelete(doc)} isDisabled={deletingId === doc.id} aria-label={`Delete ${doc.source}`} isIconOnly>{deletingId === doc.id ? <Loader2 size={14} className={styles.spin} /> : <Trash2 size={14} />}</Button></AppTooltip>
                </article>
              )
            })}</div>
          )}
        </section>
      )}
    </>
  )
}
