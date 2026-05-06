/* Ayooda — testimonials, pricing, faq, footer */

const { useState: useStateC, useEffect: useEffectC, useMemo: useMemoC } = React;

// ───── Testimonials ─────
function Testimonials() {
  const quotes = [
    {
      q: "Around 60% of our tickets are now resolved without a human touching them. Ayooda handles them end-to-end — routing, lookups, even refunds.",
      name: 'Antonia Renard', role: 'Marketing Director', company: 'AFS Foil',
    },
    {
      q: "The impact was immediate. Ayooda now handles all incoming chats and autonomously resolves about 40% of them, freeing the team for real problems.",
      name: 'Geoff Sarem', role: 'Head of Operations', company: 'Emmatt',
    },
    {
      q: "Roughly 40% of requests are fully automated. The rest escalate cleanly to us — with summaries — so quality never slips even as we scale.",
      name: 'Jim Cohen', role: 'CEO', company: 'Spidervo',
    },
  ];
  return (
    <section id="cases" style={{ padding: '100px 0', background: 'var(--bg-2)' }}>
      <div className="container">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 56 }}>
          <Reveal><div className="eyebrow"><span style={{ color: 'var(--accent)' }}>◆</span>  Case studies</div></Reveal>
          <Reveal delay={80}>
            <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 64px)', margin: '18px 0 0', maxWidth: 760, textWrap: 'balance' }}>
              Real teams. <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Real results.</em>
            </h2>
          </Reveal>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {quotes.map((t, i) => (
            <Reveal key={i} delay={i * 90}>
              <QuoteCard {...t} idx={i} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function QuoteCard({ q, name, role, company, idx }) {
  return (
    <article style={{
      padding: '28px 28px 24px',
      borderRadius: 'var(--r-lg)',
      border: '1px solid var(--line)',
      background: 'var(--panel)',
      display: 'flex', flexDirection: 'column', height: '100%',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -10, right: 22,
        fontFamily: 'var(--font-display)', fontSize: 110, color: 'var(--accent-soft)',
        lineHeight: 1, pointerEvents: 'none',
      }}>“</div>
      {/* Portrait placeholder */}
      <div style={{
        width: '100%', height: 130,
        borderRadius: 12,
        marginBottom: 22,
        background: `linear-gradient(135deg, oklch(70% 0.12 ${40 + idx * 80}), oklch(85% 0.08 ${100 + idx * 60}))`,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 12px, transparent 12px 24px)',
        }}/>
        <div style={{
          position: 'absolute', bottom: 10, left: 12,
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(0,0,0,0.5)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>portrait · {company}</div>
      </div>
      <p style={{ fontSize: 15.5, lineHeight: 1.6, color: 'var(--ink)', margin: 0, flex: 1, textWrap: 'pretty' }}>
        “{q}”
      </p>
      <div style={{ borderTop: '1px solid var(--line)', marginTop: 22, paddingTop: 16 }}>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>{role} · {company}</div>
      </div>
    </article>
  );
}

// ───── Pricing with slider ─────
function Pricing() {
  const [convos, setConvos] = useStateC(500);
  const cost = (convos * 0.05).toFixed(2);

  const plans = [
    { name: 'Mini', price: 45, color: 'var(--blue)', feats: ['Collaborative inbox', '$5 AI conversations', 'Email + live chat', '1 agent seat'] },
    { name: 'Essentials', price: 95, color: 'var(--accent)', feats: ['Everything in Mini', '$25 AI conversations', 'Helpdesk + macros', 'Up to 4 seats'], featured: true },
    { name: 'Plus', price: 295, color: 'var(--violet)', feats: ['Everything in Essentials', '$95 AI conversations', 'MCP + workflows', 'Unlimited seats + SSO'] },
  ];

  return (
    <section id="pricing" style={{ padding: '100px 0' }}>
      <div className="container">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 56 }}>
          <Reveal><div className="eyebrow"><span style={{ color: 'var(--accent)' }}>◆</span>  Pricing</div></Reveal>
          <Reveal delay={80}>
            <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 64px)', margin: '18px 0 14px', maxWidth: 760, textWrap: 'balance' }}>
              No surprises. <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>No hidden fees.</em>
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p style={{ color: 'var(--ink-dim)', fontSize: 17, maxWidth: 560, margin: 0 }}>
              Pay a simple monthly membership, then usage-based AI pricing at $0.05 per resolved conversation.
            </p>
          </Reveal>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 36 }}>
          {plans.map((p, i) => (
            <Reveal key={p.name} delay={i * 90}>
              <PlanCard plan={p} />
            </Reveal>
          ))}
        </div>

        {/* Usage slider */}
        <Reveal>
          <div style={{
            padding: '26px 28px',
            borderRadius: 'var(--r-lg)',
            border: '1px solid var(--line)',
            background: 'var(--panel)',
            display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 40, alignItems: 'center',
          }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Estimate your bill</div>
              <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500, margin: '0 0 16px', letterSpacing: '-0.01em' }}>
                Drag to estimate your monthly AI conversations.
              </h4>
              <input
                type="range" min="50" max="5000" step="10" value={convos}
                onChange={e => setConvos(+e.target.value)}
                style={{
                  width: '100%', accentColor: 'var(--accent)',
                  height: 6,
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>
                <span>50</span><span>5,000+</span>
              </div>
            </div>
            <div style={{
              padding: '24px 28px',
              borderRadius: 14,
              background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 60%, #000) 100%)',
              color: '#1a0e08',
              textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.75 }}>Estimated monthly</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 56, letterSpacing: '-0.03em', fontWeight: 500, marginTop: 4 }}>
                ${cost}
              </div>
              <div style={{ fontSize: 12.5, opacity: 0.8 }}>{convos.toLocaleString()} conversations · $0.05 each</div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function PlanCard({ plan }) {
  return (
    <div style={{
      padding: '28px 26px 24px',
      borderRadius: 'var(--r-lg)',
      border: `1px solid ${plan.featured ? 'var(--accent)' : 'var(--line)'}`,
      background: plan.featured ? 'linear-gradient(180deg, var(--accent-soft), var(--panel))' : 'var(--panel)',
      position: 'relative',
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {plan.featured && (
        <span style={{
          position: 'absolute', top: -10, right: 18,
          padding: '3px 10px', borderRadius: 999,
          background: 'var(--accent)', color: '#1a0e08',
          fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.06em',
        }}>MOST POPULAR</span>
      )}
      <div style={{
        width: 42, height: 42, borderRadius: 12,
        background: plan.color, marginBottom: 16, opacity: 0.9,
      }}/>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 4 }}>
        Membership
      </div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, margin: 0, letterSpacing: '-0.02em' }}>{plan.name}</h3>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '14px 0 18px' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 52, fontWeight: 500, letterSpacing: '-0.03em' }}>${plan.price}</span>
        <span style={{ color: 'var(--ink-mute)', fontSize: 14 }}>/ month</span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8, flex: 1 }}>
        {plan.feats.map(f => (
          <li key={f} style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--ink-dim)' }}>
            <span style={{ color: 'var(--accent)', flexShrink: 0 }}>✓</span>{f}
          </li>
        ))}
      </ul>
      <button className={plan.featured ? 'btn btn-primary' : 'btn btn-ghost'} style={{ marginTop: 22, justifyContent: 'center' }}>
        Start free trial
      </button>
    </div>
  );
}

