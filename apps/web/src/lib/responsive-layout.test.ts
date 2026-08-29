import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const dashboardLayout = readFileSync(new URL('../app/dashboard/layout.tsx', import.meta.url), 'utf8')
const dashboardCss = readFileSync(new URL('../app/dashboard/layout.module.css', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../components/dashboard/Sidebar.tsx', import.meta.url), 'utf8')
const sidebarCss = readFileSync(new URL('../components/dashboard/Sidebar.module.css', import.meta.url), 'utf8')
const inbox = readFileSync(new URL('../app/dashboard/inbox/page.tsx', import.meta.url), 'utf8')
const inboxCss = readFileSync(new URL('../app/dashboard/inbox/page.module.css', import.meta.url), 'utf8')
const copilot = readFileSync(new URL('../app/dashboard/copilot/page.tsx', import.meta.url), 'utf8')
const copilotCss = readFileSync(new URL('../app/dashboard/copilot/page.module.css', import.meta.url), 'utf8')
const landing = readFileSync(new URL('../components/LandingPage.tsx', import.meta.url), 'utf8')
const globals = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

test('dashboard switches from the desktop sidebar to an accessible mobile drawer', () => {
  assert.match(dashboardLayout, /styles\.shell/)
  assert.match(dashboardLayout, /dashboard-shell/)
  assert.match(dashboardCss, /@media \(max-width: 760px\)/)
  assert.match(sidebar, /aria-controls="dashboard-mobile-drawer"/)
  assert.match(sidebar, /aria-expanded=\{mobileOpen\}/)
  assert.match(sidebarCss, /\.desktopSidebar \{ display: none !important; \}/)
  assert.match(sidebarCss, /min-height: 48px/)
})

test('inbox becomes a single-pane mobile conversation flow', () => {
  assert.match(inbox, /Back to conversations/)
  assert.match(inbox, /data-thread-open=\{Boolean\(selectedId\)\}/)
  assert.match(inboxCss, /height: calc\(100dvh - 64px\)/)
  assert.match(inboxCss, /\.list\[data-thread-open='true'\]/)
  assert.match(inboxCss, /max-width: 90%/)
})

test('Copilot uses a single-pane mobile thread flow with a back action', () => {
  assert.match(copilot, /Back to Copilot threads/)
  assert.match(copilot, /data-compose-open=\{mobileComposeOpen\}/)
  assert.match(copilotCss, /height: calc\(100dvh - 64px\)/)
  assert.match(copilotCss, /\.list\[data-compose-open='true'\]/)
})

test('landing fixed-column sections collapse and advertised channels match launch scope', () => {
  for (const className of ['landing-two-column', 'landing-feature-layout', 'landing-integrations', 'landing-pricing-estimate', 'landing-faq-grid']) {
    assert.match(landing, new RegExp(`className="${className}"`))
    assert.match(globals, new RegExp(`\\.${className}`))
  }
  assert.match(landing, /One agent\. Five channels\./)
  assert.match(landing, /web widget, Telegram, email, Slack, and Twilio SMS/)
  assert.doesNotMatch(landing, /One agent\. Ten channels\./)
})
