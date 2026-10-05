import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Backend } from '../backend'
import { isAdminRole, type AdminMessage, type AppUser, type Application, type CandidateProfile, type CatalogEdit, type Client, type JobOpening } from '../types'
import { properName } from '../workflow/names'
import { playSound, stopSound, type SoundKind } from '../alarm/sound'
import { needsAutoDebrief, SYSTEM_ACTOR, type Action } from '../workflow/engine'
import { ctStaleSince, CT_STALE_ALERT_MS, firstReminderAt, isMyTurn, peUnansweredOverdueAt, REMINDER_EVERY_MS, sideOf, type Names } from '../workflow/workflow'
import { fmtDateTime } from '../workflow/dates'
import { jobEventsFor, jobLate, jobLateFor, jobLateText, jobNeedsMe, jobTurnSince, type JobLate } from '../workflow/jobs'

export interface Toast {
  id: number
  /** '' for announcements (new client / job opening), which open nothing */
  appId: string
  title: string
  body: string
  message: string
  actionRequired: boolean
  /** one-time alert about a client / job opening (new, or handed to someone): stays until closed */
  announcement?: boolean
  /** the job opening the alert is about: clicking it opens that job opening */
  jobId?: string
  /** a PE's message to the admins: stays until closed; clicking it opens the messages */
  isMessage?: boolean
  /** the sound played with this alert; closing the alert stops it */
  soundKey?: string
}

/** Alerts about clients / job openings from longer ago than this are skipped for someone with no record yet. */
const ANNOUNCE_LOOKBACK_MS = 7 * 86_400_000

/**
 * The automatic "interview time passed → debrief pending" move. The Client Team's dashboard makes it;
 * the PM's steps in this much later if it hasn't happened (both at once would race, and the rules refuse the second).
 */
const PM_STEPS_IN_MS = 60_000
/** Waited on top, so a computer clock a little ahead of the server's doesn't try too early. */
const CLOCK_MARGIN_MS = 2_000
/** A refused try (too early for the server, or offline) is tried again this often while still needed. */
const AUTO_RETRY_MS = 15_000

/** When this user's dashboard should make the automatic move for this record (null: not theirs to make). */
function autoMoveAt(a: Application, meId: string) {
  const side = sideOf(a, meId)
  if (!side || a.stage !== 'interview_scheduled' || !a.interviewEndsAt) return null
  return a.interviewEndsAt + CLOCK_MARGIN_MS + (side === 'PM' ? PM_STEPS_IN_MS : 0)
}

/** The repeating "work is pending" alarm: the records and job openings that are your turn for 10+ minutes. */
export interface Reminder {
  appIds: string[]
  jobIds: string[]
  at: number
}

interface AppState {
  backend: Backend
  me: AppUser
  users: AppUser[]
  nameOf: (id: string | null | undefined) => string
  /** a person's name, or undefined if unknown (for status labels) */
  names: Names
  /** Admins: all; Client Team: the clients they look after; PM / PE: the clients of their job openings */
  clients: Client[]
  /** only the job openings this person is on (all for the admins) */
  jobs: JobOpening[]
  /** job openings waiting for me: an Admin to assign the PM, the PM to assign the PE, the PE to submit a candidate */
  jobsToAssign: JobOpening[]
  /** is this job opening waiting for me? */
  jobWaitsForMe: (j: JobOpening) => boolean
  /** its submission deadline has passed without a submission, as far as it concerns me (see jobLateFor) */
  jobLateForMe: (j: JobOpening) => JobLate | null
  /** the job openings jobLateForMe flags, A–Z by job title */
  lateJobs: JobOpening[]
  /** Admins: PE candidates the PM marked unanswered with no reply from the PE for 48+ hours */
  peUnansweredLate: Application[]
  /** Super Admin: CVs with the client whose Client Team status has not changed for 6+ days */
  ctStale: Application[]
  /** the job opening whose page is open (the dashboard switches to Job openings) */
  openJobId: string | null
  openJob: (id: string | null) => void
  apps: Application[]
  appsLoaded: boolean
  loadError: string | null
  now: number
  selectedId: string | null
  openApp: (id: string | null) => void
  perform: (appId: string | null, action: Action) => Promise<string>
  toasts: Toast[]
  dismissToast: (id: number) => void
  reminder: Reminder | null
  dismissReminder: () => void
  /** PM: the PE's candidate whose "Send to Client Team" form is open */
  sendToCtId: string | null
  setSendToCtId: (id: string | null) => void
  actionRequired: Application[]
  unread: Application[]
  /** PE: their conversations with the admins; Admins: conversations with them or all admins (newest first) */
  messages: AdminMessage[]
  /** messages from someone else not read yet */
  unreadMessages: AdminMessage[]
  messagesOpen: boolean
  setMessagesOpen: (open: boolean) => void
  /** candidate profiles the person may see (PE / PM: their own; admins and the Client Team: all) */
  candidates: CandidateProfile[]
  /** the candidate whose "Delete candidate" dialog is open */
  deletingCandidate: { candidateId: string; name: string } | null
  setDeletingCandidate: (c: { candidateId: string; name: string } | null) => void
}

