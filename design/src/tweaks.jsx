/* Ayooda — Tweaks panel (accent, theme, font pairing, hero copy) */

const { useState: useStateT, useEffect: useEffectT } = React;

const TWEAK_PRESETS = {
  accents: [
    { key: 'coral', label: 'Coral', v: { accent: '#ff764d', accent2: '#ffb38a', soft: 'rgba(255, 118, 77, 0.14)' } },
    { key: 'amber', label: 'Amber', v: { accent: '#f5a524', accent2: '#ffd27a', soft: 'rgba(245, 165, 36, 0.14)' } },
    { key: 'lime', label: 'Lime', v: { accent: '#9dd458', accent2: '#cbe89d', soft: 'rgba(157, 212, 88, 0.14)' } },
    { key: 'cyan', label: 'Cyan', v: { accent: '#5bc8e8', accent2: '#a2e0ef', soft: 'rgba(91, 200, 232, 0.14)' } },
    { key: 'violet', label: 'Violet', v: { accent: '#b58bff', accent2: '#d5bbff', soft: 'rgba(181, 139, 255, 0.14)' } },
    { key: 'rose', label: 'Rose', v: { accent: '#f16a9e', accent2: '#ffb2cf', soft: 'rgba(241, 106, 158, 0.14)' } },
  ],
  fontPairings: [
    { key: 'fraunces-geist', label: 'Fraunces × Geist', display: '"Fraunces", ui-serif, Georgia, serif', sans: '"Geist", ui-sans-serif, system-ui, sans-serif' },
    { key: 'instrument-geist', label: 'Instrument × Geist', display: '"Instrument Serif", ui-serif, Georgia, serif', sans: '"Geist", ui-sans-serif, system-ui, sans-serif' },
    { key: 'playfair-inter', label: 'Playfair × Inter', display: '"Playfair Display", ui-serif, Georgia, serif', sans: '"Inter", ui-sans-serif, system-ui, sans-serif' },
    { key: 'sans-only', label: 'Geist × Geist', display: '"Geist", ui-sans-serif, system-ui, sans-serif', sans: '"Geist", ui-sans-serif, system-ui, sans-serif' },
  ],
};

function applyTweaks(tw) {
  const r = document.documentElement;
  const a = TWEAK_PRESETS.accents.find(x => x.key === tw.accent) || TWEAK_PRESETS.accents[0];
  r.style.setProperty('--accent', a.v.accent);
  r.style.setProperty('--accent-2', a.v.accent2);
  r.style.setProperty('--accent-soft', a.v.soft);
  r.setAttribute('data-theme', tw.theme);
  const f = TWEAK_PRESETS.fontPairings.find(x => x.key === tw.fonts) || TWEAK_PRESETS.fontPairings[0];
  r.style.setProperty('--font-display', f.display);
  r.style.setProperty('--font-sans', f.sans);
}

function TweaksPanel({ tweaks, setTweaks, visible, onClose }) {
  useEffectT(() => { applyTweaks(tweaks); }, [tweaks]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', right: 20, bottom: 20, zIndex: 100,
      width: 320,
      padding: 18,
      borderRadius: 16,
      background: 'color-mix(in oklab, var(--panel) 94%, transparent)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      border: '1px solid var(--line-2)',
      boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      fontFamily: 'var(--font-sans)',
      color: 'var(--ink)',
      animation: 'fade-up .3s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Design controls</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em' }}>Tweaks</div>
        </div>
        <button onClick={onClose} style={{
          all: 'unset', cursor: 'pointer',
          width: 26, height: 26, borderRadius: 50,
          border: '1px solid var(--line-2)',
          display: 'grid', placeItems: 'center',
          color: 'var(--ink-dim)', fontSize: 14,
        }}>×</button>
      </div>

      {/* Theme */}
      <TweakRow label="Theme">
        <SegSwitch
          options={[['dark', 'Dark'], ['light', 'Light']]}
          value={tweaks.theme}
          onChange={v => setTweaks({ ...tweaks, theme: v })}
        />
      </TweakRow>

      {/* Accent */}
      <TweakRow label="Accent">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TWEAK_PRESETS.accents.map(a => (
            <button
              key={a.key}
              onClick={() => setTweaks({ ...tweaks, accent: a.key })}
              title={a.label}
              style={{
                all: 'unset', cursor: 'pointer',
                width: 28, height: 28, borderRadius: 50,
                background: a.v.accent,
                outline: tweaks.accent === a.key ? '2px solid var(--ink)' : '2px solid transparent',
                outlineOffset: 2,
                transition: 'transform .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'none'}
            />
          ))}
        </div>
      </TweakRow>

      {/* Fonts */}
      <TweakRow label="Font pairing">
        <select
          value={tweaks.fonts}
          onChange={e => setTweaks({ ...tweaks, fonts: e.target.value })}
          style={{
            width: '100%', padding: '8px 10px',
            background: 'var(--bg-2)', color: 'var(--ink)',
            border: '1px solid var(--line)', borderRadius: 8,
            fontFamily: 'var(--font-sans)', fontSize: 13,
          }}
        >
          {TWEAK_PRESETS.fontPairings.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </TweakRow>

      {/* Hero headline copy */}
      <TweakRow label="Hero number">
        <SegSwitch
          options={[['40', '40%'], ['60', '60%'], ['80', '80%']]}
          value={tweaks.heroPct}
          onChange={v => setTweaks({ ...tweaks, heroPct: v })}
        />
      </TweakRow>

      <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: 'var(--bg-2)', border: '1px dashed var(--line-2)', fontSize: 11.5, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
        Changes apply live. Toggle the panel with the Tweaks button in the toolbar.
      </div>
    </div>
  );
}

function TweakRow({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

function SegSwitch({ options, value, onChange }) {
  return (
    <div style={{
      display: 'inline-flex',
      padding: 3, borderRadius: 8,
      background: 'var(--bg-2)', border: '1px solid var(--line)',
    }}>
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)} style={{
          all: 'unset', cursor: 'pointer',
          padding: '6px 12px', borderRadius: 6,
          fontSize: 12, fontWeight: 500,
          color: value === k ? 'var(--ink)' : 'var(--ink-mute)',
          background: value === k ? 'var(--panel)' : 'transparent',
          transition: 'all .15s',
        }}>{l}</button>
      ))}
    </div>
  );
}

window.AyoodaTweaks = { TweaksPanel, applyTweaks, TWEAK_PRESETS };
