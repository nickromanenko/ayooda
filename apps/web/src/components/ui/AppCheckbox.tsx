'use client'

import { Check, Minus } from 'lucide-react'
import { Checkbox, Description } from '@heroui/react'
import clsx from 'clsx'
import styles from './AppCheckbox.module.css'

type AppCheckboxProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  id?: string
  indeterminate?: boolean
  compact?: boolean
  className?: string
}

export function AppCheckbox({ checked, onChange, label, description, disabled, id, indeterminate, compact, className }: AppCheckboxProps) {
  return (
    <Checkbox
      className={clsx(styles.root, compact && styles.compact, className)}
      id={id}
      isDisabled={disabled}
      isIndeterminate={indeterminate}
      isSelected={checked}
      onChange={onChange}
      variant="secondary"
    >
      <Checkbox.Content className={styles.content}>
        <Checkbox.Control className={styles.control}>
          <Checkbox.Indicator className={styles.indicator}>
            {indeterminate ? <Minus aria-hidden="true" size={12} /> : <Check aria-hidden="true" size={12} />}
          </Checkbox.Indicator>
        </Checkbox.Control>
        <span className={styles.label}>{label}</span>
      </Checkbox.Content>
      {description && <Description className={styles.description}>{description}</Description>}
    </Checkbox>
  )
}
