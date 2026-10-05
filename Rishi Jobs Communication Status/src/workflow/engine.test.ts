import { describe, expect, it } from 'vitest'
import type { Application, AvailabilityRound, Interview } from '../types'
import { findMatches } from './dates'
import { needsAutoDebrief, planAction, roundDocId, WorkflowError, type Action, type Actor, type WritePlan } from './engine'
import { awaitingSend, ctLabel, ctStaleSince, firstReminderAt, isMyTurn, optionsFor, outcomeLabel, peUnansweredOverdueAt, pmLabel, REMINDER_EVERY_MS, stepsDone, toneFor, viewerLabel } from './workflow'

const PM: Actor = { id: 'pm1', name: 'Shubham', role: 'PM' }
const CT: Actor = { id: 'ct1', name: 'Dipanshi', role: 'ClientTeam' }
const SYS: Actor = { id: 'system', name: 'System', role: 'System' }
const PE: Actor = { id: 'pe1', name: 'Bhavya', role: 'PE' }
const DAY = 86_400_000

/** Tiny in-memory store that applies write plans the way the backends do. */
class Harness {
  app!: Application
  rounds: Record<string, AvailabilityRound> = {}
  interviews: Record<string, Interview> = {}
  timeline: WritePlan['timeline'] = []
  now = new Date(2026, 9, 1, 10, 0).getTime()

  run(actor: Actor, action: Action) {
    this.now += 60_000
    const plan = planAction(
      {
        app: this.app ?? null,
        round: this.app ? this.rounds[roundDocId(this.app.currentInterviewRound, this.app.currentAttempt)] ?? null : null,
        interview: this.app?.currentInterviewId ? this.interviews[this.app.currentInterviewId] : null,
        targetInterview: action.kind === 'save_debrief' ? (this.interviews[action.interviewId] ?? null) : undefined,
        actor,
        now: this.now,
        newId: 'app1',
      },
      action,
    )
    this.app = plan.app
    for (const r of plan.rounds) this.rounds[r.id] = { ...this.rounds[r.id], ...r.data } as AvailabilityRound
    for (const i of plan.interviews) this.interviews[i.id] = { ...this.interviews[i.id], ...i.data } as Interview
    this.timeline.push(...plan.timeline)
    return plan
  }

  /** The PE adds a candidate and the PM sends it to the Client Team (the only way in). */
  submit() {
    const candidateDates = [{ date: '2026-10-05' }, { date: '2026-10-06', from: '14:00', to: '17:00' }]
    const place = { jobId: 'j1', jobTitle: 'Accountant', clientId: 'c1', clientName: 'Acme' }
    this.run(PE, {
      kind: 'pe_submit',
      message: 'Available 5 Oct, 6 Oct 2-5pm',
      data: {
        candidateName: 'Asha',
        candidateContactNumber: '+91 98765 43210',
        originalCvUrl: 'https://drive/original.pdf',
        originalCvName: 'Asha.pdf',
        assignedPM: 'pm1',
        candidateDates,
        recruiterNote: 'Good fit',
        ...place,
      },
    })
    return this.run(PM, {
      kind: 'send_to_ct',
      message: 'Prefers afternoons',
      reason: 'Matches the job',
      data: {
        candidateId: this.app.candidateId,
        candidateName: 'Asha',
        candidateContactNumber: '+91 98765 43210',
        revisedCvUrl: 'https://drive/cv.pdf',
        revisedCvName: 'cv.pdf',
        originalCvUrl: this.app.originalCvUrl,
        assignedPE: 'pe1',
        assignedClientTeam: 'ct1',
        candidateDates,
        recruiterNote: 'Good fit',
        ...place,
      },
    })
  }
}

describe('Client Team status unchanged for 6 days', () => {
  it('flags the Super Admin only once the CV is with the client, counting from the last Client Team status change', () => {
    const h = new Harness()
    h.submit()
    expect(ctStaleSince(h.app, h.now + 10 * DAY)).toBeNull() // not with the client yet
    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    const since = h.app.ctStatusSince!
    expect(since).toBe(h.now)
    expect(ctStaleSince(h.app, since + 5 * DAY)).toBeNull()
    expect(ctStaleSince(h.app, since + 6 * DAY)).toBe(since)
    // A note does not move the Client Team status.
    h.run(PM, { kind: 'note', message: 'Any update?' })
    expect(h.app.ctStatusSince).toBe(since)
  })
})

