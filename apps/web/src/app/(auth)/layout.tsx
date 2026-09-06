import Link from 'next/link'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 16px',
    }}>
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 2 }}><ThemeToggle /></div>
      {/* Ambient glow */}
      <div aria-hidden style={{
        position: 'fixed', top: -300, left: '50%', transform: 'translateX(-50%)',
        width: 800, height: 800, borderRadius: '50%',
        background: 'radial-gradient(closest-side, var(--accent-soft), transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 32, color: 'var(--ink)', textDecoration: 'none' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="4" fill="var(--accent)" />
            <path d="M2.5 12h6M15.5 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 18 }}>Ayooda</span>
        </Link>

        {children}

        <nav aria-label="Legal links" style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '4px 18px', marginTop: 24, color: 'var(--ink-faint)', fontSize: 11.5 }}>
          <Link href="/privacy" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center' }}>Privacy Policy</Link>
          <Link href="/terms" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center' }}>Terms of Use</Link>
        </nav>
      </div>
    </div>
  )
}
