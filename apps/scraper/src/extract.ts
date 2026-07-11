import mammoth from 'mammoth'

/**
 * Extract plain text from an uploaded knowledge file.
 * Supported: .pdf, .docx, .txt, .csv, .md — throws on anything else or empty output.
 */
export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const dot = filename.lastIndexOf('.')
  const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase()

  let text: string
  switch (ext) {
    case '.txt':
    case '.md':
    case '.csv':
      text = buffer.toString('utf-8')
      break
    case '.pdf': {
      // Import the implementation directly — pdf-parse's package entry runs a
      // debug harness when it can't find its test fixture.
      const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js')
      const result = await pdfParse(buffer)
      text = result.text
      break
    }
    case '.docx': {
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
      break
    }
    default:
      throw new Error(`Unsupported file type: ${ext || filename}`)
  }

  if (!text || text.trim().length === 0) {
    throw new Error('No text content could be extracted from the file (is it a scanned image?)')
  }
  return text
}
