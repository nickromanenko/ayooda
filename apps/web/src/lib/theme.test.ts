import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const rootLayout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8')
const globalStyles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
const toggleSource = readFileSync(new URL('../components/theme/ThemeToggle.tsx', import.meta.url), 'utf8')
const landingSource = readFileSync(new URL('../components/LandingPage.tsx', import.meta.url), 'utf8')
const sidebarSource = readFileSync(new URL('../components/dashboard/Sidebar.tsx', import.meta.url), 'utf8')
const resourceSource = readFileSync(new URL('../components/marketing/ResourcePage.tsx', import.meta.url), 'utf8')
const authLayout = readFileSync(new URL('../app/(auth)/layout.tsx', import.meta.url), 'utf8')
const onboardingLayout = readFileSync(new URL('../app/onboarding/layout.tsx', import.meta.url), 'utf8')

describe('site theme support', () => {
  test('applies a stored or system theme before the page paints', () => {
    assert.match(rootLayout, /strategy="beforeInteractive"/)
    assert.match(rootLayout, /localStorage\.getItem\(key\)/)
    assert.match(rootLayout, /prefers-color-scheme: light/)
    assert.match(rootLayout, /suppressHydrationWarning/)
  })

  test('defines complete light and dark palettes', () => {
    assert.match(globalStyles, /:root\[data-theme='light'\]/)
    assert.match(globalStyles, /color-scheme: dark/)
    assert.match(globalStyles, /color-scheme: light/)
    assert.match(globalStyles, /--brand-neutral:/)
    assert.match(globalStyles, /--danger:/)
    assert.match(globalStyles, /--shadow-control:/)
  })

  test('persists changes and follows the operating system until overridden', () => {
    assert.match(toggleSource, /const STORAGE_KEY = 'ayooda\.theme'/)
    assert.match(toggleSource, /useSyncExternalStore/)
    assert.match(toggleSource, /localStorage\.setItem\(STORAGE_KEY, theme\)/)
    assert.match(toggleSource, /media\.addEventListener\('change', onSystemChange\)/)
    assert.match(toggleSource, /aria-label=\{`Switch to \$\{nextTheme\} theme`\}/)
  })

  test('offers the switcher across public and authenticated shells', () => {
    assert.match(landingSource, /<ThemeToggle/)
    assert.match(sidebarSource, /<ThemeToggle/)
    assert.match(resourceSource, /<ThemeToggle/)
    assert.match(authLayout, /<ThemeToggle/)
    assert.match(onboardingLayout, /<ThemeToggle/)
  })

  test('matches pill controls publicly and sidebar navigation in the dashboard', () => {
    assert.match(globalStyles, /\.theme-toggle \{[\s\S]*?border-radius: 999px;[\s\S]*?background: transparent;/)
    assert.match(globalStyles, /\.dashboard-theme-toggle \{[\s\S]*?height: 40px;[\s\S]*?border-radius: var\(--r-sm\);/)
    assert.match(globalStyles, /\.dashboard-theme-toggle:hover \{[\s\S]*?background: var\(--panel-2\);/)
  })
})