describe('Client Team raises a doubt with the PM', () => {
  const names = (id: string) => ({ pm1: 'Shubham', ct1: 'Dipanshi', pe1: 'Bhavya' })[id]

  it('makes it the PM’s turn until they answer, without moving the status, alerting only the two of them', () => {
    const h = new Harness()
    h.submit()
    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    h.app.unreadFor = []
    const stage = h.app.stage
    expect(() => h.run(PM, { kind: 'ct_doubt', message: 'x' })).toThrow(/Only the Client Team/)
    expect(() => h.run(CT, { kind: 'ct_doubt', message: ' ' })).toThrow(/question/)
    expect(() => h.run(PM, { kind: 'ct_doubt_answer', message: 'x' })).toThrow(/no open doubt/)

    h.now += 60_000
    h.run(CT, { kind: 'ct_doubt', message: 'Can the candidate relocate to Pune?' })
    expect(h.app.stage).toBe(stage)
    expect(h.app.ctDoubt).toMatchObject({ text: 'Can the candidate relocate to Pune?', by: 'ct1', byName: 'Dipanshi', at: h.now })
    expect(h.app.nextActionBy.sort()).toEqual(['ct1', 'pm1'])
    expect(h.app.unreadFor).toEqual(['pm1'])
    expect(isMyTurn(h.app, 'pm1', h.now)).toBe(true)
    expect(toneFor(h.app, 'pm1', h.now)).toBe('red')
    expect(viewerLabel(h.app, 'pm1', 'PM', h.now, names)).toBe('Pending – Dipanshi raised a doubt: please answer')
    expect(viewerLabel(h.app, 'ct1', 'ClientTeam', h.now, names)).toMatch(/waiting for Shubham to answer your doubt$/)
    // Reminded 10 minutes after the doubt, not after the (older) status change.
    expect(firstReminderAt(h.app, 'pm1')).toBe(h.now + REMINDER_EVERY_MS)
    expect(h.timeline.at(-1)).toMatchObject({ actor: 'ct1', statusLabel: 'Client Team Dipanshi raised a doubt', message: 'Can the candidate relocate to Pune?' })
    expect(() => h.run(CT, { kind: 'ct_doubt', message: 'another' })).toThrow(/still waiting/)

    // The Client Team carries on meanwhile; the doubt stays open for the PM.
    h.run(CT, { kind: 'status', code: 'dates_mismatch', message: 'Client free 9 Oct', clientDates: [{ date: '2026-10-09' }] })
    expect(h.app.nextActionBy).toContain('pm1')

    h.app.unreadFor = []
    h.run(PM, { kind: 'ct_doubt_answer', message: 'Yes, he can relocate.' })
    expect(h.app.ctDoubt).toBeNull()
    expect(h.app.lastCtDoubt).toMatchObject({ text: 'Can the candidate relocate to Pune?', answer: 'Yes, he can relocate.', answeredByName: 'Shubham' })
    expect(h.app.unreadFor).toEqual(['ct1'])
    expect(h.timeline.at(-1)!.statusLabel).toBe('PM Shubham answered the Client Team’s doubt')
    expect(h.app.stage).toBe('rescheduling')
  })

  it('is dropped when the candidate is closed, and can’t be raised after that', () => {
    const h = new Harness()
    h.submit()
    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    h.run(CT, { kind: 'ct_doubt', message: 'Notice period negotiable?' })
    h.run(CT, { kind: 'status', code: 'candidate_rejected', message: 'Client rejected' })
    expect(h.app.ctDoubt).toBeNull()
    expect(h.app.nextActionBy).toEqual([])
    expect(() => h.run(CT, { kind: 'ct_doubt', message: 'x' })).toThrow(/with the Client Team/)
  })
})

describe('workflow engine', () => {
  it('runs submit → mismatch → new dates → schedule → debrief → next round → placed', () => {
    const h = new Harness()
    h.submit()
    expect(h.app.stage).toBe('new_submission')
    expect(pmLabel(h.app)).toBe('Submitted CV to Client Team')
    expect(ctLabel(h.app)).toBe('Pending – New submission from PM')
    expect(h.app.nextActionBy).toEqual(['ct1'])
    expect(h.app.unreadFor.sort()).toEqual(['ct1', 'pe1'])
    expect(h.rounds['r1-a1'].candidateDates).toHaveLength(2)
    expect(toneFor(h.app, 'ct1')).toBe('red')
    expect(toneFor(h.app, 'pm1')).toBe('yellow')

    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    expect(h.app.stage).toBe('cv_with_client')
    expect(h.app.nextActionBy).toEqual(['ct1'])

    // no overlap → both sides pending
    h.run(CT, { kind: 'status', code: 'dates_mismatch', message: 'Client free 9 Oct', clientDates: [{ date: '2026-10-09' }] })
    expect(h.app.stage).toBe('rescheduling')
    expect(h.app.currentAttempt).toBe(2)
    expect(h.rounds['r1-a1'].matchResult).toBe('no-match')
    expect(h.rounds['r1-a2'].matchResult).toBe('pending')
    expect(pmLabel(h.app)).toBe('Pending – get new available date from candidate')
    expect(ctLabel(h.app)).toBe('Pending – get new available date from client')
    expect(h.app.nextActionBy).toEqual(['pm1', 'ct1'])
    expect(h.app.notificationType).toBe('action_required')

    h.run(PM, { kind: 'status', code: 'new_candidate_dates', message: 'Candidate free 2026-10-12', candidateDates: [{ date: '2026-10-12' }] })
    expect(h.app.pmStatus).toBe('candidate_dates_submitted')
    expect(h.app.nextActionBy).toEqual(['ct1'])
    expect(h.rounds['r1-a2'].candidateDates).toEqual([{ date: '2026-10-12' }])

    const at = new Date(2026, 9, 12, 15, 0).getTime()
    h.run(CT, {
      kind: 'status',
      code: 'interview_scheduled',
      clientDates: [{ date: '2026-10-12' }],
      interview: { scheduledAt: at, mode: 'video', meetingDetails: 'Meet link' },
    })
    expect(h.app.stage).toBe('interview_scheduled')
    expect(h.app.nextActionBy).toEqual([])
    expect(pmLabel(h.app)).toMatch(/^Interview scheduled at 12 Oct, 3:00 PM – in progress$/)
    expect(toneFor(h.app, 'pm1')).toBe('blue')
    expect(h.interviews['r1-a2'].status).toBe('scheduled')

    // not yet passed
    expect(needsAutoDebrief(h.app, at + 60_000)).toBe(false)
    h.now = at + DAY
    expect(needsAutoDebrief(h.app, h.now)).toBe(true)
    h.run(SYS, { kind: 'auto_debrief' })
    expect(h.app.stage).toBe('debrief_pending')
    expect(h.app.nextActionBy).toEqual(['pm1', 'ct1'])
    expect(h.app.unreadFor).toEqual(expect.arrayContaining(['pm1', 'ct1']))
    expect(h.interviews['r1-a2'].status).toBe('completed')

    h.run(PM, { kind: 'status', code: 'candidate_debrief', debrief: 'Went well' })
    expect(h.app.pmStatus).toBe('candidate_debrief_received')
    expect(h.app.nextActionBy).toEqual(['ct1'])
    expect(optionsFor(h.app, 'pm1')).toHaveLength(0)

    h.run(CT, { kind: 'status', code: 'next_round', debrief: 'Client wants a technical round' })
    expect(h.app.currentInterviewRound).toBe(2)
    expect(h.app.currentAttempt).toBe(1)
    expect(h.app.stage).toBe('rescheduling')
    expect(h.app.pmDebriefDone).toBe(false)
    expect(pmLabel(h.app)).toBe('Round 2 – Pending – get new available date from candidate')
    expect(h.interviews['r1-a2'].clientDebrief).toBe('Client wants a technical round')
    expect(h.rounds['r2-a1']).toBeDefined()

    h.run(PM, { kind: 'status', code: 'new_candidate_dates', message: 'Candidate free 2026-10-20', candidateDates: [{ date: '2026-10-20' }] })
    h.run(CT, {
      kind: 'status',
      code: 'interview_scheduled',
      clientDates: [{ date: '2026-10-20' }],
      interview: { scheduledAt: new Date(2026, 9, 20, 11, 0).getTime(), mode: 'in-person', meetingDetails: '' },
    })
    h.now = new Date(2026, 9, 21, 9, 0).getTime()
    h.run(SYS, { kind: 'auto_debrief' })
    h.run(CT, { kind: 'status', code: 'candidate_placed', debrief: 'Offer made' })
    expect(h.app.stage).toBe('closed_placed')
    expect(h.app.outcome).toBe('placed')
    expect(pmLabel(h.app)).toBe('Round 2 – Candidate placed')
    expect(toneFor(h.app, 'pm1')).toBe('green')
    expect(h.app.nextActionBy).toEqual([])
    expect(h.timeline.length).toBeGreaterThan(10)
  })

  it('enforces role rules and required fields', () => {
    const h = new Harness()
    expect(() => h.run(CT, { kind: 'pe_submit', data: {} as never })).toThrow(WorkflowError)
    expect(() => h.run(PM, { kind: 'pe_submit', data: {} as never })).toThrow(/Only a PE/)
    h.submit()
    expect(() => h.run(PM, { kind: 'status', code: 'cv_submitted_to_client' })).toThrow(/Client Team/)
    expect(() => h.run(CT, { kind: 'status', code: 'candidate_placed', debrief: 'x' })).toThrow(/not allowed/)
    expect(() => h.run({ id: 'x', name: 'X', role: 'PM' }, { kind: 'note', message: 'hi' })).toThrow(/assigned/)
    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    expect(() => h.run(CT, { kind: 'status', code: 'dates_mismatch', message: ' ' })).toThrow(/available dates in the message/)
    expect(() => h.run(SYS, { kind: 'auto_debrief' })).toThrow()
  })

  it('notes keep the stage and notify the other side', () => {
    const h = new Harness()
    h.submit()
    h.app.unreadFor = []
    h.run(CT, { kind: 'note', message: 'Client asked for one more reference' })
    expect(h.app.stage).toBe('new_submission')
    expect(h.app.latestMessage).toBe('Client asked for one more reference')
    expect(h.app.unreadFor.sort()).toEqual(['pe1', 'pm1'])
  })

  it('allows rejecting before any interview', () => {
    const h = new Harness()
    h.submit()
    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    h.run(CT, { kind: 'status', code: 'candidate_rejected' })
    expect(h.app.stage).toBe('closed_rejected')
    expect(toneFor(h.app, 'ct1')).toBe('grey')
  })

  it('reschedule cancels the interview and puts both sides on pending', () => {
    const h = new Harness()
    h.submit()
    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    h.run(CT, {
      kind: 'status',
      code: 'interview_scheduled',
      clientDates: [{ date: '2026-10-05' }],
      interview: { scheduledAt: new Date(2026, 9, 5, 10, 0).getTime(), mode: 'phone', meetingDetails: '' },
    })
    h.run(CT, { kind: 'status', code: 'reschedule', message: 'Client travelling' })
    expect(h.interviews['r1-a1'].status).toBe('cancelled')
    expect(h.app.stage).toBe('rescheduling')
    expect(h.app.currentAttempt).toBe(2)
    expect(h.app.scheduledInterviewAt).toBeNull()
    expect(h.app.nextActionBy).toEqual(['pm1', 'ct1'])
  })
})

