'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuth } from '@/components/providers/AuthProvider'
import { cn } from '@/lib/utils'

export default function SignupPage() {
  const router = useRouter()
  const { createSession } = useAuth()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGoogleSignUp() {
    setLoading(true)
    setError('')
    try {
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(auth, provider)
      await createSession(result.user)
      router.push('/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-up failed')
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
      setError(err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
      <h1 className="text-xl font-semibold text-zinc-900 mb-1">Create an account</h1>
      <p className="text-sm text-zinc-500 mb-6">Start supporting your customers with AI</p>

      {/* Google */}
      <button
        type="button"
        onClick={handleGoogleSignUp}
        disabled={loading}
        className={cn(
          'w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg border border-zinc-300',
          'text-sm font-medium text-zinc-700 bg-white',
          'hover:bg-zinc-50 transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-zinc-200" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="px-2 bg-white text-zinc-400">or</span>
        </div>
      </div>

      <form onSubmit={handleEmailSignUp} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-zinc-700 mb-1">
            Name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border border-zinc-300 bg-white text-sm text-zinc-900',
              'placeholder:text-zinc-400',
              'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
            )}
            placeholder="Your name"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-zinc-700 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border border-zinc-300 bg-white text-sm text-zinc-900',
              'placeholder:text-zinc-400',
              'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
            )}
            placeholder="you@company.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-zinc-700 mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border border-zinc-300 bg-white text-sm text-zinc-900',
              'placeholder:text-zinc-400',
              'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
            )}
            placeholder="Min. 8 characters"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className={cn(
            'w-full py-2.5 px-4 rounded-lg text-sm font-medium text-white',
            'bg-indigo-600 hover:bg-indigo-700 transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-zinc-500">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
          Sign in
        </Link>
      </p>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}
