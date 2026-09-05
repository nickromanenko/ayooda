'use client'

import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { Description, Label, ListBox, Select } from '@heroui/react'
import clsx from 'clsx'
import styles from './AppSelect.module.css'

export type AppSelectOption = {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

type AppSelectProps = {
  value: string
  options: readonly AppSelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  emptyLabel?: string
  required?: boolean
  disabled?: boolean
  className?: string
  style?: CSSProperties
}

const EMPTY_VALUE = '__ayooda_empty__'

export function AppSelect({ value, options, onChange, ariaLabel, placeholder, emptyLabel, required, disabled, className, style }: AppSelectProps) {
  const visibleOptions = emptyLabel
    ? [{ value: EMPTY_VALUE, label: emptyLabel }, ...options.filter((option) => option.value)]
    : options.filter((option) => option.value)

  return (
    <Select
      aria-label={ariaLabel}
      className={clsx(styles.select, className)}
      isDisabled={disabled}
      isRequired={required}
      onChange={(key) => onChange(key === null || key === EMPTY_VALUE ? '' : String(key))}
      placeholder={placeholder}
      style={style}
      value={value || (emptyLabel ? EMPTY_VALUE : null)}
    >
      <Select.Trigger className={styles.trigger}>
        <Select.Value className={styles.value} />
        <Select.Indicator className={styles.indicator} />
      </Select.Trigger>
      <Select.Popover className={styles.popover}>
        <ListBox className={styles.listBox}>
          {visibleOptions.map((option) => (
            <ListBox.Item
              className={styles.item}
              id={option.value}
              isDisabled={option.disabled}
              key={option.value}
              textValue={option.label}
            >
              <span className={styles.itemText}>
                <Label>{option.label}</Label>
                {option.description && <Description className={styles.description}>{option.description}</Description>}
              </span>
              <ListBox.ItemIndicator className={styles.check}><Check aria-hidden="true" size={14} /></ListBox.ItemIndicator>
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}
