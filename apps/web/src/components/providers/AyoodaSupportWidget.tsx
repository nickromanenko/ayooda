'use client'

import Script from 'next/script'
import { useEffect, useRef } from 'react'
import { useAuth } from './AuthProvider'

const SUPPORT_WIDGET_CHANNEL_ID = 'gCtB4qoNAX6tG9JUzdhO'

type AyoodaCommand = ((command: 'boot' | 'update' | 'shutdown', options?: {
  user?: { id: string; name?: string; email?: string }
}) => void) & { q?: unknown[][] }

declare global {
  interface Window {
    Ayooda?: AyoodaCommand
  }
}

function command(...args: Parameters<AyoodaCommand>) {
  if (!window.Ayooda) {
    const queue = ((...queued: unknown[]) => {
      queue.q = queue.q ?? []
      queue.q.push(queued)
    }) as AyoodaCommand
    queue.q = []
    window.Ayooda = queue
  }
  window.Ayooda(...args)
}

/**
 * Loads Ayooda's own support widget once for the entire site. Public visitors
 * remain anonymous; signed-in dashboard users get useful operator context via
 * the browser identity mode and are explicitly labelled unverified in Inbox.
 */
export function AyoodaSupportWidget() {
  const { user, loading } = useAuth()
  const previousUserId = useRef<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (user) {
      command(previousUserId.current ? 'update' : 'boot', {
        user: {
          id: user.uid,
          ...(user.displayName ? { name: user.displayName } : {}),
          ...(user.email ? { email: user.email } : {}),
        },
      })
      previousUserId.current = user.uid
      return
    }
    if (previousUserId.current) command('shutdown')
    previousUserId.current = null
  }, [loading, user])

  return (
    <Script
      src="https://cdn.ayooda.live/widget.js"
      data-agent-id={SUPPORT_WIDGET_CHANNEL_ID}
      strategy="afterInteractive"
    />
  )
}
