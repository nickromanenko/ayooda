import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const landingSource = readFileSync(new URL('../components/LandingPage.tsx', import.meta.url), 'utf8')
const globalStyles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

test('mobile landing navigation is accessible and closes after navigation', () => {
  assert.match(landingSource, /aria-expanded=\{mobileOpen\}/)
  assert.match(landingSource, /aria-controls="landing-mobile-menu"/)
  assert.match(landingSource, /if \(event\.key === 'Escape'\) setMobileOpen\(false\)/)
  assert.match(landingSource, /href=\{href\} onClick=\{\(\) => setMobileOpen\(false\)\}/)
})

test('mobile landing navigation replaces desktop links with touch-sized controls', () => {
  assert.match(globalStyles, /@media \(max-width: 760px\)/)
  assert.match(globalStyles, /\.landing-nav-links,[\s\S]*?display: none !important/)
  assert.match(globalStyles, /\.landing-mobile-toggle[\s\S]*?width: 44px;[\s\S]*?height: 44px/)
  assert.match(globalStyles, /\.landing-mobile-menu > a[\s\S]*?min-height: 44px/)
})
