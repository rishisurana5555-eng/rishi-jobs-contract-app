/**
 * Reports for the Admin / Super Admin "Reports" tab.
 *
 * Counting rules:
 * - New candidates, clients and job openings count those added in the period.
 * - Work done (sent to Client Team, CVs to client, interviews scheduled, notes…) counts the actions
 *   in the period, from every submission's history (timeline).
 * - Placed and rejected count submissions closed in the period.
 * - The pipeline follows the submissions added in the period and how far they have got so far.
 * Deleted candidates and clients (with their history) drop out.
 */
import type { AppUser, Application, CandidateProfile, Client, JobOpening, TimelineEntry } from '../types'
import { beforeClientTeam, isClosed } from '../workflow/workflow'

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'this_year'
  | 'all'
  | 'custom'

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  last_3_months: 'Last 3 months',
  this_year: 'This year',
  all: 'All time',
  custom: 'Custom dates',
}

/** [from, to): from inclusive, to exclusive (local time). */
export interface Period {
  from: number
  to: number
}

export type Unit = 'day' | 'week' | 'month'
export const UNIT_LABELS: Record<Unit, string> = { day: 'Day', week: 'Week', month: 'Month' }

// Calendar helpers (local time; weeks start on Monday).
const day0 = (t: number, add = 0) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add).getTime()
}
const week0 = (t: number, add = 0) => day0(t, -((new Date(t).getDay() + 6) % 7) + add * 7)
const month0 = (t: number, add = 0) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth() + add, 1).getTime()
}
const start: Record<Unit, (t: number, add?: number) => number> = { day: day0, week: week0, month: month0 }

/** "2026-09-30" → local midnight; '' or invalid → null. */
const parseDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null
}

export function periodRange(key: PeriodKey, now: number, custom?: { from: string; to: string }): Period {
  switch (key) {
    case 'today':
      return { from: day0(now), to: day0(now, 1) }
    case 'yesterday':
      return { from: day0(now, -1), to: day0(now) }
    case 'this_week':
      return { from: week0(now), to: week0(now, 1) }
    case 'last_week':
      return { from: week0(now, -1), to: week0(now) }
    case 'this_month':
      return { from: month0(now), to: month0(now, 1) }
    case 'last_month':
      return { from: month0(now, -1), to: month0(now) }
    case 'last_3_months':
      return { from: month0(now, -2), to: month0(now, 1) }
    case 'this_year':
      return { from: new Date(new Date(now).getFullYear(), 0, 1).getTime(), to: new Date(new Date(now).getFullYear() + 1, 0, 1).getTime() }
    case 'all':
      return { from: 0, to: Infinity }
    case 'custom': {
      const from = parseDate(custom?.from ?? '')
      const to = parseDate(custom?.to ?? '')
      return { from: from ?? 0, to: to != null ? day0(to, 1) : Infinity }
    }
  }
}

/** A sensible grouping for the chart: days up to a month, weeks up to ~4 months, else months. */
export function defaultUnit(p: Period, now: number): Unit {
  const days = (Math.min(p.to, day0(now, 1)) - p.from) / 86_400_000
  return p.from === 0 || days > 124 ? 'month' : days > 31 ? 'week' : 'day'
}

const within = (t: number | undefined, p: Period) => t != null && t >= p.from && t < p.to

// How far a submission has got (these steps never go backwards).
export const sentToClientTeam = (a: Application) => !beforeClientTeam(a.stage) && !!a.assignedClientTeam
export const reachedClient = (a: Application) => sentToClientTeam(a) && a.stage !== 'new_submission'
/** An interview was scheduled at some point (a later round, a current interview, or placed). */
export const reachedInterview = (a: Application) =>
  a.currentInterviewRound > 1 ||
  a.currentInterviewId != null ||
  a.stage === 'interview_scheduled' ||
  a.stage === 'debrief_pending' ||
  a.stage === 'closed_placed'

const placedIn = (apps: Application[], p: Period) => apps.filter((a) => a.stage === 'closed_placed' && within(a.stageSince, p))
const rejectedIn = (apps: Application[], p: Period) => apps.filter((a) => a.stage === 'closed_rejected' && within(a.stageSince, p))

