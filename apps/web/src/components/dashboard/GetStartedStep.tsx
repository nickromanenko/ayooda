'use client'

import Link from 'next/link'

export function GetStartedStep({ number, title, description, href, done }: {
  number: number; title: string; description: string; href: string; done: boolean
}) {
  return (
    <Link href={href} style={{
      display: 'flex', alignItems: 'flex-start', gap: 14, padding: '12px 14px',
      borderRadius: 'var(--r-sm)', textDecoration: 'none',
      transition: 'background .15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{
        flexShrink: 0, width: 24, height: 24, borderRadius: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, marginTop: 1,
        background: done ? 'var(--mint)' : 'var(--accent-soft)',
        border: done ? 'none' : '1px solid rgba(245,165,36,0.25)',
        color: done ? '#081a10' : 'var(--accent)',
        fontFamily: 'var(--font-mono)',
      }}>
        {done ? '✓' : number}
      </span>
      <div>
        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>{title}</p>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>{description}</p>
      </div>
    </Link>
  )
}
