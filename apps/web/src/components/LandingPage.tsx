'use client'

import { useState, useEffect, useRef, CSSProperties, ReactNode, ComponentType } from 'react'
import Link from 'next/link'
import { SiShopify, SiStripe, SiHubspot, SiNotion, SiZendesk, SiLinear, SiIntercom, SiZapier, SiGmail, SiAirtable, SiGraphql, SiModelcontextprotocol } from 'react-icons/si'
import { Sparkles, Zap, Rocket, Webhook, Braces, Database, Boxes, Network, Send } from 'lucide-react'
import { LANDING_LINKS } from '@/lib/landing-links'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { ProductDemo } from '@/components/landing/ProductDemo'
import { AyoodaMark } from '@/components/brand/AyoodaMark'

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
      <AyoodaMark size={size} />
      <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 18 }}>Ayooda</span>
    </div>
  )
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

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
      background: scrolled || mobileOpen ? 'color-mix(in oklab, var(--bg) 82%, transparent)' : 'transparent',
      backdropFilter: scrolled || mobileOpen ? 'blur(14px) saturate(130%)' : 'none',
      WebkitBackdropFilter: scrolled || mobileOpen ? 'blur(14px) saturate(130%)' : 'none',
      borderBottom: scrolled || mobileOpen ? '1px solid var(--line)' : '1px solid transparent',
      transition: 'background .3s ease, border-color .3s ease',
    }}>
      <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 24, position: 'relative' }}>
        <a href="#top"><Logo /></a>
        <nav className="landing-nav-links" aria-label="Primary navigation" style={{ display: 'flex', gap: 22, marginLeft: 16 }}>
          {links.map(([label, href]) => (
            <a key={href} href={href} style={{ fontSize: 13.5, color: 'var(--ink-dim)', fontWeight: 450, transition: 'color .15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-dim)')}
            >{label}</a>
          ))}
        </nav>
        <div className="landing-nav-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeToggle />
          <Link href="/login" className="btn btn-ghost" style={{ padding: '9px 14px', fontSize: 13 }}>Sign in</Link>
          <Link href="/signup" className="btn btn-primary landing-cta" style={{ padding: '9px 14px', fontSize: 13 }}>Start free →</Link>
        </div>
        <button
          type="button"
          className="landing-mobile-toggle"
          aria-expanded={mobileOpen}
          aria-controls="landing-mobile-menu"
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setMobileOpen(open => !open)}
        >
          <span className="landing-menu-icon" data-visible={!mobileOpen} aria-hidden>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </span>
          <span className="landing-menu-icon" data-visible={mobileOpen} aria-hidden>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </span>
        </button>
        <nav id="landing-mobile-menu" className="landing-mobile-menu" data-open={mobileOpen} aria-label="Mobile navigation">
          {links.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setMobileOpen(false)}>{label}<span aria-hidden>→</span></a>
          ))}
          <ThemeToggle showLabel className="landing-mobile-theme" />
          <div className="landing-mobile-actions">
            <Link href="/login" className="btn btn-ghost" onClick={() => setMobileOpen(false)}>Sign in</Link>
            <Link href="/signup" className="btn btn-primary landing-cta" onClick={() => setMobileOpen(false)}>Start free →</Link>
          </div>
        </nav>
      </div>
    </header>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section id="top" className="landing-hero" style={{ position: 'relative', paddingTop: 140, paddingBottom: 80, overflow: 'hidden' }}>
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
        <h1 className="display" style={{
          fontSize: 'clamp(34px, 5.4vw, 72px)',
          margin: '0 0 22px', textAlign: 'center',
          maxWidth: 1000, marginInline: 'auto', textWrap: 'balance' as CSSProperties['textWrap'],
        }}>
          <Reveal style={{ display: 'block' }}>
            Resolve routine tickets.
          </Reveal>
          <Reveal delay={120} style={{ display: 'block' }}>
            Keep your team <em style={{ fontStyle: 'normal', color: 'var(--ink-mute)' }}>focused.</em>
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
            <Link href="/signup" className="btn btn-primary landing-cta">Start free trial</Link>
            <a href={LANDING_LINKS.demo} className="btn btn-ghost landing-cta">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ marginLeft: 2 }}><path d="M2 1l9 5-9 5V1z" fill="currentColor" /></svg>
              Watch product demo
            </a>
          </div>
        </Reveal>

        <Reveal delay={440}>
          <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
            14-DAY FREE TRIAL · NO CARD REQUIRED
          </p>
        </Reveal>

        <Reveal delay={560}>
          <div style={{ marginTop: 60 }}>
            <ProductDemo />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ─── Logo Strip ───────────────────────────────────────────────────────────────

