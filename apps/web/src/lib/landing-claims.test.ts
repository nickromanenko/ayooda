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
