import type { CSSProperties } from 'react'

/** Ayooda "Orbit" mark: an open ring with a lime core and a ping leaving the ring. */
export function AyoodaMark({ size, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      className={className}
      style={style}
    >
      <path d="M50.79 25.16A20 20 0 1 1 38.84 13.21" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="32" cy="32" r="7" fill="var(--accent)" />
      <circle cx="46.14" cy="17.86" r="4.2" fill="var(--accent)" />
    </svg>
  )
}
