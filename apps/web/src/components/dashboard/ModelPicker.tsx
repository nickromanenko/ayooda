'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Cpu, Loader2, Search, Sparkles } from 'lucide-react'
import type { GatewayModelCatalog, GatewayModelInfo } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import styles from './ModelPicker.module.css'

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  google: 'Google',
  meta: 'Meta',
  openai: 'OpenAI',
  xai: 'xAI',
}

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.split(/[-_]/).map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : '').join(' ')
}

function perMillion(value: string): string | null {
  const amount = Number(value) * 1_000_000
  if (!Number.isFinite(amount)) return null
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: amount < 0.01 ? 3 : 0, maximumFractionDigits: amount < 1 ? 3 : 2 })}`
}

function tokenCount(value: number | null): string | null {
  return value === null ? null : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function unavailableModel(id: string): GatewayModelInfo {
  return {
    id,
    name: id.split('/').pop() ?? id,
    description: 'This saved model is not present in the current Gateway catalog.',
    provider: id.split('/')[0] ?? 'unknown',
    pricing: null,
    contextWindow: null,
    maxOutputTokens: null,
    recommended: false,
  }
}

export default function ModelPicker({
  agentId,
  value,
  onChange,
}: {
  agentId: string
  value: string
  onChange: (modelId: string) => void
}) {
  const [catalog, setCatalog] = useState<GatewayModelCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('all')
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void apiRequest(`/agents/${agentId}/models`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load models.')
        const data = await response.json() as GatewayModelCatalog
        if (!cancelled) setCatalog(data)
      })
      .catch(() => { if (!cancelled) setError('Could not load the model catalog.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [agentId])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const models = catalog?.models ?? []
  const selected = models.find((model) => model.id === value) ?? unavailableModel(value)
  const providers = [...new Set(models.map((model) => model.provider))].sort((a, b) => {
    const preferred = ['google', 'anthropic', 'openai', 'meta']
    const aIndex = preferred.indexOf(a)
    const bIndex = preferred.indexOf(b)
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    }
    return providerLabel(a).localeCompare(providerLabel(b))
  })

  const needle = query.trim().toLowerCase()
  const filtered = models.filter((model) => {
    if (provider !== 'all' && model.provider !== provider) return false
    return !needle || `${model.name} ${model.id} ${model.description}`.toLowerCase().includes(needle)
  })

  function choose(modelId: string) {
    onChange(modelId)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={loading && models.length === 0}
      >
        <span className={styles.modelIcon}><Cpu size={15} /></span>
        <span className={styles.triggerCopy}>
          <span className={styles.triggerName}>{selected.name}</span>
          <span className={styles.triggerMeta}>{providerLabel(selected.provider)} · {selected.id}</span>
        </span>
        {loading ? <Loader2 size={15} className={styles.spinner} /> : <ChevronDown size={15} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />}
      </button>

      {open && (
        <div className={styles.popover}>
          <div className={styles.catalogHeader}>
            <div>
              <p className={styles.catalogTitle}>Choose a Gateway model</p>
              <p className={styles.catalogCount}>{models.length} language model{models.length === 1 ? '' : 's'} available</p>
            </div>
            <span className={`${styles.liveBadge} ${catalog?.dynamic ? styles.live : styles.fallback}`}>
              {catalog?.dynamic ? 'Live catalog' : 'Recommended only'}
            </span>
          </div>

          <div className={styles.filters}>
            <label className={styles.searchField}>
              <Search size={14} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models, providers, or IDs"
                aria-label="Search models"
              />
            </label>
            <select value={provider} onChange={(event) => setProvider(event.target.value)} className={styles.providerSelect} aria-label="Filter by provider">
              <option value="all">All providers</option>
              {providers.map((item) => <option key={item} value={item}>{providerLabel(item)}</option>)}
            </select>
          </div>

          <div className={styles.modelList} role="listbox" aria-label="AI Gateway models">
            {filtered.length === 0 ? (
              <div className={styles.emptyState}>No models match this search.</div>
            ) : filtered.map((model) => {
              const inputPrice = model.pricing ? perMillion(model.pricing.input) : null
              const outputPrice = model.pricing ? perMillion(model.pricing.output) : null
              const context = tokenCount(model.contextWindow)
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={model.id === value}
                  key={model.id}
                  className={`${styles.option} ${model.id === value ? styles.optionSelected : ''}`}
                  onClick={() => choose(model.id)}
                >
                  <span className={styles.optionMain}>
                    <span className={styles.optionTitleRow}>
                      <span className={styles.optionName}>{model.name}</span>
                      {model.recommended && <span className={styles.recommended}><Sparkles size={10} /> Recommended</span>}
                    </span>
                    <span className={styles.optionId}>{model.id}</span>
                    {model.description && <span className={styles.optionDescription}>{model.description}</span>}
                  </span>
                  <span className={styles.optionAside}>
                    <span className={styles.providerBadge}>{providerLabel(model.provider)}</span>
                    {(inputPrice || outputPrice || context) && (
                      <span className={styles.modelStats}>
                        {context && <span>{context} context</span>}
                        {inputPrice && outputPrice && <span>In {inputPrice} · out {outputPrice} / 1M</span>}
                      </span>
                    )}
                    <span className={`${styles.checkIcon} ${model.id === value ? styles.checkVisible : ''}`}><Check size={13} /></span>
                  </span>
                </button>
              )
            })}
          </div>

          {(catalog?.warning || error) && <p className={styles.warning}>{catalog?.warning ?? error}</p>}
        </div>
      )}
      {!open && error && <p className={styles.inlineError}>{error}</p>}
    </div>
  )
}
