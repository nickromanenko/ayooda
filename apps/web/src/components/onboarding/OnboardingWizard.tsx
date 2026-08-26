'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { StepIdentity, type IdentityData } from './StepIdentity'
import { StepKnowledge } from './StepKnowledge'
import { StepDeploy } from './StepDeploy'

const STEPS = [
  { label: 'Your agent' },
  { label: 'Knowledge' },
  { label: 'Deploy' },
]

export function OnboardingWizard() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [identity, setIdentity] = useState<IdentityData | null>(null)

  function handleIdentityDone(data: IdentityData) {
    setIdentity(data)
    setStep(2)
  }

  function handleKnowledgeDone() {
    setStep(3)
  }

  function handleDeployDone() {
    router.push('/dashboard')
  }

  return (
    <div>
      {/* Step indicator */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 40 }}>
        {STEPS.map((s, i) => {
          const num = i + 1
          const done = num < step
          const active = num === step
          return (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 50,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)',
                  background: done || active ? 'var(--accent)' : 'var(--panel-2)',
                  color: done || active ? '#1a0e08' : 'var(--ink-mute)',
                  boxShadow: active ? '0 0 0 4px var(--accent-soft)' : 'none',
                  transition: 'background-color .2s, color .2s, box-shadow .2s',
                }}>
                  {done ? <Check size={14} strokeWidth={2.5} /> : num}
                </div>
                <span style={{
                  fontSize: 11.5,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase' as const,
                  color: active ? 'var(--ink)' : 'var(--ink-mute)',
                }}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{
                  width: 80, height: 1, margin: '0 8px',
                  marginBottom: 20,
                  background: num < step ? 'var(--accent)' : 'var(--line-2)',
                  transition: 'background .3s',
                }} />
              )}
            </div>
          )
        })}
      </nav>

      {/* Step content */}
      {step === 1 && <StepIdentity onDone={handleIdentityDone} />}
      {step === 2 && <StepKnowledge onDone={handleKnowledgeDone} onBack={() => setStep(1)} />}
      {step === 3 && identity && (
        <StepDeploy identity={identity} onDone={handleDeployDone} />
      )}
    </div>
  )
}
