import { getApps, initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  setPersistence,
  signOut as fbSignOut,
} from 'firebase/auth'
import {
  addDoc,
  arrayRemove,
  deleteDoc,
  getDocs,
  writeBatch,
  arrayUnion,
  collection,
  collectionGroup,
  doc,
  getDoc,
  initializeFirestore,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type DocumentReference,
  type Query,
  type QuerySnapshot,
  type Transaction,
} from 'firebase/firestore'
import { ALL_ADMINS, isAdminRole, type AdminMessage, type AppUser, type JobNote, type CandidateProfile, type Application, type AvailabilityRound, type Client, type Interview, type JobOpening, type TimelineEntry } from '../types'
import { duplicatePhoneMessage, phoneKey, type PhoneOwner } from '../components/PhoneInput'
import { planAction, roundDocId, WorkflowError } from '../workflow/engine'
import { properName } from '../workflow/names'
import { appStayedOpen, markBrowserSession } from './browserSession'
import { resetIdle } from './idleSignOut'
import { loginEmailFor } from './loginId'
import type { Backend } from './types'

const env = import.meta.env
const MAX_CV_BYTES = 10 * 1024 * 1024
const UPLOAD_ATTEMPTS = 4

/** The upload script's version (google-drive-upload/Code.gs): 2 = recognises a repeated upload, 3 = can trash CVs. Asked once. */
let version: Promise<number> | null = null
function scriptVersion(endpoint: string) {
  version ??= fetch(endpoint)
    .then((r) => r.json())
    .then((info: { version?: number }) => info.version ?? 1)
    .catch(() => {
      version = null // ask again next time
      return 0
    })
  return version
}
const retriesAreSafe = async (endpoint: string) => (await scriptVersion(endpoint)) >= 2

const rows = <T>(snap: QuerySnapshot<DocumentData>): T[] => snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T)
const withoutId = <T extends { id?: string }>(o: T) => {
  const { id: _id, ...rest } = o
  return rest
}

/** Running ID series: candidates CN-0001…, clients CL-0001…, job openings JB-0001…. */
const ID_PREFIX = { candidates: 'CN', clients: 'CL', jobs: 'JB' } as const
const formatCode = (prefix: string, n: number) => `${prefix}-${String(n).padStart(4, '0')}`

