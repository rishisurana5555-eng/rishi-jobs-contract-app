import { describe, expect, it } from 'vitest'
import type { AppUser, Application, CandidateProfile, Client, JobOpening, Stage, TimelineEntry } from '../types'
import { addedItems, clientReport, defaultUnit, periodRange, pipeline, teamReport, toCsv, trend, type ReportData } from './metrics'

const NOW = new Date(2026, 8, 30, 12, 0).getTime() // Wed 30 Sep 2026
const at = (month: number, day = 10, hour = 10) => new Date(2026, month, day, hour).getTime()

let n = 0
function app(stage: Stage, createdAt: number, more: Partial<Application> = {}): Application {
  return {
    id: `a${++n}`,
    stage,
    createdAt,
    stageSince: createdAt,
    currentInterviewRound: 1,
    currentInterviewId: null,
    assignedPE: 'pe1',
    assignedPM: 'pm1',
    assignedClientTeam: 'ct1',
    clientId: 'c1',
    clientName: 'Acme',
    nextActionBy: [],
    ...more,
  } as Application
}
const cand = (createdAt: number, pe = 'pe1') => ({ id: `C${++n}`, createdAt, pe }) as CandidateProfile
const entry = (actor: string, timestamp: number, statusCode: string | null, type: TimelineEntry['type'] = 'status_change') =>
  ({ actor, timestamp, statusCode, type, actorRole: actor.startsWith('ct') ? 'ClientTeam' : 'PM' }) as TimelineEntry
const user = (id: string, role: AppUser['role'], name: string, active = true) => ({ id, role, name, active }) as AppUser

const data = (d: Partial<ReportData>): ReportData => ({ apps: [], candidates: [], clients: [], jobs: [], users: [], timeline: [], ...d })

describe('periods', () => {
  it('covers whole days, weeks (from Monday) and months', () => {
    expect(periodRange('today', NOW)).toEqual({ from: at(8, 30, 0), to: at(9, 1, 0) })
    expect(periodRange('yesterday', NOW)).toEqual({ from: at(8, 29, 0), to: at(8, 30, 0) })
    expect(periodRange('this_week', NOW)).toEqual({ from: at(8, 28, 0), to: at(9, 5, 0) })
    expect(periodRange('last_week', NOW)).toEqual({ from: at(8, 21, 0), to: at(8, 28, 0) })
    expect(periodRange('this_month', NOW)).toEqual({ from: at(8, 1, 0), to: at(9, 1, 0) })
    expect(periodRange('last_month', NOW)).toEqual({ from: at(7, 1, 0), to: at(8, 1, 0) })
    expect(periodRange('last_3_months', NOW)).toEqual({ from: at(6, 1, 0), to: at(9, 1, 0) })
    expect(periodRange('this_year', NOW)).toEqual({ from: at(0, 1, 0), to: new Date(2027, 0, 1).getTime() })
    expect(periodRange('all', NOW)).toEqual({ from: 0, to: Infinity })
  })

  it('custom dates include the last day; a missing end is open', () => {
    expect(periodRange('custom', NOW, { from: '2026-09-01', to: '2026-09-15' })).toEqual({ from: at(8, 1, 0), to: at(8, 16, 0) })
    expect(periodRange('custom', NOW, { from: '2026-09-01', to: '' })).toEqual({ from: at(8, 1, 0), to: Infinity })
  })

  it('picks day, week or month for the chart', () => {
    expect(defaultUnit(periodRange('this_week', NOW), NOW)).toBe('day')
    expect(defaultUnit(periodRange('this_month', NOW), NOW)).toBe('day')
    expect(defaultUnit(periodRange('last_3_months', NOW), NOW)).toBe('week')
    expect(defaultUnit(periodRange('this_year', NOW), NOW)).toBe('month')
    expect(defaultUnit(periodRange('all', NOW), NOW)).toBe('month')
  })
})

describe('pipeline', () => {
  const apps = [
    app('pe_submitted', at(8)),
    app('new_submission', at(8)),
    app('cv_with_client', at(8)),
    app('rescheduling', at(8), { currentInterviewRound: 2 }), // had a round-1 interview
    app('interview_scheduled', at(8), { currentInterviewId: 'i1' }),
    app('closed_placed', at(7), { stageSince: at(8, 5) }), // added last month, placed this month
    app('closed_rejected', at(8), { stageSince: at(8, 20) }),
    app('cv_with_client', at(6)), // older, still open
  ]
  const p = periodRange('this_month', NOW)

  it('shows how far the period’s submissions got', () => {
    expect(pipeline(apps, p).map((s) => [s.label, s.count, s.pct])).toEqual([
      ['Added', 6, 100],
      ['Sent to Client Team', 5, 83],
      ['CV with client', 4, 67],
      ['Interview', 2, 33],
      ['Placed', 0, 0],
    ])
    expect(pipeline([], p).every((s) => s.count === 0 && s.pct === 0)).toBe(true)
  })
})

