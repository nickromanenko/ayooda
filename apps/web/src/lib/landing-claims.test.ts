import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const landingSource = readFileSync(new URL('../components/LandingPage.tsx', import.meta.url), 'utf8')
const metadataSource = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8')
const publicMarketingCopy = `${landingSource}\n${metadataSource}`

test('public landing copy does not publish unsupported social proof or performance benchmarks', () => {
  const unsupportedClaims = [
    /10,000\+ companies/i,
    /up(?:\s|&nbsp;)+to(?:\s|&nbsp;)+60%/i,
    /40[–-]60%/i,
    /Antonia Renard|Geoff Sarem|Jim Cohen/,
    /AFS Foil|Emmatt|Spidervo/,
  ]

  for (const claim of unsupportedClaims) {
    assert.doesNotMatch(publicMarketingCopy, claim)
  }
})

test('scripted landing demo is identified as a representative walkthrough', () => {
  assert.match(landingSource, /product walkthrough · representative workflow/i)
})

test('public landing copy does not promise unimplemented enterprise controls or hosting guarantees', () => {
  const unsupportedTrustClaims = [
    /scoped API keys/i,
    /\bSSO\b|\bSAML\b|\bOIDC\b/i,
    /GDPR-compliant/i,
    /Europe-hosted|EU servers/i,
  ]

  for (const claim of unsupportedTrustClaims) {
    assert.doesNotMatch(publicMarketingCopy, claim)
  }

  assert.match(landingSource, /AES-256-GCM/)
  assert.match(landingSource, /signature-checked/i)
})

test('public landing copy keeps launch claims inside the currently shipped product', () => {
  const unsupportedCapabilityClaims = [
    /One agent\. Ten channels/i,
    /\bWhatsApp\b|\bMessenger\b|\bInstagram\b/i,
    /learns from your corrections automatically/i,
    /No hallucinations|No guesses/i,
    /auto-syncs with helpdesk articles, docs, and product changes/i,
    /your\.company\.internal|Meta · self-hosted/i,
  ]

  for (const claim of unsupportedCapabilityClaims) {
    assert.doesNotMatch(publicMarketingCopy, claim)
  }

  assert.match(landingSource, /One agent\. Five channels/i)
  assert.match(landingSource, /web widget, Telegram, email, Slack, and Twilio SMS/i)
})