const Ctx = createContext<AppState | null>(null)

const REMINDER_SOUND = 'reminder'

/**
 * A desktop notification whenever the person isn't looking at the app (another tab or another program
 * in front); closing it stops its sound. Everyone is asked once to allow them (see AppProvider).
 */
function desktopNotify(title: string, options: NotificationOptions, soundKey: string, onClick?: () => void) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || (!document.hidden && document.hasFocus())) return
  const n = new Notification(title, { icon: '/logo.png', ...options })
  n.onclose = () => stopSound(soundKey)
  n.onclick = () => {
    stopSound(soundKey)
    window.focus()
    onClick?.()
    n.close()
  }
}

/** Action required → harsher alert; a status change → smooth chime; a note → calm bell. */
const soundFor = (toasts: Toast[]): SoundKind =>
  toasts.some((t) => t.actionRequired) ? 'alert' : toasts.some((t) => t.body) ? 'success' : 'notify'

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside provider')
  return v
}

let toastSeq = 0

function toastFor(app: Application, meId: string): Toast {
  // A plain note; a doubt between the Client Team and the PM (also kept as a note) says what it is.
  const isNote = app.lastActionType === 'note' && app.lastActionLabel === 'Note'
  const fromPe = app.stage === 'pe_submitted' && !isNote
  return {
    id: ++toastSeq,
    appId: app.id,
    title: isNote
      ? `${app.lastUpdatedByName} added a note on ${app.candidateName}`
      : fromPe
        ? `📥 ${app.lastActionLabel}`
        : `${app.lastUpdatedByName} → ${app.candidateName}`,
    body: isNote ? '' : fromPe ? `${app.candidateName} · ${app.jobTitle} at ${app.clientName}` : app.lastActionLabel,
    message: app.lastActionMessage,
    actionRequired: isMyTurn(app, meId),
  }
}

