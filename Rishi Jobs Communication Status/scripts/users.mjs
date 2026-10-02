/**
 * Team logins, run from this computer with the admin key (serviceAccountKey.json).
 *
 *   npm run users                   create any missing logins from scripts/team.json and
 *                                   write every profile (user type, name, contact, email)
 *   npm run users -- reset <userId> give that person a new random password
 *   npm run users -- set <userId> <password>   set a specific password (6+ characters)
 *   npm run users -- role <userId> <role>      change only that person's user type
 *                                   (e.g. role rishi SuperAdmin); nothing else is touched
 *   npm run users -- rename <oldUserId> <newUserId> <Name> <password>
 *                                   correct someone's user ID and name (same login, so all their
 *                                   work stays theirs); their name is corrected in saved records too.
 *                                   Update scripts/team.json to match.
 *
 * New/reset passwords are printed once and appended to login-credentials.txt (git-ignored).
 * Passwords live only in Firebase Authentication — never in the Firestore "users" collection.
 * Existing profiles keep contact details edited in the app unless team.json has a value.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { randomInt } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const LOGIN_DOMAIN = 'rishijobs.local' // keep in sync with src/backend/loginId.ts
const ROLES = ['SuperAdmin', 'Admin', 'PM', 'ClientTeam', 'PE']
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(root, 'serviceAccountKey.json')
const credsFile = join(root, 'login-credentials.txt')

if (!existsSync(keyPath)) {
  console.error(`Admin key not found at ${keyPath}`)
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) })
const auth = getAuth()
const db = getFirestore()

const loginEmail = (userId) => `${userId.trim().toLowerCase()}@${LOGIN_DOMAIN}`
const newPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join('')
}
const findLogin = (userId) => auth.getUserByEmail(loginEmail(userId)).catch((e) => (e.code === 'auth/user-not-found' ? null : Promise.reject(e)))

function saveCredentials(rows, heading) {
  if (!rows.length) return
  const lines = [`\n=== ${heading} — ${new Date().toLocaleString('en-IN')} ===`, ...rows.map((r) => `${r.name.padEnd(12)} User ID: ${r.userId.padEnd(12)} Password: ${r.password}`)]
  appendFileSync(credsFile, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
  console.log(`\nSaved to ${credsFile} — share each password privately, then keep this file safe or delete it.`)
}

/** Every record field ending in "Name" (e.g. actorName, createdByName) that holds `from` exactly, also inside lists. */
async function renameInRecords(from, to) {
  const fix = (v) => {
    if (Array.isArray(v)) {
      const out = v.map(fix)
      return out.some((x, i) => x !== v[i]) ? out : v
    }
    if (!v || typeof v !== 'object' || v.constructor !== Object) return v
    let changed = false
    const out = {}
    for (const [k, x] of Object.entries(v)) {
      out[k] = k.endsWith('Name') && x === from ? to : fix(x)
      if (out[k] !== x) changed = true
    }
    return changed ? out : v
  }
  let n = 0
  const walk = async (col) => {
    for (const d of (await col.get()).docs) {
      const data = d.data()
      const fixed = fix(data)
      if (fixed !== data) {
        await d.ref.update(Object.fromEntries(Object.entries(fixed).filter(([k, x]) => x !== data[k])))
        n++
      }
      for (const sub of await d.ref.listCollections()) await walk(sub)
    }
  }
  for (const c of await db.listCollections()) if (c.id !== 'users') await walk(c)
  return n
}

