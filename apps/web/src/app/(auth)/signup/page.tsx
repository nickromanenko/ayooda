'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  createUserWithEmailAndPassword,
  updateProfile,
  type AuthCredential,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuth } from '@/components/providers/AuthProvider'
import {
  googleSignInOrPrepareLink,
  completeGoogleLinkWithPassword,
} from '@/lib/auth-linking'

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
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.'
    case 'auth/invalid-email':
      return 'That doesn\'t look like a valid email address.'
    case 'auth/weak-password':
      return 'Password must be at least 8 characters.'
    case 'auth/operation-not-allowed':
      return 'Email sign-up is currently disabled. Try continuing with Google.'
    case 'auth/network-request-failed':
      return 'Network error — check your connection and try again.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return ''
    case 'auth/popup-blocked':
      return 'Pop-up was blocked by your browser. Allow pop-ups for this site and try again.'
    case 'auth/account-exists-with-different-credential':
      return ''
    case 'auth/credential-already-in-use':
      return 'This Google account is already linked to another user.'
    case 'auth/provider-already-linked':
      return ''
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.'
    default:
      return err instanceof Error ? err.message : 'Something went wrong. Please try again.'
  }
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  )
}

function SignupPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const invite = searchParams.get('invite')
  const { createSession } = useAuth()

  const [name, setName] = useState('')
  const [email, setEmail] = useState(invite ?? '')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [linkingState, setLinkingState] = useState<
    null | { email: string; pendingCred: AuthCredential }
  >(null)
  const [linkPassword, setLinkPassword] = useState('')

  async function handleGoogleSignUp() {
    setLoading(true)
    setError('')
    try {
      const outcome = await googleSignInOrPrepareLink()
      if (outcome.kind === 'success') {
        await createSession(outcome.user)
        router.push('/dashboard')
      } else if (outcome.kind === 'needs-link') {
        setLinkingState({ email: outcome.email, pendingCred: outcome.pendingCred })
      } else if (outcome.kind === 'error') {
        const msg = friendlyError({ code: outcome.code })
        if (msg) setError(msg)
        else setError(outcome.message)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleEmailSignUp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password)
      if (name) await updateProfile(result.user, { displayName: name })
      await createSession(result.user)
      router.push('/dashboard')
    } catch (err: unknown) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleLinkSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!linkingState) return
    setLoading(true)
    setError('')
    try {
      const linkedUser = await completeGoogleLinkWithPassword(
        linkingState.email,
        linkPassword,
        linkingState.pendingCred,
      )
      await createSession(linkedUser)
      router.push('/dashboard')
    } catch (err: unknown) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  function cancelLinking() {
    setLinkingState(null)
    setLinkPassword('')
    setError('')
  }

  return (
    <div style={{
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-lg)',
      padding: '32px 28px',
      boxShadow: 'var(--shadow-card)',
    }}>
      {linkingState ? (
        <>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            You already have an account
          </h1>
          <p style={{ color: 'var(--ink-mute)', fontSize: 14, margin: '0 0 24px', lineHeight: 1.5 }}>
            An account already exists for <strong style={{ color: 'var(--ink)' }}>{linkingState.email}</strong>. Enter your password to link Google sign-in to it.
          </p>

          <form onSubmit={handleLinkSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label htmlFor="link-password" style={labelStyle}>Password</label>
              <input
                id="link-password" type="password" autoComplete="current-password" required autoFocus
                value={linkPassword} onChange={e => setLinkPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
              />
            </div>

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)', fontSize: 13 }}>
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="btn btn-primary"
              style={{ justifyContent: 'center', opacity: loading ? 0.6 : 1, borderRadius: 'var(--r-sm)' }}
            >
              {loading ? 'Linking…' : 'Link & continue'}
            </button>

            <button
              type="button" onClick={cancelLinking} disabled={loading}
              style={{
                background: 'none', border: 'none', color: 'var(--ink-mute)',
                fontSize: 13, cursor: 'pointer', padding: 4, fontFamily: 'var(--font-sans)',
              }}
            >
              Use a different account
            </button>
          </form>
        </>
      ) : (
        <>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            Create an account
          </h1>
          <p style={{ color: 'var(--ink-mute)', fontSize: 14, margin: '0 0 24px' }}>
            Start supporting your customers with AI — free for 14 days.
          </p>

          {invite && (
            <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'var(--accent-soft)', border: '1px solid rgba(245,165,36,0.18)', color: 'var(--ink)', fontSize: 13, marginBottom: 20 }}>
              You&apos;re joining a team — sign up with this email.
            </div>
          )}

          {/* Google */}
          <button
            type="button"
            onClick={handleGoogleSignUp}
            disabled={loading}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 10, padding: '10px 16px',
              borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)',
              background: 'var(--bg-2)', color: 'var(--ink)',
              fontSize: 14, fontWeight: 500, cursor: 'pointer',
              transition: 'background .15s, border-color .15s',
              fontFamily: 'var(--font-sans)',
              opacity: loading ? 0.5 : 1,
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'var(--panel-2)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-2)' }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div style={{ position: 'relative', margin: '20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.1em' }}>OR</span>
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          </div>

          <form onSubmit={handleEmailSignUp} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label htmlFor="name" style={labelStyle}>Name</label>
              <input
                id="name" type="text" autoComplete="name"
                value={name} onChange={e => setName(e.target.value)}
                placeholder="Your name"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
              />
            </div>

            <div>
              <label htmlFor="email" style={labelStyle}>Email</label>
              <input
                id="email" type="email" autoComplete="email" required
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
              />
            </div>

            <div>
              <label htmlFor="password" style={labelStyle}>Password</label>
              <input
                id="password" type="password" autoComplete="new-password" required minLength={8}
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
              />
            </div>

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)', fontSize: 13 }}>
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="btn btn-primary"
              style={{ justifyContent: 'center', opacity: loading ? 0.6 : 1, borderRadius: 'var(--r-sm)' }}
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
            NO CREDIT CARD REQUIRED · 14-DAY FREE TRIAL
          </p>

          <p style={{ marginTop: 12, textAlign: 'center', fontSize: 13.5, color: 'var(--ink-mute)' }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: 'var(--accent)', fontWeight: 500 }}>
              Sign in
            </Link>
          </p>
        </>
      )}
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}
