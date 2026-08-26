import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'

const extensions = [gfm()]
const htmlExtensions = [gfmHtml()]

/** Render assistant-authored Markdown while escaping raw HTML and unsafe URLs. */
export function renderMarkdown(markdown: string): string {
  return micromark(markdown, { extensions, htmlExtensions })
}
