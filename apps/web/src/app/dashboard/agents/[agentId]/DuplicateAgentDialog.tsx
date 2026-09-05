'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CopyPlus, Loader2, X } from 'lucide-react'
import type { AgentDoc } from '@ayooda/shared'
import { apiRequestOrThrow } from '@/lib/api'
import { AppCheckbox } from '@/components/ui/AppCheckbox'
import styles from './duplicate-agent.module.css'

type CopyOptions = {
  copyTools: boolean
  copySkills: boolean
  copyWorkflows: boolean
  copyTests: boolean
}

const OPTIONS: Array<{ key: keyof CopyOptions; title: string; description: string }> = [
  { key: 'copyTools', title: 'Tools and connections', description: 'Reuse tool actions, existing credentials, and write-action settings.' },
  { key: 'copySkills', title: 'Skills', description: 'Copy enabled skills and their current configuration.' },
  { key: 'copyWorkflows', title: 'Workflows', description: 'Copy routing, replies, and human hand-off behavior.' },
  { key: 'copyTests', title: 'Regression tests', description: 'Copy test cases without previous run results.' },
]

function copyName(name: string): string {
  const suffix = ' copy'
  return `${name.slice(0, 80 - suffix.length).trimEnd()}${suffix}`
}

export default function DuplicateAgentDialog({ source, onClose }: { source: AgentDoc; onClose: () => void }) {
  const router = useRouter()
  const dialogRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(copyName(source.name))
  const [options, setOptions] = useState<CopyOptions>({ copyTools: true, copySkills: true, copyWorkflows: true, copyTests: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    inputRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key !== 'Tab') return

      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled])',
      ) ?? [])
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = overflow
    }
  }, [busy, onClose])

  async function duplicate(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true); setError('')
    try {
      const response = await apiRequestOrThrow(`/agents/${source.id}/duplicate`, {
        method: 'POST', body: JSON.stringify({ name: name.trim(), ...options }),
      }, 'Could not duplicate this agent.')
      const data = await response.json() as { agent: AgentDoc }
      router.push(`/dashboard/agents/${data.agent.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not duplicate this agent.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <form ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="duplicate-title" onSubmit={(event) => void duplicate(event)}>
        <header className={styles.header}>
          <span className={styles.icon}><CopyPlus size={18} /></span>
          <div><h2 id="duplicate-title">Duplicate {source.name}</h2><p>Create an independent agent from this configuration.</p></div>
          <button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="Close duplicate agent dialog" title="Close"><X size={16} /></button>
        </header>

        <div className={styles.body}>
          <label className={styles.nameField}><span>New agent name</span><input ref={inputRef} value={name} maxLength={80} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
          <fieldset className={styles.options}><legend>Include reusable configuration</legend>{OPTIONS.map((option) => (
            <AppCheckbox key={option.key} className={styles.option} checked={options[option.key]} disabled={busy} onChange={(checked) => setOptions((current) => ({ ...current, [option.key]: checked }))} label={option.title} description={option.description} />
          ))}</fieldset>
          <div className={styles.scope}><strong>Always starts fresh</strong><p>Knowledge, channels, conversations, usage, agent photo, team access, and model-provider keys are not copied.</p></div>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>

        <footer className={styles.footer}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? <Loader2 size={14} className={styles.spin} /> : <CopyPlus size={14} />}{busy ? 'Duplicating…' : 'Duplicate agent'}</button>
        </footer>
      </form>
    </div>
  )
}