// ───── FAQ ─────
function FAQ() {
  const faqs = [
    { q: "What exactly is Ayooda?", a: "Ayooda is an AI support agent that answers customer questions, takes actions in your tools, and escalates to humans when it should. It plugs into your existing helpdesk rather than replacing it." },
    { q: "How accurate are the answers?", a: "Every reply is grounded in your data — docs, knowledge base, CRM, product. Ayooda cites the source internally and abstains when it isn't confident, routing the ticket to a human instead of guessing." },
    { q: "What if Ayooda gets something wrong?", a: "It admits it, flags the ticket for review, and hands off with full context. You can label outcomes in the dashboard — Ayooda learns from your corrections automatically." },
    { q: "Which channels does it work on?", a: "Live chat, email, WhatsApp, Messenger, Instagram, SMS, Slack, in-app widgets — anywhere your customers already write to you." },
    { q: "Will it replace my support team?", a: "No. It takes the repetitive 40–60% of volume off your queue so your team can focus on the hard, human-facing problems — where they actually add value." },
    { q: "How long to get started?", a: "Most teams go live within an afternoon. If you have docs and a helpdesk, setup is a matter of minutes. No engineering required." },
  ];

  return (
    <section id="faq" style={{ padding: '100px 0', background: 'var(--bg-2)' }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 80 }}>
          <div>
            <Reveal><div className="eyebrow" style={{ marginBottom: 16 }}><span style={{ color: 'var(--accent)' }}>◆</span>  FAQ</div></Reveal>
            <Reveal delay={80}>
              <h2 className="display" style={{ fontSize: 'clamp(36px, 4.4vw, 56px)', margin: 0, textWrap: 'balance' }}>
                Got questions? <br/>
                <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>We’ve got answers.</em>
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <p style={{ color: 'var(--ink-dim)', marginTop: 22, fontSize: 15, lineHeight: 1.6, maxWidth: 340 }}>
                Still curious? Ask Ayooda directly — she’ll hand you off to a human if she doesn’t know.
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
  );
}

