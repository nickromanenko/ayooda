import { describe, expect, test } from 'bun:test'
import { validateKnowledgeFile, MAX_UPLOAD_BYTES } from './index'

describe('validateKnowledgeFile', () => {
  test('accepts allowed extensions under the size cap', () => {
    for (const name of ['a.pdf', 'b.docx', 'c.txt', 'd.csv', 'e.md', 'F.PDF']) {
      expect(validateKnowledgeFile(name, 1024)).toEqual({ ok: true })
    }
  })
  test('rejects filenames with path separators or dot-dot', () => {
    for (const name of ['../evil.pdf', 'a/b.pdf', 'a\\b.pdf', 'notes..md']) {
      const res = validateKnowledgeFile(name, 10)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toBe('Invalid filename.')
    }
  })
  test('rejects disallowed extensions', () => {
    const res = validateKnowledgeFile('malware.exe', 10)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('Unsupported file type')
  })
  test('rejects files without an extension', () => {
    expect(validateKnowledgeFile('README', 10).ok).toBe(false)
  })
  test('rejects files over the size cap', () => {
    const res = validateKnowledgeFile('big.pdf', MAX_UPLOAD_BYTES + 1)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('10 MB')
  })
  test('accepts a file exactly at the cap', () => {
    expect(validateKnowledgeFile('edge.pdf', MAX_UPLOAD_BYTES)).toEqual({ ok: true })
  })
})
