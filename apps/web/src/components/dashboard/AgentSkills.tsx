'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AgentSkillView, SkillId } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { Loading } from '@/components/dashboard/Loading'
import { muted } from '@/components/dashboard/ui'

const card: React.CSSProperties = {
  background: 'var(--panel)', border: 0, boxShadow: 'var(--shadow-soft)',
  borderRadius: 'var(--r-md)', padding: 16, marginBottom: 12,
}

export default function AgentSkills({ agentId }: { agentId: string }) {
  const [skills, setSkills] = useState<AgentSkillView[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<SkillId | ''>('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest(`/agents/${agentId}/skills`)
      if (res.ok) { const d = await res.json() as { skills: AgentSkillView[] }; setSkills(d.skills) }
      else setError('Could not load skills.')
    } finally { setLoading(false) }
  }, [agentId])

  useEffect(() => { void load() }, [load])

  const save = async (s: AgentSkillView, next: Partial<AgentSkillView>) => {
    setBusy(s.id); setError('')
    try {
      const res = await apiRequest(`/agents/${agentId}/skills/${s.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: next.enabled ?? s.enabled, config: next.config ?? s.config }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not save that skill.'); return }
      await load()
    } finally { setBusy('') }
  }

  if (loading) return <Loading label="Loading skills…" pad="24px 0" />

  return (
    <div>
      {error && <p style={{ ...muted, color: 'var(--danger)' }}>{error}</p>}
      {skills.map((s) => (
        <div key={s.id} style={{ ...card, opacity: s.locked ? 0.6 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <strong>{s.label}</strong>
              <p style={muted}>{s.description}</p>
            </div>
            {s.locked ? (
              <span style={muted}>Upgrade to enable</span>
            ) : (
              <input
                type="checkbox"
                checked={s.enabled}
                disabled={busy === s.id}
                onChange={(e) => void save(s, { enabled: e.target.checked })}
                aria-label={`Enable ${s.label}`}
              />
            )}
          </div>
          {s.enabled && !s.locked && <SkillConfigFields skill={s} onSave={save} busy={busy === s.id} />}
        </div>
      ))}
    </div>
  )
}

function SkillConfigFields({
  skill, onSave, busy,
}: {
  skill: AgentSkillView
  onSave: (s: AgentSkillView, next: Partial<AgentSkillView>) => Promise<void>
  busy: boolean
}) {
  const cfg = skill.config as Record<string, unknown>
  const num = (key: string, labelText: string, min: number, max: number) => (
    <label style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
      {labelText}
      <input
        type="number" min={min} max={max} disabled={busy}
        defaultValue={Number(cfg[key])}
        onBlur={(e) => void onSave(skill, { config: { ...cfg, [key]: Number(e.target.value) } as never })}
        style={{ marginLeft: 8, width: 90 }}
      />
    </label>
  )

  if (skill.id === 'memory') return num('retentionDays', 'Remember facts for (days)', 1, 365)
  if (skill.id === 'web_search') return num('maxResults', 'Results per search', 1, 5)
  return (
    <label style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
      Custom rubric (optional)
      <textarea
        rows={3} disabled={busy} defaultValue={String(cfg.rubric ?? '')}
        onBlur={(e) => void onSave(skill, { config: { rubric: e.target.value } as never })}
        style={{ width: '100%', marginTop: 4 }}
      />
    </label>
  )
}
