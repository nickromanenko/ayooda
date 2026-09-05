'use client'

import { Description, Label, Switch } from '@heroui/react'
import clsx from 'clsx'
import styles from './AppSwitch.module.css'

type AppSwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  id?: string
  compact?: boolean
  controlPosition?: 'start' | 'end'
  hideLabel?: boolean
  className?: string
}

export function AppSwitch({ checked, onChange, label, description, disabled, id, compact, controlPosition = 'start', hideLabel, className }: AppSwitchProps) {
  return (
    <Switch
      aria-label={hideLabel ? label : undefined}
      className={clsx(styles.root, compact && styles.compact, controlPosition === 'end' && styles.end, hideLabel && styles.iconOnly, className)}
      id={id}
      isDisabled={disabled}
      isSelected={checked}
      onChange={onChange}
      size="sm"
    >
      <Switch.Content className={styles.content}>
        <Switch.Control className={styles.control}><Switch.Thumb className={styles.thumb} /></Switch.Control>
        {!hideLabel && <Label className={styles.label}>{label}</Label>}
      </Switch.Content>
      {!hideLabel && description && <Description className={styles.description}>{description}</Description>}
    </Switch>
  )
}
