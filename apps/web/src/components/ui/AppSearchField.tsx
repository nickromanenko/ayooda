'use client'

import { SearchField } from '@heroui/react'
import clsx from 'clsx'
import styles from './AppSearchField.module.css'

export function AppSearchField({ value, onChange, placeholder = 'Search…', ariaLabel = 'Search', disabled, className }: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <SearchField aria-label={ariaLabel} className={clsx(styles.root, className)} fullWidth isDisabled={disabled} onChange={onChange} value={value} variant="secondary">
      <SearchField.Group className={styles.group}>
        <SearchField.SearchIcon className={styles.searchIcon} />
        <SearchField.Input className={styles.input} placeholder={placeholder} />
        <SearchField.ClearButton className={styles.clear} aria-label="Clear search" />
      </SearchField.Group>
    </SearchField>
  )
}
