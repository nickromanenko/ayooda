'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { StepIdentity, type IdentityData } from './StepIdentity'
import { StepKnowledge } from './StepKnowledge'
import { StepDeploy } from './StepDeploy'
import { cn } from '@/lib/utils'

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
      <nav className="flex items-center justify-center gap-0 mb-10">
        {STEPS.map((s, i) => {
          const num = i + 1
          const done = num < step
          const active = num === step
          return (
            <div key={s.label} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                    done && 'bg-indigo-600 text-white',
                    active && 'bg-indigo-600 text-white ring-4 ring-indigo-100',
                    !done && !active && 'bg-zinc-100 text-zinc-400',
                  )}
                >
                  {done ? <Check size={14} /> : num}
                </div>
                <span
                  className={cn(
                    'text-xs font-medium',
                    active ? 'text-zinc-900' : 'text-zinc-400',
                  )}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'w-24 h-px mx-2 mb-5',
                    num < step ? 'bg-indigo-300' : 'bg-zinc-200',
                  )}
                />
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
