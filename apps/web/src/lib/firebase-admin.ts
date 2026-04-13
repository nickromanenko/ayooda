import { initializeApp, getApps, cert, type AppOptions } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

function initAdmin() {
  if (getApps().length > 0) return

  const options: AppOptions = {
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    options.credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
  }
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS automatically

  initializeApp(options)
}

export function getAdminAuth() {
  initAdmin()
  return getAuth()
}

export function getAdminDb() {
  initAdmin()
  return getFirestore()
}
