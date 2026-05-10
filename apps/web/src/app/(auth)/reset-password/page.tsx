'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
  applyActionCode,
} from 'firebase/auth'
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

type Phase = 'verifying' | 'reset-form' | 'expired' | 'unsupported' | 'verified-email'

function ResetPasswordHandler() {
  const router = useRouter()
  const sp = useSearchParams()
  const mode = sp.get('mode')
  const oobCode = sp.get('oobCode')

  const [phase, setPhase] = useState<Phase>('verifying')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!oobCode || !mode) {
      setPhase('unsupported')
      return
    }
    if (mode === 'resetPassword') {
      verifyPasswordResetCode(auth, oobCode)
        .then((verifiedEmail) => {
          setEmail(verifiedEmail)
          setPhase('reset-form')
        })
        .catch(() => setPhase('expired'))
    } else if (mode === 'verifyEmail') {
      applyActionCode(auth, oobCode)
        .then(() => setPhase('verified-email'))
        .catch(() => setPhase('expired'))
    } else {
      setPhase('unsupported')
    }
  }, [mode, oobCode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!oobCode) return
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await confirmPasswordReset(auth, oobCode, password)
      router.push('/login?reset=success')
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? ''
      if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
        setError('Password is too weak — use at least 8 characters with a mix of letters and numbers.')
      } else if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') {
        setPhase('expired')
      } else {
        setError('Could not reset password. Try requesting a new link.')
      }
    } finally {
      setSubmitting(false)
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
      {phase === 'verifying' && (
        <p style={{ color: 'var(--ink-mute)', fontSize: 14, margin: 0, textAlign: 'center' }}>
          Verifying link…
        </p>
      )}

      {phase === 'expired' && (
        <>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            Link is invalid or expired
          </h1>
          <p style={{ color: 'var(--ink-mute)', fontSize: 14, margin: '0 0 24px', lineHeight: 1.5 }}>
            This reset link is no longer valid. Request a new one to continue.
          </p>
          <Link
            href="/forgot-password"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', borderRadius: 'var(--r-sm)', textDecoration: 'none' }}
          >
            Request new link
          </Link>
        </>
      )}

      {phase === 'unsupported' && (
        <>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            Unsupported action
          </h1>
          <p style={{ color: 'var(--ink-mute)', fontSize: 14, margin: '0 0 24px', lineHeight: 1.5 }}>
            This page handles password reset and email verification only.
          </p>
          <p style={{ textAlign: 'center', fontSize: 13.5 }}>
            <Link href="/login" style={{ color: 'var(--accent)', fontWeight: 500 }}>
              Back to sign in
            </Link>
          </p>
        </>
      )}

      {phase === 'verified-email' && (
        <>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            Email verified
          </h1>
          <p style={{ color: 'var(--ink-mute)', fontSize: 14, margin: '0 0 24px', lineHeight: 1.5 }}>
            Your email has been verified. You can now sign in.
          </p>
          <p style={{ textAlign: 'center', fontSize: 13.5 }}>
            <Link href="/login" style={{ color: 'var(--accent)', fontWeight: 500 }}>
              Continue to sign in
            </Link>
          </p>
        </>
      )}

      {phase === 'reset-form' && (
        <>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            Set a new password
          </h1>
          <p style={{ color: 'var(--ink-mute)', fontSize: 14, margin: '0 0 24px' }}>
            Resetting password for <strong style={{ color: 'var(--ink)' }}>{email}</strong>.
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label htmlFor="password" style={labelStyle}>New password</label>
              <input
                id="password" type="password" autoComplete="new-password" required minLength={8} autoFocus
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
              />
            </div>

            <div>
              <label htmlFor="confirm" style={labelStyle}>Confirm new password</label>
              <input
                id="confirm" type="password" autoComplete="new-password" required minLength={8}
                value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat password"
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
              type="submit" disabled={submitting}
              className="btn btn-primary"
              style={{ justifyContent: 'center', opacity: submitting ? 0.6 : 1, borderRadius: 'var(--r-sm)' }}
            >
              {submitting ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
        </>
      )}
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordHandler />
    </Suspense>
  )
}
