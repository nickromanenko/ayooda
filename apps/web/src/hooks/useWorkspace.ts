'use client'

import { useState, useEffect } from 'react'
import { apiRequest } from '@/lib/api'
import type { AgentConfig } from '@ayooda/shared'

export interface WorkspaceData {
  id: string
  name: string
  onboardingComplete: boolean
  agent: AgentConfig
  usage: { conversationCount: number; tokenCount: number }
}

/**
 * Fetches workspace data (including workspaceId) from the API.
 * Each call is independent — no global cache. Suitable for dashboard pages
 * that each mount once and need workspace context.
 */
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchWorkspace() {
      try {
        const res = await apiRequest('/workspace')
        if (!res.ok) throw new Error('Failed to load workspace')
        const data = await res.json() as WorkspaceData
        if (!cancelled) setWorkspace(data)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load workspace')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchWorkspace()
    return () => { cancelled = true }
  }, [])

  return { workspace, loading, error }
}
