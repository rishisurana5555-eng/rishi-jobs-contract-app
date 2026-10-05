import { DELEGATION_LABEL, JOB_PRIORITY_LABEL, type Client, type Delegation, type JobOpening, type JobPriority } from '../types'
import { fmtDateTime } from './dates'
import { JOB_STATUS_LABEL } from './jobs'
import type { Names } from './workflow'

const short = (text: string, max = 60) => {
  const t = text.trim().replace(/\s+/g, ' ')
  return !t ? '(empty)' : t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export const priorityLabel = (p: JobPriority | undefined) => JOB_PRIORITY_LABEL[p ?? 'active']
export const dueLabel = (submitBy: number | null | undefined) => (submitBy ? fmtDateTime(submitBy) : 'no deadline')
export const delegationLabel = (d: Delegation | null | undefined) => (d ? DELEGATION_LABEL[d] : null)

/** What an edit of a client changes, one item per field (empty: nothing changed). */
export function clientChanges(prev: Client, next: Client, names?: Names): string[] {
  const out: string[] = []
  if (prev.name.trim() !== next.name.trim()) out.push(`Name: ${short(prev.name)} → ${short(next.name)}`)
  if ((prev.contactPerson ?? '').trim() !== (next.contactPerson ?? '').trim()) out.push(`Contact person: ${short(prev.contactPerson ?? '')} → ${short(next.contactPerson ?? '')}`)
  if (prev.assignedClientTeam !== next.assignedClientTeam)
    out.push(`Client Team: ${names?.(prev.assignedClientTeam) ?? prev.assignedClientTeam} → ${names?.(next.assignedClientTeam) ?? next.assignedClientTeam}`)
  return out
}

/** What an edit of a job opening changes, one item per field (empty: nothing changed). */
export function jobChanges(prev: JobOpening, next: Pick<JobOpening, 'title' | 'details' | 'status' | 'priority' | 'submitBy'>): string[] {
  const out: string[] = []
  if (prev.title.trim() !== next.title.trim()) out.push(`Title: ${short(prev.title)} → ${short(next.title)}`)
  if ((prev.details ?? '').trim() !== (next.details ?? '').trim()) out.push('Job details changed')
  if (prev.status !== next.status) out.push(`Status: ${JOB_STATUS_LABEL[prev.status]} → ${JOB_STATUS_LABEL[next.status]}`)
  if (priorityLabel(prev.priority) !== priorityLabel(next.priority)) out.push(`Job status: ${priorityLabel(prev.priority)} → ${priorityLabel(next.priority)}`)
  if ((prev.submitBy ?? null) !== (next.submitBy ?? null)) out.push(`Submissions due by: ${dueLabel(prev.submitBy)} → ${dueLabel(next.submitBy)}`)
  return out
}
