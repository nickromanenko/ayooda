'use client'

import type { ReactNode } from 'react'
import { Tabs } from '@heroui/react'
import styles from './AppTabs.module.css'

export type AppTab = { id: string; label: string; disabled?: boolean }

export function AppTabs({ tabs, selectedKey, onSelectionChange, ariaLabel, children, className }: {
  tabs: readonly AppTab[]
  selectedKey: string
  onSelectionChange: (key: string) => void
  ariaLabel: string
  children: ReactNode
  className?: string
}) {
  return (
    <Tabs className={`${styles.root}${className ? ` ${className}` : ''}`} onSelectionChange={(key) => onSelectionChange(String(key))} selectedKey={selectedKey} variant="primary">
      <Tabs.ListContainer className={styles.listContainer}>
        <Tabs.List aria-label={ariaLabel} className={styles.list}>
          {tabs.map((tab) => <Tabs.Tab className={styles.tab} id={tab.id} isDisabled={tab.disabled} key={tab.id}>{tab.label}<Tabs.Indicator className={styles.indicator} /></Tabs.Tab>)}
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel className={styles.panel} id={selectedKey}>{children}</Tabs.Panel>
    </Tabs>
  )
}
