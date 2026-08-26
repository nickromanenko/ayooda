import { describe, expect, test } from 'bun:test'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  test('renders common assistant formatting', () => {
    const html = renderMarkdown('* **Bold item** with [a link](https://example.com)\n* second item')

    expect(html).toContain('<ul>')
    expect(html).toContain('<strong>Bold item</strong>')
    expect(html).toContain('<a href="https://example.com">a link</a>')
  })

  test('supports GFM tables and strikethrough', () => {
    const html = renderMarkdown('| A | B |\n| - | - |\n| one | ~~two~~ |')

    expect(html).toContain('<table>')
    expect(html).toContain('<del>two</del>')
  })

  test('does not execute raw HTML or unsafe link protocols', () => {
    const html = renderMarkdown('<script>alert(1)</script> [bad](javascript:alert(1))')

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('&lt;script&gt;')
  })
})
