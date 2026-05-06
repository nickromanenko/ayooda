/* Ayooda — content sections */

const { useState: useStateS, useEffect: useEffectS, useRef: useRefS } = React;

// ───── Logo Strip ─────
function LogoStrip() {
  const companies = ['Northwind', 'Kestrel', 'Arcadia', 'Fieldnote', 'Quillbox', 'Portola', 'Modulo', 'Sagebrush'];
  return (
    <section style={{ padding: '40px 0 80px', position: 'relative' }}>
      <div className="container">
        <p style={{
          textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-faint)',
          marginBottom: 28,
        }}>
          Trusted by modern support teams at 10,000+ companies
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '18px 36px',
          opacity: 0.7,
        }}>
          {companies.map(c => (
            <div key={c} style={{
              textAlign: 'center',
              fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500,
              color: 'var(--ink-dim)', letterSpacing: '-0.02em',
            }}>
              {c}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───── Why Ayooda ─────
function Why() {
  const pillars = [
    {
      title: 'Built for the real world.',
      body: 'AI doesn’t live in sandboxes. Ayooda handles messy, real customer conversations, with real data behind them, and doesn’t flinch when things get complicated.',
      glyph: 'world',
    },
    {
      title: 'Engineered for the long run.',
      body: 'Not a trend. Ayooda is modular, fast, and architected to evolve alongside your support stack for the next decade.',
      glyph: 'long',
    },
    {
      title: 'Transparent by design.',
      body: 'Every decision, route, and retrieval is visible and editable. You always know what your agent is doing — and why.',
      glyph: 'eye',
    },
    {
      title: 'Grounded in your truth.',
      body: 'Every answer comes from your data — docs, helpdesk, CRM, product. No hallucinations. No guesses.',
      glyph: 'root',
    },
    {
      title: 'Autonomy with accountability.',
      body: 'Ayooda resolves routine tickets end-to-end and knows when to loop in a human, with full context attached.',
      glyph: 'balance',
    },
  ];

  return (
    <section id="why" style={{ padding: '100px 0', position: 'relative', background: 'var(--bg-2)' }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 80, alignItems: 'start' }}>
          <div style={{ position: 'sticky', top: 120 }}>
            <Reveal>
              <div className="eyebrow" style={{ marginBottom: 18 }}>
                <span style={{ color: 'var(--accent)' }}>◆</span>  Why Ayooda
              </div>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="display" style={{ fontSize: 'clamp(40px, 4.2vw, 58px)', margin: 0, textWrap: 'balance' }}>
                An agent you can actually <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>trust</em> in production.
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <p style={{ color: 'var(--ink-dim)', marginTop: 22, fontSize: 16, lineHeight: 1.55, maxWidth: 380 }}>
                Five principles we won’t compromise on — because shipping an AI to your customers is a serious thing.
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
  );
}

function PillarCard({ title, body, glyph }) {
  const [hover, setHover] = useStateS(false);
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        padding: '22px 24px',
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--line)',
        background: hover ? 'var(--panel)' : 'transparent',
        transition: 'background .25s ease, transform .25s ease',
        transform: hover ? 'translateY(-2px)' : 'none',
        display: 'grid', gridTemplateColumns: '48px 1fr', gap: 18, alignItems: 'start',
      }}
    >
      <Glyph kind={glyph} />
      <div>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em', fontFamily: 'var(--font-display)' }}>{title}</h3>
        <p style={{ margin: '8px 0 0', color: 'var(--ink-dim)', fontSize: 15, lineHeight: 1.55, textWrap: 'pretty' }}>{body}</p>
      </div>
    </div>
  );
}

