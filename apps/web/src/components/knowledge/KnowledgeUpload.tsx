'use client'

import { useRef, useState } from 'react'
import { FileUp, Loader2, AlertCircle } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { validateKnowledgeFile, KNOWLEDGE_FILE_EXTENSIONS } from '@ayooda/shared'

export function KnowledgeUpload({
  onUploaded,
  uploadPath,
}: {
  onUploaded: (doc: { docId: string; source: string }) => void
  uploadPath: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function handleFile(file: File) {
    if (inputRef.current) inputRef.current.value = '' // allow re-selecting the same file
    const validation = validateKnowledgeFile(file.name, file.size)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiRequest(uploadPath, { method: 'POST', body: form })
      const data = (await res.json()) as { docId?: string; error?: string }
      if (!res.ok || !data.docId) throw new Error(data.error ?? 'Upload failed')
      onUploaded({ docId: data.docId, source: file.name })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={KNOWLEDGE_FILE_EXTENSIONS.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="btn btn-ghost"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center',
          padding: '12px 16px', borderRadius: 'var(--r-sm)', border: '1px dashed var(--line-2)',
          cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1,
          fontSize: 13, color: 'var(--ink-mute)', background: 'transparent',
        }}
      >
        {uploading
          ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          : <FileUp size={14} />}
        {uploading ? 'Uploading…' : 'Upload a document (PDF, DOCX, TXT, CSV, MD — max 10 MB)'}
      </button>
      {error && (
        <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>
          <AlertCircle size={12} /> {error}
        </p>
      )}
    </div>
  )
}
