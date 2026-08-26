import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownMessage from './MarkdownMessage'

describe('MarkdownMessage', () => {
  test('renders common and GitHub-flavored Markdown without rendering raw HTML', () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage content={'**Strong**\n\n- first\n- second\n\n~~old~~\n\n<script>alert(1)</script>'} />,
    )

    assert.match(html, /<strong>Strong<\/strong>/)
    assert.match(html, /<ul>/)
    assert.match(html, /<li>first<\/li>/)
    assert.match(html, /<del>old<\/del>/)
    assert.doesNotMatch(html, /<script>/)
  })
})
