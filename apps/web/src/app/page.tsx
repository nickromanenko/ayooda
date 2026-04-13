import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export default async function Home() {
  const cookieStore = await cookies()
  const hasSession = cookieStore.has('__session')

  if (hasSession) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}