function LogoStrip() {
  const proofPoints = ['Grounded answers', 'Guarded actions', 'Clean hand-offs']

  return (
    <section aria-label="Product capabilities" style={{ padding: '40px 0 80px' }}>
      <div className="container">
        <p style={{
          textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-faint)',
          marginBottom: 20,
        }}>
          Built for support teams that need answers and actions—not another chatbot
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
          {proofPoints.map(point => (
            <div key={point} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 13px', borderRadius: 999,
              background: 'var(--panel)', boxShadow: '0 0 0 1px var(--line)',
              color: 'var(--ink-dim)', fontSize: 13, fontWeight: 500,
            }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: 50, background: 'var(--accent)' }} />
              {point}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Why ──────────────────────────────────────────────────────────────────────

function Glyph({ kind }: { kind: string }) {
  const k = 'var(--ink)'
  const hair = { stroke: k, strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const dim = { ...hair, opacity: 0.32 }
  const lime = { stroke: 'var(--accent)', strokeWidth: 1.8, strokeLinecap: 'round' as const }
  return (
    <div className="wg-tile" aria-hidden="true">
      <svg className="wg" width="46" height="46" viewBox="0 0 40 40" fill="none">
        {kind === 'world' && (
          <>
            <circle cx="20" cy="20" r="12" {...hair} />
            <path d="M8 20h24M10 13.5c6 2.6 14 2.6 20 0M10 26.5c6-2.6 14-2.6 20 0" {...dim} />
            <ellipse className="wg-meridian" cx="20" cy="20" rx="6" ry="12" {...hair} />
            <ellipse className="wg-meridian wg-meridian-b" cx="20" cy="20" rx="6" ry="12" {...dim} />
            <g className="wg-orbit"><circle cx="20" cy="3.6" r="2" fill="var(--accent)" /></g>
          </>
        )}
        {kind === 'long' && (
          <>
            <path d={INFINITY} {...dim} />
            <path className="wg-trace" d={INFINITY} pathLength={100} {...lime} />
          </>
        )}
        {kind === 'eye' && (
          <>
            <g className="wg-lid">
              <path d="M5 20c3.4-6.2 8.6-9.4 15-9.4s11.6 3.2 15 9.4c-3.4 6.2-8.6 9.4-15 9.4S8.4 26.2 5 20z" {...hair} />
              <g className="wg-iris">
                <circle cx="20" cy="20" r="6" {...dim} />
                <circle cx="20" cy="20" r="2.8" fill="var(--accent)" />
              </g>
            </g>
          </>
        )}
        {kind === 'root' && (
          <>
            <path d={ROOT_L} {...dim} /><path d={ROOT_M} {...dim} /><path d={ROOT_R} {...dim} />
            <path className="wg-pulse" d={ROOT_L} pathLength={100} {...lime} />
            <path className="wg-pulse wg-pulse-b" d={ROOT_M} pathLength={100} {...lime} />
            <path className="wg-pulse wg-pulse-c" d={ROOT_R} pathLength={100} {...lime} />
            {[8, 20, 32].map((x) => <circle key={x} cx={x} cy={x === 20 ? 33 : 31.5} r="2.2" fill="var(--panel-2)" {...hair} />)}
            <circle className="wg-ring" cx="20" cy="9" r="3" {...lime} strokeWidth="1.2" />
            <circle cx="20" cy="9" r="3" fill="var(--accent)" />
          </>
        )}
        {kind === 'balance' && (
          <>
            <circle cx="20" cy="20" r="12.5" {...dim} />
            <circle className="wg-arc" cx="20" cy="20" r="12.5" pathLength={100} {...lime} />
            <path className="wg-check" d="M14 20.6l4.2 4.2L26.4 15.6" pathLength={20} {...hair} strokeWidth="1.8" />
          </>
        )}
      </svg>
    </div>
  )
}

const INFINITY = 'M20 20c-3-5-6.5-6.5-9.5-6.5C7 13.5 5 16.5 5 20s2 6.5 5.5 6.5c3 0 6.5-1.5 9.5-6.5s6.5-6.5 9.5-6.5c3.5 0 5.5 3 5.5 6.5s-2 6.5-5.5 6.5c-3 0-6.5-1.5-9.5-6.5z'
const ROOT_L = 'M8 31.5C8 21 20 22 20 12'
const ROOT_M = 'M20 33V12'
const ROOT_R = 'M32 31.5C32 21 20 22 20 12'

function PillarCard({ title, body, glyph }: { title: string; body: string; glyph: string }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      className="pillar-card" tabIndex={0}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        padding: '22px 24px', borderRadius: 'var(--r-lg)', border: '1px solid var(--line)',
        background: hover ? 'var(--panel)' : 'transparent',
        transition: 'background .25s ease, transform .25s ease',
        transform: hover ? 'translateY(-2px)' : 'none',
        display: 'grid', gridTemplateColumns: '52px 1fr', gap: 20, alignItems: 'start',
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
    { title: 'Grounded in your truth.', body: 'Ayooda retrieves context from your indexed websites and documents, surfaces confidence, and can hand uncertain conversations to your team.', glyph: 'root' },
    { title: 'Autonomy with accountability.', body: 'Ayooda resolves routine tickets end-to-end and knows when to loop in a human, with full context attached.', glyph: 'balance' },
  ]
  return (
    <section id="why" className="landing-section" style={{ padding: '100px 0', background: 'var(--bg-2)' }}>
      <div className="container">
        <div className="landing-two-column" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 80, alignItems: 'start' }}>
          <div className="landing-sticky" style={{ position: 'sticky', top: 120 }}>
            <Reveal>
              <div className="eyebrow" style={{ marginBottom: 18 }}>
                <span style={{ color: 'var(--accent)' }}>◆</span>{'  '}Why Ayooda
              </div>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="display" style={{ fontSize: 'clamp(40px, 4.2vw, 58px)', margin: 0, textWrap: 'balance' as CSSProperties['textWrap'] }}>
                An agent you can actually <em style={{ fontStyle: 'normal', color: 'var(--ink-mute)' }}>trust</em> in production.
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <p style={{ color: 'var(--ink-dim)', marginTop: 22, fontSize: 16, lineHeight: 1.55, maxWidth: 380 }}>
                Five principles we won&apos;t compromise on — because shipping an AI to your customers is a serious thing.
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
  const labels: Record<string, string> = { encrypted: 'ENC', access: 'ACL', verified: 'SIG' }
  return (
    <div style={{
      width: 44, height: 48,
      background: 'linear-gradient(180deg, var(--accent), color-mix(in oklab, var(--accent) 60%, #000))',
      clipPath: 'polygon(50% 0, 100% 18%, 100% 72%, 50% 100%, 0 72%, 0 18%)',
      display: 'grid', placeItems: 'center', flexShrink: 0,
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: '#08090a', letterSpacing: '0.08em' }}>
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
    { h: 'Deep integrations.', b: 'Connect provider bundles, custom REST actions, and MCP servers to bring useful customer and product context into each turn.' },
    { h: 'Smart escalation.', b: 'Knows its limits. Routes to the right human with a compact summary of context.' },
  ]
  const trust = [
    { badge: 'encrypted', h: 'Credentials stay encrypted.', b: 'Connector and model secrets are protected with authenticated AES-256-GCM encryption before storage.' },
    { badge: 'access', h: 'Access follows your team.', b: 'Workspace roles and per-agent editor access keep configuration in the hands of the right teammates.' },
    { badge: 'verified', h: 'Inbound traffic is verified.', b: 'Slack, SMS, and email webhooks are signature-checked before customer messages enter a workflow.' },
  ]
  return (
    <section className="landing-section" style={{ padding: '100px 0' }}>
      <div className="container">
        <Reveal>
          <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 72px)', margin: 0, textAlign: 'center', textWrap: 'balance' as CSSProperties['textWrap'] }}>
            One agent. Five channels.<br />
            <em style={{ fontStyle: 'normal', color: 'var(--ink-mute)' }}>A thousand possibilities.</em>
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
      { name: 'Notion', Icon: SiNotion, color: 'var(--brand-neutral)' },
      { name: 'Zendesk', Icon: SiZendesk, color: 'var(--brand-neutral)' },
      { name: 'Linear', Icon: SiLinear, color: '#9CA3F0' },
      { name: 'Intercom', Icon: SiIntercom, color: '#3B82F6' },
      { name: 'Zapier', Icon: SiZapier, color: '#FF4F00' },
    ]
    return (
      <div style={wrap}>
        <div className="pill" style={{ marginBottom: 18 }}><span className="dot" />MCP connections · live</div>
        <div className="landing-tool-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
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
              <span style={{ width: 26, height: 26, borderRadius: 50, background: i <= 2 ? 'var(--accent)' : 'transparent', border: i <= 2 ? 'none' : '1px dashed var(--line-2)', color: '#08090a', fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{i <= 2 ? '✓' : i + 1}</span>
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
      { n: 'Llama 3.3 70B', a: 'Meta · AI Gateway', active: false },
      { n: 'Custom endpoint', a: 'OpenAI-compatible HTTPS', active: false },
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
    { key: 'configure', label: 'Configure', h: 'Pick the brain that fits your business.', b: 'Choose from the live AI Gateway catalog or connect a public OpenAI-compatible HTTPS endpoint. You stay in control of data, tone, and spend.' },
    { key: 'workflow', label: 'Workflows', h: 'Design complex automations, visually.', b: 'Drag-and-drop flows to model triage, escalation, and routing logic. Every branch is auditable and testable.' },
    { key: 'analytics', label: 'Analytics', h: 'Learn from every single conversation.', b: 'See resolution rate, CSAT, hand-off causes, confidence trends, timing, and exportable conversation data.' },
    { key: 'train', label: 'Train', h: 'Keep your website knowledge fresh.', b: 'Schedule daily, weekly, or monthly refreshes for website sources, sync on demand, and replace uploaded documents whenever they change.' },
  ]
  const [active, setActive] = useState(0)
  const tab = tabs[active]

  return (
    <section id="features" className="landing-section" style={{ padding: '100px 0' }}>
      <div className="container">
        <Reveal>
          <div className="eyebrow" style={{ marginBottom: 18 }}><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}Features</div>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 68px)', margin: 0, maxWidth: 820, textWrap: 'balance' as CSSProperties['textWrap'] }}>
            Everything you need. <em style={{ fontStyle: 'normal', color: 'var(--ink-mute)' }}>Nothing you don&apos;t.</em>
          </h2>
        </Reveal>
        <div className="landing-feature-layout" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 48, marginTop: 56 }}>
          <div className="landing-feature-tabs" style={{ display: 'flex', flexDirection: 'column', gap: 4, borderLeft: '1px solid var(--line)' }}>
            {tabs.map((t, i) => (
              <button className="landing-feature-tab" data-active={i === active} key={t.key} onClick={() => setActive(i)} style={{
                appearance: 'none', background: 'none', border: 'none',
                textAlign: 'left', cursor: 'pointer',
                padding: '16px 20px',
                color: i === active ? 'var(--ink)' : 'var(--ink-mute)',
                fontSize: 16, fontWeight: i === active ? 500 : 400,
                borderLeft: `2px solid ${i === active ? 'var(--accent)' : 'transparent'}`,
                marginLeft: -1,
                transition: 'color .2s, background-color .2s, border-color .2s',
                fontFamily: 'var(--font-sans)',
              }}>{t.label}</button>
            ))}
          </div>
          <div className="landing-feature-content" style={{ minHeight: 520 }}>
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
        <div key={t} style={{ flex: 1, height: `${40 + i * 14}%`, background: i % 2 ? 'var(--accent)' : 'var(--accent-2)', opacity: 0.8 + i * 0.04, borderRadius: 6, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, color: '#08090a', fontWeight: 700 }}>{t}</div>
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
      <div style={{ width: 56, height: 56, borderRadius: 50, background: 'var(--accent)', display: 'grid', placeItems: 'center', animation: 'pulse-ring 2s infinite', color: '#08090a', fontWeight: 700 }}>A</div>
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
    <section id="how" className="landing-section" style={{ padding: '100px 0', background: 'var(--bg-2)' }}>
      <div className="container">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 56 }}>
          <Reveal><div className="eyebrow"><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}How it works</div></Reveal>
          <Reveal delay={80}>
            <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 64px)', margin: '18px 0 14px', maxWidth: 760, textWrap: 'balance' as CSSProperties['textWrap'] }}>
              Four steps. <em style={{ fontStyle: 'normal', color: 'var(--ink-mute)' }}>From zero to live in an afternoon.</em>
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

