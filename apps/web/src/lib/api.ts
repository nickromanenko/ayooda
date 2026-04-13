import { getAuth } from 'firebase/auth'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const user = getAuth().currentUser
  if (!user) throw new Error('Not authenticated')

  const idToken = await user.getIdToken()

  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...(init.headers ?? {}),
    },
  })
}
