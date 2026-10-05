import { isAdminRole, type AppUser, type Application, type JobOpening } from '../types'
import { fmtDateTime } from './dates'
import type { Names } from './workflow'

/**
 * Where a job opening is in its hand-down: Client Team → Admin → PM → PE.
 * with_admin: waiting for an Admin to pick the PM; with_pm: waiting for that PM to pick the PE.
 */
export type JobStep = 'with_admin' | 'with_pm' | 'with_pe'

export const jobStep = (j: Pick<JobOpening, 'assignedPM' | 'assignedPE'>): JobStep =>
  !j.assignedPM ? 'with_admin' : !j.assignedPE ? 'with_pm' : 'with_pe'

export function jobStepLabel(j: Pick<JobOpening, 'assignedPM' | 'assignedPE'>, names?: Names) {
  const who = (id: string | null, role: string) => (id && names?.(id)) || role
  switch (jobStep(j)) {
    case 'with_admin':
      return 'With Admin – to assign a PM'
    case 'with_pm':
      return `With ${who(j.assignedPM, 'PM')} – to assign a PE`
    case 'with_pe':
      return `Assigned to ${who(j.assignedPE, 'PE')} (PM ${who(j.assignedPM, 'PM')})`
  }
}

/**
 * Open job openings waiting for this person: Admins assign the PM, the PM assigns the PE, and the PE
 * finds a candidate — until they have submitted one for it (`submittedJobIds`: the job openings they
 * have submitted candidates for).
 */
export function jobNeedsMe(j: JobOpening, me: Pick<AppUser, 'id' | 'role'>, submittedJobIds: ReadonlySet<string> = new Set()) {
  if (j.status !== 'open') return false
  const step = jobStep(j)
  return (
    (step === 'with_admin' && isAdminRole(me.role)) ||
    (step === 'with_pm' && j.assignedPM === me.id) ||
    (step === 'with_pe' && j.assignedPE === me.id && !submittedJobIds.has(j.id))
  )
}

/** Since when a job opening has been waiting for this person (the start of their turn). */
export function jobTurnSince(j: JobOpening, me: Pick<AppUser, 'id' | 'role'>) {
  if (j.assignedPE === me.id) return j.peAssignedAt ?? j.createdAt ?? 0
  if (j.assignedPM === me.id) return j.pmAssignedAt ?? j.createdAt ?? 0
  return j.createdAt ?? 0
}

/** What the person has to do with a job opening waiting for them. */
export function jobTodo(j: JobOpening, me: Pick<AppUser, 'id'>) {
  return j.assignedPE === me.id ? 'Find and add a candidate' : j.assignedPM === me.id ? 'Assign it to a PE' : 'Assign it to a PM'
}

export const JOB_STATUS_LABEL = { open: 'Open', 'on-hold': 'On hold', closed: 'Closed' } as const

/** Said to a PM / PE given a job opening that is not open: it is not the priority right now. */
export function jobStatusWarning(j: Pick<JobOpening, 'status'>) {
  return j.status === 'open'
    ? null
    : `This job opening is ${JOB_STATUS_LABEL[j.status].toLowerCase()} right now, so it is not a priority — work on your other openings for now.`
}

/** When the job opening's age counts from: the day it was added, or the day its priority last changed. */
export const jobAgeFrom = (j: Pick<JobOpening, 'createdAt' | 'priorityChangedAt'>) => j.priorityChangedAt ?? j.createdAt ?? null

const dayStart = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * The job opening's age in days: 1 on the day it was added (or its priority changed), 2 the next day,
 * and so on — by calendar day. Null when unknown (older records without a date).
 */
export function jobAgeDays(j: Pick<JobOpening, 'createdAt' | 'priorityChangedAt'>, now: number): number | null {
  const from = jobAgeFrom(j)
  if (!from) return null
  return Math.round((dayStart(now) - dayStart(from)) / 86_400_000) + 1
}

/** Older than 7 days: orange; older than 12 days: red. */
export function jobAgeTone(age: number | null): 'orange' | 'red' | null {
  return age == null ? null : age > 12 ? 'red' : age > 7 ? 'orange' : null
}

/** " — submissions due by 5 Oct, 6:00 PM" for a job opening with a deadline, else "". */
export const dueText = (j: Pick<JobOpening, 'submitBy'>) => (j.submitBy ? ` — submissions due by ${fmtDateTime(j.submitBy)}` : '')

/**
 * Who has missed a job opening's submission deadline (null: nobody — no deadline, not passed yet,
 * not open, or no PM yet). The PE is late until they have submitted a candidate for it; the PM until
 * a candidate for it has been sent on to the Client Team (also when the PE never got the job opening).
 * A late submission clears it. `apps` are the submissions the viewer can see.
 */
export interface JobLate {
  pm: boolean
  pe: boolean
}

type AppRef = Pick<Application, 'jobId' | 'assignedPM' | 'assignedPE' | 'assignedClientTeam'>

