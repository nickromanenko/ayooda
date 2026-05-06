/* Ayooda — an original AI support agent landing page.
   Original copy, original layout, original visual language.
*/

const { useState, useEffect, useRef, useMemo } = React;

// ───── tiny utilities ─────
function useInView(threshold = 0.15) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect(); } },
      { threshold }
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return [ref, inView];
}

function Reveal({ children, delay = 0, as: Tag = 'div', style, ...rest }) {
  const [ref, inView] = useInView(0.12);
  return (
    <Tag
      ref={ref}
      className={`reveal ${inView ? 'in' : ''}`}
      style={{ transitionDelay: `${delay}ms`, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// Ayooda wordmark — original geometric logo
function Logo({ size = 22, color }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: color || 'var(--ink)' }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="4" fill="var(--accent)" />
        <path d="M2.5 12h6M15.5 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, letterSpacing: '-0.02em', fontSize: 18 }}>
        Ayooda
      </span>
    </div>
  );
}

// ───── Top Nav ─────
function Nav({ theme, onToggleTheme, showTweaksBtn, onOpenTweaks }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    ['Why', '#why'],
    ['Features', '#features'],
    ['How it works', '#how'],
    ['Pricing', '#pricing'],
    ['FAQ', '#faq'],
  ];

  return (
    <header
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        padding: '14px 0',
        background: scrolled ? 'color-mix(in oklab, var(--bg) 82%, transparent)' : 'transparent',
        backdropFilter: scrolled ? 'blur(14px) saturate(130%)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(14px) saturate(130%)' : 'none',
        borderBottom: scrolled ? '1px solid var(--line)' : '1px solid transparent',
        transition: 'background .3s ease, border-color .3s ease, backdrop-filter .3s ease',
      }}
    >
      <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <a href="#top"><Logo /></a>
        <nav style={{ display: 'flex', gap: 22, marginLeft: 16 }}>
          {links.map(([label, href]) => (
            <a key={href} href={href} style={{
              fontSize: 13.5, color: 'var(--ink-dim)', fontWeight: 450,
              transition: 'color .15s',
            }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--ink)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--ink-dim)'}
            >{label}</a>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost" style={{ padding: '9px 14px', fontSize: 13 }}>Sign in</button>
          <button className="btn btn-primary" style={{ padding: '9px 14px', fontSize: 13 }}>Start free →</button>
        </div>
      </div>
    </header>
  );
}

// ───── Hero ─────
function Hero() {
  return (
    <section id="top" style={{ position: 'relative', paddingTop: 140, paddingBottom: 80, overflow: 'hidden' }}>
      {/* Ambient glow */}
      <div aria-hidden style={{
        position: 'absolute', top: -200, left: '50%', transform: 'translateX(-50%)',
        width: 1100, height: 1100, borderRadius: '50%',
        background: 'radial-gradient(closest-side, var(--accent-soft), transparent 70%)',
        pointerEvents: 'none',
      }}/>
      <div aria-hidden className="grid-bg" style={{
        position: 'absolute', inset: 0,
        maskImage: 'radial-gradient(ellipse 70% 50% at 50% 30%, #000 40%, transparent 90%)',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 50% at 50% 30%, #000 40%, transparent 90%)',
        opacity: 0.6, pointerEvents: 'none',
      }}/>

      <div className="container" style={{ position: 'relative' }}>
        <Reveal>
          <div className="pill" style={{ margin: '0 auto', display: 'inline-flex' }}>
            <span className="dot" /> New — Model Context Protocol support
          </div>
        </Reveal>

        <h1 className="display" style={{
          fontSize: 'clamp(48px, 7.2vw, 104px)',
          margin: '28px 0 22px',
          textAlign: 'center',
          maxWidth: 1000,
          marginInline: 'auto',
        }}>
          <Reveal as="span" style={{ display: 'block' }}>
            Resolve <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>up&nbsp;to&nbsp;60%</em> of
          </Reveal>
          <Reveal as="span" delay={120} style={{ display: 'block' }}>
            your support tickets.
          </Reveal>
        </h1>

        <Reveal delay={220}>
          <p style={{
            textAlign: 'center',
            fontSize: 19, color: 'var(--ink-dim)',
            maxWidth: 620, margin: '0 auto 34px',
            lineHeight: 1.5, textWrap: 'pretty',
          }}>
            Ayooda takes the repetitive volume off your queue, so your team stops
            firefighting and gets back to delivering real, human support.
          </p>
        </Reveal>

        <Reveal delay={340}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <button className="btn btn-primary">Start free trial</button>
            <button className="btn btn-ghost">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 1l9 5-9 5V1z" fill="currentColor"/></svg>
              Watch 90-sec demo
            </button>
          </div>
        </Reveal>

        <Reveal delay={440}>
          <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
            14-DAY FREE TRIAL · NO CARD REQUIRED
          </p>
        </Reveal>

        {/* Hero demo — chat interaction */}
        <Reveal delay={560}>
          <div style={{ marginTop: 60 }}>
            <ChatDemo />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ───── Live-animated chat demo ─────
function ChatDemo() {
  const script = useMemo(() => [
    { who: 'user', text: "My order #4421 hasn't shipped yet — it's been 5 days." , delay: 900 },
    { who: 'ayooda', typing: 1200, text: "Let me check that for you right now." , delay: 600 },
    { who: 'tool', text: "→ orders.lookup(id: 4421)", delay: 900 },
    { who: 'ayooda', typing: 1400, text: "Your order was held for address verification. I've confirmed the address on file and released it — it ships today via DHL Express, ETA Wed Apr 22.", delay: 400 },
    { who: 'user', text: "Oh! Can you also update the delivery address?", delay: 700 },
    { who: 'ayooda', typing: 1100, text: "Of course. What's the new address?", delay: 400 },
  ], []);

  const [step, setStep] = useState(0);
  const [typing, setTyping] = useState(false);
  const timeoutsRef = useRef([]);

  useEffect(() => {
    // reset timers
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    let elapsed = 0;
    let idx = 0;
    const queue = () => {
      if (idx >= script.length) {
        // restart the loop after a pause
        timeoutsRef.current.push(setTimeout(() => { setStep(0); idx = 0; elapsed = 0; queue(); }, 3500));
        return;
      }
      const item = script[idx];
      if (item.typing) {
        timeoutsRef.current.push(setTimeout(() => setTyping(true), elapsed + item.delay));
        timeoutsRef.current.push(setTimeout(() => { setTyping(false); setStep(idx + 1); }, elapsed + item.delay + item.typing));
        elapsed += item.delay + item.typing + 300;
      } else {
        timeoutsRef.current.push(setTimeout(() => setStep(idx + 1), elapsed + item.delay));
        elapsed += item.delay + 600;
      }
      idx++;
      queue();
    };
    queue();

    return () => timeoutsRef.current.forEach(clearTimeout);
  }, [script]);

  const visible = script.slice(0, step);

  return (
    <div style={{
      margin: '0 auto', maxWidth: 860,
      position: 'relative',
      padding: 14,
      borderRadius: 28,
      background: 'linear-gradient(180deg, color-mix(in oklab, var(--panel) 90%, transparent), var(--panel))',
      border: '1px solid var(--line)',
      boxShadow: 'var(--shadow-card)',
    }}>
      {/* Window chrome */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px 10px', borderBottom: '1px solid var(--line)',
        marginBottom: 12,
      }}>
        <span style={{ width: 10, height: 10, borderRadius: 50, background: '#ff6057' }}/>
        <span style={{ width: 10, height: 10, borderRadius: 50, background: '#ffbd2e' }}/>
        <span style={{ width: 10, height: 10, borderRadius: 50, background: '#27c93f' }}/>
        <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
          live · ayooda agent · resolution time 00:04.1
        </div>
      </div>

      <div style={{ minHeight: 360, padding: '8px 14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {visible.map((m, i) => <ChatBubble key={i} m={m} />)}
        {typing && <TypingIndicator />}
      </div>

      {/* Composer */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', margin: '0 6px 6px',
        borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--line)',
      }}>
        <div style={{ fontSize: 13, color: 'var(--ink-faint)' }}>Type a message…</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--panel-2)', display: 'grid', placeItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="var(--ink-mute)" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </div>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l5-5 5 5M7 2v11" stroke="#1a0e08" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ m }) {
  const isUser = m.who === 'user';
  const isTool = m.who === 'tool';

  if (isTool) {
    return (
      <div style={{
        alignSelf: 'flex-start',
        fontFamily: 'var(--font-mono)',
        fontSize: 11.5,
        color: 'var(--ink-mute)',
        background: 'var(--bg-2)',
        border: '1px dashed var(--line-2)',
        padding: '6px 10px',
        borderRadius: 8,
        animation: 'fade-up .4s ease',
      }}>
        {m.text}
      </div>
    );
  }

  return (
    <div style={{
      alignSelf: isUser ? 'flex-end' : 'flex-start',
      maxWidth: '76%',
      display: 'flex', gap: 10, flexDirection: isUser ? 'row-reverse' : 'row',
      animation: 'fade-up .4s ease',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 50, flexShrink: 0,
        background: isUser ? 'var(--panel-2)' : 'var(--accent)',
        display: 'grid', placeItems: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
        color: isUser ? 'var(--ink-dim)' : '#1a0e08',
        border: '1px solid var(--line)',
      }}>
        {isUser ? 'M' : 'A'}
      </div>
      <div style={{
        background: isUser ? 'var(--panel-2)' : 'var(--bg-2)',
        border: '1px solid var(--line)',
        padding: '10px 14px',
        borderRadius: 14,
        borderTopLeftRadius: isUser ? 14 : 4,
        borderTopRightRadius: isUser ? 4 : 14,
        fontSize: 14.5, lineHeight: 1.5,
        color: 'var(--ink)',
      }}>
        {m.text}
      </div>
    </div>
  );
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
          }}/>
        ))}
      </div>
    </div>
  );
}

// Expose commonly-used helpers globally so sibling babel scripts can use them
Object.assign(window, { Reveal, Logo, useInView });
window.AyoodaCore = { Nav, Hero, Logo, Reveal, useInView };