/** Everything the reports are worked out from. `timeline` is null while it loads (or if it can't). */
export interface ReportData {
  apps: Application[]
  candidates: CandidateProfile[]
  clients: Client[]
  jobs: JobOpening[]
  users: AppUser[]
  timeline: TimelineEntry[] | null
}

/** History entries in the period, by status code (a status change) or type. */
const actions = (timeline: TimelineEntry[], p: Period) => timeline.filter((e) => within(e.timestamp, p) && e.actorRole !== 'System')
const isCode = (code: string) => (e: TimelineEntry) => e.statusCode === code

export interface PipelineStep {
  label: string
  count: number
  /** % of the submissions added in the period (0–100) */
  pct: number
}

/** Of the submissions added in the period: how many reached each step. */
export function pipeline(apps: Application[], p: Period): PipelineStep[] {
  const added = apps.filter((a) => within(a.createdAt, p))
  const steps: [string, (a: Application) => boolean][] = [
    ['Added', () => true],
    ['Sent to Client Team', sentToClientTeam],
    ['CV with client', reachedClient],
    ['Interview', reachedInterview],
    ['Placed', (a) => a.stage === 'closed_placed'],
  ]
  return steps.map(([label, test]) => {
    const count = added.filter(test).length
    return { label, count, pct: added.length ? Math.round((count / added.length) * 100) : 0 }
  })
}

export interface TrendPoint {
  /** e.g. "30 Sep", "wk 22 Sep", "Sep '26" */
  label: string
  newCandidates: number
  placed: number
}

const MAX_POINTS: Record<Unit, number> = { day: 92, week: 60, month: 36 }

const pointLabel = (t: number, unit: Unit) => {
  const d = new Date(t)
  if (unit === 'month') return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }).replace(' ', " '")
  const s = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return unit === 'week' ? `wk ${s}` : s
}

/**
 * New candidates and placements per day / week / month across the period (up to today; "All time"
 * starts from the first record). Very long ranges keep the most recent points.
 */
export function trend(d: ReportData, p: Period, unit: Unit, now: number): TrendPoint[] {
  const candTimes = d.candidates.map((c) => c.createdAt).filter((t) => within(t, p))
  const placedTimes = placedIn(d.apps, p).map((a) => a.stageSince)
  const first = p.from > 0 ? p.from : Math.min(now, ...candTimes, ...placedTimes)
  const end = Math.min(p.to, day0(now, 1))
  const points: TrendPoint[] = []
  for (let t = start[unit](first); t < end; t = start[unit](t, 1)) {
    const next = start[unit](t, 1)
    const inBucket = (x: number) => x >= t && x < next
    points.push({ label: pointLabel(t, unit), newCandidates: candTimes.filter(inBucket).length, placed: placedTimes.filter(inBucket).length })
  }
  return points.slice(-MAX_POINTS[unit])
}

export interface PeRow {
  id: string
  name: string
  newCandidates: number
  /** submissions to clients' jobs (one candidate can go to several) */
  submissions: number
  placed: number
}
export interface PmRow {
  id: string
  name: string
  sentToClientTeam: number
  candidateDates: number
  debriefs: number
  notes: number
  /** right now */
  pending: number
  placed: number
}
export interface CtRow {
  id: string
  name: string
  cvsToClient: number
  interviewsScheduled: number
  reschedules: number
  placed: number
  rejected: number
  notes: number
}

/** Active people, plus anyone deactivated who still has numbers in the period. Sorted by name. */
function people<R extends { name: string }>(users: AppUser[], role: AppUser['role'], row: (u: AppUser) => R, hasNumbers: (r: R) => boolean) {
  return users
    .filter((u) => u.role === role)
    .map((u) => ({ u, r: row(u) }))
    .filter(({ u, r }) => u.active || hasNumbers(r))
    .map(({ r }) => r)
    .sort((a, b) => a.name.localeCompare(b.name))
}

const sum = (r: object) => Object.values(r).reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0)

