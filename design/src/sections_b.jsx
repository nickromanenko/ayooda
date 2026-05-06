/* Ayooda — features, how-it-works, integrations */

const { useState: useStateB, useEffect: useEffectB, useRef: useRefB } = React;

// ───── Features (tabbed) ─────
function Features() {
  const tabs = [
    { key: 'integrate', label: 'Integrate', h: 'Resolve complex tickets with real context.',
      b: 'Ayooda connects to your tools through the Model Context Protocol — live data, live actions, real resolutions, not just redirections.', mock: 'integrate' },
    { key: 'activate', label: 'Activate', h: 'Launch AI support without writing code.',
      b: 'Anyone on your team can train and deploy Ayooda in minutes. No developers, no long onboarding, no surprises.', mock: 'activate' },
    { key: 'configure', label: 'Configure', h: 'Pick the brain that fits your business.',
      b: 'Claude, GPT, Llama, or your own model — Ayooda swaps backends instantly. You stay in control of data, tone, and spend.', mock: 'configure' },
    { key: 'workflow', label: 'Workflows', h: 'Design complex automations, visually.',
      b: 'Drag-and-drop flows to model triage, escalation, and routing logic. Every branch is auditable and testable.', mock: 'workflow' },
    { key: 'analytics', label: 'Analytics', h: 'Learn from every single conversation.',
      b: 'Resolution rate, CSAT, hand-off causes, confidence trends — all in real time, all exportable.', mock: 'analytics' },
    { key: 'train', label: 'Train', h: 'Your knowledge, always up to date.',
      b: 'Ayooda auto-syncs with helpdesk articles, docs, and product changes — no more stale answers.', mock: 'train' },
  ];

  const [active, setActive] = useStateB(0);
  const tab = tabs[active];

  return (
    <section id="features" style={{ padding: '100px 0' }}>
      <div className="container">
        <Reveal>
          <div className="eyebrow" style={{ marginBottom: 18 }}><span style={{ color: 'var(--accent)' }}>◆</span>  Features</div>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 68px)', margin: 0, maxWidth: 820, textWrap: 'balance' }}>
            Everything you need. <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Nothing you don’t.</em>
          </h2>
        </Reveal>

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 48, marginTop: 56 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderLeft: '1px solid var(--line)' }}>
            {tabs.map((t, i) => (
              <button
                key={t.key}
                onClick={() => setActive(i)}
                style={{
                  appearance: 'none', background: 'none', border: 'none',
                  textAlign: 'left', cursor: 'pointer',
                  padding: '16px 20px',
                  color: i === active ? 'var(--ink)' : 'var(--ink-mute)',
                  fontSize: 16, fontWeight: i === active ? 500 : 400,
                  borderLeft: `2px solid ${i === active ? 'var(--accent)' : 'transparent'}`,
                  marginLeft: -1,
                  transition: 'all .2s',
                  fontFamily: 'var(--font-sans)',
                }}
              >{t.label}</button>
            ))}
          </div>
          <div style={{ minHeight: 520 }}>
            <div key={tab.key} style={{ animation: 'fade-up .5s ease' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, maxWidth: 620, textWrap: 'balance' }}>
                {tab.h}
              </h3>
              <p style={{ color: 'var(--ink-dim)', fontSize: 16, lineHeight: 1.6, margin: '14px 0 26px', maxWidth: 560, textWrap: 'pretty' }}>{tab.b}</p>
              <FeatureMock kind={tab.mock} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureMock({ kind }) {
  const common = {
    borderRadius: 'var(--r-lg)',
    border: '1px solid var(--line)',
    background: 'linear-gradient(180deg, var(--panel), var(--bg-2))',
    padding: 26, height: 380,
    position: 'relative', overflow: 'hidden',
    boxShadow: 'var(--shadow-card)',
  };

  if (kind === 'integrate') {
    const tools = ['Shopify', 'Stripe', 'HubSpot', 'Notion', 'Zendesk', 'Linear', 'Segment', 'Salesforce'];
    return (
      <div style={common}>
        <div className="pill" style={{ marginBottom: 18 }}><span className="dot"/>MCP connections · live</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {tools.map((t, i) => (
            <div key={t} style={{
              padding: '12px 14px',
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: 'var(--bg-2)',
              fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
              animation: `fade-up .5s ${i * 0.06}s backwards ease`,
            }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: `oklch(70% 0.12 ${20 + i * 40})` }}/>
              {t}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 24, padding: 14, background: 'var(--bg)', borderRadius: 12, border: '1px dashed var(--line-2)', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          <div><span style={{ color: 'var(--accent)' }}>→</span> shopify.orders.refund(id: 8821, amount: 24.99)</div>
          <div><span style={{ color: 'var(--accent)' }}>→</span> stripe.customer.update(email: new@addr.com)</div>
          <div style={{ color: 'var(--mint)' }}>✓ refunded · customer notified · ticket closed (4.1s)</div>
        </div>
      </div>
    );
  }

  if (kind === 'activate') {
    return (
      <div style={common}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {['Describe your agent’s role', 'Upload your knowledge', 'Set a tone of voice', 'Go live'].map((s, i) => (
            <div key={s} style={{
              padding: '16px 18px', borderRadius: 12, border: '1px solid var(--line)',
              background: i <= 2 ? 'var(--panel)' : 'transparent',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <span style={{
                width: 26, height: 26, borderRadius: 50,
                background: i <= 2 ? 'var(--accent)' : 'transparent',
                border: i <= 2 ? 'none' : '1px dashed var(--line-2)',
                color: '#1a0e08', fontSize: 12, fontWeight: 700,
                display: 'grid', placeItems: 'center',
              }}>{i <= 2 ? '✓' : i + 1}</span>
              <span style={{ fontSize: 15, color: i <= 2 ? 'var(--ink)' : 'var(--ink-mute)' }}>{s}</span>
              {i === 2 && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>in progress…</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (kind === 'configure') {
    const models = [
      { n: 'Claude Sonnet 4.5', a: 'Anthropic', active: true },
      { n: 'GPT-5', a: 'OpenAI', active: false },
      { n: 'Llama 3.3 70B', a: 'Meta · self-hosted', active: false },
      { n: 'Custom endpoint', a: 'your.company.internal', active: false },
    ];
    return (
      <div style={common}>
        <div className="pill" style={{ marginBottom: 14 }}>Brain · swap any time</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {models.map(m => (
            <div key={m.n} style={{
              padding: '14px 16px', borderRadius: 12,
              border: `1px solid ${m.active ? 'var(--accent)' : 'var(--line)'}`,
              background: m.active ? 'var(--accent-soft)' : 'var(--bg-2)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ width: 10, height: 10, borderRadius: 50, background: m.active ? 'var(--accent)' : 'var(--ink-faint)' }}/>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 500 }}>{m.n}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{m.a}</div>
              </div>
              {m.active && <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>ACTIVE</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (kind === 'workflow') {
    return (
      <div style={common}>
        <svg viewBox="0 0 600 300" style={{ width: '100%', height: '100%' }}>
          <defs>
            <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0 0L6 4L0 8z" fill="var(--ink-mute)"/>
            </marker>
          </defs>
          {[
            { x: 40, y: 130, w: 120, h: 44, label: 'Incoming ticket', color: 'var(--panel)' },
            { x: 220, y: 80, w: 120, h: 44, label: 'Classify intent', color: 'var(--accent-soft)' },
            { x: 220, y: 180, w: 120, h: 44, label: 'Check SLA', color: 'var(--accent-soft)' },
            { x: 400, y: 50, w: 150, h: 44, label: 'Auto-resolve', color: 'var(--panel)' },
            { x: 400, y: 130, w: 150, h: 44, label: 'Ask for context', color: 'var(--panel)' },
            { x: 400, y: 210, w: 150, h: 44, label: 'Escalate to tier 2', color: 'var(--panel)' },
          ].map((n, i) => (
            <g key={i}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="8" fill={n.color} stroke="var(--line-2)"/>
              <text x={n.x + n.w / 2} y={n.y + n.h / 2 + 4} textAnchor="middle" fontSize="12" fill="var(--ink)" fontFamily="var(--font-sans)">{n.label}</text>
            </g>
          ))}
          {[
            ['160,152', '220,102'], ['160,152', '220,202'],
            ['340,102', '400,72'], ['340,102', '400,152'], ['340,202', '400,232'],
          ].map((p, i) => {
            const [a, b] = p;
            return <line key={i} x1={a.split(',')[0]} y1={a.split(',')[1]} x2={b.split(',')[0]} y2={b.split(',')[1]} stroke="var(--ink-mute)" strokeWidth="1.4" markerEnd="url(#arr)"/>;
          })}
        </svg>
      </div>
    );
  }

  if (kind === 'analytics') {
    const bars = [34, 52, 41, 68, 74, 62, 81, 77, 89, 82, 94, 88];
    return (
      <div style={common}>
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
            <div key={i} style={{
              flex: 1, height: `${b}%`, background: `linear-gradient(0deg, var(--accent), var(--accent-2))`,
              borderRadius: 4, opacity: 0.85,
              animation: `fade-up .7s ${i * 0.05}s backwards ease`,
            }}/>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)', marginTop: 6 }}>
          <span>Jan</span><span>Mar</span><span>May</span><span>Jul</span><span>Sep</span><span>Nov</span>
        </div>
      </div>
    );
  }

  if (kind === 'train') {
    return (
      <div style={common}>
        <div style={{ display: 'grid', gap: 10 }}>
          {[
            { t: 'Help Center — refund policy', s: 'synced 2m ago', ok: true },
            { t: 'Notion — product brief v12', s: 'synced 14m ago', ok: true },
            { t: 'Zendesk macros', s: 'syncing now…', ok: null },
            { t: 'Intercom articles', s: 'synced 1h ago', ok: true },
            { t: 'Internal runbook (PDF)', s: 'synced 6h ago', ok: true },
          ].map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 14, alignItems: 'center', padding: '14px 16px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 50, background: row.ok === null ? 'var(--accent)' : 'var(--mint)', animation: row.ok === null ? 'pulse-ring 1.4s infinite' : 'none' }}/>
              <span style={{ fontSize: 14 }}>{row.t}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{row.s}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

// ───── How It Works — 4 steps ─────
function HowItWorks() {
  const steps = [
    { n: '01', h: 'Feed Ayooda your knowledge.', b: 'Upload docs, FAQs, helpdesk articles, PDFs — whatever you have. Ayooda ingests and indexes it in minutes.' },
    { n: '02', h: 'Make it yours.', b: 'Tune the tone of voice, set routing rules, and decide what Ayooda is allowed to do autonomously.' },
    { n: '03', h: 'Test before you ship.', b: 'Use the sandbox — real chat widget, fake traffic — to stress-test every flow before a single customer sees it.' },
    { n: '04', h: 'Let it run.', b: 'Watch Ayooda handle conversations in real time. Review, tweak, and keep improving.' },
  ];

  return (
    <section id="how" style={{ padding: '100px 0', position: 'relative', background: 'var(--bg-2)' }}>
      <div className="container">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 56 }}>
          <Reveal><div className="eyebrow"><span style={{ color: 'var(--accent)' }}>◆</span>  How it works</div></Reveal>
          <Reveal delay={80}>
            <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 64px)', margin: '18px 0 14px', maxWidth: 760, textWrap: 'balance' }}>
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
              <div style={{
                padding: '26px 24px 30px',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-lg)',
                background: 'var(--panel)',
                height: '100%',
                display: 'flex', flexDirection: 'column',
              }}>
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
  );
}

function StepIllustration({ idx }) {
  const size = { width: '100%', height: 110 };
  if (idx === 0) return (
    <div style={{ ...size, display: 'flex', alignItems: 'flex-end', gap: 6, padding: 8, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--line)' }}>
      {['PDF', 'DOC', 'MD', 'CSV', 'URL'].map((t, i) => (
        <div key={t} style={{ flex: 1, height: `${40 + i * 14}%`, background: i % 2 ? 'var(--accent)' : 'var(--accent-2)', opacity: 0.8 + i * 0.04, borderRadius: 6, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, color: '#1a0e08', fontWeight: 700 }}>{t}</div>
      ))}
    </div>
  );
  if (idx === 1) return (
    <div style={{ ...size, padding: 10, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
      {[['Tone', 70], ['Caution', 40], ['Verbosity', 55]].map(([l, v]) => (
        <div key={l} style={{ display: 'grid', gridTemplateColumns: '62px 1fr', gap: 10, alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-mute)' }}>{l}</span>
          <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, width: `${v}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }}/>
            <div style={{ position: 'absolute', left: `calc(${v}% - 6px)`, top: -5, width: 14, height: 14, borderRadius: 50, background: 'var(--ink)', border: '3px solid var(--accent)' }}/>
          </div>
        </div>
      ))}
    </div>
  );
  if (idx === 2) return (
    <div style={{ ...size, padding: 10, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)' }}>
      <div>▶ running test suite…</div>
      <div style={{ color: 'var(--mint)' }}>✓ 23 / 24 conversations resolved</div>
      <div style={{ color: 'var(--accent)' }}>⚠ 1 escalated (low confidence)</div>
      <div style={{ marginTop: 'auto', color: 'var(--ink-faint)' }}>avg. 1.8s first reply</div>
    </div>
  );
  return (
    <div style={{ ...size, padding: 10, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <div style={{ width: 56, height: 56, borderRadius: 50, background: 'var(--accent)', display: 'grid', placeItems: 'center', animation: 'pulse-ring 2s infinite', color: '#1a0e08', fontWeight: 700 }}>A</div>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 12, border: '1px dashed var(--line-2)', animation: 'orbit-rotate 20s linear infinite' }}/>
    </div>
  );
}

// ───── Integrations Orbit ─────
function Integrations() {
  const inner = ['Slack', 'Gmail', 'Intercom', 'Zendesk'];
  const middle = ['Shopify', 'Stripe', 'HubSpot', 'Salesforce', 'Notion', 'Linear'];
  const outer = ['MCP', 'Webhooks', 'REST', 'GraphQL', 'SQL', 'S3', 'Segment', 'Zapier'];

  return (
    <section id="integrations" style={{ padding: '100px 0', position: 'relative', overflow: 'hidden' }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
          <div>
            <Reveal><div className="eyebrow" style={{ marginBottom: 16 }}><span style={{ color: 'var(--accent)' }}>◆</span>  Integrations</div></Reveal>
            <Reveal delay={80}>
              <h2 className="display" style={{ fontSize: 'clamp(36px, 4.4vw, 58px)', margin: 0, textWrap: 'balance' }}>
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
                <button className="btn btn-primary">Browse connectors</button>
                <button className="btn btn-ghost">Read the MCP docs</button>
              </div>
            </Reveal>
          </div>
          <div style={{ position: 'relative', height: 520 }}>
            <OrbitViz inner={inner} middle={middle} outer={outer} />
          </div>
        </div>
      </div>
    </section>
  );
}

function OrbitViz({ inner, middle, outer }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
      {/* Core */}
      <div style={{
        width: 92, height: 92, borderRadius: 50,
        background: 'radial-gradient(circle at 30% 30%, var(--accent-2), var(--accent))',
        display: 'grid', placeItems: 'center',
        fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500, color: '#1a0e08',
        boxShadow: '0 10px 50px rgba(255,118,77,0.4)',
        animation: 'float 4s ease-in-out infinite',
        zIndex: 3,
      }}>Ayooda</div>

      <OrbitRing radius={130} items={inner} duration={40} size={52} fontSize={11} />
      <OrbitRing radius={200} items={middle} duration={70} reverse size={54} fontSize={11} />
      <OrbitRing radius={260} items={outer} duration={100} size={48} fontSize={10} dashed />
    </div>
  );
}

function OrbitRing({ radius, items, duration, reverse, size = 50, fontSize = 11, dashed }) {
  return (
    <div style={{
      position: 'absolute',
      width: radius * 2, height: radius * 2,
      borderRadius: '50%',
      border: `1px ${dashed ? 'dashed' : 'solid'} var(--line)`,
      animation: `orbit-rotate ${duration}s linear infinite ${reverse ? 'reverse' : ''}`,
    }}>
      {items.map((it, i) => {
        const angle = (i / items.length) * Math.PI * 2;
        const x = Math.cos(angle) * radius + radius;
        const y = Math.sin(angle) * radius + radius;
        return (
          <div key={it} style={{
            position: 'absolute',
            left: x - size / 2, top: y - size / 2,
            width: size, height: size,
            borderRadius: 50,
            background: 'var(--panel)',
            border: '1px solid var(--line-2)',
            display: 'grid', placeItems: 'center',
            fontSize, fontWeight: 500, color: 'var(--ink-dim)',
            animation: `orbit-rotate ${duration}s linear infinite ${reverse ? '' : 'reverse'}`,
            boxShadow: 'var(--shadow-soft)',
          }}>
            {it}
          </div>
        );
      })}
    </div>
  );
}

window.AyoodaSections2 = { Features, HowItWorks, Integrations };
