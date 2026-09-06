import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const privacy = readFileSync(join(root, 'app/privacy/page.tsx'), 'utf8')
const terms = readFileSync(join(root, 'app/terms/page.tsx'), 'utf8')
const landing = readFileSync(join(root, 'components/LandingPage.tsx'), 'utf8')
const authLayout = readFileSync(join(root, 'app/(auth)/layout.tsx'), 'utf8')

test('public and authentication footers link to both legal documents', () => {
  for (const source of [landing, authLayout]) {
    assert.match(source, /href="\/privacy"/)
    assert.match(source, /href="\/terms"/)
  }
})

test('privacy policy covers the implemented data lifecycle', () => {
  for (const phrase of ['data controller', 'processor or service provider', 'Mixpanel', 'session recordings', 'AI-assisted processing', 'International data transfers', 'Data retention', 'Your privacy rights', 'legal@ayooda.live']) {
    assert.match(privacy, new RegExp(phrase, 'i'))
  }
})

test('terms cover SaaS, AI, billing, and connected-action responsibilities', () => {
  for (const phrase of ['subscriptions', 'Customer Data', 'AI outputs', 'Tools, channels', 'Acceptable use', 'Limits of liability', 'legal@ayooda.live']) {
    assert.match(terms, new RegExp(phrase, 'i'))
  }
})