function FAQItem({ q, a, defaultOpen }) {
  const [open, setOpen] = useStateC(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          all: 'unset', cursor: 'pointer',
          padding: '22px 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>{q}</span>
        <span style={{
          width: 28, height: 28, borderRadius: 50, border: '1px solid var(--line-2)',
          display: 'grid', placeItems: 'center',
          transform: `rotate(${open ? 45 : 0}deg)`, transition: 'transform .25s',
          color: 'var(--ink-dim)', fontSize: 14,
        }}>+</span>
      </button>
      <div style={{
        maxHeight: open ? 200 : 0, overflow: 'hidden',
        transition: 'max-height .35s ease, opacity .3s',
        opacity: open ? 1 : 0,
      }}>
        <p style={{ paddingBottom: 22, margin: 0, color: 'var(--ink-dim)', fontSize: 15, lineHeight: 1.6, maxWidth: 620, textWrap: 'pretty' }}>{a}</p>
      </div>
    </div>
  );
}

// ───── Final CTA + Footer ─────
function FinalCTA() {
  return (
    <section style={{ padding: '120px 0', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 60% at 50% 50%, var(--accent-soft), transparent 70%)',
      }}/>
      <div aria-hidden className="grid-bg" style={{
        position: 'absolute', inset: 0,
        maskImage: 'radial-gradient(ellipse 60% 50% at 50% 50%, #000 40%, transparent 90%)',
        WebkitMaskImage: 'radial-gradient(ellipse 60% 50% at 50% 50%, #000 40%, transparent 90%)',
        opacity: 0.5, pointerEvents: 'none',
      }}/>
      <div className="container" style={{ position: 'relative', textAlign: 'center' }}>
        <Reveal>
          <h2 className="display" style={{ fontSize: 'clamp(48px, 6.6vw, 92px)', margin: 0, maxWidth: 900, marginInline: 'auto', textWrap: 'balance' }}>
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
            <button className="btn btn-primary">Start free trial</button>
            <button className="btn btn-ghost">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 1l9 5-9 5V1z" fill="currentColor"/></svg>
              Watch demo
            </button>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', margin: 0 }}>
            14-DAY FREE TRIAL · NO CARD REQUIRED
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{ padding: '60px 0 40px', borderTop: '1px solid var(--line)' }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr repeat(3, 1fr)', gap: 40, marginBottom: 40 }}>
          <div>
            <Logo />
            <p style={{ marginTop: 14, color: 'var(--ink-mute)', fontSize: 13, maxWidth: 260, lineHeight: 1.5 }}>
              The AI support agent your customers will want to talk to.
            </p>
          </div>
          {[
            { h: 'Product', links: ['Features', 'Integrations', 'Pricing', 'Changelog'] },
            { h: 'Company', links: ['About', 'Customers', 'Careers', 'Blog'] },
            { h: 'Resources', links: ['Docs', 'MCP guide', 'Status', 'Contact'] },
          ].map(col => (
            <div key={col.h}>
              <div className="eyebrow" style={{ marginBottom: 14 }}>{col.h}</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {col.links.map(l => (
                  <li key={l}>
                    <a href="#" style={{ fontSize: 13.5, color: 'var(--ink-dim)' }}>{l}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'space-between', paddingTop: 24, borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)' }}>
          <span>© 2026 Ayooda · All rights reserved</span>
          <span>Made for the humans behind the inbox.</span>
        </div>
      </div>
    </footer>
  );
}

window.AyoodaSections3 = { Testimonials, Pricing, FAQ, FinalCTA, Footer };
