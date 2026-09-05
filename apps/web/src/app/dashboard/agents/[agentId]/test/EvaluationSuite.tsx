'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Clock3, FlaskConical, Loader2, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { AppSelect } from '@/components/ui/AppSelect'
import { useAppConfirm } from '@/components/ui/AppInteractionProvider'
import { AppSwitch } from '@/components/ui/AppSwitch'
import styles from './evaluation.module.css'

type ExpectedOutcome = 'any' | 'answer' | 'handoff' | 'silent'
type EvaluationCase = {
  id: string
  name: string
  prompt: string
  expectedIncludes: string[]
  forbiddenIncludes: string[]
  expectedOutcome: ExpectedOutcome
  enabled: boolean
}
type EvaluationResult = {
  caseId: string
  name: string
  prompt: string
  response: string
  actualOutcome: Exclude<ExpectedOutcome, 'any'>
  passed: boolean
  checks: { label: string; passed: boolean }[]
  error: string | null
  durationMs: number
}
type EvaluationRun = {
  id: string
  total: number
  passed: number
  durationMs: number
  results: EvaluationResult[]
  createdAt: string | null
}
type CaseDraft = Omit<EvaluationCase, 'id'>

const EMPTY_DRAFT: CaseDraft = {
  name: '', prompt: '', expectedIncludes: [], forbiddenIncludes: [], expectedOutcome: 'answer', enabled: true,
}

function percentage(run: EvaluationRun): number {
  return run.total ? Math.round((run.passed / run.total) * 100) : 0
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const data = await response.json().catch(() => ({})) as { error?: string }
  return new Error(data.error ?? fallback)
}