function Glyph({ kind }) {
  const common = { width: 40, height: 40, viewBox: '0 0 40 40', fill: 'none' };
  const stroke = 'var(--ink)';
  return (
    <div style={{
      width: 44, height: 44, borderRadius: 12,
      background: 'var(--accent-soft)',
      border: '1px solid var(--line)',
      display: 'grid', placeItems: 'center',
    }}>
      {kind === 'world' && (
        <svg {...common}><circle cx="20" cy="20" r="12" stroke={stroke} strokeWidth="1.4"/><ellipse cx="20" cy="20" rx="5" ry="12" stroke={stroke} strokeWidth="1.4"/><path d="M8 20h24" stroke={stroke} strokeWidth="1.4"/></svg>
      )}
      {kind === 'long' && (
        <svg {...common}><rect x="8" y="14" width="24" height="12" rx="2" stroke={stroke} strokeWidth="1.4"/><path d="M12 14v-3M20 14v-3M28 14v-3M12 29v-3M20 29v-3M28 29v-3" stroke={stroke} strokeWidth="1.4" strokeLinecap="round"/></svg>
      )}
      {kind === 'eye' && (
        <svg {...common}><path d="M6 20c3-6 8-9 14-9s11 3 14 9c-3 6-8 9-14 9S9 26 6 20z" stroke={stroke} strokeWidth="1.4"/><circle cx="20" cy="20" r="3.5" fill="var(--accent)"/></svg>
      )}
      {kind === 'root' && (
        <svg {...common}><path d="M20 6v14M20 20l-8 8M20 20l8 8M20 20l-10-2M20 20l10-2" stroke={stroke} strokeWidth="1.4" strokeLinecap="round"/><circle cx="20" cy="20" r="2.5" fill="var(--accent)"/></svg>
      )}
      {kind === 'balance' && (
        <svg {...common}><circle cx="13" cy="20" r="6" stroke={stroke} strokeWidth="1.4"/><circle cx="27" cy="20" r="6" stroke={stroke} strokeWidth="1.4" strokeDasharray="2 2"/><path d="M7 20h12" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"/></svg>
      )}
    </div>
  );
}

// ───── Solutions band (1 agent. 10 channels.) ─────
function SolutionsBand() {
  return (
    <section style={{ padding: '100px 0', position: 'relative' }}>
      <div className="container">
        <Reveal>
          <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 72px)', margin: 0, textAlign: 'center', textWrap: 'balance' }}>
            One agent. Ten channels. <br/>
            <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>A thousand possibilities.</em>
          </h2>
        </Reveal>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 56 }}>
          {[
            {
              h: 'Multi-turn context.',
              b: 'Unlike scripted bots, Ayooda threads conversations across sessions — remembers your customer, the product, and the past ticket.',
            },
            {
              h: 'Deep integrations.',
              b: 'Connects to your CRM, helpdesk, docs, and product data — live, not cached.',
            },
            {
              h: 'Smart escalation.',
              b: 'Knows its limits. Routes to the right human with a compact summary of context.',
            },
          ].map((card, i) => (
            <Reveal key={card.h} delay={i * 80}>
              <div className="card" style={{ padding: '26px 24px', height: '100%' }}>
                <h3 style={{ margin: 0, fontSize: 22, fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.01em' }}>{card.h}</h3>
                <p style={{ margin: '12px 0 0', color: 'var(--ink-dim)', fontSize: 15, lineHeight: 1.55, textWrap: 'pretty' }}>{card.b}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Trust badges row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 48 }}>
          {[
            { badge: 'security', h: 'Security at the core.', b: 'Enterprise-grade encryption, scoped API keys, SSO, and strict access control by default.' },
            { badge: 'gdpr', h: 'GDPR-compliant.', b: 'Built to meet Europe’s strictest privacy standards — full audit trail and transparent data handling.' },
            { badge: 'eu', h: 'Europe-hosted.', b: 'All data stored and processed on EU servers. No data leaves the region without your explicit consent.' },
          ].map((b, i) => (
            <Reveal key={b.h} delay={i * 80}>
              <TrustBadge {...b} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustBadge({ badge, h, b }) {
  return (
    <div style={{
      display: 'flex', gap: 16, alignItems: 'flex-start',
      padding: '20px 22px',
      borderRadius: 'var(--r-lg)',
      border: '1px solid var(--line)',
      background: 'linear-gradient(180deg, var(--panel), transparent)',
    }}>
      <BadgeShield kind={badge} />
      <div>
        <h4 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{h}</h4>
        <p style={{ margin: '6px 0 0', color: 'var(--ink-mute)', fontSize: 13.5, lineHeight: 1.5 }}>{b}</p>
      </div>
    </div>
  );
}

function BadgeShield({ kind }) {
  return (
    <div style={{
      width: 44, height: 48,
      background: 'linear-gradient(180deg, var(--accent), color-mix(in oklab, var(--accent) 60%, #000))',
      clipPath: 'polygon(50% 0, 100% 18%, 100% 72%, 50% 100%, 0 72%, 0 18%)',
      display: 'grid', placeItems: 'center',
      flexShrink: 0,
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: '#1a0e08', letterSpacing: '0.08em' }}>
        {kind === 'security' ? 'SEC' : kind === 'gdpr' ? 'GDPR' : 'EU'}
      </span>
    </div>
  );
}

window.AyoodaSections1 = { LogoStrip, Why, SolutionsBand };
