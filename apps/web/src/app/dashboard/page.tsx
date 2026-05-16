import { MessageSquare, BookOpen, Bot, Zap } from 'lucide-react'
import { GetStartedStep } from '@/components/dashboard/GetStartedStep'

const stats = [
  { label: 'Total conversations', value: '—', icon: MessageSquare, accent: 'var(--blue)' },
  { label: 'Automated', value: '—', icon: Zap, accent: 'var(--mint)' },
  { label: 'Knowledge docs', value: '—', icon: BookOpen, accent: 'var(--accent)' },
  { label: 'Agent status', value: 'Inactive', icon: Bot, accent: 'var(--ink-mute)' },
]

export default function DashboardPage() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>Overview</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-mute)', marginTop: 4 }}>
          Your support agent at a glance
        </p>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {stats.map((stat) => (
          <div key={stat.label} style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            padding: '18px 20px',
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: `color-mix(in oklab, ${stat.accent} 15%, transparent)`,
              border: `1px solid color-mix(in oklab, ${stat.accent} 25%, transparent)`,
              display: 'grid', placeItems: 'center',
              marginBottom: 12,
              color: stat.accent,
            }}>
              <stat.icon size={16} />
            </div>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>{stat.value}</p>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Get started */}
      <div style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '24px',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 16 }}>
          Get started
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <GetStartedStep number={1} title="Configure your agent" description="Give your agent a name, avatar, and personality." href="/dashboard/agent" done={false} />
          <GetStartedStep number={2} title="Add your knowledge base" description="Paste your website URL or upload documents." href="/dashboard/knowledge" done={false} />
          <GetStartedStep number={3} title="Deploy the widget" description="Copy a script tag and paste it into your website." href="/dashboard/channels" done={false} />
        </div>
      </div>
    </div>
  )
}