type OrbitItem = { label: string; Icon?: ComponentType<{ size?: number; color?: string }>; color?: string }

function OrbitRing({ radius, items, duration, reverse, size = 50, fontSize = 11, dashed }: {
  radius: number; items: OrbitItem[]; duration: number; reverse?: boolean
  size?: number; fontSize?: number; dashed?: boolean
}) {
  const iconSize = Math.round(size * 0.46)
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
        // Stable pixel precision avoids server/browser style serialization
        // disagreeing on near-zero trigonometric values during hydration.
        const x = Math.round((Math.cos(angle) * radius + radius) * 1_000) / 1_000
        const y = Math.round((Math.sin(angle) * radius + radius) * 1_000) / 1_000
        return (
          <div key={it.label} title={it.label} style={{
            position: 'absolute', left: x - size / 2, top: y - size / 2,
            width: size, height: size, borderRadius: 50,
            background: 'var(--panel)', border: '1px solid var(--line-2)',
            display: 'grid', placeItems: 'center',
            fontSize, fontWeight: 500, color: 'var(--ink-dim)',
            animation: `orbit-rotate ${duration}s linear infinite ${reverse ? '' : 'reverse'}`,
            boxShadow: 'var(--shadow-soft)',
          }}>
            {it.Icon ? <it.Icon size={iconSize} color={it.color ?? 'var(--ink-dim)'} /> : it.label}
          </div>
        )
      })}
    </div>
  )
}