/** Work per PE, PM and Client Team member. PM and Client Team rows are null while the history loads. */
export function teamReport(d: ReportData, p: Period) {
  const placedP = placedIn(d.apps, p)
  const pes = people<PeRow>(
    d.users,
    'PE',
    (u) => ({
      id: u.id,
      name: u.name,
      newCandidates: d.candidates.filter((c) => c.pe === u.id && within(c.createdAt, p)).length,
      submissions: d.apps.filter((a) => a.assignedPE === u.id && within(a.createdAt, p)).length,
      placed: placedP.filter((a) => a.assignedPE === u.id).length,
    }),
    (r) => sum(r) > 0,
  )
  if (!d.timeline) return { pes, pms: null, cts: null }
  const acts = actions(d.timeline, p)
  const by = (id: string) => acts.filter((e) => e.actor === id)
  const pms = people<PmRow>(
    d.users,
    'PM',
    (u) => {
      const mine = by(u.id)
      return {
        id: u.id,
        name: u.name,
        sentToClientTeam: mine.filter(isCode('submitted_to_ct')).length,
        candidateDates: mine.filter(isCode('new_candidate_dates')).length,
        debriefs: mine.filter((e) => e.type === 'debrief').length,
        notes: mine.filter((e) => e.type === 'note').length,
        pending: d.apps.filter((a) => !isClosed(a.stage) && a.nextActionBy.includes(u.id)).length,
        placed: placedP.filter((a) => a.assignedPM === u.id).length,
      }
    },
    (r) => sum(r) > 0,
  )
  const cts = people<CtRow>(
    d.users,
    'ClientTeam',
    (u) => {
      const mine = by(u.id)
      return {
        id: u.id,
        name: u.name,
        cvsToClient: mine.filter(isCode('cv_submitted_to_client')).length,
        interviewsScheduled: mine.filter(isCode('interview_scheduled')).length,
        reschedules: mine.filter((e) => e.statusCode === 'reschedule' || e.statusCode === 'dates_mismatch').length,
        placed: mine.filter(isCode('candidate_placed')).length,
        rejected: mine.filter(isCode('candidate_rejected')).length,
        notes: mine.filter((e) => e.type === 'note').length,
      }
    },
    (r) => sum(r) > 0,
  )
  return { pes, pms, cts }
}

export interface AddedItem {
  kind: 'Client' | 'Job opening'
  name: string
  /** for a job opening: its client */
  client: string
  addedBy: string
  at: number
}

/** Clients and job openings added in the period, newest first (older records without a date are left out). */
export function addedItems(d: ReportData, p: Period): AddedItem[] {
  const clientName = new Map(d.clients.map((c) => [c.id, c.name]))
  const nameOf = (id?: string, fallback?: string) => d.users.find((u) => u.id === id)?.name ?? fallback ?? '—'
  return [
    ...d.clients
      .filter((c) => within(c.createdAt, p))
      .map((c) => ({ kind: 'Client' as const, name: c.name, client: '', addedBy: nameOf(c.createdBy, c.createdByName), at: c.createdAt! })),
    ...d.jobs
      .filter((j) => within(j.createdAt, p))
      .map((j) => ({ kind: 'Job opening' as const, name: j.title, client: clientName.get(j.clientId) ?? '—', addedBy: nameOf(j.createdBy, j.createdByName), at: j.createdAt! })),
  ].sort((a, b) => b.at - a.at)
}

export interface ClientRow {
  id: string
  name: string
  submissions: number
  interviews: number
  placed: number
  rejected: number
}

/** One row per client with any numbers in the period, most submissions first. */
export function clientReport(apps: Application[], clients: Client[], p: Period): ClientRow[] {
  const added = apps.filter((a) => within(a.createdAt, p))
  const placedP = placedIn(apps, p)
  const rejectedP = rejectedIn(apps, p)
  const names = new Map(clients.map((c) => [c.id, c.name]))
  for (const a of apps) if (!names.has(a.clientId) && a.clientId) names.set(a.clientId, a.clientName)
  return [...names]
    .map(([id, name]) => {
      const mine = added.filter((a) => a.clientId === id)
      return {
        id,
        name,
        submissions: mine.length,
        interviews: mine.filter(reachedInterview).length,
        placed: placedP.filter((a) => a.clientId === id).length,
        rejected: rejectedP.filter((a) => a.clientId === id).length,
      }
    })
    .filter((r) => r.submissions + r.interviews + r.placed + r.rejected > 0)
    .sort((a, b) => b.submissions - a.submissions || b.placed - a.placed || a.name.localeCompare(b.name))
}

/** A CSV file (with a BOM so Excel reads it as UTF-8). */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}
