'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  signInWithEmailAndPassword,
  signInWithCustomToken,
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
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.'
    case 'auth/invalid-email':
      return "That doesn't look like a valid email address."
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support.'
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Try again in a few minutes.'
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
    default:
      return err instanceof Error ? err.message : 'Something went wrong. Please try again.'
  }
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { createSession } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [linkingState, setLinkingState] = useState<
    null | { email: string; pendingCred: AuthCredential }
  >(null)
  const [linkPassword, setLinkPassword] = useState('')
  const devLoginStarted = useRef(false)

  const redirectTo = searchParams.get('from') ?? '/dashboard'
  const resetSuccess = searchParams.get('reset') === 'success'

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || devLoginStarted.current) return

    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const token = fragment.get('devToken')
    if (!token) return

    devLoginStarted.current = true
    const devDestination = fragment.get('from')
    // Remove the credential before making any network requests so it is not left in
    // browser history, screenshots, or copied URLs.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setLoading(true)
    setError('')

    void signInWithCustomToken(auth, token)
      .then(async (result) => {
        await createSession(result.user)
        router.replace(devDestination?.startsWith('/') && !devDestination.startsWith('//')
          ? devDestination
          : redirectTo)
      })
      .catch((err: unknown) => {
        setError(`Development sign-in failed: ${friendlyError(err)}`)
        setLoading(false)
      })
  }, [createSession, redirectTo, router])

  async function handleGoogleSignIn() {
    setLoading(true)
    setError('')
    try {
      const outcome = await googleSignInOrPrepareLink()
      if (outcome.kind === 'success') {
        await createSession(outcome.user)
        router.push(redirectTo)
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

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await signInWithEmailAndPassword(auth, email, password)
      await createSession(result.user)
      router.push(redirectTo)
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
      router.push(redirectTo)
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
            Link Google to your account
          </h1>
          <p style={{ color: 'var(--ink-mute)', fontSize: 14, margin: '0 0 24px', lineHeight: 1.5 }}>
            An account already exists for <strong style={{ color: 'var(--ink)' }}>{linkingState.email}</strong>. Enter your password to link Google sign-in.
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
              <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13 }}>
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
            Sign in
          </h1>
          <p style={{ color: 'var(--ink-mute)', fontSize: 14, margin: '0 0 24px' }}>
            Welcome back to Ayooda
          </p>

          {resetSuccess && (
            <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac', fontSize: 13, marginBottom: 16 }}>
              Your password has been reset. Sign in to continue.
            </div>
          )}

          {/* Google */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
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

          <form onSubmit={handleEmailSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                id="password" type="password" autoComplete="current-password" required
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <Link href="/forgot-password" style={{ fontSize: 12.5, color: 'var(--ink-mute)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
                  Forgot password?
                </Link>
              </div>
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
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13.5, color: 'var(--ink-mute)' }}>
            No account?{' '}
            <Link href="/signup" style={{ color: 'var(--accent)', fontWeight: 500 }}>
              Sign up
            </Link>
          </p>
        </>
      )}
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
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
