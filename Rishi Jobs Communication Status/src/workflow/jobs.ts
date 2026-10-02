import { isAdminRole, type AppUser, type JobOpening } from '../types'
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
    out.push({ key: `j:${j.id}:new`, at: j.createdAt, title: `📢 New job opening: ${where}`, body: `added by ${j.createdByName ?? 'the Client Team'} — assign a PM`, actionRequired: !j.assignedPM })
  // Assigned to a PM → that PM, and the Client Team member of the client.
  if (j.assignedPM && j.pmAssignedAt && j.pmAssignedBy !== me.id) {
    if (j.assignedPM === me.id)
      out.push({ key: `j:${j.id}:pm:${j.pmAssignedAt}`, at: j.pmAssignedAt, title: `📋 Job opening assigned to you: ${where}`, body: toMe(`by ${j.pmAssignedByName ?? 'Admin'} — assign a PE`), actionRequired: !j.assignedPE && !warning })
    else if (j.assignedClientTeam === me.id)
      out.push({ key: `j:${j.id}:pm:${j.pmAssignedAt}`, at: j.pmAssignedAt, title: `${where}: assigned to PM ${names?.(j.assignedPM) ?? ''}`.trim(), body: `by ${j.pmAssignedByName ?? 'Admin'}`, actionRequired: false })
  }
  // Assigned to a PE → that PE, and the Client Team member.
  if (j.assignedPE && j.peAssignedAt && j.peAssignedBy !== me.id) {
    if (j.assignedPE === me.id)
      out.push({ key: `j:${j.id}:pe:${j.peAssignedAt}`, at: j.peAssignedAt, title: `📋 Job opening assigned to you: ${where}`, body: toMe(`by ${j.peAssignedByName ?? 'your PM'} — find candidates for it`), actionRequired: !warning })
    else if (j.assignedClientTeam === me.id)
      out.push({ key: `j:${j.id}:pe:${j.peAssignedAt}`, at: j.peAssignedAt, title: `${where}: assigned to PE ${names?.(j.assignedPE) ?? ''}`.trim(), body: `by ${j.peAssignedByName ?? 'the PM'}`, actionRequired: false })
  }
  return out
}