export function AppProvider({ backend, me, children }: { backend: Backend; me: AppUser; children: ReactNode }) {
  const [users, setUsers] = useState<AppUser[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [jobs, setJobs] = useState<JobOpening[]>([])
  const [apps, setApps] = useState<Application[]>([])
  const [appsLoaded, setAppsLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [now, setNow] = useState(Date.now())
  const seen = useRef<Map<string, number> | null>(null)
  /** appId → when the automatic "interview passed" move was last tried */
  const autoTried = useRef(new Map<string, number>())
  const [reminder, setReminder] = useState<Reminder | null>(null)
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  const [sendToCtId, setSendToCtId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AdminMessage[] | null>(null)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [candidates, setCandidates] = useState<CandidateProfile[]>([])
  const [deletingCandidate, setDeletingCandidate] = useState<{ candidateId: string; name: string } | null>(null)
  const seenMessages = useRef<Set<string> | null>(null)
  const toastsRef = useRef<Toast[]>([])
  toastsRef.current = toasts
  const [clientsLoaded, setClientsLoaded] = useState(false)
  const [jobsLoaded, setJobsLoaded] = useState(false)
  const [catalogSeenAt, setCatalogSeenAt] = useState<number | null | undefined>(undefined)
  const announced = useRef(new Set<string>())
  /** appId → when the next reminder alarm is due for it (in memory, per open tab) */
  const nextRing = useRef(new Map<string, number>())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    // Browsers slow timers down in background tabs: look again as soon as the tab is shown.
    const onShow = () => !document.hidden && setNow(Date.now())
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('focus', onShow)
    }
  }, [])

  useEffect(() => {
    const u1 = backend.listenUsers((list) => setUsers(list.map((u) => ({ ...u, name: properName(u.name) }))))
    const u2 = backend.listenClients(me, (c) => {
      setClients(c)
      setClientsLoaded(true)
    })
    const u3 = backend.listenJobs(me, (j) => {
      setJobs(j)
      setJobsLoaded(true)
    })
    const u5 = backend.listenCatalogSeen(me.id, setCatalogSeenAt)
    const u6 = me.role === 'PE' || isAdminRole(me.role) ? backend.listenMessages(me, setMessages) : () => {}
    const u4 = backend.listenApplications(
      me,
      (list) => {
        setApps(list.map((a) => ({ ...a, candidateName: properName(a.candidateName) })))
        setAppsLoaded(true)
        setLoadError(null)
      },
      (e) => setLoadError(e.message),
    )
    const u7 = backend.listenCandidates(me, (list) => setCandidates(list.map((c) => ({ ...c, candidateName: properName(c.candidateName) }))))
    return () => [u1, u2, u3, u4, u5, u6, u7].forEach((u) => u())
  }, [backend, me])

  // Desktop notifications for everyone: asked on the person's first click / key press after logging in
  // (browsers only allow asking then). If they were blocked, the bell menu explains how to allow them.
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
    const ask = () => {
      window.removeEventListener('pointerdown', ask, true)
      window.removeEventListener('keydown', ask, true)
      if (Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    }
    window.addEventListener('pointerdown', ask, true)
    window.addEventListener('keydown', ask, true)
    return () => {
      window.removeEventListener('pointerdown', ask, true)
      window.removeEventListener('keydown', ask, true)
    }
  }, [])

  // A new message or reply from someone else → alert with the calm notification sound (not for ones already there at login).
  useEffect(() => {
    if (!messages) return
    const prev = seenMessages.current
    seenMessages.current = new Set(messages.map((m) => m.id))
    if (!prev) return
    const fresh = messages.filter((m) => !prev.has(m.id) && m.from !== me.id && !m.readBy.includes(me.id))
    if (!fresh.length) return
    const soundKey = `messages-${toastSeq + 1}`
    const newToasts: Toast[] = fresh.map((m) => ({
      id: ++toastSeq,
      appId: '',
      title: `✉ ${m.replyTo ? 'Reply' : 'Message'} from ${m.fromName}`,
      body: '',
      message: m.body.length > 140 ? `${m.body.slice(0, 140)}…` : m.body,
      actionRequired: false,
      isMessage: true,
      soundKey,
    }))
    setToasts((t) => [...newToasts, ...t].slice(0, 8))
    playSound('notify', soundKey)
    for (const m of fresh) desktopNotify(`✉ ${m.replyTo ? 'Reply' : 'Message'} from ${m.fromName}`, { body: m.body, tag: `msg-${m.id}` }, soundKey, () => setMessagesOpen(true))
  }, [messages, me.id, me.role])

  // Real-time alerts: anything changed by someone else that is unread for me.
  useEffect(() => {
    if (!appsLoaded) return
    const prev = seen.current
    const next = new Map(apps.map((a) => [a.id, a.lastUpdatedAt]))
    seen.current = next
    // First load: what became my turn while I was away (unread, waiting for me) pops up once now;
    // other unread changes only show in the counts.
    const fresh = apps.filter(
      (a) =>
        a.lastUpdatedBy !== me.id &&
        a.unreadFor.includes(me.id) &&
        (prev ? (prev.get(a.id) ?? 0) < a.lastUpdatedAt : isMyTurn(a, me.id)),
    )
    if (!fresh.length) return
    const soundKey = `toasts-${toastSeq + 1}`
    const newToasts = fresh.map((a) => ({ ...toastFor(a, me.id), soundKey }))
    setToasts((t) => [...newToasts, ...t].slice(0, 5))
    playSound(soundFor(newToasts), soundKey)
    // It has just become my turn: the repeating alarm starts 10 minutes from now. (At login, what was
    // already waiting keeps its own schedule — an overdue one still rings at once.)
    if (prev) for (const t of newToasts) if (t.actionRequired) nextRing.current.set(`a:${t.appId}`, Date.now() + REMINDER_EVERY_MS)
    for (const t of newToasts)
      desktopNotify(t.title, { body: [t.body, t.message && `“${t.message}”`].filter(Boolean).join(' — '), tag: t.appId }, soundKey, () =>
        setSelectedId(t.appId),
      )
  }, [apps, appsLoaded, me.id])

  // Interview time + 5 minutes passed → debrief pending, performed by an open dashboard the moment it is
  // due (not on reload only). The transaction makes sure it only happens once; the alert and the alarm
  // for the next step then follow on both sides.
  useEffect(() => {
    const t = Date.now()
    const dueAt = (a: Application) => autoMoveAt(a, me.id)
    for (const a of apps) {
      const at = dueAt(a)
      if (at == null || at > t || !needsAutoDebrief(a, t)) continue
      const last = autoTried.current.get(a.id)
      if (last && t - last < AUTO_RETRY_MS) continue
      autoTried.current.set(a.id, t)
      backend.perform(a.id, SYSTEM_ACTOR, { kind: 'auto_debrief' }).catch(() => {
        // Already moved by the other side (the listener brings that in), or refused as a moment
        // too early for the server's clock: try again shortly.
        setTimeout(() => setNow(Date.now()), AUTO_RETRY_MS)
      })
    }
    // Wake up exactly when the next one is due, not only on the 30-second tick.
    const next = Math.min(...apps.map(dueAt).filter((x): x is number => x != null && x > t))
    if (!Number.isFinite(next) || next - t > 86_400_000) return
    const timer = setTimeout(() => setNow(Date.now()), next - t + 50)
    return () => clearTimeout(timer)
  }, [apps, now, backend, me.id])

  // Job openings are handed down Client Team → Admin → PM → PE, and only the people concerned are
  // alerted, once: the admins about a new client and a new job opening, a PM / PE when one is assigned
  // to them, and the client's Client Team member as it moves on. An edit (with its reason) goes to the
  // admins and to the PM and PE on the job openings concerned. What each person has been alerted about
  // is saved in userState/{uid}, so it doesn't repeat on reload or another device.
  useEffect(() => {
    if (!clientsLoaded || !jobsLoaded || !users.length || catalogSeenAt === undefined) return
    const since = catalogSeenAt ?? Date.now() - ANNOUNCE_LOOKBACK_MS
    const nameOf = (id: string) => users.find((u) => u.id === id)?.name
    const admin = isAdminRole(me.role)
    const editBody = (e: CatalogEdit) => `by ${e.byName} — ${e.summary}. Reason: ${e.reason}`
    const items = [
      // Every new client → the admins.
      ...(admin ? clients.filter((c) => c.createdBy !== me.id) : []).map((c) => ({
        key: `c:${c.id}`,
        at: c.createdAt,
        title: `📢 New client added: ${c.name}`,
        body: `added by ${c.createdByName ?? 'the Client Team'}`,
        actionRequired: false,
        jobId: undefined as string | undefined,
      })),
      // A client edited → the admins (from the client), and the PM / PE of its job openings (stamped on them).
      ...(admin ? clients : [])
        .filter((c) => c.lastEdit && c.lastEdit.by !== me.id)
        .map((c) => ({ key: `ce:${c.id}:${c.lastEdit!.at}`, at: c.lastEdit!.at, title: `✏️ Client edited: ${c.name}`, body: editBody(c.lastEdit!), actionRequired: false, jobId: undefined as string | undefined })),
      ...jobs
        .filter((j) => j.lastEdit && j.lastEdit.by !== me.id && (admin ? j.lastEdit.what === 'job' : j.assignedPM === me.id || j.assignedPE === me.id))
        .map((j) => {
          const e = j.lastEdit!
          return e.what === 'client'
            ? { key: `ce:${j.clientId}:${e.at}`, at: e.at, title: `✏️ Client edited: ${j.clientName}`, body: editBody(e), actionRequired: false, jobId: j.id as string | undefined }
            : { key: `je:${j.id}:${e.at}`, at: e.at, title: `✏️ Job opening edited: ${j.title} at ${j.clientName}`, body: editBody(e), actionRequired: false, jobId: j.id as string | undefined }
        }),
      ...jobs.flatMap((j) => jobEventsFor(me, j, nameOf).map((e) => ({ ...e, jobId: j.id as string | undefined }))),
      // A submission deadline passed without a submission → the admins, once per deadline (`now` notices it passing).
      ...(admin && appsLoaded ? jobs : []).flatMap((j) => {
        const late = jobLate(j, apps, Date.now())
        return late
          ? [{
              key: `jl:${j.id}:${j.submitBy}`,
              at: j.submitBy!,
              title: `⏰ Submission deadline missed: ${j.title} at ${j.clientName}`,
              body: `Due by ${fmtDateTime(j.submitBy!)} — ${jobLateText(j, late, nameOf)}`,
              actionRequired: true,
              jobId: j.id as string | undefined,
            }]
          : []
      }),
      // A PE has not replied for 48 hours to a candidate the PM marked unanswered → the admins, once per doubt.
      ...(admin && appsLoaded ? apps : []).flatMap((a) => {
        const at = peUnansweredOverdueAt(a, Date.now())
        return at
          ? [{
              key: `pu:${a.id}:${a.stageSince}`,
              at,
              title: `⚠ PE has not answered for 48 hours: ${a.candidateName}`,
              body: `${nameOf(a.assignedPM) ?? 'The PM'} marked the candidate unanswered for ${nameOf(a.assignedPE ?? '') ?? 'the PE'} on ${fmtDateTime(a.stageSince)} — ${a.jobTitle} at ${a.clientName}`,
              actionRequired: true,
              jobId: undefined as string | undefined,
              appId: a.id,
            }]
          : []
      }),
      // The Client Team status has not changed for 6 days with the CV at the client → the Super Admin, once per status.
      ...(me.role === 'SuperAdmin' && appsLoaded ? apps : []).flatMap((a) => {
        const since = ctStaleSince(a, Date.now())
        return since
          ? [{
              key: `cs:${a.id}:${since}`,
              at: since + CT_STALE_ALERT_MS,
              title: `🔴 Client Team status unchanged for 6 days: ${a.candidateName}`,
              body: `${nameOf(a.assignedClientTeam) ?? 'The Client Team'} — ${a.jobTitle} at ${a.clientName}, no change since ${fmtDateTime(since)}`,
              actionRequired: true,
              jobId: undefined as string | undefined,
              appId: a.id,
            }]
          : []
      }),
    ].filter((x): x is typeof x & { at: number } => !!x.at && x.at > since && !announced.current.has(x.key))
    if (!items.length) return
    for (const x of items) announced.current.add(x.key)
    const unique = [...new Map(items.map((x) => [x.key, x])).values()]
    const soundKey = `announce-${toastSeq + 1}`
    const newToasts: Toast[] = unique
      .sort((a, b) => b.at - a.at)
      .map((x) => ({ id: ++toastSeq, appId: 'appId' in x && typeof x.appId === 'string' ? x.appId : '', jobId: x.jobId, title: x.title, body: x.body, message: '', actionRequired: x.actionRequired, announcement: true, soundKey }))
    setToasts((t) => [...newToasts, ...t].slice(0, 8))
    playSound(newToasts.some((t) => t.actionRequired) ? 'alert' : 'notify', soundKey)
    for (const t of newToasts)
      desktopNotify(t.title, { body: t.body }, soundKey, t.appId ? () => setSelectedId(t.appId) : t.jobId ? () => setOpenJobId(t.jobId!) : undefined)
    backend.markCatalogSeen(me.id, Math.max(...items.map((x) => x.at))).catch(console.error)
  }, [clients, jobs, apps, appsLoaded, now, users, clientsLoaded, jobsLoaded, catalogSeenAt, backend, me])

  // The job openings I have submitted candidates for (a PE's job opening waits for them until then).
  const submittedJobIds = useMemo(() => new Set(me.role === 'PE' ? apps.filter((a) => a.assignedPE === me.id).map((a) => a.jobId) : []), [apps, me])
  const jobWaitsForMe = useCallback((j: JobOpening) => jobNeedsMe(j, me, submittedJobIds), [me, submittedJobIds])
  const jobsWaiting = useMemo(() => jobs.filter(jobWaitsForMe), [jobs, jobWaitsForMe])
  const jobLateForMe = useCallback((j: JobOpening) => (appsLoaded ? jobLateFor(j, apps, me, now) : null), [apps, appsLoaded, me, now])
  const peUnansweredLate = useMemo(
    () => (isAdminRole(me.role) ? apps.filter((a) => peUnansweredOverdueAt(a, now)).sort((a, b) => a.stageSince - b.stageSince) : []),
    [apps, me.role, now],
  )
  const ctStale = useMemo(
    () => (me.role === 'SuperAdmin' ? apps.filter((a) => ctStaleSince(a, now)).sort((a, b) => ctStaleSince(a, now)! - ctStaleSince(b, now)!) : []),
    [apps, me.role, now],
  )
  const lateJobs = useMemo(() => jobs.filter((j) => jobLateForMe(j)).sort((a, b) => a.title.localeCompare(b.title) || a.clientName.localeCompare(b.clientName)), [jobs, jobLateForMe])

  // Reminder alarm: every 10 minutes while a record or a job opening is my turn, until that changes.
  // All overdue ones ring together, then their next alarm is 10 minutes later.
  useEffect(() => {
    if (!appsLoaded || !jobsLoaded) return
    const check = () => {
      const t = Date.now()
      // One list of my pending work: candidates ("a:") and job openings ("j:"), with when each first rings.
      const mine = [
        ...apps.filter((a) => isMyTurn(a, me.id, t)).map((a) => ({ key: `a:${a.id}`, first: firstReminderAt(a, me.id), name: a.candidateName })),
        ...jobsWaiting.map((j) => ({ key: `j:${j.id}`, first: jobTurnSince(j, me) + REMINDER_EVERY_MS, name: `${j.title} at ${j.clientName}` })),
        // The PM / PE who missed a job opening's submission deadline: rings the moment it passes ("d:").
        ...(me.role === 'PM' || me.role === 'PE' ? jobs : [])
          .filter((j) => jobLateFor(j, apps, me, t))
          .map((j) => ({ key: `d:${j.id}`, first: j.submitBy!, name: `${j.title} at ${j.clientName} (submission deadline passed)` })),
      ]
      const keys = new Set(mine.map((x) => x.key))
      for (const k of nextRing.current.keys()) if (!keys.has(k)) nextRing.current.delete(k)
      for (const x of mine) if (!nextRing.current.has(x.key)) nextRing.current.set(x.key, x.first)
      if (!mine.some((x) => nextRing.current.get(x.key)! <= t)) return
      const overdue = mine.filter((x) => x.first <= t)
      for (const x of overdue) nextRing.current.set(x.key, t + REMINDER_EVERY_MS)
      const ids = (prefix: string) => overdue.filter((x) => x.key.startsWith(prefix)).map((x) => x.key.slice(2))
      setReminder({ appIds: ids('a:'), jobIds: [...new Set([...ids('j:'), ...ids('d:')])], at: t })
      playSound('alarm', REMINDER_SOUND)
      desktopNotify(
        `⏰ ${overdue.length} task${overdue.length > 1 ? 's' : ''} pending — please finish as soon as possible`,
        { body: overdue.map((x) => x.name).join(', '), tag: 'rj-reminder', requireInteraction: true },
        REMINDER_SOUND,
      )
    }
    check()
    const timer = setInterval(check, 15_000)
    return () => clearInterval(timer)
  }, [apps, appsLoaded, jobs, jobsWaiting, jobsLoaded, me])

  const dismissReminder = useCallback(() => {
    stopSound(REMINDER_SOUND)
    setReminder(null)
  }, [])

  const openApp = useCallback((id: string | null) => {
    setSelectedId(id)
    if (!id) return
    for (const x of toastsRef.current) if (x.appId === id) stopSound(x.soundKey)
    setToasts((t) => t.filter((x) => x.appId !== id))
  }, [])

  // Opening a record marks it read for me (also while it stays open and new changes arrive).
  const selected = apps.find((a) => a.id === selectedId)
  const selectedUnread = !!selected?.unreadFor.includes(me.id)
  useEffect(() => {
    if (selectedId && selectedUnread) backend.markRead(selectedId, me.id).catch(console.error)
  }, [selectedId, selectedUnread, backend, me.id])

  // Closing an alert stops the sound that came with it.
  const dismissToast = useCallback((id: number) => {
    stopSound(toastsRef.current.find((x) => x.id === id)?.soundKey)
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  // A successful change gets the smooth "done" chime (errors get the alert sound where they are shown).
  const perform = useCallback(
    async (appId: string | null, action: Action) => {
      const id = await backend.perform(appId, { id: me.id, name: me.name, role: me.role }, action)
      playSound('success')
      return id
    },
    [backend, me],
  )

  const value = useMemo<AppState>(() => {
    const byId = new Map(users.map((u) => [u.id, u]))
    return {
      backend,
      me,
      users,
      nameOf: (id) => (id === 'system' ? 'System' : id ? (byId.get(id)?.name ?? 'Unknown') : '—'),
      names: (id) => byId.get(id)?.name,
      // PMs and PEs can't read clients: theirs come from their job openings.
      clients:
        me.role === 'PM' || me.role === 'PE'
          ? [...new Map(jobs.map((j) => [j.clientId, { id: j.clientId, name: j.clientName, contactPerson: '', assignedClientTeam: j.assignedClientTeam }])).values()]
          : clients,
      jobs,
      jobsToAssign: jobsWaiting,
      jobWaitsForMe,
      jobLateForMe,
      lateJobs,
      peUnansweredLate,
      ctStale,
      openJobId,
      openJob: setOpenJobId,
      apps,
      appsLoaded,
      loadError,
      now,
      selectedId,
      openApp,
      perform,
      toasts,
      dismissToast,
      reminder,
      dismissReminder,
      sendToCtId,
      setSendToCtId,
      actionRequired: apps.filter((a) => isMyTurn(a, me.id, now)),
      unread: apps.filter((a) => a.unreadFor.includes(me.id)),
      messages: messages ?? [],
      unreadMessages: (messages ?? []).filter((m) => m.from !== me.id && !m.readBy.includes(me.id)),
      messagesOpen,
      setMessagesOpen,
      candidates,
      deletingCandidate,
      setDeletingCandidate,
    }
  }, [backend, me, users, clients, jobs, jobsWaiting, jobWaitsForMe, jobLateForMe, lateJobs, peUnansweredLate, ctStale, openJobId, apps, appsLoaded, loadError, now, selectedId, openApp, perform, toasts, dismissToast, reminder, dismissReminder, sendToCtId, messages, messagesOpen, candidates, deletingCandidate])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