export function createFirebaseBackend(): Backend {
  const fbApp = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  })
  const auth = getAuth(fbApp)
  // The login is shared by every tab of the browser, and ends once every tab of the app is closed (see browserSession.ts).
  const persistence = setPersistence(auth, browserLocalPersistence).catch(console.error)
  const db = initializeFirestore(fbApp, { ignoreUndefinedProperties: true })
  const appsCol = collection(db, 'applications')

  /**
   * The next number of a running ID series, e.g. CN-0079 after CN-0078, kept in counters/{kind}.
   * Reads the counter inside the transaction (reads must come first); call commit() once the new
   * record is being written in the same transaction, so two people adding at once never get the same ID.
   */
  async function nextCode(tx: Transaction, kind: keyof typeof ID_PREFIX) {
    const ref = doc(db, 'counters', kind)
    const snap = await tx.get(ref)
    const next = ((snap.data()?.last as number | undefined) ?? 0) + 1
    return { code: formatCode(ID_PREFIX[kind], next), commit: () => tx.set(ref, { last: next }) }
  }

  /**
   * No two candidates may have the same number: phoneIndex/{phoneKey} names the candidate each number
   * belongs to. Run inside the transaction that saves the candidate's numbers; it reads now (reads must
   * come first) and throws if a number is another candidate's. Call the returned function with the other
   * writes: it claims the new numbers and frees the candidate's old ones (`before`).
   */
  async function claimPhones(tx: Transaction, candidateId: string, pe: string | null, numbers: string[], before: string[], me: string) {
    const keys = [...new Set(numbers.map(phoneKey).filter((k): k is string => !!k))]
    const stale = [...new Set(before.map(phoneKey).filter((k): k is string => !!k && !keys.includes(k)))]
    const free: string[] = []
    for (const key of keys) {
      const owner = (await tx.get(doc(db, 'phoneIndex', key))).data() as PhoneOwner | undefined
      if (!owner) free.push(key)
      else if (owner.candidateId !== candidateId) throw new WorkflowError(duplicatePhoneMessage(owner, me))
    }
    const freed: string[] = []
    for (const key of stale) if ((await tx.get(doc(db, 'phoneIndex', key))).data()?.candidateId === candidateId) freed.push(key)
    return () => {
      for (const key of free) tx.set(doc(db, 'phoneIndex', key), { candidateId, pe, createdAt: Date.now() })
      for (const key of freed) tx.delete(doc(db, 'phoneIndex', key))
    }
  }

  /** Index entries of a candidate being deleted (any of these numbers that still point to them). */
  async function freePhones(candidateId: string, numbers: (string | undefined)[]) {
    const keys = [...new Set(numbers.map((n) => phoneKey(n ?? '')).filter((k): k is string => !!k))]
    for (const key of keys) {
      const ref = doc(db, 'phoneIndex', key)
      if ((await getDoc(ref)).data()?.candidateId === candidateId) await deleteDoc(ref)
    }
  }

  /** Saves a client / job opening; a new one (empty id) is given the next CL- / JB- number. */
  async function saveNumbered<T extends { id: string }>(col: 'clients' | 'jobOpenings', item: T): Promise<string> {
    if (item.id) {
      await setDoc(doc(db, col, item.id), withoutId(item))
      return item.id
    }
    return runTransaction(db, async (tx) => {
      const { code, commit } = await nextCode(tx, col === 'clients' ? 'clients' : 'jobs')
      const ref = doc(db, col, code)
      if ((await tx.get(ref)).exists()) throw new Error(`ID ${code} is already in use. Please try again.`)
      tx.set(ref, withoutId(item))
      commit()
      return code
    })
  }

  /** A client's job openings (the Client Team may only list those of the clients they look after). */
  const clientJobsQuery = (clientId: string, clientTeam: string) =>
    query(collection(db, 'jobOpenings'), where('clientId', '==', clientId), where('assignedClientTeam', '==', clientTeam))

  /** A candidate's submissions: admins and the Client Team find all; a PE / PM those they are on. */
  const candidateAppsQuery = (candidateId: string, me: AppUser) =>
    isAdminRole(me.role) || me.role === 'ClientTeam'
      ? query(appsCol, where('candidateId', '==', candidateId))
      : query(appsCol, where('candidateId', '==', candidateId), where(me.role === 'PE' ? 'assignedPE' : 'assignedPM', '==', me.id))

  async function deleteInBatches(refs: DocumentReference[]) {
    for (let i = 0; i < refs.length; i += 400) {
      const batch = writeBatch(db)
      for (const r of refs.slice(i, i + 400)) batch.delete(r)
      await batch.commit()
    }
  }

  /** A submission and everything under it: history, availability rounds, interviews. */
  async function deleteApplication(appId: string) {
    const ref = doc(appsCol, appId)
    // Children first: the rules check the parent record while its children are deleted.
    for (const sub of ['timeline', 'availabilityRounds', 'interviews']) {
      const snap = await getDocs(collection(ref, sub))
      await deleteInBatches(snap.docs.map((d) => d.ref))
    }
    await deleteDoc(ref)
  }

  /** Moves CV files to the Drive trash through the upload script (version 3+). Returns how many, or null if it can't. */
  async function trashCvFiles(urls: (string | null | undefined)[]): Promise<number | null> {
    const ids = [...new Set(urls.map((u) => u?.match(/\/d\/([A-Za-z0-9_-]{10,})/)?.[1]).filter((x): x is string => !!x))]
    if (!ids.length) return 0
    const endpoint = env.VITE_CV_UPLOAD_URL
    const user = auth.currentUser
    if (!endpoint || !user || (await scriptVersion(endpoint)) < 3) return null
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ idToken: await user.getIdToken(), action: 'trash', fileIds: ids }),
      })
      const out = (await res.json()) as { ok: boolean; trashed?: number }
      return out.ok ? (out.trashed ?? 0) : null
    } catch {
      return null
    }
  }

  const listen = <T>(q: Query<DocumentData>, cb: (rows: T[]) => void, onError?: (e: Error) => void) =>
    onSnapshot(
      q,
      (snap) => cb(rows<T>(snap)),
      (e) => (onError ? onError(e) : console.error(e)),
    )

  return {
    onAuth(cb, onError) {
      return onAuthStateChanged(auth, async (fbUser) => {
        if (!fbUser) return cb(null)
        // Logged in before, but every tab of the app (or the browser) has been closed since then: sign out.
        if (!(await appStayedOpen())) {
          await fbSignOut(auth)
          return
        }
        markBrowserSession()
        try {
          const snap = await getDoc(doc(db, 'users', fbUser.uid))
          const data = snap.exists() ? (snap.data() as AppUser) : null
          const profile = data ? { ...data, id: fbUser.uid, name: properName(data.name ?? '') } : null
          if (!profile || profile.active === false) {
            await fbSignOut(auth)
            onError(new Error(profile ? 'Your login has been deactivated. Please contact Rishi.' : 'Your login has no team profile yet. Please contact Rishi.'))
            return
          }
          cb(profile)
        } catch (e) {
          onError(e as Error)
        }
      })
    },
    async signIn(userId, password) {
      await persistence
      markBrowserSession()
      resetIdle()
      await signInWithEmailAndPassword(auth, loginEmailFor(userId), password)
    },
    async signOut() {
      await fbSignOut(auth)
    },
    async createLogin(userId, password) {
      // A second app instance, so creating the login doesn't sign the Owner out of their own session.
      const helper = getApps().find((a) => a.name === 'create-login') ?? initializeApp(fbApp.options, 'create-login')
      const helperAuth = getAuth(helper)
      try {
        const cred = await createUserWithEmailAndPassword(helperAuth, loginEmailFor(userId), password)
        return cred.user.uid
      } catch (e) {
        if ((e as { code?: string }).code === 'auth/email-already-in-use') throw new Error(`User ID "${userId}" already has a login.`)
        throw e
      } finally {
        await fbSignOut(helperAuth)
      }
    },

    listenUsers: (cb) => listen<AppUser>(query(collection(db, 'users')), cb),
    listenClients(me, cb) {
      const col = collection(db, 'clients')
      if (isAdminRole(me.role)) return listen<Client>(query(col), cb)
      if (me.role === 'ClientTeam') return listen<Client>(query(col, where('assignedClientTeam', '==', me.id)), cb)
      cb([])
      return () => {}
    },
    listenJobs(me, cb) {
      // Each person only receives the job openings they are on (enforced by firestore.rules too).
      const col = collection(db, 'jobOpenings')
      const field = me.role === 'PM' ? 'assignedPM' : me.role === 'PE' ? 'assignedPE' : 'assignedClientTeam'
      return listen<JobOpening>(isAdminRole(me.role) ? query(col) : query(col, where(field, '==', me.id)), cb)
    },
    listenCatalogSeen: (uid, cb) =>
      onSnapshot(
        doc(db, 'userState', uid),
        (snap) => cb(snap.exists() ? ((snap.data().catalogSeenAt as number | undefined) ?? null) : null),
        (e) => console.error(e),
      ),
    markCatalogSeen: (uid, seenAt) => setDoc(doc(db, 'userState', uid), { catalogSeenAt: seenAt }, { merge: true }),

    listenApplications(me, cb, onError) {
      // The Client Team: the submissions sent to them, and their clients' candidates still with the PM.
      if (me.role === 'ClientTeam') {
        const parts: Application[][] = [[], []]
        const loaded = [false, false]
        const unsubs = (['assignedClientTeam', 'watchClientTeam'] as const).map((field, i) =>
          listen<Application>(
            query(appsCol, where(field, '==', me.id)),
            (list) => {
              parts[i] = list
              loaded[i] = true
              if (loaded.every(Boolean)) cb([...new Map([...parts[0], ...parts[1]].map((a) => [a.id, a])).values()])
            },
            onError,
          ),
        )
        return () => unsubs.forEach((u) => u())
      }
      // Visibility is enforced by the query (and by firestore.rules), never by manual routing.
      const q =
        isAdminRole(me.role)
          ? query(appsCol)
          : me.role === 'PM'
            ? query(appsCol, where('assignedPM', '==', me.id))
            : query(appsCol, where('assignedPE', '==', me.id))
      return listen<Application>(q, cb, onError)
    },
    listenTimeline: (appId, cb) =>
      listen<TimelineEntry>(query(collection(db, 'applications', appId, 'timeline'), orderBy('timestamp')), cb),
    loadAllTimeline: () =>
      getDocs(collectionGroup(db, 'timeline')).then((s) =>
        s.docs.map((d) => ({ ...d.data(), id: d.id, appId: d.ref.parent.parent?.id ?? '' }) as TimelineEntry & { appId: string }),
      ),
    listenRounds: (appId, cb) => listen<AvailabilityRound>(query(collection(db, 'applications', appId, 'availabilityRounds')), cb),
    listenInterviews: (appId, cb) => listen<Interview>(query(collection(db, 'applications', appId, 'interviews')), cb),

    async perform(appId, actor, action) {
      // A new candidate gets the next candidate ID (CN-0001, CN-0002, …), counted in the same transaction.
      const ref = appId ? doc(appsCol, appId) : doc(appsCol)
      await runTransaction(db, async (tx) => {
        let app: Application | null = null
        let round: AvailabilityRound | null = null
        let interview: Interview | null = null
        let targetInterview: Interview | null = null
        if (appId) {
          const snap = await tx.get(ref)
          if (!snap.exists()) throw new WorkflowError('Record not found.')
          app = { ...(snap.data() as Application), id: snap.id }
          const r = await tx.get(doc(ref, 'availabilityRounds', roundDocId(app.currentInterviewRound, app.currentAttempt)))
          round = r.exists() ? ({ ...r.data(), id: r.id } as AvailabilityRound) : null
          if (app.currentInterviewId) {
            const i = await tx.get(doc(ref, 'interviews', app.currentInterviewId))
            interview = i.exists() ? ({ ...i.data(), id: i.id } as Interview) : null
          }
          if (action.kind === 'save_debrief') {
            const t = await tx.get(doc(ref, 'interviews', action.interviewId))
            targetInterview = t.exists() ? ({ ...t.data(), id: t.id } as Interview) : null
          }
        }
        const counted = action.kind === 'pe_submit' && !action.data.candidateId?.trim() ? await nextCode(tx, 'candidates') : null
        // The candidate's numbers must not belong to another candidate.
        let claim: (() => void) | null = null
        if (action.kind === 'pe_submit' || action.kind === 'send_to_ct') {
          const d = action.data
          const numbers = [d.candidateContactNumber, d.candidateAltContactNumber ?? '']
          if (action.kind === 'send_to_ct' && app) {
            claim = await claimPhones(tx, app.candidateId, app.assignedPE, numbers, [app.candidateContactNumber, app.candidateAltContactNumber ?? ''], actor.id)
          } else if (action.kind === 'pe_submit') {
            const existingId = d.candidateId?.trim()
            const profile = existingId ? ((await tx.get(doc(db, 'candidates', existingId))).data() as CandidateProfile | undefined) : undefined
            const candidateId = existingId || counted?.code
            if (candidateId)
              claim = await claimPhones(
                tx,
                candidateId,
                profile?.pe ?? actor.id,
                numbers,
                profile ? [profile.candidateContactNumber, profile.candidateAltContactNumber ?? ''] : [],
                actor.id,
              )
          }
        }
        const plan = planAction({ app, round, interview, targetInterview, actor, now: Date.now(), newId: ref.id, newCandidateId: counted?.code }, action)
        counted?.commit()
        tx.set(ref, withoutId(plan.app))
        for (const r of plan.rounds) tx.set(doc(ref, 'availabilityRounds', r.id), withoutId(r.data), { merge: true })
        for (const i of plan.interviews) tx.set(doc(ref, 'interviews', i.id), withoutId(i.data), { merge: true })
        for (const e of plan.timeline) tx.set(doc(collection(ref, 'timeline')), e)
        claim?.()
        // The same candidate can be sent to job openings of different PMs: every one of them keeps seeing the profile.
        if (plan.candidate)
          tx.set(doc(db, 'candidates', plan.candidate.id), { ...plan.candidate.data, ...(plan.candidate.data.people ? { people: arrayUnion(...plan.candidate.data.people) } : {}) }, { merge: true })
      })
      return ref.id
    },

    async markRead(appId, userId) {
      await updateDoc(doc(appsCol, appId), { unreadFor: arrayRemove(userId) })
    },

    async uploadCv(file, uploadId = crypto.randomUUID()) {
      const endpoint = env.VITE_CV_UPLOAD_URL
      if (!endpoint) throw new Error('CV upload is not set up yet. Choose "Paste link" for now.')
      if (file.size > MAX_CV_BYTES) throw new Error('The CV file is larger than 10 MB.')
      const user = auth.currentUser
      if (!user) throw new Error('Please sign in again.')
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file)
      })
      // Google sometimes answers with an error page even though the file was saved. The same uploadId
      // lets the script recognise a retry and return the saved file instead of saving it twice, so the
      // upload is retried automatically - but only once the script says it can recognise retries.
      for (let attempt = 1; ; attempt++) {
        let out: { ok: boolean; url?: string; name?: string; error?: string } | null = null
        let status = 0
        try {
          // text/plain avoids a CORS preflight (needed for a Google Apps Script web app).
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ idToken: await user.getIdToken(), uploadId, fileName: file.name, mimeType: file.type, data }),
          })
          status = res.status
          out = await res.json().catch(() => null)
        } catch {
          /* network error: treated like a lost answer below */
        }
        if (out?.ok && out.url) return { url: out.url, name: out.name ?? file.name }
        // The script said what went wrong: no point retrying.
        if (out && out.ok === false && out.error) throw new Error(`CV upload failed: ${out.error}`)
        // Anything else (an error page, or an answer without the file's link) means the answer got
        // lost on the way: the file may well be saved, and a retry with the same uploadId returns it.
        if (out) console.warn('CV upload: unexpected answer', status, out)
        if (attempt >= UPLOAD_ATTEMPTS || !(await retriesAreSafe(endpoint)))
          throw new Error(
            status
              ? 'Google Drive did not respond properly. Please wait a moment and try again.'
              : 'Could not reach the CV upload server. Check your internet connection and try again.',
          )
        await new Promise((r) => setTimeout(r, 1500 * attempt))
      }
    },

    discardCv: async (url) => ((await trashCvFiles([url])) ?? 0) > 0,

    listenCandidates(me, cb) {
      const col = collection(db, 'candidates')
      const q = isAdminRole(me.role) || me.role === 'ClientTeam' ? query(col) : query(col, where('people', 'array-contains', me.id))
      return listen<CandidateProfile>(q, cb)
    },

    async lookupPhone(number) {
      const key = phoneKey(number)
      if (!key) return null
      const owner = (await getDoc(doc(db, 'phoneIndex', key))).data() as PhoneOwner | undefined
      return owner ? { candidateId: owner.candidateId, pe: owner.pe ?? null } : null
    },

    findCandidateApps: (candidateId, me) => getDocs(candidateAppsQuery(candidateId, me)).then((s) => rows<Application>(s)),

    async deleteCandidate(candidateId, me) {
      const list = rows<Application>(await getDocs(candidateAppsQuery(candidateId, me)))
      const profileSnap = await getDoc(doc(db, 'candidates', candidateId)).catch(() => null)
      const profile = profileSnap?.exists() ? (profileSnap.data() as CandidateProfile) : null
      // Their numbers are free again (while the profile still exists: firestore.rules checks who is on it).
      await freePhones(candidateId, [profile?.candidateContactNumber, profile?.candidateAltContactNumber, ...list.flatMap((a) => [a.candidateContactNumber, a.candidateAltContactNumber])])
      for (const a of list) await deleteApplication(a.id)
      if (profileSnap?.exists()) await deleteDoc(doc(db, 'candidates', candidateId))
      const files = [profile?.originalCvUrl, ...list.flatMap((a) => [a.originalCvUrl, a.revisedCvUrl])]
      return { submissions: list.length, trashedFiles: await trashCvFiles(files) }
    },

    findClientApps: (clientId) => getDocs(query(appsCol, where('clientId', '==', clientId))).then((s) => rows<Application>(s)),

    async deleteClient(clientId) {
      const list = rows<Application>(await getDocs(query(appsCol, where('clientId', '==', clientId))))
      for (const a of list) await deleteApplication(a.id)
      const client = await getDoc(doc(db, 'clients', clientId))
      const jobs = await getDocs(clientJobsQuery(clientId, (client.data()?.assignedClientTeam as string | undefined) ?? ''))
      await deleteInBatches(jobs.docs.map((d) => d.ref))
      await deleteDoc(doc(db, 'clients', clientId))
      // The revised CVs were made for this client; the original CVs belong to the candidates and stay.
      return { submissions: list.length, trashedFiles: await trashCvFiles(list.map((a) => a.revisedCvUrl)) }
    },

    listenMessages(me, cb) {
      const col = collection(db, 'messages')
      const q = isAdminRole(me.role) ? query(col, where('threadTo', 'in', [me.id, ALL_ADMINS])) : query(col, where('pe', '==', me.id))
      return listen<AdminMessage>(q, (list) => cb(list.sort((a, b) => b.createdAt - a.createdAt)))
    },
    sendMessage: async (m) => void (await addDoc(collection(db, 'messages'), m)),
    markMessageRead: (id, uid) => updateDoc(doc(db, 'messages', id), { readBy: arrayUnion(uid) }),

    // A new client / job opening (no id yet) gets the next ID: CL-0001… / JB-0001…, whoever adds it.
    async saveClient(c) {
      if (!c.id) return saveNumbered('clients', c)
      const prev = (await getDoc(doc(db, 'clients', c.id))).data() as Client | undefined
      await setDoc(doc(db, 'clients', c.id), withoutId(c))
      // The job openings carry the client's name and Client Team member.
      if (prev && (prev.name !== c.name || prev.assignedClientTeam !== c.assignedClientTeam)) {
        const jobs = await getDocs(clientJobsQuery(c.id, prev.assignedClientTeam))
        for (let i = 0; i < jobs.docs.length; i += 400) {
          const batch = writeBatch(db)
          for (const d of jobs.docs.slice(i, i + 400)) batch.update(d.ref, { clientName: c.name, assignedClientTeam: c.assignedClientTeam })
          await batch.commit()
        }
      }
      return c.id
    },
    async saveJob(j) {
      if (!j.id) return void (await saveNumbered('jobOpenings', j))
      await updateDoc(doc(db, 'jobOpenings', j.id), { title: j.title, details: j.details, status: j.status })
    },
    assignJob(jobId, { to, userId, by, note }) {
      const now = Date.now()
      const text = note.trim()
      const notes = text ? { notes: arrayUnion({ by: by.id, byName: by.name, role: by.role, text, at: now } satisfies JobNote) } : {}
      const ref = doc(db, 'jobOpenings', jobId)
      // A new PM starts without a PE: they choose their own.
      return to === 'PM'
        ? updateDoc(ref, {
            assignedPM: userId,
            pmAssignedAt: now,
            pmAssignedBy: by.id,
            pmAssignedByName: by.name,
            assignedPE: null,
            peAssignedAt: null,
            peAssignedBy: null,
            peAssignedByName: null,
            ...notes,
          })
        : updateDoc(ref, {
            assignedPE: userId,
            peAssignedAt: userId ? now : null,
            peAssignedBy: userId ? by.id : null,
            peAssignedByName: userId ? by.name : null,
            ...notes,
          })
    },
    addJobNote: (jobId, note) => updateDoc(doc(db, 'jobOpenings', jobId), { notes: arrayUnion(note) }),
    saveUser: (u) => setDoc(doc(db, 'users', u.id), withoutId(u)),
    newId: () => doc(collection(db, '_ids')).id,
  }
}
