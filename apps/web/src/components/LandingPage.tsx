'use client'

import { useState, useEffect, useRef, useMemo, CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { SiShopify, SiStripe, SiHubspot, SiNotion, SiZendesk, SiLinear, SiIntercom, SiZapier } from 'react-icons/si'
import { Sparkles, Zap, Rocket } from 'lucide-react'

// ─── Reveal ───────────────────────────────────────────────────────────────────

function useInView(threshold = 0.12) {
  const ref = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect() } },
      { threshold }
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [threshold])
  return [ref, inView] as const
}

function Reveal({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: CSSProperties }) {
  const [ref, inView] = useInView()
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={`reveal ${inView ? 'in' : ''}`}
      style={{ transitionDelay: `${delay}ms`, ...style }}
    >
      {children}
    </div>
  )
}

// ─── Logo ─────────────────────────────────────────────────────────────────────

function Logo({ size = 22 }: { size?: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="4" fill="var(--accent)" />
        <path d="M2.5 12h6M15.5 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 18 }}>Ayooda</span>
    </div>
  )
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const links = [
    ['Why', '#why'],
    ['Features', '#features'],
    ['How it works', '#how'],
    ['Pricing', '#pricing'],
    ['FAQ', '#faq'],
  ]

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
      padding: '14px 0',
      background: scrolled ? 'color-mix(in oklab, var(--bg) 82%, transparent)' : 'transparent',
      backdropFilter: scrolled ? 'blur(14px) saturate(130%)' : 'none',
      WebkitBackdropFilter: scrolled ? 'blur(14px) saturate(130%)' : 'none',
      borderBottom: scrolled ? '1px solid var(--line)' : '1px solid transparent',
      transition: 'background .3s ease, border-color .3s ease',
    }}>
      <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <a href="#top"><Logo /></a>
        <nav style={{ display: 'flex', gap: 22, marginLeft: 16 }}>
          {links.map(([label, href]) => (
            <a key={href} href={href} style={{ fontSize: 13.5, color: 'var(--ink-dim)', fontWeight: 450, transition: 'color .15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-dim)')}
            >{label}</a>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/login" className="btn btn-ghost" style={{ padding: '9px 14px', fontSize: 13 }}>Sign in</Link>
          <Link href="/signup" className="btn btn-primary" style={{ padding: '9px 14px', fontSize: 13 }}>Start free →</Link>
        </div>
      </div>
    </header>
  )
}

// ─── Chat demo ────────────────────────────────────────────────────────────────

type ChatMsg = { who: 'user' | 'ayooda' | 'tool'; text: string; delay: number; typing?: number }

function ChatBubble({ m }: { m: ChatMsg }) {
  const isUser = m.who === 'user'
  const isTool = m.who === 'tool'
  if (isTool) {
    return (
      <div style={{
        alignSelf: 'flex-start',
        fontFamily: 'var(--font-mono)', fontSize: 11.5,
        color: 'var(--ink-mute)',
        background: 'var(--bg-2)',
        border: '1px dashed var(--line-2)',
        padding: '6px 10px', borderRadius: 8,
        animation: 'fade-up .4s ease',
      }}>{m.text}</div>
    )
  }
  return (
    <div style={{
      alignSelf: isUser ? 'flex-end' : 'flex-start',
      maxWidth: '76%', display: 'flex', gap: 10,
      flexDirection: isUser ? 'row-reverse' : 'row',
      animation: 'fade-up .4s ease',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 50, flexShrink: 0,
        background: isUser ? 'var(--panel-2)' : 'var(--accent)',
        display: 'grid', placeItems: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
        color: isUser ? 'var(--ink-dim)' : '#1a0e08',
        border: '1px solid var(--line)',
      }}>{isUser ? 'M' : 'A'}</div>
      <div style={{
        background: isUser ? 'var(--panel-2)' : 'var(--bg-2)',
        border: '1px solid var(--line)',
        padding: '10px 14px', borderRadius: 14,
        borderTopLeftRadius: isUser ? 14 : 4,
        borderTopRightRadius: isUser ? 4 : 14,
        fontSize: 14.5, lineHeight: 1.5, color: 'var(--ink)',
      }}>{m.text}</div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 10, alignItems: 'center' }}>
      <div style={{
        width: 28, height: 28, borderRadius: 50,
        background: 'var(--accent)', display: 'grid', placeItems: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: '#1a0e08',
      }}>A</div>
      <div style={{
        padding: '12px 14px', borderRadius: 14, background: 'var(--bg-2)',
        border: '1px solid var(--line)', display: 'flex', gap: 5,
      }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: 50, background: 'var(--ink-mute)',
            animation: `typing-dot 1.1s ${i * 0.15}s infinite ease-in-out`,
            display: 'inline-block',
          }} />
        ))}
      </div>
    </div>
  )
}

