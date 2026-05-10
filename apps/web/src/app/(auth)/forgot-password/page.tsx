'use client'

import { useState } from 'react'
import Link from 'next/link'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '@/lib/firebase'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--bg-2)',
  color: 'var(--ink)',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
  transition: 'border-color .15s',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12.5,
  fontFamily: 'var(--font-mono)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-mute)',
  marginBottom: 6,
}

function friendlyError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/invalid-email':
      return "That doesn't look like a valid email address."
    case 'auth/too-many-requests':
      return 'Too many requests. Try again in a few minutes.'
    case 'auth/network-request-failed':
      return 'Network error — check your connection and try again.'
    default:
      return ''
  }
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await sendPasswordResetEmail(auth, email, {
        url: `${window.location.origin}/login`,
        handleCodeInApp: false,
      })
      setSubmitted(true)
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? ''
      // Don't leak account existence — treat user-not-found as success.
      if (code === 'auth/user-not-found') {
        setSubmitted(true)
      } else {
        const msg = friendlyError(err)
        if (msg) {
          setError(msg)
        } else {
          // For other errors (e.g. email-not-registered isn't returned with enum protection),
          // still show the success state to avoid enumeration.
          setSubmitted(true)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-lg)',
      padding: '32px 28px',
      boxShadow: 'var(--shadow-card)',
    }}>
      {submitted ? (
        <>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            Check your inbox
          </h1>
          <p style={{ color: 'var(--ink-mute)', fontSize: 14, margin: '0 0 24px', lineHeight: 1.5 }}>
            If an account exists for <strong style={{ color: 'var(--ink)' }}>{email}</strong>, we&apos;ve sent a password reset link. Click the link in the email to set a new password.
          </p>
          <p style={{ textAlign: 'center', fontSize: 13.5 }}>
            <Link href="/login" style={{ color: 'var(--accent)', fontWeight: 500 }}>
              Back to sign in
            </Link>
          </p>
        </>
      ) : (
        <>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            Reset your password
          </h1>
          <p style={{ color: 'var(--ink-mute)', fontSize: 14, margin: '0 0 24px' }}>
            Enter your email and we&apos;ll send you a link to set a new password.
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label htmlFor="email" style={labelStyle}>Email</label>
              <input
                id="email" type="email" autoComplete="email" required autoFocus
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
              />
            </div>

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13 }}>
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="btn btn-primary"
              style={{ justifyContent: 'center', opacity: loading ? 0.6 : 1, borderRadius: 'var(--r-sm)' }}
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>

          <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13.5, color: 'var(--ink-mute)' }}>
            <Link href="/login" style={{ color: 'var(--accent)', fontWeight: 500 }}>
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </div>
  )
}
