import { createFirebaseBackend } from './firebaseBackend'
import type { Backend } from './types'

export async function loadBackend(): Promise<Backend> {
  if (!import.meta.env.VITE_FIREBASE_API_KEY)
    throw new Error('Firebase is not configured: the .env file with the VITE_FIREBASE_* settings is missing. See README.md.')
  return createFirebaseBackend()
}

export type { Backend, DeleteResult, JobAssignment, Unsub } from './types'
