'use client'

/**
 * An agent's visual identity. Renders the uploaded logo when there is one, and
 * otherwise a deterministic initial-letter chip — so an agent is never blank,
 * including in the creation form before anything has been uploaded.
 */

const PALETTES: ReadonlyArray<readonly [string, string]> = [
  ['#6366f1', '#8b5cf6'],
  ['#0ea5e9', '#22d3ee'],
  ['#f59e0b', '#f97316'],
  ['#10b981', '#14b8a6'],
  ['#ec4899', '#f43f5e'],
  ['#8b5cf6', '#d946ef'],
]

/** Stable across renders and reloads: same seed always yields the same gradient. */
function paletteFor(seed: string): readonly [string, string] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTES[h % PALETTES.length]!
}

function initial(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed[0]!.toUpperCase() : '?'
}

export default function AgentAvatar({
  name,
  photoURL,
  seed,
  size = 40,
}: {
  name: string
  photoURL: string | null
  /** Usually the agent id. Falls back to the name so the form can render before an id exists. */
  seed?: string
  size?: number
}) {
  const box: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 'var(--r-sm)',
    flexShrink: 0,
    objectFit: 'cover',
    display: 'block',
  }

  if (photoURL) {
    // eslint-disable-next-line @next/next/no-img-element -- external Storage URL, no loader configured
    return <img src={photoURL} alt="" style={box} />
  }

  const [from, to] = paletteFor(seed || name || 'agent')
  return (
    <div
      aria-hidden
      style={{
        ...box,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      {initial(name)}
    </div>
  )
}
