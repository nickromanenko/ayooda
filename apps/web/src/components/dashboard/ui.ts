import type { CSSProperties } from 'react'

/** Shared panel/field styling for the dashboard's form screens. */

export const card: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)',
  padding: 24,
  marginBottom: 20,
}

export const label: CSSProperties = {
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-mute)',
  marginBottom: 12,
}

export const input: CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--bg-2)',
  color: 'var(--ink)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}

export const muted: CSSProperties = { fontSize: 13, color: 'var(--ink-mute)' }

export const errorText: CSSProperties = { fontSize: 12, color: '#f87171' }
