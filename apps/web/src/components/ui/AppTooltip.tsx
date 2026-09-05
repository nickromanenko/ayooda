'use client'

import type { ReactElement, ReactNode } from 'react'
import { Tooltip } from '@heroui/react'
import styles from './AppTooltip.module.css'

export function AppTooltip({ label, children, placement = 'top' }: { label: ReactNode; children: ReactElement<{ className?: string }>; placement?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip closeDelay={70} delay={350}>
      <Tooltip.Trigger className={styles.trigger}>{children}</Tooltip.Trigger>
      <Tooltip.Content className={styles.content} offset={7} placement={placement} showArrow>
        <Tooltip.Arrow className={styles.arrow} />
        {label}
      </Tooltip.Content>
    </Tooltip>
  )
}
