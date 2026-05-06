import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { LandingPage } from '@/components/LandingPage'

export default async function RootPage() {
  const cookieStore = await cookies()
  const session = cookieStore.get('__session')?.value
  if (session) redirect('/dashboard')
  return <LandingPage />
}
