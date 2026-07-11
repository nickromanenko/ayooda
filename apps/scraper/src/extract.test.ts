import { describe, expect, test } from 'bun:test'
import { extractText } from './extract'

describe('extractText', () => {
  test('reads txt/md/csv as UTF-8', async () => {
    expect(await extractText('a.txt', Buffer.from('hello world'))).toBe('hello world')
    expect(await extractText('b.md', Buffer.from('# Title\nBody'))).toBe('# Title\nBody')
    expect(await extractText('c.csv', Buffer.from('col1,col2\n1,2'))).toBe('col1,col2\n1,2')
  })
  test('is case-insensitive on extension', async () => {
    expect(await extractText('NOTES.TXT', Buffer.from('x'))).toBe('x')
  })
  test('rejects unsupported extensions', async () => {
    await expect(extractText('x.exe', Buffer.from('x'))).rejects.toThrow('Unsupported file type')
  })
  test('rejects empty extraction', async () => {
    await expect(extractText('empty.txt', Buffer.from('   '))).rejects.toThrow('No text content')
  })
})