describe('interview follow-up', () => {
  const schedule = (h: Harness, at: number) => {
    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    h.run(CT, {
      kind: 'status',
      code: 'interview_scheduled',
      clientDates: [{ date: '2026-10-05' }],
      interview: { scheduledAt: at, mode: 'video', meetingDetails: '' },
    })
  }

  it('moves to debrief 5 minutes after the interview time', () => {
    const h = new Harness()
    h.submit()
    const at = h.now + 3 * DAY
    schedule(h, at)
    expect(h.app.interviewEndsAt).toBe(at + 5 * 60_000)
    expect(needsAutoDebrief(h.app, at + 4 * 60_000)).toBe(false)
    expect(needsAutoDebrief(h.app, at + 6 * 60_000)).toBe(true)
  })

  it('lets the Client Team pick next round with client dates straight after scheduling', () => {
    const h = new Harness()
    h.submit()
    schedule(h, h.now + DAY)
    expect(optionsFor(h.app, 'ct1').map((o) => o.code)).toEqual(['reschedule', 'next_round', 'candidate_placed', 'candidate_rejected'])
    expect(() => h.run(CT, { kind: 'status', code: 'next_round' })).toThrow(/Client debrief/)

    h.run(CT, { kind: 'status', code: 'next_round', debrief: 'Go to round 2', clientDates: [{ date: '2026-10-20', from: '11:00', to: '13:00' }] })
    expect(h.app.currentInterviewRound).toBe(2)
    expect(h.interviews['r1-a1'].status).toBe('completed')
    expect(h.interviews['r1-a1'].clientDebrief).toBe('Go to round 2')
    expect(h.rounds['r2-a1'].clientDates).toEqual([{ date: '2026-10-20', from: '11:00', to: '13:00' }])
    expect(ctLabel(h.app)).toBe('Round 2 – New client dates submitted – waiting for PM (candidate dates)')
    expect(pmLabel(h.app)).toBe('Round 2 – Pending – get new available date from candidate')
    expect(h.app.nextActionBy).toEqual(['pm1'])

    h.run(PM, { kind: 'status', code: 'new_candidate_dates', message: 'Candidate free 2026-10-20', candidateDates: [{ date: '2026-10-20' }] })
    expect(h.app.clientTeamStatus).toBe('pending_schedule')
    expect(h.app.nextActionBy).toEqual(['ct1'])
  })

  it('without next-round dates both sides are pending as before', () => {
    const h = new Harness()
    h.submit()
    schedule(h, h.now + DAY)
    h.run(CT, { kind: 'status', code: 'next_round', debrief: 'ok' })
    expect(h.app.nextActionBy).toEqual(['pm1', 'ct1'])
    expect(h.app.clientTeamStatus).toBe('pending_new_client_dates')
  })

  it('both sides can write the round 1 debrief after moving to round 2', () => {
    const h = new Harness()
    h.submit()
    const at = h.now + 60 * 60_000
    schedule(h, at)
    expect(() => h.run(PM, { kind: 'save_debrief', interviewId: 'r1-a1', debrief: 'too early' })).toThrow(/once the interview has started/)
    h.now = at + 30 * 60_000
    h.run(CT, { kind: 'status', code: 'next_round', debrief: 'Client: strong' })
    h.run(PM, { kind: 'save_debrief', interviewId: 'r1-a1', debrief: 'Candidate: went well' })
    h.run(CT, { kind: 'save_debrief', interviewId: 'r1-a1', debrief: 'Client: strong, wants tech round' })
    expect(h.interviews['r1-a1'].candidateDebrief).toBe('Candidate: went well')
    expect(h.interviews['r1-a1'].clientDebrief).toBe('Client: strong, wants tech round')
    expect(h.app.stage).toBe('rescheduling')
    expect(h.timeline.at(-1)!.statusLabel).toBe('Round 1 client debrief saved')
    expect(h.timeline.at(-1)!.interviewRound).toBe(1)
  })

  it('saving the candidate debrief during debrief pending completes the PM side', () => {
    const h = new Harness()
    h.submit()
    const at = h.now + 60 * 60_000
    schedule(h, at)
    h.now = at + 10 * 60_000
    h.run(SYS, { kind: 'auto_debrief' })
    h.run(PM, { kind: 'save_debrief', interviewId: 'r1-a1', debrief: 'fine' })
    expect(h.app.pmStatus).toBe('candidate_debrief_received')
    h.run(CT, { kind: 'status', code: 'candidate_placed', debrief: 'Offer' })
    expect(h.app.stage).toBe('closed_placed')
  })
})