function ChatDemo() {
  const script = useMemo<ChatMsg[]>(() => [
    { who: 'user', text: "My order #4421 hasn't shipped yet — it's been 5 days.", delay: 900 },
    { who: 'ayooda', typing: 1200, text: "Let me check that for you right now.", delay: 600 },
    { who: 'tool', text: "→ orders.lookup(id: 4421)", delay: 900 },
    { who: 'ayooda', typing: 1400, text: "Your order was held for address verification. I've confirmed the address on file and released it — it ships today via DHL Express, ETA Wed Apr 22.", delay: 400 },
    { who: 'user', text: "Oh! Can you also update the delivery address?", delay: 700 },
    { who: 'ayooda', typing: 1100, text: "Of course. What's the new address?", delay: 400 },
  ], [])

  const [step, setStep] = useState(0)
  const [typing, setTyping] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []

    let elapsed = 0
    let idx = 0
    const queue = () => {
      if (idx >= script.length) {
        timers.current.push(setTimeout(() => { setStep(0); idx = 0; elapsed = 0; queue() }, 3500))
        return
      }
      const item = script[idx]
      if (item.typing) {
        timers.current.push(setTimeout(() => setTyping(true), elapsed + item.delay))
        timers.current.push(setTimeout(() => { setTyping(false); setStep(idx + 1) }, elapsed + item.delay + item.typing))
        elapsed += item.delay + item.typing + 300
      } else {
        timers.current.push(setTimeout(() => setStep(idx + 1), elapsed + item.delay))
        elapsed += item.delay + 600
      }
      idx++
      queue()
    }
    queue()
    return () => timers.current.forEach(clearTimeout)
  }, [script])

  const visible = script.slice(0, step)

  return (
    <div style={{
      margin: '0 auto', maxWidth: 860,
      padding: 14, borderRadius: 28,
      background: 'linear-gradient(180deg, color-mix(in oklab, var(--panel) 90%, transparent), var(--panel))',
      border: '1px solid var(--line)',
      boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px 10px', borderBottom: '1px solid var(--line)', marginBottom: 12,
      }}>
        <span style={{ width: 10, height: 10, borderRadius: 50, background: '#ff6057', display: 'inline-block' }} />
        <span style={{ width: 10, height: 10, borderRadius: 50, background: '#ffbd2e', display: 'inline-block' }} />
        <span style={{ width: 10, height: 10, borderRadius: 50, background: '#27c93f', display: 'inline-block' }} />
        <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
          live · ayooda agent · resolution time 00:04.1
        </div>
      </div>

      <div style={{ height: 360, padding: '8px 14px 18px', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden', justifyContent: 'flex-end' }}>
        {visible.map((m, i) => <ChatBubble key={i} m={m} />)}
        {typing && <TypingIndicator />}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', margin: '0 6px 6px',
        borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--line)',
      }}>
        <div style={{ fontSize: 13, color: 'var(--ink-faint)' }}>Type a message…</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--panel-2)', display: 'grid', placeItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="var(--ink-mute)" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </div>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l5-5 5 5M7 2v11" stroke="#1a0e08" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section id="top" style={{ position: 'relative', paddingTop: 140, paddingBottom: 80, overflow: 'hidden' }}>
      <div aria-hidden style={{
        position: 'absolute', top: -200, left: '50%', transform: 'translateX(-50%)',
        width: 1100, height: 1100, borderRadius: '50%',
        background: 'radial-gradient(closest-side, var(--accent-soft), transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div aria-hidden className="grid-bg" style={{
        position: 'absolute', inset: 0,
        maskImage: 'radial-gradient(ellipse 70% 50% at 50% 30%, #000 40%, transparent 90%)',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 50% at 50% 30%, #000 40%, transparent 90%)',
        opacity: 0.6, pointerEvents: 'none',
      }} />

      <div className="container" style={{ position: 'relative' }}>
        <Reveal>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div className="pill">
              <span className="dot" /> New — Model Context Protocol support
            </div>
          </div>
        </Reveal>

        <h1 className="display" style={{
          fontSize: 'clamp(34px, 5.4vw, 72px)',
          margin: '28px 0 22px', textAlign: 'center',
          maxWidth: 1000, marginInline: 'auto', textWrap: 'balance' as CSSProperties['textWrap'],
        }}>
          <Reveal style={{ display: 'block' }}>
            Resolve <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>up&nbsp;to&nbsp;60%</em> of
          </Reveal>
          <Reveal delay={120} style={{ display: 'block' }}>
            your support tickets.
          </Reveal>
        </h1>

        <Reveal delay={220}>
          <p style={{
            textAlign: 'center', fontSize: 19, color: 'var(--ink-dim)',
            maxWidth: 620, margin: '0 auto 34px',
            lineHeight: 1.5, textWrap: 'pretty' as CSSProperties['textWrap'],
          }}>
            Ayooda takes the repetitive volume off your queue, so your team stops
            firefighting and gets back to delivering real, human support.
          </p>
        </Reveal>

        <Reveal delay={340}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <Link href="/signup" className="btn btn-primary">Start free trial</Link>
            <button className="btn btn-ghost">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 1l9 5-9 5V1z" fill="currentColor" /></svg>
              Watch 90-sec demo
            </button>
          </div>
        </Reveal>

        <Reveal delay={440}>
          <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
            14-DAY FREE TRIAL · NO CARD REQUIRED
          </p>
        </Reveal>

        <Reveal delay={560}>
          <div style={{ marginTop: 60 }}>
            <ChatDemo />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ─── Logo Strip ───────────────────────────────────────────────────────────────

function LogoStrip() {
  const companies = ['Northwind', 'Kestrel', 'Arcadia', 'Fieldnote', 'Quillbox', 'Portola', 'Modulo', 'Sagebrush']
  return (
    <section style={{ padding: '40px 0 80px' }}>
      <div className="container">
        <p style={{
          textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-faint)',
          marginBottom: 28,
        }}>
          Trusted by modern support teams at 10,000+ companies
        </p>
        {/* logo grid hidden until real logos are ready */}
      </div>
    </section>
  )
}

// ─── Why ──────────────────────────────────────────────────────────────────────

function Glyph({ kind }: { kind: string }) {
  const s = { width: 40, height: 40, viewBox: '0 0 40 40', fill: 'none' as const }
  const k = 'var(--ink)'
  return (
    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-soft)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center' }}>
      {kind === 'world' && <svg {...s}><circle cx="20" cy="20" r="12" stroke={k} strokeWidth="1.4" /><ellipse cx="20" cy="20" rx="5" ry="12" stroke={k} strokeWidth="1.4" /><path d="M8 20h24" stroke={k} strokeWidth="1.4" /></svg>}
      {kind === 'long' && <svg {...s}><rect x="8" y="14" width="24" height="12" rx="2" stroke={k} strokeWidth="1.4" /><path d="M12 14v-3M20 14v-3M28 14v-3M12 29v-3M20 29v-3M28 29v-3" stroke={k} strokeWidth="1.4" strokeLinecap="round" /></svg>}
      {kind === 'eye' && <svg {...s}><path d="M6 20c3-6 8-9 14-9s11 3 14 9c-3 6-8 9-14 9S9 26 6 20z" stroke={k} strokeWidth="1.4" /><circle cx="20" cy="20" r="3.5" fill="var(--accent)" /></svg>}
      {kind === 'root' && <svg {...s}><path d="M20 6v14M20 20l-8 8M20 20l8 8M20 20l-10-2M20 20l10-2" stroke={k} strokeWidth="1.4" strokeLinecap="round" /><circle cx="20" cy="20" r="2.5" fill="var(--accent)" /></svg>}
      {kind === 'balance' && <svg {...s}><circle cx="13" cy="20" r="6" stroke={k} strokeWidth="1.4" /><circle cx="27" cy="20" r="6" stroke={k} strokeWidth="1.4" strokeDasharray="2 2" /><path d="M7 20h12" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" /></svg>}
    </div>
  )
}

function PillarCard({ title, body, glyph }: { title: string; body: string; glyph: string }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        padding: '22px 24px', borderRadius: 'var(--r-lg)', border: '1px solid var(--line)',
        background: hover ? 'var(--panel)' : 'transparent',
        transition: 'background .25s ease, transform .25s ease',
        transform: hover ? 'translateY(-2px)' : 'none',
        display: 'grid', gridTemplateColumns: '48px 1fr', gap: 18, alignItems: 'start',
      }}
    >
      <Glyph kind={glyph} />
      <div>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em', fontFamily: 'var(--font-display)' }}>{title}</h3>
        <p style={{ margin: '8px 0 0', color: 'var(--ink-dim)', fontSize: 15, lineHeight: 1.55, textWrap: 'pretty' as CSSProperties['textWrap'] }}>{body}</p>
      </div>
    </div>
  )
}

