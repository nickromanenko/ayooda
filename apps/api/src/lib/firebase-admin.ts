import { initializeApp, getApps, cert, type AppOptions } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'

if (getApps().length === 0) {
  const options: AppOptions = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ?? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`,
  }

  // Production: use inline JSON from env var (Cloud Run secret)
  // Local dev: set GOOGLE_APPLICATION_CREDENTIALS to path of service-account.json
  //            and Firebase Admin picks it up automatically
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    options.credential = cert(serviceAccount)
  }

  initializeApp(options)
}

export const adminDb = getFirestore()
export const adminAuth = getAuth()

type StorageBucket = ReturnType<ReturnType<typeof getStorage>['bucket']>
export const adminBucket = (): StorageBucket => getStorage().bucket()