describe('date matching', () => {
  it('matches same dates and intersects time windows', () => {
    expect(findMatches([{ date: '2026-10-05' }], [{ date: '2026-10-06' }])).toEqual([])
    expect(findMatches([{ date: '2026-10-05' }], [{ date: '2026-10-05', from: '10:00', to: '12:00' }])).toEqual([
      { date: '2026-10-05', from: '10:00', to: '12:00' },
    ])
    expect(
      findMatches([{ date: '2026-10-05', from: '14:00', to: '17:00' }], [{ date: '2026-10-05', from: '16:00', to: '18:00' }]),
    ).toEqual([{ date: '2026-10-05', from: '16:00', to: '17:00' }])
    expect(
      findMatches([{ date: '2026-10-05', from: '09:00', to: '11:00' }], [{ date: '2026-10-05', from: '14:00', to: '18:00' }]),
    ).toEqual([])
  })
})

describe('waiting period and reminders', () => {
  const toDebrief = (h: Harness) => {
    h.submit()
    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    const at = h.now + DAY
    h.run(CT, { kind: 'status', code: 'interview_scheduled', clientDates: [{ date: '2026-10-02' }], interview: { scheduledAt: at, mode: 'video', meetingDetails: '' } })
    h.now = at + 10 * 60_000
    h.run(SYS, { kind: 'auto_debrief' })
  }

  it('nobody is reminded while the interview is scheduled; the turn starts at debrief pending', () => {
    const h = new Harness()
    h.submit()
    expect(isMyTurn(h.app, 'ct1', h.now)).toBe(true)
    expect(firstReminderAt(h.app, 'ct1')).toBe(h.app.stageSince + REMINDER_EVERY_MS)
    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    const at = h.now + DAY
    h.run(CT, { kind: 'status', code: 'interview_scheduled', clientDates: [{ date: '2026-10-02' }], interview: { scheduledAt: at, mode: 'video', meetingDetails: '' } })
    expect(isMyTurn(h.app, 'ct1', at + 60_000)).toBe(false)
    expect(isMyTurn(h.app, 'pm1', at + 60_000)).toBe(false)
    h.now = at + 6 * 60_000
    h.run(SYS, { kind: 'auto_debrief' })
    expect(isMyTurn(h.app, 'pm1', h.now)).toBe(true)
    expect(isMyTurn(h.app, 'ct1', h.now)).toBe(true)
  })

  it('client wait pauses only the Client Team; the PM keeps being reminded and can record the debrief', () => {
    const h = new Harness()
    toDebrief(h)
    expect(optionsFor(h.app, 'ct1').map((o) => o.code)).toContain('client_asked_wait')
    expect(() => h.run(CT, { kind: 'status', code: 'client_asked_wait' })).toThrow(/date and time/)
    expect(() => h.run(CT, { kind: 'status', code: 'client_asked_wait', waitUntil: h.now - 1 })).toThrow(/future/)

    const until = new Date(2026, 9, 5, 17, 0).getTime()
    const plan = h.run(CT, { kind: 'status', code: 'client_asked_wait', waitUntil: until, message: 'Final answer on Monday' })
    expect(h.app.stage).toBe('debrief_pending')
    expect(h.app.clientWaitUntil).toBe(until)
    expect(h.app.candidateWaitUntil ?? null).toBeNull()
    expect(plan.timeline[0].statusLabel).toBe('Client asked to wait till 5 Oct, 5:00 PM')

    // Client Team side: paused till the time, then back on
    expect(ctLabel(h.app, until - 1)).toBe('Client asked to wait till 5 Oct, 5:00 PM')
    expect(ctLabel(h.app, until + 1)).toBe("Client's waiting time over (5 Oct, 5:00 PM) – Pending – get debrief from client")
    expect(isMyTurn(h.app, 'ct1', until - 1)).toBe(false)
    expect(toneFor(h.app, 'ct1', until - 1)).toBe('blue')
    expect(isMyTurn(h.app, 'ct1', until + 1)).toBe(true)
    expect(firstReminderAt(h.app, 'ct1')).toBe(until)

    // PM side: not affected
    expect(pmLabel(h.app, until - 1)).toBe('Pending – get debrief from candidate')
    expect(isMyTurn(h.app, 'pm1', until - 1)).toBe(true)
    expect(toneFor(h.app, 'pm1', until - 1)).toBe('red')
    expect(firstReminderAt(h.app, 'pm1')).toBe(h.app.stageSince + REMINDER_EVERY_MS)

    h.run(PM, { kind: 'status', code: 'candidate_debrief', debrief: 'Liked the team' })
    expect(isMyTurn(h.app, 'pm1', h.now)).toBe(false)
    expect(h.app.clientWaitUntil).toBe(until)

    // after the wait the Client Team sets the outcome; the wait is cleared
    h.now = until + 60_000
    h.run(CT, { kind: 'status', code: 'candidate_rejected', debrief: 'Went with another candidate' })
    expect(h.app.clientWaitUntil).toBeNull()
    expect(h.app.candidateWaitUntil).toBeNull()
  })

  it('candidate wait pauses only the PM; it ends when the candidate debrief is recorded', () => {
    const h = new Harness()
    toDebrief(h)
    const until = h.now + DAY
    expect(() => h.run(CT, { kind: 'status', code: 'candidate_asked_wait', waitUntil: until })).toThrow(/PM/)
    h.run(PM, { kind: 'status', code: 'candidate_asked_wait', waitUntil: until })
    expect(h.app.candidateWaitUntil).toBe(until)
    expect(pmLabel(h.app, until - 1)).toMatch(/^Candidate asked to wait till /)
    expect(isMyTurn(h.app, 'pm1', until - 1)).toBe(false)
    expect(isMyTurn(h.app, 'ct1', until - 1)).toBe(true)
    expect(ctLabel(h.app, until - 1)).toBe('Pending – get debrief from client')

    // both sides can each have their own wait
    h.run(CT, { kind: 'status', code: 'client_asked_wait', waitUntil: until + DAY })
    expect(isMyTurn(h.app, 'ct1', until + 1)).toBe(false)
    expect(isMyTurn(h.app, 'pm1', until + 1)).toBe(true)

    h.now = until + 60_000
    h.run(PM, { kind: 'status', code: 'candidate_debrief', debrief: 'Wants to join' })
    expect(h.app.candidateWaitUntil).toBeNull()
    expect(h.app.clientWaitUntil).toBe(until + DAY)
    expect(optionsFor(h.app, 'pm1')).toHaveLength(0)
  })
})

