'use client'

import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { SCENES } from './demo-scenes'
import { clamp } from './demo-kit'
import s from './ProductDemo.module.css'

const HOLD = 1600
const TICK = 50

export function ProductDemo() {
  const [state, setState] = useState({ active: 0, t: 0 })
  const [paused, setPaused] = useState(false)
  const [inView, setInView] = useState(false)
  const [reduced, setReduced] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!inView || paused || reduced) return
    let last = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      const dt = now - last
      last = now
      setState((prev) => {
        const t = prev.t + dt
        if (t > SCENES[prev.active].duration + HOLD) return { active: (prev.active + 1) % SCENES.length, t: 0 }
        return { active: prev.active, t }
      })
    }, TICK)
    return () => window.clearInterval(id)
  }, [inView, paused, reduced])

  const scene = SCENES[state.active]
  const shownT = reduced ? scene.duration + 5000 : state.t
  const select = (i: number) => setState({ active: i, t: 0 })

  return (
    <div ref={rootRef} id="demo" className={s.demo}>
      <div className={s.tabs} role="tablist" aria-label="Product demo scenes">
        {SCENES.map((sc, i) => {
          const on = i === state.active
          return (
            <button
              key={sc.id}
              type="button"
              role="tab"
              id={`demo-tab-${sc.id}`}
              aria-selected={on}
              aria-controls="demo-stage"
              className={s.tab}
              data-active={on}
              onClick={() => select(i)}
            >
              <span className={s.tabLabel}>{sc.label}</span>
              <span className={s.tabDesc}>{sc.desc}</span>
              <span className={s.tabBar} aria-hidden="true">
                <i style={{ width: on ? `${reduced ? 100 : clamp(state.t / (sc.duration + HOLD)) * 100}%` : '0%' }} />
              </span>
            </button>
          )
        })}
        <button
          type="button"
          className={s.playToggle}
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? 'Play demo' : 'Pause demo'}
          disabled={reduced}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
      </div>

      <div id="demo-stage" className={s.stage} role="tabpanel" aria-labelledby={`demo-tab-${scene.id}`}>
        <div className={s.glow} aria-hidden="true" />
        <scene.Component key={scene.id} t={shownT} />
      </div>
    </div>
  )
}
