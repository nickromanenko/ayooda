'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertDialog, Button, Toast } from '@heroui/react'
import styles from './AppInteractionProvider.module.css'

export type ConfirmOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'warning'
}

type PendingConfirmation = ConfirmOptions & { resolve: (confirmed: boolean) => void }

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null)

export function AppInteractionProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null)
  const pendingRef = useRef<PendingConfirmation | null>(null)

  const confirm = useCallback((options: ConfirmOptions) => {
    pendingRef.current?.resolve(false)
    return new Promise<boolean>((resolve) => {
      const request = { ...options, resolve }
      pendingRef.current = request
      setPending(request)
    })
  }, [])

  const settle = useCallback((confirmed: boolean) => {
    const request = pendingRef.current
    if (!request) return
    pendingRef.current = null
    setPending(null)
    request.resolve(confirmed)
  }, [])

  const tone = pending?.tone ?? 'danger'

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Toast.Provider className={styles.toastRegion} maxVisibleToasts={3} placement="bottom end" width="min(420px, calc(100vw - 32px))" />
      <AlertDialog>
        <Button aria-label="Confirmation dialog trigger" className={styles.hiddenTrigger} excludeFromTabOrder />
        <AlertDialog.Backdrop
          className={styles.backdrop}
          isDismissable
          isKeyboardDismissDisabled={false}
          isOpen={Boolean(pending)}
          onOpenChange={(isOpen) => { if (!isOpen) settle(false) }}
          variant="blur"
        >
          <AlertDialog.Container className={styles.container} placement="center" size="sm">
            <AlertDialog.Dialog className={styles.dialog}>
              <AlertDialog.Header className={styles.header}>
                <AlertDialog.Icon className={styles.icon} status={tone} />
                <AlertDialog.Heading className={styles.heading}>{pending?.title}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body className={styles.body}>{pending?.description}</AlertDialog.Body>
              <AlertDialog.Footer className={styles.footer}>
                <Button className={`${styles.button} ${styles.cancel}`} onPress={() => settle(false)} variant="tertiary">
                  {pending?.cancelLabel ?? 'Cancel'}
                </Button>
                <Button className={`${styles.button} ${tone === 'danger' ? styles.danger : styles.warning}`} onPress={() => settle(true)} variant="primary">
                  {pending?.confirmLabel ?? 'Continue'}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useAppConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useAppConfirm must be used within AppInteractionProvider')
  return confirm
}