describe('PE adds a candidate → PM revises the CV and sends it to the Client Team', () => {
  const peSubmit = (h: Harness, extra: Partial<Extract<Action, { kind: 'pe_submit' }>['data']> = {}) =>
    h.run(PE, {
      kind: 'pe_submit',
      message: 'Strong fit',
      data: {
        candidateName: 'Ravi',
        candidateContactNumber: '+91 98765 43210',
        candidateEmail: 'ravi@example.com',
        originalCvUrl: 'https://drive/original.pdf',
        originalCvName: 'Ravi.pdf',
        jobId: 'j1',
        jobTitle: 'Accountant',
        clientId: 'c1',
        clientName: 'Acme',
        assignedPM: 'pm1',
        candidateDates: [{ date: '2026-10-05' }],
        currentSalary: '12',
        expectedSalary: '15.5',
        noticePeriod: '30 days',
        recruiterNote: 'Has GST experience',
        ...extra,
      },
    })

  const send = (h: Harness, actor: Actor = PM) =>
    h.run(actor, {
      kind: 'send_to_ct',
      message: 'Please share with client',
      reason: 'Strong GST experience',
      data: {
        candidateId: h.app.candidateId,
        candidateName: 'Ravi Kumar',
        candidateContactNumber: h.app.candidateContactNumber,
        candidateEmail: 'ravi@example.com',
        revisedCvUrl: 'https://drive/revised.pdf',
        revisedCvName: 'Ravi_Kumar_RishiJobs.pdf',
        originalCvUrl: h.app.originalCvUrl,
        jobId: 'j1',
        jobTitle: 'Accountant',
        clientId: 'c1',
        clientName: 'Acme',
        assignedPE: 'pe1',
        assignedClientTeam: 'ct1',
        candidateDates: [{ date: '2026-10-06' }],
        currentSalary: '12',
        expectedSalary: '16',
        noticePeriod: '30 days',
        recruiterNote: 'Has GST experience',
      },
    })

  it('logs when the PM made and checked the revised CV, changing nothing else and alerting nobody', () => {
    const h = new Harness()
    peSubmit(h)
    h.run(PM, { kind: 'pm_query', message: 'Notice?' })
    h.run(PE, { kind: 'pe_answer', message: '15 days' })
    h.app.unreadFor = []
    const before = { ...h.app }
    h.now += 60_000
    expect(() => h.run(PE, { kind: 'cv_checked', fileName: 'x.pdf' })).toThrow()
    h.run(PM, { kind: 'cv_checked', fileName: 'Ravi_Kumar_RishiJobs.pdf' })
    const entry = h.timeline.at(-1)!
    expect(entry).toMatchObject({ type: 'cv_upload', actor: 'pm1', statusLabel: 'Revised CV made and checked by PM Shubham (Ravi_Kumar_RishiJobs.pdf)', timestamp: h.now })
    expect(h.app.stage).toBe('pe_submitted')
    expect(h.app.pmStatus).toBe(before.pmStatus)
    expect(h.app.peAnswered).toBe(true)
    expect(h.app.latestMessage).toBe(before.latestMessage)
    expect(h.app.availabilityNote).toBe(before.availabilityNote)
    expect(h.app.unreadFor).toEqual([])
    send(h)
    expect(() => h.run(PM, { kind: 'cv_checked', fileName: 'x.pdf' })).toThrow(/already been sent/)
  })

  it('logs the PM’s reason for selecting the candidate, and requires it', () => {
    const h = new Harness()
    peSubmit(h)
    expect(() =>
      h.run(PM, { kind: 'send_to_ct', message: 'Mon 10am', reason: ' ', data: { ...h.app, assignedClientTeam: 'ct1', revisedCvUrl: 'https://drive/r.pdf' } as never }),
    ).toThrow(/reason for selection/i)
    send(h)
    expect(h.app.selectionReason).toBe('Strong GST experience')
    expect(h.timeline.find((e) => e.statusCode === 'pm_select')).toMatchObject({ statusLabel: 'Selected by PM Shubham', message: 'Strong GST experience', actor: 'pm1' })
  })

  it('sends an unanswered candidate to the PE to reach, and back to the PM when the PE says they answered', () => {
    const h = new Harness()
    peSubmit(h)
    h.app.unreadFor = []
    expect(() => h.run(PM, { kind: 'pm_unanswered', message: '' })).toThrow()
    expect(() => h.run(PE, { kind: 'pm_unanswered', message: 'x' })).toThrow()
    h.run(PM, { kind: 'pm_unanswered', message: 'Called twice, no answer' })
    expect(h.timeline.at(-1)).toMatchObject({ statusCode: 'pm_unanswered', statusLabel: 'Marked unanswered by PM Shubham', message: 'Called twice, no answer' })
    // The PE's turn (red for the PE); the PM waits.
    expect(h.app).toMatchObject({ stage: 'pe_query', peUnanswered: true, peAnswered: false, nextActionBy: ['pe1'] })
    expect(h.app.unreadFor).toContain('pe1')
    expect(viewerLabel(h.app, 'pe1', 'PE', undefined, (id) => ({ pm1: 'Shubham' })[id])).toBe(
      'Pending – Shubham could not reach the candidate: call the candidate and let Shubham know when they answer',
    )
    expect(pmLabel(h.app)).toMatch(/^Unanswered – waiting for/)
    // The PE reached the candidate: back to the PM's turn, logged.
    expect(() => h.run(PE, { kind: 'pe_answer', message: ' ' })).toThrow(/message to the PM/)
    h.run(PE, { kind: 'pe_answer', message: 'Answered at 4 PM, please call' })
    expect(h.timeline.at(-1)).toMatchObject({ statusCode: 'pe_reached', actor: 'pe1', message: 'Answered at 4 PM, please call' })
    expect(h.app).toMatchObject({ stage: 'pe_submitted', peAnswered: true, nextActionBy: ['pm1'] })
    expect(h.app.unreadFor).toContain('pm1')
    expect(pmLabel(h.app)).toMatch(/says the candidate answered/)
    // The PM decides again — even unanswered once more, or a doubt.
    h.run(PM, { kind: 'pm_unanswered', message: 'Missed the call again' })
    expect(h.app.stage).toBe('pe_query')
    h.run(PE, { kind: 'pe_answer', message: 'Try now' })
    h.run(PM, { kind: 'pm_query', message: 'Notice period?' })
    expect(h.app.peUnanswered).toBe(false)
    expect(viewerLabel(h.app, 'pe1', 'PE')).toMatch(/raised a doubt/)
  })

  it('flags the admins when the PE has not replied to an unanswered candidate for 48 hours', () => {
    const h = new Harness()
    peSubmit(h)
    h.run(PM, { kind: 'pm_query', message: 'Notice period?' })
    expect(peUnansweredOverdueAt(h.app, h.now + 3 * DAY)).toBeNull() // a doubt, not unanswered
    h.run(PE, { kind: 'pe_answer', message: '30 days' })
    h.run(PM, { kind: 'pm_unanswered', message: 'No answer' })
    const since = h.app.stageSince
    expect(peUnansweredOverdueAt(h.app, since + 47 * 3_600_000)).toBeNull()
    expect(peUnansweredOverdueAt(h.app, since + 49 * 3_600_000)).toBe(since + 48 * 3_600_000)
    h.run(PE, { kind: 'pe_answer', message: 'Reached now' })
    expect(peUnansweredOverdueAt(h.app, since + 3 * DAY)).toBeNull()
  })

  it('logs when the PM generated the revised CV, alerting nobody', () => {
    const h = new Harness()
    peSubmit(h)
    h.app.unreadFor = []
    h.now += 60_000
    expect(() => h.run(PE, { kind: 'cv_generated', fileName: 'x.pdf' })).toThrow()
    h.run(PM, { kind: 'cv_generated', fileName: 'Ravi_Kumar_RishiJobs.pdf' })
    expect(h.timeline.at(-1)).toMatchObject({ type: 'cv_upload', actor: 'pm1', statusLabel: 'Revised CV generated by PM Shubham (Ravi_Kumar_RishiJobs.pdf)', timestamp: h.now })
    expect(h.app.stage).toBe('pe_submitted')
    expect(h.app.unreadFor).toEqual([])
    send(h)
    expect(() => h.run(PM, { kind: 'cv_generated', fileName: 'x.pdf' })).toThrow(/already been sent/)
  })

  it('logs when the Client Team downloads the revised CV, alerting nobody', () => {
    const h = new Harness()
    peSubmit(h)
    expect(() => h.run(CT, { kind: 'cv_downloaded' })).toThrow()
    send(h)
    h.app.unreadFor = []
    const stage = h.app.stage
    h.now += 60_000
    expect(() => h.run(PM, { kind: 'cv_downloaded' })).toThrow()
    h.run(CT, { kind: 'cv_downloaded' })
    expect(h.timeline.at(-1)).toMatchObject({ type: 'cv_upload', actor: 'ct1', statusLabel: 'Revised CV downloaded by Dipanshi', timestamp: h.now })
    expect(h.app.stage).toBe(stage)
    expect(h.app.unreadFor).toEqual([])
  })

  it('lets the client’s Client Team member follow it before the PM sends it, without alerting them', () => {
    const h = new Harness()
    peSubmit(h, { watchClientTeam: 'ct1' })
    expect(h.app.watchClientTeam).toBe('ct1')
    expect(h.app.assignedClientTeam).toBe('')
    expect(h.app.unreadFor).toEqual(['pm1'])
    expect(isMyTurn(h.app, 'ct1', h.now)).toBe(false)
    const names = (id: string) => ({ pe1: 'Dheer', pm1: 'Shubham' })[id]
    expect(viewerLabel(h.app, 'ct1', 'ClientTeam', h.now, names)).toBe('New candidate from Dheer – with Shubham, not sent to you yet')
    h.run(PM, { kind: 'pm_query', message: 'Notice period?' })
    expect(viewerLabel(h.app, 'ct1', 'ClientTeam', h.now, names)).toBe('Shubham raised a doubt with Dheer – not sent to you yet')
    h.run(PE, { kind: 'pe_answer', message: '15 days' })
    send(h)
    expect(h.app.assignedClientTeam).toBe('ct1')
    expect(h.app.watchClientTeam).toBe('ct1')
    expect(isMyTurn(h.app, 'ct1', h.now)).toBe(true)
  })

  it('goes to the PM only, with an alert, and the PE sees "Submitted new candidate to PM"', () => {
    const h = new Harness()
    const plan = peSubmit(h)
    expect(plan.isNew).toBe(true)
    expect(h.app.stage).toBe('pe_submitted')
    expect(h.app.assignedPE).toBe('pe1')
    expect(h.app.assignedPM).toBe('pm1')
    expect(h.app.assignedClientTeam).toBe('')
    expect(h.app.revisedCvUrl).toBe('')
    expect(h.app.nextActionBy).toEqual(['pm1'])
    expect(h.app.unreadFor).toEqual(['pm1'])
    expect(h.app.lastActionLabel).toBe('New candidate added by PE Bhavya')
    expect(h.app.recruiterNote).toBe('Has GST experience')
    expect(h.app.expectedSalary).toBe('15.5')
    expect(awaitingSend(h.app, 'pm1')).toBe(true)
    expect(isMyTurn(h.app, 'pm1', h.now)).toBe(true)
    expect(toneFor(h.app, 'pm1', h.now)).toBe('red')
    expect(toneFor(h.app, 'pe1', h.now)).toBe('yellow')
    expect(viewerLabel(h.app, 'pe1', 'PE', h.now)).toBe('Submitted new candidate to PM')
    expect(pmLabel(h.app)).toMatch(/^Pending – new candidate from PE/)
    expect(h.rounds['r1-a1'].candidateDates).toEqual([{ date: '2026-10-05' }])
    expect(h.timeline.map((e) => e.actorRole)).toEqual(['PE', 'PE'])
    expect(h.timeline[1].statusLabel).toBe('Submitted new candidate to PM')
    // no status dropdown options at this stage: the PM rejects, asks the PE, or uses "Send to Client Team"
    expect(optionsFor(h.app, 'pm1')).toHaveLength(0)
  })

  it('checks the PE’s input', () => {
    expect(() => peSubmit(new Harness(), { recruiterNote: ' ' })).toThrow(/Recruiter note/)
    expect(() => peSubmit(new Harness(), { originalCvUrl: '' })).toThrow(/Original CV/)
    expect(() => peSubmit(new Harness(), { assignedPM: '' })).toThrow(/no PM yet/)
    expect(() => peSubmit(new Harness(), { currentSalary: '12,00,000' })).toThrow(/LPA/)
    expect(() => peSubmit(new Harness(), { candidateEmail: 'nope' })).toThrow(/email/)
    expect(() => new Harness().run(PM, { kind: 'pe_submit', data: {} as never })).toThrow(/Only a PE/)
    expect(() => peSubmit(new Harness(), { candidateAltContactNumber: '123' })).toThrow(/second contact/)
    expect(() => peSubmit(new Harness(), { candidateAltContactNumber: '+91 98765 43210' })).toThrow(/same as the first/)
    expect(() => new Harness().run(PE, { kind: 'pe_submit', message: '', data: {} as never })).toThrow()
  })

  it('keeps an optional second number, and works without any date inputs (dates are in the message)', () => {
    const h = new Harness()
    peSubmit(h, { candidateAltContactNumber: '+91 91234 56789', candidateDates: undefined })
    expect(h.app.candidateAltContactNumber).toBe('+91 91234 56789')
    expect(h.app.latestCandidateDates).toEqual([])
    expect(h.app.latestMessage).toBe('Strong fit')
    const plan = h.run(PM, { kind: 'pm_query', message: 'Notice period negotiable?' })
    expect(plan.candidate).toBeUndefined()
  })

  it('the PM can reject, or ask the PE a question that the PE answers', () => {
    const h = new Harness()
    peSubmit(h)
    const firstNote = h.app.latestMessage
    expect(h.app.availabilityNote).toBe(firstNote)
    expect(pmLabel(h.app)).toMatch(/^Pending – new candidate from PE/)
    expect(() => h.run(PM, { kind: 'pm_query', message: ' ' })).toThrow(/question/)
    expect(() => h.run(PE, { kind: 'pm_query', message: 'x' })).toThrow()
    h.run(PM, { kind: 'pm_query', message: 'Is the notice period negotiable?' })
    expect(h.app.stage).toBe('pe_query')
    expect(h.app.pmStatus).toBe('query_to_pe')
    expect(h.app.nextActionBy).toEqual(['pe1'])
    expect(isMyTurn(h.app, 'pe1', h.now)).toBe(true)
    expect(awaitingSend(h.app, 'pm1')).toBe(false)
    expect(viewerLabel(h.app, 'pe1', 'PE', h.now)).toBe('Pending – PM raised a doubt: please answer')
    expect(pmLabel(h.app)).toBe('Doubt sent to PE – waiting for the answer')
    expect(() => send(h)).toThrow(/already been sent/)
    expect(() => h.run(PE, { kind: 'pe_answer', message: '' })).toThrow(/answer/)
    expect(() => h.run(CT, { kind: 'pe_answer', message: 'x' })).toThrow(/Only the PE/)

    h.run(PE, { kind: 'pe_answer', message: 'Yes, down to 15 days' })
    expect(h.app.stage).toBe('pe_submitted')
    expect(h.app.nextActionBy).toEqual(['pm1'])
    expect(h.timeline.at(-1)!.actorRole).toBe('PE')
    expect(h.app.unreadFor).toEqual(['pm1'])
    // The PM is told the doubt was answered; the PE's first note (the available dates) is kept for sending on.
    expect(pmLabel(h.app, h.now, (id) => ({ pe1: 'Dheer' })[id])).toBe('Dheer answered your doubt')
    expect(h.app.latestMessage).toBe('Yes, down to 15 days')
    expect(h.app.availabilityNote).toBe(firstNote)

    h.run(PM, { kind: 'pm_reject', message: 'Salary too high' })
    expect(h.app.stage).toBe('closed_rejected')
    expect(h.app.outcome).toBe('rejected')
    expect(h.app.nextActionBy).toEqual([])
    expect(h.timeline.at(-1)!.statusLabel).toBe('Rejected by PM Shubham')
    expect(pmLabel(h.app)).toBe('Rejected by PM')
    expect(outcomeLabel(h.app)).toBe('Rejected by PM')
    // never reached the Client Team: no step is ticked
    expect(stepsDone(h.app)).toBe(0)
    expect(() => h.run(PE, { kind: 'candidate_backout', message: 'x' })).toThrow(/already closed/)
  })

  it('PE or PM can mark a candidate backout at any point, with a reason', () => {
    const h = new Harness()
    peSubmit(h)
    expect(() => h.run(PE, { kind: 'candidate_backout', message: ' ' })).toThrow(/reason/)
    expect(() => h.run(CT, { kind: 'candidate_backout', message: 'x' })).toThrow()
    h.run(PE, { kind: 'candidate_backout', message: 'Took another offer' })
    expect(h.app.stage).toBe('closed_backout')
    expect(h.app.backoutReason).toBe('Took another offer')
    expect(h.app.closedFromStage).toBe('pe_submitted')
    expect(h.app.nextActionBy).toEqual([])
    expect(pmLabel(h.app)).toBe('Candidate backout')
    expect(stepsDone(h.app)).toBe(0)
    expect(h.timeline.at(-1)!.actorRole).toBe('PE')

    const h2 = new Harness()
    h2.submit()
    h2.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    h2.run(PM, { kind: 'candidate_backout', message: 'Not interested any more' })
    expect(h2.app.stage).toBe('closed_backout')
    expect(h2.app.closedFromStage).toBe('cv_with_client')
    expect(stepsDone(h2.app)).toBe(1)
    expect(h2.timeline.at(-1)!.statusLabel).toBe('Candidate backout (marked by PM Shubham)')
  })

  it('a client rejection says so, and ticks only the steps reached', () => {
    const h = new Harness()
    h.submit()
    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    h.run(CT, { kind: 'status', code: 'candidate_rejected' })
    expect(pmLabel(h.app)).toBe('Rejected by client')
    expect(ctLabel(h.app)).toBe('Rejected by client')
    expect(h.app.closedFromStage).toBe('cv_with_client')
    expect(stepsDone(h.app)).toBe(2)
  })

  it('the PM sends it on with the revised CV, then the normal workflow runs', () => {
    const h = new Harness()
    peSubmit(h)
    const created = h.app.createdAt
    expect(() => send(h, CT)).toThrow(/assigned PM/)
    const plan = send(h)
    expect(plan.isNew).toBe(false)
    expect(h.app.stage).toBe('new_submission')
    expect(h.app.candidateName).toBe('Ravi Kumar')
    expect(h.app.assignedClientTeam).toBe('ct1')
    expect(h.app.assignedPE).toBe('pe1')
    expect(h.app.createdBy).toBe('pe1')
    expect(h.app.createdAt).toBe(created)
    expect(h.app.revisedCvUrl).toBe('https://drive/revised.pdf')
    expect(h.app.originalCvUrl).toBe('https://drive/original.pdf')
    expect(h.app.expectedSalary).toBe('16')
    expect(h.app.nextActionBy).toEqual(['ct1'])
    expect(h.app.unreadFor.sort()).toEqual(['ct1', 'pe1'])
    expect(pmLabel(h.app)).toBe('Submitted CV to Client Team')
    expect(viewerLabel(h.app, 'pe1', 'PE')).toBe('Submitted CV to Client Team')
    expect(h.rounds['r1-a1'].candidateDates).toEqual([{ date: '2026-10-06' }])
    expect(h.timeline.slice(-2).map((e) => e.statusLabel)).toEqual(['Revised CV uploaded: Ravi_Kumar_RishiJobs.pdf', 'Submitted CV to Client Team'])
    expect(h.timeline.at(-1)!.fromStage).toBe('pe_submitted')

    // can only be sent once
    expect(() => send(h)).toThrow(/already been sent/)
    h.run(CT, { kind: 'status', code: 'cv_submitted_to_client' })
    expect(h.app.stage).toBe('cv_with_client')
    expect(h.app.unreadFor).toEqual(expect.arrayContaining(['pm1', 'pe1']))
  })

  it('keeps a candidate profile: new, sent to another client, and corrected by the PM', () => {
    const h = new Harness()
    const plan = peSubmit(h)
    const id = h.app.candidateId
    expect(plan.candidate?.id).toBe(id)
    expect(plan.candidate?.data).toMatchObject({
      candidateName: 'Ravi',
      originalCvUrl: 'https://drive/original.pdf',
      recruiterNote: 'Has GST experience',
      pe: 'pe1',
      pm: 'pm1',
      people: ['pe1', 'pm1'],
      createdBy: 'pe1',
    })

    // The same candidate sent to a second client: same candidate ID, no new createdAt.
    const again = peSubmit(new Harness(), { candidateId: id, clientId: 'c2', clientName: 'Beta', jobId: 'j2', jobTitle: 'Clerk' })
    expect(again.app.candidateId).toBe(id)
    expect(again.candidate?.id).toBe(id)
    expect(again.candidate?.data.createdAt).toBeUndefined()
    expect(again.timeline[0].statusLabel).toBe('Existing candidate sent to Beta – Clerk')

    // The PM's corrections reach the profile too.
    const sent = send(h)
    expect(sent.candidate).toEqual({ id, data: expect.objectContaining({ candidateName: 'Ravi Kumar', expectedSalary: '16' }) })
    expect(sent.candidate?.data.people).toBeUndefined()
  })
})
