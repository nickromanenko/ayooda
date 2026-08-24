'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'ayooda.theme'
const CHANGE_EVENT = 'ayooda:theme-change'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

function subscribeTheme(onStoreChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: light)')
  const onThemeChange = () => onStoreChange()
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return
    applyTheme(storedTheme() ?? systemTheme())
    onStoreChange()
  }
  const onSystemChange = () => {
    if (storedTheme()) return
    applyTheme(systemTheme())
    onStoreChange()
  }

  window.addEventListener(CHANGE_EVENT, onThemeChange)
  window.addEventListener('storage', onStorage)
  media.addEventListener('change', onSystemChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onThemeChange)
    window.removeEventListener('storage', onStorage)
    media.removeEventListener('change', onSystemChange)
  }
}

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function getThemeServerSnapshot(): Theme {
  return 'dark'
}

function setTheme(theme: Theme) {
  try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* use the in-memory DOM state */ }
  applyTheme(theme)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function ThemeToggle({ showLabel = false, className = '' }: { showLabel?: boolean; className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot)
  const [ready, setReady] = useState(false)
  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark'

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      data-label={showLabel}
      data-ready={ready}
      onClick={() => setTheme(nextTheme)}
      aria-label={`Switch to ${nextTheme} theme`}
      title={`Switch to ${nextTheme} theme`}
    >
      <span className="theme-toggle-icons" aria-hidden>
        <span className="theme-toggle-icon" data-visible={theme === 'dark'}><Sun size={17} strokeWidth={1.7} /></span>
        <span className="theme-toggle-icon" data-visible={theme === 'light'}><Moon size={17} strokeWidth={1.7} /></span>
      </span>
      {showLabel && <span>{nextTheme === 'light' ? 'Light theme' : 'Dark theme'}</span>}
    </button>
  )
}
