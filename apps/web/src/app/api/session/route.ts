import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminAuth } from '@/lib/firebase-admin'

const SESSION_COOKIE = '__session'
const SESSION_DURATION_MS = 60 * 60 * 24 * 14 * 1000 // 14 days

export async function POST(request: NextRequest) {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing token' }, { status: 401 })
  }

  const idToken = authorization.slice(7)

  try {
    const adminAuth = getAdminAuth()
    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_DURATION_MS,
    })

    const cookieStore = await cookies()
    cookieStore.set(SESSION_COOKIE, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_DURATION_MS / 1000,
      path: '/',
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Session creation failed:', error)
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }
}

export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
  return NextResponse.json({ ok: true })
}

// Server Components can't clear cookies themselves (Next.js only allows cookie
// writes from Server Actions and Route Handlers), so pages redirect here to drop
// an invalid/expired session cookie before landing on /login. Without this, proxy.ts
// sees the (still-present but unverifiable) cookie and bounces the request straight
// back to /dashboard, which re-fails verification and redirects back to /login — an
// infinite loop.
export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)

  const loginUrl = new URL('/login', request.url)
  const from = request.nextUrl.searchParams.get('from')
  if (from) loginUrl.searchParams.set('from', from)

  return NextResponse.redirect(loginUrl)
}
