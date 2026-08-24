import Link from 'next/link'
import { SignOutButton } from '@/components/onboarding/SignOutButton'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <header style={{ padding: '16px 32px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--ink)', textDecoration: 'none' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="4" fill="var(--accent)" />
            <path d="M2.5 12h6M15.5 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 16 }}>Ayooda</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 16px' }}>
        <div style={{ width: '100%', maxWidth: 560 }}>{children}</div>
      </div>
    </div>
  )
}
