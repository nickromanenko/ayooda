import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readFileSync } from 'node:fs'

const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8')
const widget = readFileSync(new URL('../components/providers/AyoodaSupportWidget.tsx', import.meta.url), 'utf8')

describe('Ayooda support widget', () => {
  test('loads the production Yooda channel once from the authenticated root', () => {
    assert.match(layout, /<AyoodaSupportWidget \/>/)
    assert.match(widget, /https:\/\/cdn\.ayooda\.live\/widget\.js/)
    assert.match(widget, /gCtB4qoNAX6tG9JUzdhO/)
    assert.match(widget, /strategy="afterInteractive"/)
  })

  test('identifies signed-in users and clears identity on logout', () => {
    assert.match(widget, /previousUserId\.current \? 'update' : 'boot'/)
    assert.match(widget, /id: user\.uid/)
    assert.match(widget, /name: user\.displayName/)
    assert.match(widget, /email: user\.email/)
    assert.match(widget, /command\('shutdown'\)/)
  })
})