function Integrations() {
  return (
    <section id="integrations" className="landing-section" style={{ padding: '100px 0', overflow: 'hidden' }}>
      <div className="container">
        <div className="landing-integrations" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
          <div>
            <Reveal><div className="eyebrow" style={{ marginBottom: 16 }}><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}Integrations</div></Reveal>
            <Reveal delay={80}>
              <h2 className="display" style={{ fontSize: 'clamp(36px, 4.4vw, 58px)', margin: 0, textWrap: 'balance' as CSSProperties['textWrap'] }}>
                Works with your stack. <em style={{ fontStyle: 'normal', color: 'var(--ink-mute)' }}>Not against it.</em>
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <p style={{ color: 'var(--ink-dim)', fontSize: 17, lineHeight: 1.6, margin: '22px 0 28px', maxWidth: 440 }}>
                Plug into your existing helpdesk, CRM, billing, and product data with first-party connectors — or wire up anything custom via MCP, webhooks, or a direct REST call.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link href={LANDING_LINKS.connectors} className="btn btn-primary landing-cta">Browse connectors</Link>
                <Link href={LANDING_LINKS.mcpDocs} className="btn btn-ghost landing-cta">Read the MCP docs</Link>
              </div>
            </Reveal>
          </div>
          <div className="landing-orbit" style={{ position: 'relative', height: 520 }}>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <div style={{
                width: 92, height: 92, borderRadius: 50,
                background: 'radial-gradient(circle at 30% 30%, var(--accent-2), var(--accent))',
                display: 'grid', placeItems: 'center',
                fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500, color: '#08090a',
                boxShadow: '0 10px 50px rgba(245,165,36,0.4)',
                animation: 'float 4s ease-in-out infinite',
                zIndex: 3, position: 'relative',
              }}>Ayooda</div>
              <OrbitRing radius={130} duration={40} size={52} items={[
                { label: 'Telegram', Icon: Send, color: '#2AABEE' },
                { label: 'Gmail', Icon: SiGmail, color: '#EA4335' },
                { label: 'Intercom', Icon: SiIntercom, color: '#3B82F6' },
                { label: 'Zendesk', Icon: SiZendesk, color: 'var(--brand-neutral)' },
              ]} />
              <OrbitRing radius={200} duration={70} reverse size={54} items={[
                { label: 'Shopify', Icon: SiShopify, color: '#95BF47' },
                { label: 'Stripe', Icon: SiStripe, color: '#635BFF' },
                { label: 'HubSpot', Icon: SiHubspot, color: '#FF7A59' },
                { label: 'Airtable', Icon: SiAirtable, color: '#FCB400' },
                { label: 'Notion', Icon: SiNotion, color: 'var(--brand-neutral)' },
                { label: 'Linear', Icon: SiLinear, color: '#9CA3F0' },
              ]} />
              <OrbitRing radius={260} duration={100} size={48} dashed items={[
                { label: 'MCP', Icon: SiModelcontextprotocol, color: 'var(--brand-neutral)' },
                { label: 'Webhooks', Icon: Webhook, color: '#9CA3F0' },
                { label: 'REST', Icon: Braces, color: '#8be3b5' },
                { label: 'GraphQL', Icon: SiGraphql, color: '#E10098' },
                { label: 'SQL', Icon: Database, color: '#7aa2ff' },
                { label: 'S3', Icon: Boxes, color: '#FF9900' },
                { label: 'Segment', Icon: Network, color: '#52BD94' },
                { label: 'Zapier', Icon: SiZapier, color: '#FF4F00' },
              ]} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Testimonials ─────────────────────────────────────────────────────────────

function OutcomeCard({ index, title, body, proof }: { index: string; title: string; body: string; proof: string }) {
  return (
    <article style={{
      padding: '28px 28px 24px', borderRadius: 'var(--r-lg)',
      border: '1px solid var(--line)', background: 'var(--panel)',
      display: 'flex', flexDirection: 'column', height: '100%',
      position: 'relative', overflow: 'hidden',
    }}>
      <div aria-hidden style={{ position: 'absolute', top: -22, right: 18, fontFamily: 'var(--font-display)', fontSize: 130, color: 'var(--accent-soft)', lineHeight: 1, pointerEvents: 'none' }}>{index}</div>
      <div style={{
        width: 42, height: 42, borderRadius: 12, marginBottom: 44,
        display: 'grid', placeItems: 'center',
        background: 'var(--accent-soft)', color: 'var(--accent)',
        fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
        boxShadow: '0 0 0 1px var(--line)',
      }}>
        {index}
      </div>
      <h3 style={{ fontSize: 20, lineHeight: 1.3, margin: '0 0 12px', textWrap: 'balance' as CSSProperties['textWrap'] }}>{title}</h3>
      <p style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--ink-dim)', margin: 0, flex: 1, textWrap: 'pretty' as CSSProperties['textWrap'] }}>{body}</p>
      <div style={{ borderTop: '1px solid var(--line)', marginTop: 22, paddingTop: 16 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-mute)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{proof}</div>
      </div>
    </article>
  )
}

function OutcomePlaybook() {
  const outcomes = [
    { index: '01', title: 'Answer the questions that keep coming back.', body: 'Use synced help-center content, product docs, and connected business data to give customers useful answers in the moment.', proof: 'Knowledge retrieval + confidence' },
    { index: '02', title: 'Take action when an answer is not enough.', body: 'Look up orders, update records, and run approved workflows through connected tools—with confirmation and guardrails where they matter.', proof: 'Connected tools + workflows' },
    { index: '03', title: 'Hand off the exceptions, already organized.', body: 'When confidence drops or a rule calls for a person, route the conversation with its context, summary, and hand-off reason intact.', proof: 'Escalation rules + shared inbox' },
  ]
  return (
    <section id="outcomes" className="landing-section" style={{ padding: '100px 0', background: 'var(--bg-2)' }}>
      <div className="container">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 56 }}>
          <Reveal><div className="eyebrow"><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}Outcome playbook</div></Reveal>
          <Reveal delay={80}>
            <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 64px)', margin: '18px 0 0', maxWidth: 760, textWrap: 'balance' as CSSProperties['textWrap'] }}>
              Put the routine on autopilot. <em style={{ fontStyle: 'normal', color: 'var(--ink-mute)' }}>Keep control of the rest.</em>
            </h2>
          </Reveal>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {outcomes.map((outcome, i) => (
            <Reveal key={outcome.index} delay={i * 90}>
              <OutcomeCard {...outcome} />
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
    textColor: '#08090a',
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
      <Link href="/signup" className={`${plan.featured ? 'btn btn-primary' : 'btn btn-ghost'} landing-cta`} style={{ marginTop: 22, justifyContent: 'center' }}>
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
    <section id="pricing" className="landing-section" style={{ padding: '100px 0' }}>
      <div className="container">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 56 }}>
          <Reveal><div className="eyebrow"><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}Pricing</div></Reveal>
          <Reveal delay={80}>
            <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 64px)', margin: '18px 0 14px', maxWidth: 760, textWrap: 'balance' as CSSProperties['textWrap'] }}>
              No surprises. <em style={{ fontStyle: 'normal', color: 'var(--ink-mute)' }}>No hidden fees.</em>
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
          <div className="landing-pricing-estimate" style={{ padding: '26px 28px', borderRadius: 'var(--r-lg)', border: '1px solid var(--line)', background: 'var(--panel)', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 40, alignItems: 'center' }}>
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
    { q: "What exactly is Ayooda?", a: "Ayooda is an AI support agent that answers customer questions, takes guarded actions in connected tools, and follows your workflows for hand-offs and routing." },
    { q: "How accurate are the answers?", a: "Ayooda retrieves relevant context from your indexed websites and documents and records retrieval confidence. You can configure low-confidence workflows to route uncertain conversations to a human." },
    { q: "What if Ayooda gets something wrong?", a: "Your team can take over in the shared inbox, review the conversation context, and refine the agent's knowledge, instructions, or workflows before the next interaction." },
    { q: "Which channels does it work on?", a: "Ayooda currently supports the web widget, Telegram, email, Slack, and Twilio SMS. Every channel feeds the same inbox and agent workflows." },
    { q: "Will it replace my support team?", a: "No. It takes repetitive work off the queue so your team can focus on the hard, human-facing problems—where their judgment and care add the most value." },
    { q: "How long to get started?", a: "You can create an agent, add a website or documents, and test it during the guided setup. Going live then depends on the channel you choose and its provider configuration." },
  ]
  return (
    <section id="faq" className="landing-section" style={{ padding: '100px 0', background: 'var(--bg-2)' }}>
      <div className="container">
        <div className="landing-faq-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 80 }}>
          <div>
            <Reveal><div className="eyebrow" style={{ marginBottom: 16 }}><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}FAQ</div></Reveal>
            <Reveal delay={80}>
              <h2 className="display" style={{ fontSize: 'clamp(36px, 4.4vw, 56px)', margin: 0, textWrap: 'balance' as CSSProperties['textWrap'] }}>
                Got questions? <br />
                <em style={{ fontStyle: 'normal', color: 'var(--ink-mute)' }}>We&apos;ve got answers.</em>
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <p style={{ color: 'var(--ink-dim)', marginTop: 22, fontSize: 15, lineHeight: 1.6, maxWidth: 340, textWrap: 'pretty' as CSSProperties['textWrap'] }}>
                Still curious? Build your own agent and test its answers, sources, workflows, and hand-offs in the isolated sandbox.
              </p>
            </Reveal>
            <Reveal delay={220}>
              <Link href={LANDING_LINKS.sandbox} className="btn btn-ghost landing-cta" style={{ marginTop: 14 }}>Test your own agent →</Link>
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
    <section className="landing-final-cta" style={{ padding: '120px 0', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 70% 60% at 50% 50%, var(--accent-soft), transparent 70%)' }} />
      <div aria-hidden className="grid-bg" style={{ position: 'absolute', inset: 0, maskImage: 'radial-gradient(ellipse 60% 50% at 50% 50%, #000 40%, transparent 90%)', WebkitMaskImage: 'radial-gradient(ellipse 60% 50% at 50% 50%, #000 40%, transparent 90%)', opacity: 0.5, pointerEvents: 'none' }} />
      <div className="container" style={{ position: 'relative', textAlign: 'center' }}>
        <Reveal>
          <h2 className="display" style={{ fontSize: 'clamp(48px, 6.6vw, 92px)', margin: 0, maxWidth: 900, marginInline: 'auto', textWrap: 'balance' as CSSProperties['textWrap'] }}>
            Get started with <em style={{ fontStyle: 'normal', color: 'var(--ink-mute)' }}>Ayooda</em> today.
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p style={{ color: 'var(--ink-dim)', fontSize: 18, margin: '22px 0 30px' }}>
            Your team will wonder how they ever lived without her.
          </p>
        </Reveal>
        <Reveal delay={200}>
          <div className="landing-footer-cta" style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <Link href="/signup" className="btn btn-primary landing-cta">Start free trial</Link>
            <a href={LANDING_LINKS.demo} className="btn btn-ghost landing-cta">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ marginLeft: 2 }}><path d="M2 1l9 5-9 5V1z" fill="currentColor" /></svg>
              Watch product demo
            </a>
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
  return (
    <footer style={{ padding: '32px 0', borderTop: '1px solid var(--line)' }}>
      <div className="container">
        <div className="landing-footer-row" style={{ display: 'flex', gap: 16, justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)' }}>
          <span>© 2026 Ayooda · All rights reserved</span>
          <nav className="landing-footer-links" aria-label="Legal links">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Use</Link>
            <a href="mailto:legal@ayooda.live">Contact</a>
          </nav>
          <span className="landing-footer-tagline">Made for the humans behind the inbox.</span>
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
        <OutcomePlaybook />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  )
}