export function jobLate(j: JobOpening, apps: readonly AppRef[], now: number): JobLate | null {
  if (!j.submitBy || now < j.submitBy || j.status !== 'open' || !j.assignedPM) return null
  const mine = apps.filter((a) => a.jobId === j.id)
  // A candidate reaches the Client Team when the PM sends it on (assignedClientTeam is set then).
  const pm = !mine.some((a) => a.assignedPM === j.assignedPM && !!a.assignedClientTeam)
  const pe = !!j.assignedPE && !mine.some((a) => a.assignedPE === j.assignedPE)
  return pm || pe ? { pm, pe } : null
}

/**
 * The missed deadline as this person hears of it: the admins and the client's Client Team member see
 * every one; the PM and PE only their own part (null: nothing for them).
 */
export function jobLateFor(j: JobOpening, apps: readonly AppRef[], me: Pick<AppUser, 'id' | 'role'>, now: number): JobLate | null {
  const late = jobLate(j, apps, now)
  if (!late) return null
  if (isAdminRole(me.role) || j.assignedClientTeam === me.id) return late
  if (j.assignedPM === me.id && late.pm) return late
  if (j.assignedPE === me.id && late.pe) return late
  return null
}

/** Who has not submitted, in words — "you" for the viewer (`meId`). */
export function jobLateText(j: JobOpening, late: JobLate, names?: Names, meId?: string): string {
  const pm = `PM ${names?.(j.assignedPM ?? '') ?? ''}`.trim()
  const pe = `PE ${names?.(j.assignedPE ?? '') ?? ''}`.trim()
  const iAmPm = j.assignedPM === meId
  const iAmPe = !!j.assignedPE && j.assignedPE === meId
  if (!j.assignedPE)
    return iAmPm ? 'You have not assigned a PE yet, and no candidate has been submitted.' : `${pm} has not assigned a PE yet, and no candidate has been submitted.`
  if (late.pe)
    return iAmPe
      ? 'You have not submitted any candidate for it.'
      : iAmPm
        ? `${pe} has not submitted any candidate, and you have sent none to the Client Team.`
        : `${pm} and ${pe} have not submitted any candidate.`
  return iAmPm ? `${pe} has submitted, but you have not sent any candidate to the Client Team.` : `${pe} has submitted, but ${pm} has not sent any candidate to the Client Team.`
}

/** One alert per hand-down step, for the people it concerns (never for the person who did it). */
export interface JobEvent {
  key: string
  at: number
  title: string
  body: string
  actionRequired: boolean
}

export function jobEventsFor(me: Pick<AppUser, 'id' | 'role'>, j: JobOpening, names?: Names): JobEvent[] {
  const where = `${j.title} at ${j.clientName}`
  const warning = jobStatusWarning(j)
  /** the PM / PE it was handed to: also told when the job opening is on hold or closed */
  const toMe = (body: string) => (warning ? `${body}. ⚠ ${warning}` : body)
  const out: JobEvent[] = []
  // New job opening → the admins.
  if (isAdminRole(me.role) && j.createdAt && j.createdBy !== me.id)
    out.push({ key: `j:${j.id}:new`, at: j.createdAt, title: `📢 New job opening: ${where}`, body: `added by ${j.createdByName ?? 'the Client Team'} — assign a PM${dueText(j)}`, actionRequired: !j.assignedPM })
  // Assigned to a PM → that PM, and the Client Team member of the client.
  if (j.assignedPM && j.pmAssignedAt && j.pmAssignedBy !== me.id) {
    if (j.assignedPM === me.id)
      out.push({ key: `j:${j.id}:pm:${j.pmAssignedAt}`, at: j.pmAssignedAt, title: `📋 Job opening assigned to you: ${where}`, body: toMe(`by ${j.pmAssignedByName ?? 'Admin'} — assign a PE${dueText(j)}`), actionRequired: !j.assignedPE && !warning })
    else if (j.assignedClientTeam === me.id)
      out.push({ key: `j:${j.id}:pm:${j.pmAssignedAt}`, at: j.pmAssignedAt, title: `${where}: assigned to PM ${names?.(j.assignedPM) ?? ''}`.trim(), body: `by ${j.pmAssignedByName ?? 'Admin'}`, actionRequired: false })
  }
  // Assigned to a PE → that PE, and the Client Team member.
  if (j.assignedPE && j.peAssignedAt && j.peAssignedBy !== me.id) {
    if (j.assignedPE === me.id)
      out.push({ key: `j:${j.id}:pe:${j.peAssignedAt}`, at: j.peAssignedAt, title: `📋 Job opening assigned to you: ${where}`, body: toMe(`by ${j.peAssignedByName ?? 'your PM'} — find candidates for it${dueText(j)}`), actionRequired: !warning })
    else if (j.assignedClientTeam === me.id)
      out.push({ key: `j:${j.id}:pe:${j.peAssignedAt}`, at: j.peAssignedAt, title: `${where}: assigned to PE ${names?.(j.assignedPE) ?? ''}`.trim(), body: `by ${j.peAssignedByName ?? 'the PM'}`, actionRequired: false })
  }
  return out
}
