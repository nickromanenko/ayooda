import Link from 'next/link'
import { ArrowRight, Check, ChevronDown, Circle, Rocket } from 'lucide-react'
import styles from './ActivationChecklist.module.css'

export type ActivationStep = {
  id: string
  title: string
  description: string
  href: string
  action: string
  done: boolean
}

export function ActivationChecklist({ agentName, steps }: { agentName: string; steps: ActivationStep[] }) {
  const completed = steps.filter((step) => step.done).length
  const next = steps.find((step) => !step.done)
  const complete = completed === steps.length
  const percent = Math.round(completed / steps.length * 100)

  return (
    <details className={styles.panel} open={!complete}>
      <summary className={styles.summary}>
        <span className={`${styles.heroIcon} ${complete ? styles.completeIcon : ''}`}><Rocket size={18} /></span>
        <span className={styles.summaryCopy}>
          <strong>{complete ? `${agentName} is launch-ready` : `Launch ${agentName}`}</strong>
          <small>{complete ? 'The core activation workflow is complete.' : next ? `Next: ${next.title}` : 'Complete the setup checklist.'}</small>
        </span>
        <span className={styles.progressCopy}><strong>{percent}%</strong><small>{completed}/{steps.length} complete</small></span>
        <ChevronDown size={16} className={styles.chevron} />
        <span className={styles.progressTrack} aria-label={`${percent}% of activation steps complete`}><span style={{ width: `${percent}%` }} /></span>
      </summary>

      <div className={styles.steps}>
        {steps.map((step) => {
          const isNext = next?.id === step.id
          return (
            <Link key={step.id} href={step.href} className={styles.step} data-complete={step.done} data-next={isNext}>
              <span className={styles.stepIcon}>{step.done ? <Check size={14} /> : <Circle size={13} />}</span>
              <span className={styles.stepCopy}><strong>{step.title}</strong><small>{step.description}</small></span>
              <span className={styles.action}>{step.done ? 'Review' : step.action}<ArrowRight size={13} /></span>
            </Link>
          )
        })}
      </div>
      <p className={styles.note}>This checklist reflects the selected default agent. You can revisit any step without affecting live conversations.</p>
    </details>
  )
}
