'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import {
  type User,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'

interface AuthContextValue {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
  createSession: (user: User) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const createSession = useCallback(async (firebaseUser: User) => {
    const idToken = await firebaseUser.getIdToken()

    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    })

    if (!res.ok) throw new Error('Failed to create session')

    // Notify Hono API to create user + workspace on first login
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (apiUrl) {
      await fetch(`${apiUrl}/auth/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      }).catch(() => {
        // Non-blocking — workspace creation is idempotent
      })
    }
  }, [])

  const signOut = useCallback(async () => {
    await fetch('/api/session', { method: 'DELETE' })
    await firebaseSignOut(auth)
    router.push('/login')
  }, [router])

  return (
    <AuthContext.Provider value={{ user, loading, signOut, createSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