describe('trend', () => {
  const d = data({
    candidates: [cand(at(8, 28)), cand(at(8, 30)), cand(at(8, 30)), cand(at(3))],
    apps: [app('closed_placed', at(3), { stageSince: at(8, 29) })],
  })

  it('by day: up to today only', () => {
    const t = trend(d, periodRange('this_week', NOW), 'day', NOW)
    expect(t.map((x) => [x.label, x.newCandidates, x.placed])).toEqual([
      ['28 Sept', 1, 0],
      ['29 Sept', 0, 1],
      ['30 Sept', 2, 0],
    ])
  })

  it('by week and by month', () => {
    const weeks = trend(d, periodRange('this_month', NOW), 'week', NOW)
    expect(weeks).toHaveLength(5) // weeks starting 31 Aug, 7, 14, 21, 28 Sep
    expect(weeks.at(-1)).toMatchObject({ newCandidates: 3, placed: 1 })
    expect(weeks[0].newCandidates).toBe(0) // the April candidate is outside the month
    const months = trend(d, periodRange('all', NOW), 'month', NOW)
    expect(months).toHaveLength(6) // Apr … Sep
    expect(months[0]).toMatchObject({ newCandidates: 1 })
  })
})

describe('team, added items and clients', () => {
  const users = [
    user('pe1', 'PE', 'Bhavya'),
    user('pe2', 'PE', 'Old Pe', false),
    user('pm1', 'PM', 'Shubham'),
    user('ct1', 'ClientTeam', 'Dipanshi'),
  ]
  const apps = [
    app('pe_submitted', at(8), { nextActionBy: ['pm1'] }),
    app('interview_scheduled', at(8), { currentInterviewId: 'i1', clientId: 'c2', clientName: 'Beta' }),
    app('closed_placed', at(8), { stageSince: at(8, 25), currentInterviewId: 'i2' }),
  ]
  const timeline = [
    entry('pm1', at(8), 'submitted_to_ct'),
    entry('pm1', at(8), 'submitted_to_ct'),
    entry('pm1', at(8), 'new_candidate_dates', 'availability_update'),
    entry('pm1', at(8), null, 'debrief'),
    entry('pm1', at(8), null, 'note'),
    entry('pm1', at(7), null, 'note'), // last month
    entry('ct1', at(8), 'cv_submitted_to_client'),
    entry('ct1', at(8), 'interview_scheduled', 'interview'),
    entry('ct1', at(8), 'dates_mismatch'),
    entry('ct1', at(8), 'candidate_placed', 'debrief'),
  ]
  const p = periodRange('this_month', NOW)

  it('counts each person’s work; hides inactive people with no numbers', () => {
    const { pes, pms, cts } = teamReport(data({ apps, users, timeline, candidates: [cand(at(8)), cand(at(8)), cand(at(8), 'pe9')] }), p)
    expect(pes).toEqual([{ id: 'pe1', name: 'Bhavya', newCandidates: 2, submissions: 3, placed: 1 }])
    expect(pms).toEqual([{ id: 'pm1', name: 'Shubham', sentToClientTeam: 2, candidateDates: 1, debriefs: 1, notes: 1, pending: 1, placed: 1 }])
    expect(cts).toEqual([{ id: 'ct1', name: 'Dipanshi', cvsToClient: 1, interviewsScheduled: 1, reschedules: 1, placed: 1, rejected: 0, notes: 0 }])
  })

  it('leaves PM and Client Team work empty while the history loads', () => {
    expect(teamReport(data({ apps, users, timeline: null }), p)).toMatchObject({ pms: null, cts: null })
  })

  it('lists clients and job openings added, newest first, with who added them', () => {
    const d = data({
      users,
      clients: [{ id: 'c1', name: 'Acme', createdAt: at(8, 2), createdBy: 'ct1' }, { id: 'c0', name: 'Old' }] as Client[],
      jobs: [{ id: 'j1', title: 'Dev', clientId: 'c1', createdAt: at(8, 3), createdBy: 'gone', createdByName: 'Former' }] as JobOpening[],
    })
    expect(addedItems(d, p).map((x) => [x.kind, x.name, x.client, x.addedBy])).toEqual([
      ['Job opening', 'Dev', 'Acme', 'Former'],
      ['Client', 'Acme', '', 'Dipanshi'],
    ])
  })

  it('lists clients with numbers, most submissions first', () => {
    const clients = [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Beta' }, { id: 'c3', name: 'Quiet' }] as Client[]
    expect(clientReport(apps, clients, p)).toEqual([
      { id: 'c1', name: 'Acme', submissions: 2, interviews: 1, placed: 1, rejected: 0 },
      { id: 'c2', name: 'Beta', submissions: 1, interviews: 1, placed: 0, rejected: 0 },
    ])
  })
})

it('writes CSV that Excel can open', () => {
  expect(toCsv(['Name', 'Placed'], [['Ravi, Kumar', 2], ['Say "hi"', 0]])).toBe('﻿Name,Placed\r\n"Ravi, Kumar",2\r\n"Say ""hi""",0')
})