function Why() {
  const pillars = [
    { title: 'Built for the real world.', body: "AI doesn’t live in sandboxes. Ayooda handles messy, real customer conversations, with real data behind them, and doesn’t flinch when things get complicated.", glyph: 'world' },
    { title: 'Engineered for the long run.', body: 'Not a trend. Ayooda is modular, fast, and architected to evolve alongside your support stack for the next decade.', glyph: 'long' },
    { title: 'Transparent by design.', body: 'Every decision, route, and retrieval is visible and editable. You always know what your agent is doing — and why.', glyph: 'eye' },
    { title: 'Grounded in your truth.', body: 'Every answer comes from your data — docs, helpdesk, CRM, product. No hallucinations. No guesses.', glyph: 'root' },
    { title: 'Autonomy with accountability.', body: 'Ayooda resolves routine tickets end-to-end and knows when to loop in a human, with full context attached.', glyph: 'balance' },
  ]
  return (
    <section id="why" style={{ padding: '100px 0', background: 'var(--bg-2)' }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 80, alignItems: 'start' }}>
          <div style={{ position: 'sticky', top: 120 }}>
            <Reveal>
              <div className="eyebrow" style={{ marginBottom: 18 }}>
                <span style={{ color: 'var(--accent)' }}>◆</span>{'  '}Why Ayooda
              </div>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="display" style={{ fontSize: 'clamp(40px, 4.2vw, 58px)', margin: 0, textWrap: 'balance' as CSSProperties['textWrap'] }}>
                An agent you can actually <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>trust</em> in production.
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <p style={{ color: 'var(--ink-dim)', marginTop: 22, fontSize: 16, lineHeight: 1.55, maxWidth: 380 }}>
                Five principles we won't compromise on — because shipping an AI to your customers is a serious thing.
              </p>
            </Reveal>
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            {pillars.map((p, i) => (
              <Reveal key={p.title} delay={i * 70}>
                <PillarCard {...p} />
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Solutions Band ───────────────────────────────────────────────────────────

function BadgeShield({ kind }: { kind: string }) {
  const labels: Record<string, string> = { security: 'SEC', gdpr: 'GDPR', eu: 'EU' }
  return (
    <div style={{
      width: 44, height: 48,
      background: 'linear-gradient(180deg, var(--accent), color-mix(in oklab, var(--accent) 60%, #000))',
      clipPath: 'polygon(50% 0, 100% 18%, 100% 72%, 50% 100%, 0 72%, 0 18%)',
      display: 'grid', placeItems: 'center', flexShrink: 0,
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: '#1a0e08', letterSpacing: '0.08em' }}>
        {labels[kind]}
      </span>
    </div>
  )
}

function TrustBadge({ badge, h, b }: { badge: string; h: string; b: string }) {
  return (
    <div style={{
      display: 'flex', gap: 16, alignItems: 'flex-start',
      padding: '20px 22px', borderRadius: 'var(--r-lg)',
      border: '1px solid var(--line)',
      background: 'linear-gradient(180deg, var(--panel), transparent)',
    }}>
      <BadgeShield kind={badge} />
      <div>
        <h4 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{h}</h4>
        <p style={{ margin: '6px 0 0', color: 'var(--ink-mute)', fontSize: 13.5, lineHeight: 1.5 }}>{b}</p>
      </div>
    </div>
  )
}

function SolutionsBand() {
  const cards = [
    { h: 'Multi-turn context.', b: 'Unlike scripted bots, Ayooda threads conversations across sessions — remembers your customer, the product, and the past ticket.' },
    { h: 'Deep integrations.', b: 'Connects to your CRM, helpdesk, docs, and product data — live, not cached.' },
    { h: 'Smart escalation.', b: 'Knows its limits. Routes to the right human with a compact summary of context.' },
  ]
  const trust = [
    { badge: 'security', h: 'Security at the core.', b: 'Enterprise-grade encryption, scoped API keys, SSO, and strict access control by default.' },
    { badge: 'gdpr', h: 'GDPR-compliant.', b: "Built to meet Europe's strictest privacy standards — full audit trail and transparent data handling." },
    { badge: 'eu', h: 'Europe-hosted.', b: 'All data stored and processed on EU servers. No data leaves the region without your explicit consent.' },
  ]
  return (
    <section style={{ padding: '100px 0' }}>
      <div className="container">
        <Reveal>
          <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 72px)', margin: 0, textAlign: 'center', textWrap: 'balance' as CSSProperties['textWrap'] }}>
            One agent. Ten channels.<br />
            <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>A thousand possibilities.</em>
          </h2>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 56 }}>
          {cards.map((c, i) => (
            <Reveal key={c.h} delay={i * 80}>
              <div className="card" style={{ padding: '26px 24px', height: '100%' }}>
                <h3 style={{ margin: 0, fontSize: 22, fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.01em' }}>{c.h}</h3>
                <p style={{ margin: '12px 0 0', color: 'var(--ink-dim)', fontSize: 15, lineHeight: 1.55, textWrap: 'pretty' as CSSProperties['textWrap'] }}>{c.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 48 }}>
          {trust.map((b, i) => (
            <Reveal key={b.h} delay={i * 80}>
              <TrustBadge {...b} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Features ─────────────────────────────────────────────────────────────────

function FeatureMock({ kind }: { kind: string }) {
  const wrap: CSSProperties = {
    borderRadius: 'var(--r-lg)', border: '1px solid var(--line)',
    background: 'linear-gradient(180deg, var(--panel), var(--bg-2))',
    padding: 26, height: 380, position: 'relative', overflow: 'hidden',
    boxShadow: 'var(--shadow-card)',
  }

  if (kind === 'integrate') {
    const tools = [
      { name: 'Shopify', Icon: SiShopify, color: '#95BF47' },
      { name: 'Stripe', Icon: SiStripe, color: '#635BFF' },
      { name: 'HubSpot', Icon: SiHubspot, color: '#FF7A59' },
      { name: 'Notion', Icon: SiNotion, color: '#f4f4f0' },
      { name: 'Zendesk', Icon: SiZendesk, color: '#f4f4f0' },
      { name: 'Linear', Icon: SiLinear, color: '#9CA3F0' },
      { name: 'Intercom', Icon: SiIntercom, color: '#3B82F6' },
      { name: 'Zapier', Icon: SiZapier, color: '#FF4F00' },
    ]
    return (
      <div style={wrap}>
        <div className="pill" style={{ marginBottom: 18 }}><span className="dot" />MCP connections · live</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {tools.map(({ name, Icon, color }, i) => (
            <div key={name} style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--bg-2)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10, animation: `fade-up .5s ${i * 0.06}s backwards ease` }}>
              <Icon size={20} color={color} style={{ flexShrink: 0 }} />{name}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 24, padding: 14, background: 'var(--bg)', borderRadius: 12, border: '1px dashed var(--line-2)', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          <div><span style={{ color: 'var(--accent)' }}>→</span> shopify.orders.refund(id: 8821, amount: 24.99)</div>
          <div><span style={{ color: 'var(--accent)' }}>→</span> stripe.customer.update(email: new@addr.com)</div>
          <div style={{ color: 'var(--mint)' }}>✓ refunded · customer notified · ticket closed (4.1s)</div>
        </div>
      </div>
    )
  }

  if (kind === 'activate') {
    return (
      <div style={wrap}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {["Describe your agent's role", 'Upload your knowledge', 'Set a tone of voice', 'Go live'].map((s, i) => (
            <div key={s} style={{ padding: '16px 18px', borderRadius: 12, border: '1px solid var(--line)', background: i <= 2 ? 'var(--panel)' : 'transparent', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 26, height: 26, borderRadius: 50, background: i <= 2 ? 'var(--accent)' : 'transparent', border: i <= 2 ? 'none' : '1px dashed var(--line-2)', color: '#1a0e08', fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{i <= 2 ? '✓' : i + 1}</span>
              <span style={{ fontSize: 15, color: i <= 2 ? 'var(--ink)' : 'var(--ink-mute)' }}>{s}</span>
              {i === 2 && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>in progress…</span>}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'configure') {
    const models = [
      { n: 'Claude Sonnet 4.5', a: 'Anthropic', active: true },
      { n: 'GPT-5', a: 'OpenAI', active: false },
      { n: 'Llama 3.3 70B', a: 'Meta · self-hosted', active: false },
      { n: 'Custom endpoint', a: 'your.company.internal', active: false },
    ]
    return (
      <div style={wrap}>
        <div className="pill" style={{ marginBottom: 14 }}>Brain · swap any time</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {models.map(m => (
            <div key={m.n} style={{ padding: '14px 16px', borderRadius: 12, border: `1px solid ${m.active ? 'var(--accent)' : 'var(--line)'}`, background: m.active ? 'var(--accent-soft)' : 'var(--bg-2)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 50, background: m.active ? 'var(--accent)' : 'var(--ink-faint)', display: 'inline-block' }} />
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 500 }}>{m.n}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{m.a}</div>
              </div>
              {m.active && <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>ACTIVE</span>}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'workflow') {
    const nodes = [
      { x: 40, y: 130, w: 120, h: 44, label: 'Incoming ticket', color: 'var(--panel)' },
      { x: 220, y: 80, w: 120, h: 44, label: 'Classify intent', color: 'var(--accent-soft)' },
      { x: 220, y: 180, w: 120, h: 44, label: 'Check SLA', color: 'var(--accent-soft)' },
      { x: 400, y: 50, w: 150, h: 44, label: 'Auto-resolve', color: 'var(--panel)' },
      { x: 400, y: 130, w: 150, h: 44, label: 'Ask for context', color: 'var(--panel)' },
      { x: 400, y: 210, w: 150, h: 44, label: 'Escalate to tier 2', color: 'var(--panel)' },
    ]
    const edges = [
      ['160,152', '220,102'], ['160,152', '220,202'],
      ['340,102', '400,72'], ['340,102', '400,152'], ['340,202', '400,232'],
    ]
    return (
      <div style={wrap}>
        <svg viewBox="0 0 600 300" style={{ width: '100%', height: '100%' }}>
          <defs>
            <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0 0L6 4L0 8z" fill="var(--ink-mute)" />
            </marker>
          </defs>
          {nodes.map((n, i) => (
            <g key={i}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="8" fill={n.color} stroke="var(--line-2)" />
              <text x={n.x + n.w / 2} y={n.y + n.h / 2 + 4} textAnchor="middle" fontSize="12" fill="var(--ink)" fontFamily="var(--font-sans)">{n.label}</text>
            </g>
          ))}
          {edges.map((p, i) => {
            const [ax, ay] = p[0].split(',')
            const [bx, by] = p[1].split(',')
            return <line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--ink-mute)" strokeWidth="1.4" markerEnd="url(#arr)" />
          })}
        </svg>
      </div>
    )
  }

  if (kind === 'analytics') {
    const bars = [34, 52, 41, 68, 74, 62, 81, 77, 89, 82, 94, 88]
    return (
      <div style={wrap}>
        <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
          {[['58%', 'auto-resolved'], ['4.7', 'CSAT / 5'], ['1.8s', 'first reply'], ['+12%', 'wk/wk']].map(([v, l]) => (
            <div key={l}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, letterSpacing: '-0.02em' }}>{v}</div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{l}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 180, padding: '16px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
          {bars.map((b, i) => (
            <div key={i} style={{ flex: 1, height: `${b}%`, background: 'linear-gradient(0deg, var(--accent), var(--accent-2))', borderRadius: 4, opacity: 0.85, animation: `fade-up .7s ${i * 0.05}s backwards ease` }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)', marginTop: 6 }}>
          <span>Jan</span><span>Mar</span><span>May</span><span>Jul</span><span>Sep</span><span>Nov</span>
        </div>
      </div>
    )
  }

  if (kind === 'train') {
    const rows = [
      { t: 'Help Center — refund policy', s: 'synced 2m ago', ok: true },
      { t: 'Notion — product brief v12', s: 'synced 14m ago', ok: true },
      { t: 'Zendesk macros', s: 'syncing now…', ok: null },
      { t: 'Intercom articles', s: 'synced 1h ago', ok: true },
      { t: 'Internal runbook (PDF)', s: 'synced 6h ago', ok: true },
    ]
    return (
      <div style={wrap}>
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 14, alignItems: 'center', padding: '14px 16px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 50, background: row.ok === null ? 'var(--accent)' : 'var(--mint)', animation: row.ok === null ? 'pulse-ring 1.4s infinite' : 'none', display: 'inline-block' }} />
              <span style={{ fontSize: 14 }}>{row.t}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{row.s}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return null
}

function Features() {
  const tabs = [
    { key: 'integrate', label: 'Integrate', h: 'Resolve complex tickets with real context.', b: 'Ayooda connects to your tools through the Model Context Protocol — live data, live actions, real resolutions, not just redirections.' },
    { key: 'activate', label: 'Activate', h: 'Launch AI support without writing code.', b: 'Anyone on your team can train and deploy Ayooda in minutes. No developers, no long onboarding, no surprises.' },
    { key: 'configure', label: 'Configure', h: 'Pick the brain that fits your business.', b: 'Claude, GPT, Llama, or your own model — Ayooda swaps backends instantly. You stay in control of data, tone, and spend.' },
    { key: 'workflow', label: 'Workflows', h: 'Design complex automations, visually.', b: 'Drag-and-drop flows to model triage, escalation, and routing logic. Every branch is auditable and testable.' },
    { key: 'analytics', label: 'Analytics', h: 'Learn from every single conversation.', b: 'Resolution rate, CSAT, hand-off causes, confidence trends — all in real time, all exportable.' },
    { key: 'train', label: 'Train', h: 'Your knowledge, always up to date.', b: 'Ayooda auto-syncs with helpdesk articles, docs, and product changes — no more stale answers.' },
  ]
  const [active, setActive] = useState(0)
  const tab = tabs[active]

  return (
    <section id="features" style={{ padding: '100px 0' }}>
      <div className="container">
        <Reveal>
          <div className="eyebrow" style={{ marginBottom: 18 }}><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}Features</div>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 68px)', margin: 0, maxWidth: 820, textWrap: 'balance' as CSSProperties['textWrap'] }}>
            Everything you need. <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Nothing you don't.</em>
          </h2>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 48, marginTop: 56 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderLeft: '1px solid var(--line)' }}>
            {tabs.map((t, i) => (
              <button key={t.key} onClick={() => setActive(i)} style={{
                appearance: 'none', background: 'none', border: 'none',
                textAlign: 'left', cursor: 'pointer',
                padding: '16px 20px',
                color: i === active ? 'var(--ink)' : 'var(--ink-mute)',
                fontSize: 16, fontWeight: i === active ? 500 : 400,
                borderLeft: `2px solid ${i === active ? 'var(--accent)' : 'transparent'}`,
                marginLeft: -1,
                transition: 'all .2s',
                fontFamily: 'var(--font-sans)',
              }}>{t.label}</button>
            ))}
          </div>
          <div style={{ minHeight: 520 }}>
            <div key={tab.key} style={{ animation: 'fade-up .5s ease' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, maxWidth: 620, textWrap: 'balance' as CSSProperties['textWrap'] }}>
                {tab.h}
              </h3>
              <p style={{ color: 'var(--ink-dim)', fontSize: 16, lineHeight: 1.6, margin: '14px 0 26px', maxWidth: 560, textWrap: 'pretty' as CSSProperties['textWrap'] }}>{tab.b}</p>
              <FeatureMock kind={tab.key} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── How It Works ─────────────────────────────────────────────────────────────

function StepIllustration({ idx }: { idx: number }) {
  const size: CSSProperties = { width: '100%', height: 110 }
  if (idx === 0) return (
    <div style={{ ...size, display: 'flex', alignItems: 'flex-end', gap: 6, padding: 8, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--line)' }}>
      {['PDF', 'DOC', 'MD', 'CSV', 'URL'].map((t, i) => (
        <div key={t} style={{ flex: 1, height: `${40 + i * 14}%`, background: i % 2 ? 'var(--accent)' : 'var(--accent-2)', opacity: 0.8 + i * 0.04, borderRadius: 6, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, color: '#1a0e08', fontWeight: 700 }}>{t}</div>
      ))}
    </div>
  )
  if (idx === 1) return (
    <div style={{ ...size, padding: 10, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
      {[['Tone', 70], ['Caution', 40], ['Verbosity', 55]].map(([l, v]) => (
        <div key={l as string} style={{ display: 'grid', gridTemplateColumns: '62px 1fr', gap: 10, alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-mute)' }}>{l}</span>
          <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, width: `${v}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
            <div style={{ position: 'absolute', left: `calc(${v}% - 6px)`, top: -5, width: 14, height: 14, borderRadius: 50, background: 'var(--ink)', border: '3px solid var(--accent)' }} />
          </div>
        </div>
      ))}
    </div>
  )
  if (idx === 2) return (
    <div style={{ ...size, padding: 10, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)' }}>
      <div>▶ running test suite…</div>
      <div style={{ color: 'var(--mint)' }}>✓ 23 / 24 conversations resolved</div>
      <div style={{ color: 'var(--accent)' }}>⚠ 1 escalated (low confidence)</div>
      <div style={{ marginTop: 'auto', color: 'var(--ink-faint)' }}>avg. 1.8s first reply</div>
    </div>
  )
  return (
    <div style={{ ...size, padding: 10, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <div style={{ width: 56, height: 56, borderRadius: 50, background: 'var(--accent)', display: 'grid', placeItems: 'center', animation: 'pulse-ring 2s infinite', color: '#1a0e08', fontWeight: 700 }}>A</div>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 12, border: '1px dashed var(--line-2)', animation: 'orbit-rotate 20s linear infinite' }} />
    </div>
  )
}

function HowItWorks() {
  const steps = [
    { n: '01', h: 'Feed Ayooda your knowledge.', b: 'Upload docs, FAQs, helpdesk articles, PDFs — whatever you have. Ayooda ingests and indexes it in minutes.' },
    { n: '02', h: 'Make it yours.', b: 'Tune the tone of voice, set routing rules, and decide what Ayooda is allowed to do autonomously.' },
    { n: '03', h: 'Test before you ship.', b: 'Use the sandbox — real chat widget, fake traffic — to stress-test every flow before a single customer sees it.' },
    { n: '04', h: 'Let it run.', b: 'Watch Ayooda handle conversations in real time. Review, tweak, and keep improving.' },
  ]
  return (
    <section id="how" style={{ padding: '100px 0', background: 'var(--bg-2)' }}>
      <div className="container">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 56 }}>
          <Reveal><div className="eyebrow"><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}How it works</div></Reveal>
          <Reveal delay={80}>
            <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 64px)', margin: '18px 0 14px', maxWidth: 760, textWrap: 'balance' as CSSProperties['textWrap'] }}>
              Four steps. <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>From zero to live in an afternoon.</em>
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p style={{ color: 'var(--ink-dim)', fontSize: 17, maxWidth: 560, margin: 0 }}>
              No dev team. No deploy waterfalls. No consultant calls.
            </p>
          </Reveal>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 80}>
              <div style={{ padding: '26px 24px 30px', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--panel)', height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)', letterSpacing: '0.06em', marginBottom: 60 }}>
                  STEP {s.n}
                </div>
                <StepIllustration idx={i} />
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500, margin: '22px 0 10px', letterSpacing: '-0.01em' }}>{s.h}</h3>
                <p style={{ color: 'var(--ink-dim)', fontSize: 14.5, lineHeight: 1.55, margin: 0 }}>{s.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Integrations ─────────────────────────────────────────────────────────────

function OrbitRing({ radius, items, duration, reverse, size = 50, fontSize = 11, dashed }: {
  radius: number; items: string[]; duration: number; reverse?: boolean
  size?: number; fontSize?: number; dashed?: boolean
}) {
  return (
    <div style={{
      position: 'absolute',
      width: radius * 2, height: radius * 2,
      borderRadius: '50%',
      border: `1px ${dashed ? 'dashed' : 'solid'} var(--line)`,
      animation: `orbit-rotate ${duration}s linear infinite ${reverse ? 'reverse' : ''}`,
    }}>
      {items.map((it, i) => {
        const angle = (i / items.length) * Math.PI * 2
        const x = Math.cos(angle) * radius + radius
        const y = Math.sin(angle) * radius + radius
        return (
          <div key={it} style={{
            position: 'absolute', left: x - size / 2, top: y - size / 2,
            width: size, height: size, borderRadius: 50,
            background: 'var(--panel)', border: '1px solid var(--line-2)',
            display: 'grid', placeItems: 'center',
            fontSize, fontWeight: 500, color: 'var(--ink-dim)',
            animation: `orbit-rotate ${duration}s linear infinite ${reverse ? '' : 'reverse'}`,
            boxShadow: 'var(--shadow-soft)',
          }}>{it}</div>
        )
      })}
    </div>
  )
}

function Integrations() {
  return (
    <section id="integrations" style={{ padding: '100px 0', overflow: 'hidden' }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
          <div>
            <Reveal><div className="eyebrow" style={{ marginBottom: 16 }}><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}Integrations</div></Reveal>
            <Reveal delay={80}>
              <h2 className="display" style={{ fontSize: 'clamp(36px, 4.4vw, 58px)', margin: 0, textWrap: 'balance' as CSSProperties['textWrap'] }}>
                Works with your stack. <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Not against it.</em>
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <p style={{ color: 'var(--ink-dim)', fontSize: 17, lineHeight: 1.6, margin: '22px 0 28px', maxWidth: 440 }}>
                Plug into your existing helpdesk, CRM, billing, and product data with first-party connectors — or wire up anything custom via MCP, webhooks, or a direct REST call.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link href="/signup" className="btn btn-primary">Browse connectors</Link>
                <button className="btn btn-ghost">Read the MCP docs</button>
              </div>
            </Reveal>
          </div>
          <div style={{ position: 'relative', height: 520 }}>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <div style={{
                width: 92, height: 92, borderRadius: 50,
                background: 'radial-gradient(circle at 30% 30%, var(--accent-2), var(--accent))',
                display: 'grid', placeItems: 'center',
                fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500, color: '#1a0e08',
                boxShadow: '0 10px 50px rgba(245,165,36,0.4)',
                animation: 'float 4s ease-in-out infinite',
                zIndex: 3, position: 'relative',
              }}>Ayooda</div>
              <OrbitRing radius={130} items={['Slack', 'Gmail', 'Intercom', 'Zendesk']} duration={40} size={52} fontSize={11} />
              <OrbitRing radius={200} items={['Shopify', 'Stripe', 'HubSpot', 'Salesforce', 'Notion', 'Linear']} duration={70} reverse size={54} fontSize={11} />
              <OrbitRing radius={260} items={['MCP', 'Webhooks', 'REST', 'GraphQL', 'SQL', 'S3', 'Segment', 'Zapier']} duration={100} size={48} fontSize={10} dashed />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Testimonials ─────────────────────────────────────────────────────────────

function QuoteCard({ q, name, role, company, photo }: { q: string; name: string; role: string; company: string; photo: string }) {
  return (
    <article style={{
      padding: '28px 28px 24px', borderRadius: 'var(--r-lg)',
      border: '1px solid var(--line)', background: 'var(--panel)',
      display: 'flex', flexDirection: 'column', height: '100%',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: -10, right: 22, fontFamily: 'var(--font-display)', fontSize: 110, color: 'var(--accent-soft)', lineHeight: 1, pointerEvents: 'none' }}>"</div>
      <div style={{ width: '100%', height: 200, borderRadius: 12, marginBottom: 22, overflow: 'hidden', flexShrink: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
      </div>
      <p style={{ fontSize: 15.5, lineHeight: 1.6, color: 'var(--ink)', margin: 0, flex: 1, textWrap: 'pretty' as CSSProperties['textWrap'] }}>"{q}"</p>
      <div style={{ borderTop: '1px solid var(--line)', marginTop: 22, paddingTop: 16 }}>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>{role} · {company}</div>
      </div>
    </article>
  )
}

function Testimonials() {
  const quotes = [
    { q: "Around 60% of our tickets are now resolved without a human touching them. Ayooda handles them end-to-end — routing, lookups, even refunds.", name: 'Antonia Renard', role: 'Marketing Director', company: 'AFS Foil', photo: '/testimonials/antonia.jpg' },
    { q: "The impact was immediate. Ayooda now handles all incoming chats and autonomously resolves about 40% of them, freeing the team for real problems.", name: 'Geoff Sarem', role: 'Head of Operations', company: 'Emmatt', photo: '/testimonials/geoff.jpg' },
    { q: "Roughly 40% of requests are fully automated. The rest escalate cleanly to us — with summaries — so quality never slips even as we scale.", name: 'Jim Cohen', role: 'CEO', company: 'Spidervo', photo: '/testimonials/jim.jpg' },
  ]
  return (
    <section id="cases" style={{ padding: '100px 0', background: 'var(--bg-2)' }}>
      <div className="container">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 56 }}>
          <Reveal><div className="eyebrow"><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}Case studies</div></Reveal>
          <Reveal delay={80}>
            <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 64px)', margin: '18px 0 0', maxWidth: 760, textWrap: 'balance' as CSSProperties['textWrap'] }}>
              Real teams. <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Real results.</em>
            </h2>
          </Reveal>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {quotes.map((t, i) => (
            <Reveal key={i} delay={i * 90}>
              <QuoteCard {...t} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

const PLANS = [
  {
    name: 'Lite', price: 25, featured: false, Icon: Sparkles,
    gradient: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)',
    gradientSoft: 'linear-gradient(180deg, rgba(96,165,250,0.12) 0%, transparent 100%)',
    borderActive: '#60a5fa',
    textColor: '#fff',
    aiCredit: 5, includedConvos: 100,
    feats: [
      'Collaborative inbox for all customer emails',
      '$5 of AI conversations included',
      'Let the AI handle and resolve tickets end-to-end',
    ],
  },
  {
    name: 'Core', price: 55, featured: true, Icon: Zap,
    gradient: 'linear-gradient(135deg, #f5a524 0%, #b45309 100%)',
    gradientSoft: 'linear-gradient(180deg, rgba(245,165,36,0.14) 0%, transparent 100%)',
    borderActive: 'var(--accent)',
    textColor: '#1a0e08',
    aiCredit: 25, includedConvos: 500,
    feats: [
      'Organize and utilize customer information effectively',
      '$25 of AI conversations included',
      'Let the AI handle and resolve tickets end-to-end',
    ],
  },
  {
    name: 'Max', price: 195, featured: false, Icon: Rocket,
    gradient: 'linear-gradient(135deg, #c084fc 0%, #7c3aed 100%)',
    gradientSoft: 'linear-gradient(180deg, rgba(192,132,252,0.12) 0%, transparent 100%)',
    borderActive: '#c084fc',
    textColor: '#fff',
    aiCredit: 75, includedConvos: 1500,
    feats: [
      'AI-powered tools for maximum team productivity',
      '$75 of AI conversations included',
      'Let the AI handle and resolve tickets end-to-end',
    ],
  },
] as const

const SLIDER_STEPS = [50, 100, 250, 500, 750, 1000, 2500, 5000] as const

function getPlanForConvos(convos: number) {
  if (convos >= 1000) return PLANS[2]
  if (convos >= 500) return PLANS[1]
  return PLANS[0]
}

function getPayAsYouGo(convos: number) {
  const plan = getPlanForConvos(convos)
  const extra = Math.max(0, convos - plan.includedConvos)
  return extra * 0.05
}

function PlanCard({ plan, active }: { plan: typeof PLANS[number]; active?: boolean }) {
  const borderColor = active ? plan.borderActive : plan.featured ? plan.borderActive : 'var(--line)'
  const glowColor = active ? plan.borderActive : 'transparent'
  return (
    <div style={{
      padding: '28px 26px 24px', borderRadius: 'var(--r-lg)',
      border: `1px solid ${borderColor}`,
      background: `${plan.gradientSoft}, var(--panel)`,
      position: 'relative', display: 'flex', flexDirection: 'column', height: '100%',
      transition: 'border-color .25s, box-shadow .25s',
      boxShadow: active ? `0 0 0 3px ${glowColor}33` : 'none',
    }}>
      {plan.featured && (
        <span style={{ position: 'absolute', top: -10, right: 18, padding: '3px 10px', borderRadius: 999, background: plan.gradient, color: plan.textColor, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.06em' }}>MOST POPULAR</span>
      )}
      <div style={{ width: 42, height: 42, borderRadius: 12, background: plan.gradient, marginBottom: 16, display: 'grid', placeItems: 'center' }}>
        <plan.Icon size={22} color={plan.textColor} strokeWidth={2.2} />
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 4 }}>Membership</div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, margin: 0, letterSpacing: '-0.02em' }}>{plan.name}</h3>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '14px 0 18px' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 52, fontWeight: 500, letterSpacing: '-0.03em' }}>${plan.price}</span>
        <span style={{ color: 'var(--ink-mute)', fontSize: 14 }}>/ month</span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8, flex: 1 }}>
        {plan.feats.map(f => (
          <li key={f} style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--ink-dim)' }}>
            <span style={{ flexShrink: 0, background: plan.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>✓</span>{f}
          </li>
        ))}
      </ul>
      <Link href="/signup" className={plan.featured ? 'btn btn-primary' : 'btn btn-ghost'} style={{ marginTop: 22, justifyContent: 'center' }}>
        Start free trial
      </Link>
    </div>
  )
}

function Pricing() {
  const [stepIdx, setStepIdx] = useState(0) // starts at 50 (index 0)
  const convos = SLIDER_STEPS[stepIdx]
  const activePlan = getPlanForConvos(convos)
  const payg = getPayAsYouGo(convos)

  return (
    <section id="pricing" style={{ padding: '100px 0' }}>
      <div className="container">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 56 }}>
          <Reveal><div className="eyebrow"><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}Pricing</div></Reveal>
          <Reveal delay={80}>
            <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 64px)', margin: '18px 0 14px', maxWidth: 760, textWrap: 'balance' as CSSProperties['textWrap'] }}>
              No surprises. <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>No hidden fees.</em>
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p style={{ color: 'var(--ink-dim)', fontSize: 17, maxWidth: 560, margin: 0 }}>
              Pay a simple monthly membership. AI conversations are included — extra usage billed at $0.05 each.
            </p>
          </Reveal>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 36 }}>
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * 90}>
              <PlanCard plan={p} active={activePlan.name === p.name} />
            </Reveal>
          ))}
        </div>
        <Reveal>
          <div style={{ padding: '26px 28px', borderRadius: 'var(--r-lg)', border: '1px solid var(--line)', background: 'var(--panel)', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 40, alignItems: 'center' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Estimate your bill</div>
              <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500, margin: '0 0 20px', letterSpacing: '-0.01em' }}>
                Drag to estimate your monthly AI conversations.
              </h4>
              <input
                type="range" min={0} max={SLIDER_STEPS.length - 1} step={1} value={stepIdx}
                onChange={e => setStepIdx(+e.target.value)}
                style={{ width: '100%', accentColor: 'var(--accent)', height: 6 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>
                {SLIDER_STEPS.map((s, i) => (
                  <span key={s} style={{ color: i === stepIdx ? 'var(--accent)' : undefined, fontWeight: i === stepIdx ? 700 : undefined }}>
                    {s >= 1000 ? `${s / 1000}k` : s}{s === 5000 ? '+' : ''}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ padding: '24px 28px', borderRadius: 14, background: activePlan.gradient, color: activePlan.textColor, transition: 'background .35s' }}>
              {/* Plan badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.65 }}>
                  {convos.toLocaleString()} conversations / mo
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'rgba(0,0,0,0.18)', padding: '3px 9px', borderRadius: 999 }}>
                  {activePlan.name}
                </span>
              </div>
              {/* Membership price */}
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 56, letterSpacing: '-0.03em', fontWeight: 500, lineHeight: 1 }}>
                ${activePlan.price}
                <span style={{ fontSize: 16, fontFamily: 'var(--font-sans)', fontWeight: 400, opacity: 0.65, marginLeft: 4 }}>/mo</span>
              </div>
              {/* Pay as you go row — always rendered to reserve space */}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.15)', display: 'flex', justifyContent: 'space-between', fontSize: 13, opacity: payg > 0 ? 0.85 : 0, transition: 'opacity .2s' }}>
                <span>Pay as you go:</span>
                <span style={{ fontWeight: 600 }}>${payg % 1 === 0 ? payg.toFixed(0) : payg.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

function FAQItem({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        all: 'unset', cursor: 'pointer',
        padding: '22px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
      }}>
        <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>{q}</span>
        <span style={{ width: 28, height: 28, borderRadius: 50, border: '1px solid var(--line-2)', display: 'grid', placeItems: 'center', transform: `rotate(${open ? 45 : 0}deg)`, transition: 'transform .25s', color: 'var(--ink-dim)', fontSize: 14, flexShrink: 0 }}>+</span>
      </button>
      <div style={{ maxHeight: open ? 200 : 0, overflow: 'hidden', transition: 'max-height .35s ease, opacity .3s', opacity: open ? 1 : 0 }}>
        <p style={{ paddingBottom: 22, margin: 0, color: 'var(--ink-dim)', fontSize: 15, lineHeight: 1.6, maxWidth: 620, textWrap: 'pretty' as CSSProperties['textWrap'] }}>{a}</p>
      </div>
    </div>
  )
}

function FAQ() {
  const faqs = [
    { q: "What exactly is Ayooda?", a: "Ayooda is an AI support agent that answers customer questions, takes actions in your tools, and escalates to humans when it should. It plugs into your existing helpdesk rather than replacing it." },
    { q: "How accurate are the answers?", a: "Every reply is grounded in your data — docs, knowledge base, CRM, product. Ayooda cites the source internally and abstains when it isn't confident, routing the ticket to a human instead of guessing." },
    { q: "What if Ayooda gets something wrong?", a: "It admits it, flags the ticket for review, and hands off with full context. You can label outcomes in the dashboard — Ayooda learns from your corrections automatically." },
    { q: "Which channels does it work on?", a: "Live chat, email, WhatsApp, Messenger, Instagram, SMS, Slack, in-app widgets — anywhere your customers already write to you." },
    { q: "Will it replace my support team?", a: "No. It takes the repetitive 40–60% of volume off your queue so your team can focus on the hard, human-facing problems — where they actually add value." },
    { q: "How long to get started?", a: "Most teams go live within an afternoon. If you have docs and a helpdesk, setup is a matter of minutes. No engineering required." },
  ]
  return (
    <section id="faq" style={{ padding: '100px 0', background: 'var(--bg-2)' }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 80 }}>
          <div>
            <Reveal><div className="eyebrow" style={{ marginBottom: 16 }}><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}FAQ</div></Reveal>
            <Reveal delay={80}>
              <h2 className="display" style={{ fontSize: 'clamp(36px, 4.4vw, 56px)', margin: 0, textWrap: 'balance' as CSSProperties['textWrap'] }}>
                Got questions? <br />
                <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>We've got answers.</em>
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <p style={{ color: 'var(--ink-dim)', marginTop: 22, fontSize: 15, lineHeight: 1.6, maxWidth: 340 }}>
                Still curious? Ask Ayooda directly — she'll hand you off to a human if she doesn't know.
              </p>
            </Reveal>
            <Reveal delay={220}>
              <button className="btn btn-ghost" style={{ marginTop: 14 }}>Ask Ayooda →</button>
            </Reveal>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--line)' }}>
            {faqs.map((f, i) => <FAQItem key={i} q={f.q} a={f.a} defaultOpen={i === 0} />)}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Final CTA ────────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section style={{ padding: '120px 0', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 70% 60% at 50% 50%, var(--accent-soft), transparent 70%)' }} />
      <div aria-hidden className="grid-bg" style={{ position: 'absolute', inset: 0, maskImage: 'radial-gradient(ellipse 60% 50% at 50% 50%, #000 40%, transparent 90%)', WebkitMaskImage: 'radial-gradient(ellipse 60% 50% at 50% 50%, #000 40%, transparent 90%)', opacity: 0.5, pointerEvents: 'none' }} />
      <div className="container" style={{ position: 'relative', textAlign: 'center' }}>
        <Reveal>
          <h2 className="display" style={{ fontSize: 'clamp(48px, 6.6vw, 92px)', margin: 0, maxWidth: 900, marginInline: 'auto', textWrap: 'balance' as CSSProperties['textWrap'] }}>
            Get started with <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Ayooda</em> today.
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p style={{ color: 'var(--ink-dim)', fontSize: 18, margin: '22px 0 30px' }}>
            Your team will wonder how they ever lived without her.
          </p>
        </Reveal>
        <Reveal delay={200}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <Link href="/signup" className="btn btn-primary">Start free trial</Link>
            <button className="btn btn-ghost">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 1l9 5-9 5V1z" fill="currentColor" /></svg>
              Watch demo
            </button>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', margin: 0 }}>
            14-DAY FREE TRIAL · NO CARD REQUIRED
          </p>
        </Reveal>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  const cols = [
    { h: 'Product', links: ['Features', 'Integrations', 'Pricing', 'Changelog'] },
    { h: 'Company', links: ['About', 'Customers', 'Careers', 'Blog'] },
    { h: 'Resources', links: ['Docs', 'MCP guide', 'Status', 'Contact'] },
  ]
  const showLinks = false // links block temporarily hidden
  return (
    <footer style={{ padding: showLinks ? '60px 0 40px' : '32px 0', borderTop: '1px solid var(--line)' }}>
      <div className="container">
        {showLinks && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr repeat(3, 1fr)', gap: 40, marginBottom: 40 }}>
          <div>
            <Logo />
            <p style={{ marginTop: 14, color: 'var(--ink-mute)', fontSize: 13, maxWidth: 260, lineHeight: 1.5 }}>
              The AI support agent your customers will want to talk to.
            </p>
          </div>
          {cols.map(col => (
            <div key={col.h}>
              <div className="eyebrow" style={{ marginBottom: 14 }}>{col.h}</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {col.links.map(l => (
                  <li key={l}><a href="#" style={{ fontSize: 13.5, color: 'var(--ink-dim)' }}>{l}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        )}
        <div style={{ display: 'flex', gap: 16, justifyContent: 'space-between', paddingTop: showLinks ? 24 : 0, borderTop: showLinks ? '1px solid var(--line)' : 'none', fontSize: 12, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)' }}>
          <span>© 2026 Ayooda · All rights reserved</span>
          <span>Made for the humans behind the inbox.</span>
        </div>
      </div>
    </footer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <Nav />
      <main>
        <Hero />
        <LogoStrip />
        <Why />
        <SolutionsBand />
        <Features />
        <HowItWorks />
        <Integrations />
        <Testimonials />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  )
}
