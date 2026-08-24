import {
  GoogleAuthProvider,
  getAdditionalUserInfo,
  signInWithPopup,
  signInWithEmailAndPassword,
  linkWithCredential,
  type AuthCredential,
  type User,
} from 'firebase/auth'
import { auth } from './firebase'

export type GoogleSignInOutcome =
  | { kind: 'success'; user: User; isNewUser: boolean }
  | { kind: 'needs-link'; email: string; pendingCred: AuthCredential }
  | { kind: 'cancelled' }
  | { kind: 'error'; code: string; message: string }

export async function googleSignInOrPrepareLink(): Promise<GoogleSignInOutcome> {
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider())
    return { kind: 'success', user: result.user, isNewUser: getAdditionalUserInfo(result)?.isNewUser === true }
  } catch (err) {
    const code = (err as { code?: string })?.code ?? ''
    if (code === 'auth/account-exists-with-different-credential') {
      const pendingCred = GoogleAuthProvider.credentialFromError(err as never)
      const email = (err as { customData?: { email?: string } })?.customData?.email
      if (pendingCred && email) {
        return { kind: 'needs-link', email, pendingCred }
      }
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return { kind: 'cancelled' }
    }
    return {
      kind: 'error',
      code,
      message: err instanceof Error ? err.message : 'Sign-in failed',
    }
  }
}

export async function completeGoogleLinkWithPassword(
  email: string,
  password: string,
  pendingCred: AuthCredential,
): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, password)
  await linkWithCredential(result.user, pendingCred)
  return result.user
}
