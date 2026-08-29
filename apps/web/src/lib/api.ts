import { getAuth, onAuthStateChanged, type User } from 'firebase/auth'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/**
 * Resolve the signed-in user, waiting for Firebase to restore the session on a
 * fresh page load. `getAuth().currentUser` is null until `onAuthStateChanged`
 * fires once on init — without this wait, a request made from a mount effect
 * right after a full load (e.g. the Stripe checkout redirect) throws
 * "Not authenticated" even though the user is signed in. Rejects if signed out.
 */
function resolveUser(): Promise<User> {
  const auth = getAuth()
  if (auth.currentUser) return Promise.resolve(auth.currentUser)
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe()
        if (user) resolve(user)
        else reject(new Error('Not authenticated'))
      },
      (err) => {
        unsubscribe()
        reject(err)
      },
    )
  })
}

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const user = await resolveUser()
  const idToken = await user.getIdToken()

  const isFormData = init.body instanceof FormData
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${idToken}`,
      ...(init.headers ?? {}),
    },
  })
}

/**
 * Perform an authenticated request and turn HTTP failures into exceptions.
 * `fetch` only rejects for transport failures, so mutation handlers that rely
 * on try/catch should use this helper before updating optimistic local state.
 */
export async function apiRequestOrThrow(
  path: string,
  init: RequestInit = {},
  fallbackMessage = 'The request could not be completed.',
): Promise<Response> {
  const response = await apiRequest(path, init)
  if (response.ok) return response

  const body = await response.json().catch(() => ({})) as { error?: string }
  throw new Error(body.error ?? fallbackMessage)
}