export default function EvaluationSuite({ agentId }: { agentId: string }) {
  const confirm = useAppConfirm()
  const [cases, setCases] = useState<EvaluationCase[]>([])
  const [runs, setRuns] = useState<EvaluationRun[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CaseDraft>(EMPTY_DRAFT)
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiRequest(`/agents/${agentId}/evaluations`)
      if (!response.ok) throw await responseError(response, 'Could not load the evaluation suite.')
      const data = await response.json() as { cases: EvaluationCase[]; runs: EvaluationRun[] }
      setCases(data.cases)
      setRuns(data.runs)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the evaluation suite.')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => { void load() }, [load])

  const enabledCount = cases.filter((testCase) => testCase.enabled).length
  const latest = runs[0]
  const prior = runs[1]
  const delta = latest && prior ? percentage(latest) - percentage(prior) : null
  const lastResult = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const result of latest?.results ?? []) map.set(result.caseId, result.passed)
    return map
  }, [latest])

  function openCreate() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setFormOpen(true)
    setError('')
  }

  function openEdit(testCase: EvaluationCase) {
    setEditingId(testCase.id)
    setDraft({
      name: testCase.name, prompt: testCase.prompt, expectedIncludes: testCase.expectedIncludes,
      forbiddenIncludes: testCase.forbiddenIncludes, expectedOutcome: testCase.expectedOutcome, enabled: testCase.enabled,
    })
    setFormOpen(true)
    setError('')
  }

  async function save() {
    if (!draft.name.trim() || !draft.prompt.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const response = await apiRequest(
        editingId ? `/agents/${agentId}/evaluations/cases/${editingId}` : `/agents/${agentId}/evaluations/cases`,
        { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(draft) },
      )
      if (!response.ok) throw await responseError(response, 'Could not save this test.')
      const saved = await response.json() as EvaluationCase
      setCases((current) => editingId
        ? current.map((testCase) => testCase.id === editingId ? saved : testCase)
        : [...current, saved])
      setFormOpen(false)
      setEditingId(null)
      setDraft(EMPTY_DRAFT)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this test.')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(testCase: EvaluationCase) {
    const updated = { ...testCase, enabled: !testCase.enabled }
    setCases((current) => current.map((item) => item.id === testCase.id ? updated : item))
    const response = await apiRequest(`/agents/${agentId}/evaluations/cases/${testCase.id}`, {
      method: 'PUT', body: JSON.stringify(updated),
    }).catch(() => null)
    if (!response?.ok) {
      setCases((current) => current.map((item) => item.id === testCase.id ? testCase : item))
      setError('Could not update this test.')
    }
  }

  async function remove(testCase: EvaluationCase) {
    if (!await confirm({ title: `Delete “${testCase.name}”?`, description: 'The test will be removed from future suite runs. Past run results will remain available.', confirmLabel: 'Delete test' })) return
    setError('')
    const response = await apiRequest(`/agents/${agentId}/evaluations/cases/${testCase.id}`, { method: 'DELETE' }).catch(() => null)
    if (!response?.ok) {
      setError('Could not delete this test.')
      return
    }
    setCases((current) => current.filter((item) => item.id !== testCase.id))
  }

  async function runSuite() {
    if (!enabledCount || running) return
    setRunning(true)
    setError('')
    try {
      const response = await apiRequest(`/agents/${agentId}/evaluations/runs`, { method: 'POST', body: '{}' })
      if (!response.ok) throw await responseError(response, 'Could not run the suite.')
      const run = await response.json() as EvaluationRun
      setRuns((current) => [run, ...current].slice(0, 10))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not run the suite.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className={styles.suite} aria-labelledby="evaluation-title">
      <header className={styles.header}>
        <span className={styles.icon}><FlaskConical size={16} /></span>
        <div className={styles.headingCopy}>
          <h2 id="evaluation-title">Regression suite</h2>
          <p>Catch knowledge and workflow regressions before customers do.</p>
        </div>
        {latest && (
          <div className={styles.score} data-perfect={latest.passed === latest.total}>
            <strong>{percentage(latest)}%</strong>
            <span>{latest.passed}/{latest.total} passed{delta !== null && <em className={delta < 0 ? styles.deltaDown : styles.deltaUp}>{delta > 0 ? ` +${delta}` : ` ${delta}`} pts</em>}</span>
          </div>
        )}
        <button type="button" className="btn btn-ghost" onClick={openCreate}><Plus size={14} /> Add test</button>
        <button type="button" className="btn btn-primary" onClick={() => void runSuite()} disabled={!enabledCount || running}>
          {running ? <Loader2 size={14} className={styles.spin} /> : <Play size={14} />}
          {running ? `Running ${enabledCount} tests…` : `Run ${enabledCount || ''} ${enabledCount === 1 ? 'test' : 'tests'}`}
        </button>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {formOpen && (
        <div className={styles.form}>
          <div className={styles.formHeading}>
            <div><h3>{editingId ? 'Edit test' : 'Add a regression test'}</h3><p>Use stable facts and behaviors that should remain true over time.</p></div>
            <button type="button" className={styles.iconButton} onClick={() => setFormOpen(false)} aria-label="Close test editor" title="Close"><X size={15} /></button>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.field}><span>Test name</span><input value={draft.name} maxLength={100} placeholder="Refund policy" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <div className={styles.field}><span>Expected behavior</span><AppSelect ariaLabel="Expected behavior" value={draft.expectedOutcome} onChange={(value) => setDraft((current) => ({ ...current, expectedOutcome: value as ExpectedOutcome }))} options={[{ value: 'answer', label: 'Answer customer' }, { value: 'handoff', label: 'Hand off to human' }, { value: 'silent', label: 'Stop without reply' }, { value: 'any', label: 'Any behavior' }]} /></div>
            <label className={`${styles.field} ${styles.full}`}><span>Customer message</span><textarea rows={2} maxLength={5000} value={draft.prompt} placeholder="Can I get a refund after 30 days?" onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} /></label>
            <label className={styles.field}><span>Must mention <small>one phrase per line</small></span><textarea rows={3} value={draft.expectedIncludes.join('\n')} placeholder={'30 days\ncontact support'} onChange={(event) => setDraft((current) => ({ ...current, expectedIncludes: event.target.value.split('\n') }))} /></label>
            <label className={styles.field}><span>Must avoid <small>one phrase per line</small></span><textarea rows={3} value={draft.forbiddenIncludes.join('\n')} placeholder={'guaranteed refund\nlegal advice'} onChange={(event) => setDraft((current) => ({ ...current, forbiddenIncludes: event.target.value.split('\n') }))} /></label>
          </div>
          <div className={styles.formActions}>
            <AppSwitch compact className={styles.enabled} checked={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} label="Include in suite runs" />
            <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !draft.name.trim() || !draft.prompt.trim()}>{saving && <Loader2 size={14} className={styles.spin} />}{editingId ? 'Save changes' : 'Add test'}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className={styles.loading}><Loader2 size={16} className={styles.spin} /> Loading suite…</div>
      ) : cases.length === 0 ? (
        <button type="button" className={styles.empty} onClick={openCreate}>
          <Plus size={16} /><span><strong>Add your first regression test</strong><small>Save a customer question and define what a good answer must do.</small></span>
        </button>
      ) : (
        <div className={styles.caseList}>
          {cases.map((testCase) => {
            const result = lastResult.get(testCase.id)
            return (
              <article key={testCase.id} className={styles.case} data-disabled={!testCase.enabled}>
                <AppSwitch hideLabel className={styles.caseToggle} label={testCase.enabled ? 'Included in suite runs' : 'Excluded from suite runs'} checked={testCase.enabled} onChange={() => void toggle(testCase)} />
                <div className={styles.caseCopy}>
                  <div className={styles.caseTitle}><strong>{testCase.name}</strong>{result !== undefined && <span className={result ? styles.pass : styles.fail}>{result ? <Check size={11} /> : <X size={11} />}{result ? 'Passed' : 'Failed'}</span>}</div>
                  <p>{testCase.prompt}</p>
                  <div className={styles.criteria}>
                    <span>{testCase.expectedOutcome === 'any' ? 'Any behavior' : testCase.expectedOutcome === 'answer' ? 'Must answer' : testCase.expectedOutcome === 'handoff' ? 'Must hand off' : 'Must stop silently'}</span>
                    {testCase.expectedIncludes.length > 0 && <span>+{testCase.expectedIncludes.length} required</span>}
                    {testCase.forbiddenIncludes.length > 0 && <span>−{testCase.forbiddenIncludes.length} forbidden</span>}
                  </div>
                </div>
                <button type="button" className={styles.iconButton} onClick={() => openEdit(testCase)} aria-label={`Edit ${testCase.name}`} title="Edit test"><Pencil size={14} /></button>
                <button type="button" className={styles.iconButton} onClick={() => void remove(testCase)} aria-label={`Delete ${testCase.name}`} title="Delete test"><Trash2 size={14} /></button>
              </article>
            )
          })}
        </div>
      )}

      {runs.length > 0 && (
        <details className={styles.history}>
          <summary><span>Run history</span><span>{runs.length} recent {runs.length === 1 ? 'run' : 'runs'}</span><ChevronDown size={14} /></summary>
          <div className={styles.runList}>
            {runs.map((run) => (
              <details key={run.id} className={styles.run}>
                <summary>
                  <span className={run.passed === run.total ? styles.passIcon : styles.failIcon}>{run.passed === run.total ? <Check size={12} /> : <X size={12} />}</span>
                  <strong>{run.passed}/{run.total} passed</strong>
                  <span>{run.createdAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(run.createdAt)) : 'Recent run'}</span>
                  <span><Clock3 size={11} /> {(run.durationMs / 1000).toFixed(1)}s</span>
                  <ChevronDown size={13} />
                </summary>
                <div className={styles.results}>
                  {run.results.map((result) => (
                    <details key={result.caseId} className={styles.result}>
                      <summary><span className={result.passed ? styles.passIcon : styles.failIcon}>{result.passed ? <Check size={11} /> : <X size={11} />}</span><strong>{result.name}</strong><span>{result.error ?? result.checks.map((check) => check.label).join(' · ')}</span><ChevronDown size={12} /></summary>
                      <div className={styles.resultBody}>
                        <p><b>Customer</b>{result.prompt}</p>
                        <p><b>Agent</b>{result.response || (result.actualOutcome === 'silent' ? 'No reply (workflow stopped).' : 'No response captured.')}</p>
                        <ul>{result.checks.map((check) => <li key={check.label} className={check.passed ? styles.checkPass : styles.checkFail}>{check.passed ? <Check size={11} /> : <X size={11} />}{check.label}</li>)}</ul>
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
