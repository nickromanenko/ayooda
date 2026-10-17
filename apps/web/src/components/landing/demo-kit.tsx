import type { ReactNode } from 'react'
import { LayoutGrid, MessageSquare, Sparkles, Bot, Activity, CreditCard, Users, Settings, Search, Bell, Check } from 'lucide-react'
import { AyoodaMark } from '@/components/brand/AyoodaMark'
import s from './ProductDemo.module.css'

// ─── Timeline helpers ─────────────────────────────────────────────────────────

export const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n))
/** 0 → 1 progress of `t` between `a` and `b` milliseconds. */
export const prog = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
/** Typewriter: the part of `text` revealed at time `t`, starting at `a`. */
export const typed = (text: string, t: number, a: number, cps = 60) =>
  text.slice(0, Math.max(0, Math.floor(((t - a) / 1000) * cps)))
export const count = (to: number, t: number, a: number, b: number) => Math.round(to * easeOut(prog(t, a, b)))
export const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)

// ─── App shell ────────────────────────────────────────────────────────────────

export type NavKey = 'overview' | 'inbox' | 'copilot' | 'agents'

const NAV: Array<{ key: NavKey; label: string; Icon: typeof LayoutGrid }> = [
  { key: 'overview', label: 'Overview', Icon: LayoutGrid },
  { key: 'inbox', label: 'Inbox', Icon: MessageSquare },
  { key: 'copilot', label: 'Copilot', Icon: Sparkles },
  { key: 'agents', label: 'Agents', Icon: Bot },
]

const WORKSPACE = [
  { label: 'Channel health', Icon: Activity },
  { label: 'Billing', Icon: CreditCard },
  { label: 'Team', Icon: Users },
  { label: 'Settings', Icon: Settings },
]

export function AppShell({ nav, badge, address, children }: { nav: NavKey; badge?: number; address: string; children: ReactNode }) {
  return (
    <div className={s.window}>
      <div className={s.chrome} aria-hidden="true">
        <span className={s.dots}><i /><i /><i /></span>
        <span className={s.address}>{address}</span>
        <span className={s.chromeNote}>Representative workflow</span>
      </div>
      <div className={s.app}>
        <aside className={s.sidebar} aria-hidden="true">
          <div className={s.brand}><AyoodaMark size={16} /> Ayooda</div>
          <div className={s.searchRow}><Search size={13} /> Search <kbd>⌘K</kbd></div>
          <div className={s.attention}><Bell size={13} /> Needs attention</div>
          <nav className={s.nav}>
            {NAV.map(({ key, label, Icon }) => (
              <div key={key} className={s.navItem} data-active={nav === key}>
                <Icon size={14} /> {label}
                {key === 'inbox' && badge ? <span key={badge} className={s.navBadge}>{badge}</span> : null}
              </div>
            ))}
          </nav>
          <div className={s.sideLabel}>Workspace</div>
          <nav className={s.nav}>
            {WORKSPACE.map(({ label, Icon }) => (
              <div key={label} className={s.navItem}><Icon size={14} /> {label}</div>
            ))}
          </nav>
        </aside>
        <div className={s.main}>{children}</div>
      </div>
    </div>
  )
}

// ─── Inbox primitives ─────────────────────────────────────────────────────────

export type ConvItem = { id: string; name: string; time: string; preview: string; tag: string; unread?: boolean; active?: boolean; flag?: 'escalated' }

export function InboxFrame({ items, name, status, pill, thread, rail }: {
  items: ConvItem[]
  name: string
  status: string
  pill?: { label: string; tone: 'lime' | 'green' | 'red' | 'neutral' }
  thread: ReactNode
  rail: ReactNode
}) {
  return (
    <div className={s.inbox}>
      <div className={s.list}>
        <div className={s.listHead}><b>Inbox</b><span>{items.length + 5} conversations</span></div>
        <div className={s.chips} aria-hidden="true">
          {['All', 'Unread', 'Mine', 'Waiting', 'Bot'].map((c, i) => <span key={c} data-on={i === 0}>{c}</span>)}
        </div>
        <div className={s.rows}>
          {items.map((it) => (
            <div key={it.id} className={s.row} data-active={it.active} data-flag={it.flag}>
              <div className={s.rowTop}>
                <span className={s.rowName}>{it.unread && <i className={s.unread} />}{it.name}</span>
                <span className={s.rowTime}>{it.time}</span>
              </div>
              <div className={s.rowPrev}>{it.preview}</div>
              <div className={s.rowTags}><em data-flag={it.flag}>{it.tag}</em><em>Kim</em></div>
            </div>
          ))}
        </div>
      </div>
      <div className={s.thread}>
        <div className={s.threadHead}>
          <div><b>{name}</b><span>{status}</span></div>
          {pill && <span key={pill.label} className={s.pill} data-tone={pill.tone}>{pill.label}</span>}
        </div>
        <div className={s.messages}>{thread}</div>
        <div className={s.composer} aria-hidden="true">Reply to customer…</div>
      </div>
      <aside className={s.rail}>{rail}</aside>
    </div>
  )
}

export function Msg({ who, name, children }: { who: 'user' | 'agent' | 'human'; name?: string; children: ReactNode }) {
  if (who === 'user') return <div className={s.msgUser}><span>{children}</span></div>
  return (
    <div className={s.msgAgent}>
      <span className={s.avatar} data-who={who}>{who === 'human' ? 'M' : <AyoodaMark size={12} />}</span>
      <div className={s.bubble} data-who={who}>
        {name && <div className={s.bubbleName}>{name}</div>}
        {children}
      </div>
    </div>
  )
}

export function Typing() {
  return <div className={s.msgAgent}><span className={s.avatar}><AyoodaMark size={12} /></span><div className={s.bubble}><span className={s.typing}><i /><i /><i /></span></div></div>
}

export function StatusIcon({ done }: { done: boolean }) {
  return done ? <span className={s.tick}><Check size={11} strokeWidth={3} /></span> : <span className={s.spin} />
}

export function ToolCall({ name, args, done, result }: { name: string; args: string; done: boolean; result?: string }) {
  return (
    <div className={s.tool} data-done={done}>
      <StatusIcon done={done} />
      <code>{name}<span>({args})</span></code>
      {done && result && <span className={s.toolResult}>{result}</span>}
    </div>
  )
}

export function SourceChip({ children }: { children: ReactNode }) {
  return <span className={s.source}>{children}</span>
}

// ─── Rail primitives ──────────────────────────────────────────────────────────

export function RailTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return <div className={s.railTitle}><b>{children}</b>{sub && <span>{sub}</span>}</div>
}

export function RailStep({ done, title, sub, children }: { done: boolean; title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className={s.step}>
      <StatusIcon done={done} />
      <div className={s.stepBody}>
        <div className={s.stepTitle}>{title}</div>
        {sub && <div className={s.stepSub}>{sub}</div>}
        {children}
      </div>
    </div>
  )
}

export function Meter({ value, tone, label }: { value: number; tone: 'lime' | 'red'; label: string }) {
  return (
    <div className={s.meter} data-tone={tone}>
      <div className={s.meterTop}><span>Confidence</span><b>{value}%</b></div>
      <div className={s.meterTrack}><i style={{ width: `${value}%` }} /></div>
      <div className={s.meterLabel}>{label}</div>
    </div>
  )
}

export function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className={s.score}>
      <span>{label}</span>
      <div className={s.scoreTrack}><i style={{ width: `${value * 100}%` }} /></div>
      <b>{value.toFixed(2)}</b>
    </div>
  )
}
