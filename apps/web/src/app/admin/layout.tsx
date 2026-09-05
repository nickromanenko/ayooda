import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { ShieldX } from 'lucide-react'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'
import AdminShell from '@/components/admin/AdminShell'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sessionCookie = (await cookies()).get('__session')?.value
  if (!sessionCookie) redirect('/login?from=/admin')

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true)
    const user = await getAdminDb().doc(`users/${decoded.uid}`).get()
    const data = user.data()
    if (!user.exists || data?.accessStatus === 'disabled') redirect('/api/session?from=/admin')
    if (data?.platformRole !== 'admin') {
      return (
        <main className="dashboard-shell" style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-2)' }}>
          <section style={{ width: 'min(100%, 480px)', padding: 32, borderRadius: 'var(--r-lg)', background: 'var(--panel)', boxShadow: 'var(--shadow-card)', textAlign: 'center' }}>
            <ShieldX size={34} color="var(--danger)" aria-hidden />
            <h1 style={{ margin: '16px 0 8px', fontSize: 24, color: 'var(--ink)' }}>Administrator access required</h1>
            <p style={{ margin: '0 auto 22px', color: 'var(--ink-mute)', lineHeight: 1.65 }}>This area is restricted to Ayooda platform administrators. Your workspace permissions have not changed.</p>
            <Link href="/dashboard" className="btn btn-primary">Return to dashboard</Link>
          </section>
        </main>
      )
    }
    return <AdminShell>{children}</AdminShell>
  } catch (error) {
    if (isRedirectError(error)) throw error
    console.error('[admin/layout] session verification failed:', error)
    redirect('/api/session?from=/admin')
  }
}