const [cmd, arg] = process.argv.slice(2)
try {
  if (cmd === 'rename') {
    const [, from, to, name, password] = process.argv.slice(2)
    if (!from || !to || !name || !password) throw new Error('Usage: npm run users -- rename <oldUserId> <newUserId> <Name> <password>')
    if (!/^[a-z0-9._-]{3,30}$/.test(to)) throw new Error(`Invalid user ID "${to}"`)
    if (password.length < 6) throw new Error('Firebase needs a password of at least 6 characters.')
    if (await findLogin(to)) throw new Error(`User ID "${to}" is already taken`)
    const login = await findLogin(from)
    if (!login) throw new Error(`No login for user ID "${from}"`)
    const ref = db.doc(`users/${login.uid}`)
    const oldName = (await ref.get()).get('name')
    await auth.updateUser(login.uid, { email: loginEmail(to), displayName: name, password })
    await auth.revokeRefreshTokens(login.uid)
    await ref.update({ userId: to, name })
    const records = oldName && oldName !== name ? await renameInRecords(oldName, name) : 0
    console.log(`✓ ${from} → ${to} (${oldName} → ${name}); name corrected in ${records} record(s)`)
    saveCredentials([{ name, userId: to, password }], `Renamed from ${from}`)
  } else if (cmd === 'role') {
    const [, userId, role] = process.argv.slice(2)
    if (!userId || !ROLES.includes(role)) throw new Error(`Usage: npm run users -- role <userId> <${ROLES.join('|')}>`)
    const login = await findLogin(userId)
    if (!login) throw new Error(`No login for user ID "${userId}"`)
    const ref = db.doc(`users/${login.uid}`)
    const before = (await ref.get()).get('role')
    await ref.update({ role, ...(role === 'PE' ? {} : { reportsTo: null }) })
    console.log(`✓ ${userId}: ${before ?? '(none)'} → ${role}`)
  } else if (cmd === 'set') {
    const [, userId, password] = process.argv.slice(2)
    if (!userId || !password) throw new Error('Usage: npm run users -- set <userId> <password>')
    if (password.length < 6) throw new Error('Firebase needs a password of at least 6 characters.')
    const login = await findLogin(userId)
    if (!login) throw new Error(`No login for user ID "${userId}"`)
    await auth.updateUser(login.uid, { password })
    await auth.revokeRefreshTokens(login.uid)
    const snap = await db.doc(`users/${login.uid}`).get()
    saveCredentials([{ name: snap.get('name') ?? userId, userId, password }], 'Password set')
  } else if (cmd === 'reset') {
    if (!arg) throw new Error('Usage: npm run users -- reset <userId>')
    const login = await findLogin(arg)
    if (!login) throw new Error(`No login for user ID "${arg}"`)
    const password = newPassword()
    await auth.updateUser(login.uid, { password })
    await auth.revokeRefreshTokens(login.uid)
    const snap = await db.doc(`users/${login.uid}`).get()
    saveCredentials([{ name: snap.get('name') ?? arg, userId: arg, password }], 'Password reset')
  } else if (!cmd) {
    const { users } = JSON.parse(readFileSync(join(root, 'scripts', 'team.json'), 'utf8'))
    for (const u of users) {
      if (!ROLES.includes(u.role)) throw new Error(`${u.userId}: unknown role "${u.role}" (use ${ROLES.join(', ')})`)
      if (!/^[a-z0-9._-]{3,30}$/.test(u.userId)) throw new Error(`Invalid user ID "${u.userId}"`)
    }
    const created = []
    const uid = new Map()
    for (const u of users) {
      let login = await findLogin(u.userId)
      if (!login) {
        const password = newPassword()
        login = await auth.createUser({ email: loginEmail(u.userId), password, displayName: u.name })
        created.push({ name: u.name, userId: u.userId, password })
      }
      uid.set(u.userId, login.uid)
    }
    for (const u of users) {
      const ref = db.doc(`users/${uid.get(u.userId)}`)
      const existing = (await ref.get()).data() ?? {}
      const reportsTo = u.role === 'PE' && u.reportsTo ? uid.get(u.reportsTo) : null
      if (u.role === 'PE' && u.reportsTo && !reportsTo) throw new Error(`${u.userId}: reportsTo "${u.reportsTo}" is not in team.json`)
      await ref.set({
        userId: u.userId,
        name: u.name,
        role: u.role,
        contactNumber: u.contactNumber || existing.contactNumber || '',
        email: u.email || existing.email || '',
        reportsTo,
        active: existing.active ?? true,
      })
      console.log(`✓ ${u.name.padEnd(12)} ${u.role.padEnd(11)} ${u.userId}`)
    }
    saveCredentials(created, 'New logins')
    if (!created.length) console.log('\nAll logins already existed; profiles updated.')
  } else {
    console.error('Usage: npm run users   |   npm run users -- reset <userId>   |   npm run users -- set <userId> <password>   |   npm run users -- role <userId> <role>')
    process.exit(1)
  }
} catch (e) {
  console.error(
    e?.code === 'auth/configuration-not-found'
      ? 'Logins are not switched on yet: Firebase console → Build → Authentication → Get started → Email/Password → Enable. Then run this again.'
      : `Error: ${e?.message ?? e}`,
  )
  process.exit(1)
}
