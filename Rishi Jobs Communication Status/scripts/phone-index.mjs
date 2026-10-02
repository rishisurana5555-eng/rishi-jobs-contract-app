/**
 * Builds phoneIndex (which candidate each phone number belongs to) from the existing candidates,
 * run from this computer with the admin key (serviceAccountKey.json). Safe to run again.
 *
 *   npm run phone-index            show what would be written and any numbers shared by candidates
 *   npm run phone-index -- write   write the missing entries and remove entries whose candidate is gone
 *
 * A number shared by several candidates is given to the earliest-added one and listed, so they can be
 * checked and merged by hand. New candidates can't use any indexed number (see claimPhones in firebaseBackend.ts).
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(root, 'serviceAccountKey.json')
if (!existsSync(keyPath)) {
  console.error(`Admin key not found at ${keyPath}`)
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) })
const db = getFirestore()
const write = process.argv[2] === 'write'

// Keep in sync with COUNTRY_CODES / splitPhone / phoneKey in src/components/PhoneInput.tsx.
const CODES = ['+91', '+971', '+966', '+974', '+968', '+965', '+973', '+1', '+44', '+61', '+65', '+60', '+49', '+977', '+880', '+94']
function phoneKey(value) {
  const v = (value ?? '').trim()
  if (v.startsWith('+')) {
    const digits = v.slice(1).replace(/\D/g, '')
    const code = [...CODES].sort((a, b) => b.length - a.length).find((c) => digits.startsWith(c.slice(1)))
    if (code) {
      const number = digits.slice(code.length - 1)
      return number ? code.slice(1) + number : null
    }
  }
  let digits = v.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return digits ? '91' + digits : null
}

const candidates = (await db.collection('candidates').get()).docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
const ids = new Set(candidates.map((c) => c.id))

/** key → candidates with that number, earliest first */
const byKey = new Map()
for (const c of candidates)
  for (const n of [c.candidateContactNumber, c.candidateAltContactNumber]) {
    const key = phoneKey(n)
    if (!key) continue
    const list = byKey.get(key) ?? []
    if (!list.some((x) => x.id === c.id)) list.push(c)
    byKey.set(key, list)
  }

const existing = new Map((await db.collection('phoneIndex').get()).docs.map((d) => [d.id, d.data()]))
const toWrite = [...byKey].filter(([key]) => !existing.has(key))
const orphans = [...existing].filter(([, v]) => !ids.has(v.candidateId))
const shared = [...byKey].filter(([, list]) => list.length > 1)

console.log(`${candidates.length} candidates, ${byKey.size} numbers; ${existing.size} already indexed.`)
console.log(`${toWrite.length} to add, ${orphans.length} to remove (candidate deleted).`)
if (shared.length) {
  console.log(`\n⚠ ${shared.length} number(s) shared by more than one candidate (given to the first listed):`)
  for (const [key, list] of shared) console.log(`  +${key}: ${list.map((c) => `${c.id} ${c.candidateName}`).join(' | ')}`)
}

if (!write) {
  console.log('\nNothing written. Run `npm run phone-index -- write` to apply.')
} else {
  const ops = [
    ...toWrite.map(([key, list]) => (b) => b.set(db.doc(`phoneIndex/${key}`), { candidateId: list[0].id, pe: list[0].pe ?? null, createdAt: Date.now() })),
    ...orphans.map(([key]) => (b) => b.delete(db.doc(`phoneIndex/${key}`))),
  ]
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch()
    for (const op of ops.slice(i, i + 400)) op(batch)
    await batch.commit()
  }
  console.log(`\n✓ phoneIndex updated (${ops.length} change(s)).`)
}
