import { NextRequest, NextResponse } from 'next/server'

const SESSION_COOKIE = '__session'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasSession = request.cookies.has(SESSION_COOKIE)

  // Redirect authenticated users away from auth pages
  if ((pathname === '/login' || pathname === '/signup') && hasSession) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Redirect unauthenticated users away from dashboard
  if ((pathname.startsWith('/dashboard') || pathname.startsWith('/admin')) && !hasSession) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/onboarding', '/login', '/signup'],
}
