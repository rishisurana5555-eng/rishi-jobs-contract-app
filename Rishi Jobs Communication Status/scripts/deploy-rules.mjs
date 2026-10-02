/** Publishes firestore.rules to the Firebase project using serviceAccountKey.json (no Firebase CLI needed). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getSecurityRules } from 'firebase-admin/security-rules'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(root, 'serviceAccountKey.json')
initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) })
const ruleset = await getSecurityRules().releaseFirestoreRulesetFromSource(readFileSync(join(root, 'firestore.rules'), 'utf8'))
console.log(`✓ Firestore rules published (${ruleset.name})`)
