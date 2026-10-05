import { describe, expect, it } from 'vitest'
import type { JobOpening, Role } from '../types'
import { jobAgeDays, jobAgeTone, jobEventsFor, jobLate, jobLateFor, jobLateText, jobNeedsMe, jobStep, jobStepLabel, jobTurnSince } from './jobs'

const job = (o: Partial<JobOpening> = {}): JobOpening => ({
  id: 'JB-0001',
  clientId: 'CL-0001',
  clientName: 'Acme',
  title: 'Java Developer',
  details: '',
  status: 'open',
  assignedClientTeam: 'ct',
  assignedPM: null,
  pmAssignedAt: null,
  pmAssignedBy: null,
  pmAssignedByName: null,
  assignedPE: null,
  peAssignedAt: null,
  peAssignedBy: null,
  peAssignedByName: null,
  notes: [],
  createdAt: 100,
  createdBy: 'ct',
  createdByName: 'Dipanshi',
  ...o,
})
const user = (id: string, role: Role) => ({ id, role })
const names = (id: string) => ({ pm: 'Shubham', pe: 'Dheer' })[id]
const withPm = { assignedPM: 'pm', pmAssignedAt: 200, pmAssignedBy: 'admin', pmAssignedByName: 'Shweta' }
const withPe = { ...withPm, assignedPE: 'pe', peAssignedAt: 300, peAssignedBy: 'pm', peAssignedByName: 'Shubham' }

describe('job opening hand-down', () => {
  it('goes Admin → PM → PE', () => {
    expect(jobStep(job())).toBe('with_admin')
    expect(jobStep(job(withPm))).toBe('with_pm')
    expect(jobStep(job(withPe))).toBe('with_pe')
    expect(jobStepLabel(job(withPm), names)).toBe('With Shubham – to assign a PE')
    expect(jobStepLabel(job(withPe), names)).toBe('Assigned to Dheer (PM Shubham)')
  })

  it('waits on the admins, then only on the assigned PM', () => {
    expect(jobNeedsMe(job(), user('a', 'Admin'))).toBe(true)
    expect(jobNeedsMe(job(), user('r', 'SuperAdmin'))).toBe(true)
    expect(jobNeedsMe(job(), user('pm', 'PM'))).toBe(false)
    expect(jobNeedsMe(job(withPm), user('a', 'Admin'))).toBe(false)
    expect(jobNeedsMe(job(withPm), user('pm', 'PM'))).toBe(true)
    expect(jobNeedsMe(job(withPm), user('pm2', 'PM'))).toBe(false)
    expect(jobNeedsMe(job({ ...withPm, status: 'on-hold' }), user('pm', 'PM'))).toBe(false)
  })

  it('waits on the PE until they have submitted a candidate for it', () => {
    const pe = user('pe', 'PE')
    expect(jobNeedsMe(job(withPe), pe)).toBe(true)
    expect(jobNeedsMe(job(withPe), user('pe2', 'PE'))).toBe(false)
    expect(jobNeedsMe(job(withPe), user('pm', 'PM'))).toBe(false)
    expect(jobNeedsMe(job(withPe), pe, new Set(['JB-0001']))).toBe(false)
    expect(jobNeedsMe(job({ ...withPe, status: 'on-hold' }), pe)).toBe(false)
    expect(jobTurnSince(job(withPe), pe)).toBe(300)
    expect(jobTurnSince(job(withPm), user('pm', 'PM'))).toBe(200)
    expect(jobTurnSince(job(), user('a', 'Admin'))).toBe(100)
  })

  it('alerts only the people concerned', () => {
    const keys = (id: string, role: Role, j: JobOpening) => jobEventsFor(user(id, role), j, names).map((e) => e.key)
    // New job opening: the admins only.
    expect(keys('admin', 'Admin', job())).toEqual(['j:JB-0001:new'])
    expect(keys('pm', 'PM', job())).toEqual([])
    expect(keys('pe', 'PE', job())).toEqual([])
    // Assigned to the PM: that PM and the client's Client Team member; not another PM, nor the admin who did it.
    expect(keys('pm', 'PM', job(withPm))).toEqual(['j:JB-0001:pm:200'])
    expect(keys('pm2', 'PM', job(withPm))).toEqual([])
    expect(keys('ct', 'ClientTeam', job(withPm))).toEqual(['j:JB-0001:pm:200'])
    expect(keys('admin', 'Admin', job(withPm))).toEqual(['j:JB-0001:new'])
    // Assigned to the PE: that PE (action) and the Client Team member; not the PM who did it, nor another PE.
    expect(jobEventsFor(user('pe', 'PE'), job(withPe), names)).toMatchObject([{ key: 'j:JB-0001:pe:300', actionRequired: true }])
    expect(keys('pe2', 'PE', job(withPe))).toEqual([])
    expect(keys('pm', 'PM', job(withPe))).toEqual(['j:JB-0001:pm:200'])
    expect(keys('ct', 'ClientTeam', job(withPe))).toEqual(['j:JB-0001:pm:200', 'j:JB-0001:pe:300'])
  })

  it('tells the PM / PE when the job opening is on hold or closed', () => {
    const [open] = jobEventsFor(user('pe', 'PE'), job(withPe), names)
    expect(open.body).not.toMatch(/priority/)
    for (const status of ['on-hold', 'closed'] as const) {
      const [pe] = jobEventsFor(user('pe', 'PE'), job({ ...withPe, status }), names)
      expect(pe.body).toMatch(new RegExp(`${status === 'closed' ? 'closed' : 'on hold'} right now, so it is not a priority`))
      expect(pe.actionRequired).toBe(false)
      const [pm] = jobEventsFor(user('pm', 'PM'), job({ ...withPm, status }), names)
      expect(pm.body).toMatch(/not a priority/)
    }
  })

  it('sends the submission deadline with the assignment alerts', () => {
    const [pe] = jobEventsFor(user('pe', 'PE'), job({ ...withPe, submitBy: new Date(2026, 9, 5, 18, 0).getTime() }), names)
    expect(pe.body).toMatch(/submissions due by 5 Oct, 6:00 PM/)
    const [pm] = jobEventsFor(user('pm', 'PM'), job(withPm), names)
    expect(pm.body).not.toMatch(/due by/)
  })
})

describe('missed submission deadline', () => {
  const due = 1_000
  const sentToCt = { jobId: 'JB-0001', assignedPM: 'pm', assignedPE: 'pe', assignedClientTeam: 'ct' }
  const withPmOnly = { jobId: 'JB-0001', assignedPM: 'pm', assignedPE: 'pe', assignedClientTeam: '' }

  it('is nothing before the deadline, without one, when not open, or before a PM is assigned', () => {
    expect(jobLate(job({ ...withPe, submitBy: due }), [], due - 1)).toBeNull()
    expect(jobLate(job(withPe), [], due)).toBeNull()
    expect(jobLate(job({ ...withPe, submitBy: due, status: 'on-hold' }), [], due)).toBeNull()
    expect(jobLate(job({ submitBy: due }), [], due)).toBeNull()
  })

  it('stays with the PE until they submit, and with the PM until one reaches the Client Team', () => {
    const j = job({ ...withPe, submitBy: due })
    expect(jobLate(j, [], due)).toEqual({ pm: true, pe: true })
    expect(jobLate(j, [withPmOnly], due)).toEqual({ pm: true, pe: false })
    expect(jobLate(j, [sentToCt], due)).toBeNull()
    // Another job opening's submissions don't count.
    expect(jobLate(j, [{ ...sentToCt, jobId: 'JB-0002' }], due)).toEqual({ pm: true, pe: true })
    // No PE assigned yet: the PM is late.
    expect(jobLate(job({ ...withPm, submitBy: due }), [], due)).toEqual({ pm: true, pe: false })
  })

  it('alerts the PM and PE for their own part, and the admins and Client Team for all of it', () => {
    const j = job({ ...withPe, submitBy: due })
    expect(jobLateFor(j, [withPmOnly], user('pe', 'PE'), due)).toBeNull()
    expect(jobLateFor(j, [withPmOnly], user('pm', 'PM'), due)).toEqual({ pm: true, pe: false })
    expect(jobLateFor(j, [], user('pe', 'PE'), due)).toEqual({ pm: true, pe: true })
    expect(jobLateFor(j, [], user('pe2', 'PE'), due)).toBeNull()
    expect(jobLateFor(j, [], user('a', 'Admin'), due)).not.toBeNull()
    expect(jobLateFor(j, [], user('ct', 'ClientTeam'), due)).not.toBeNull()
  })

  it('says who has not submitted', () => {
    const j = job({ ...withPe, submitBy: due })
    expect(jobLateText(j, { pm: true, pe: true }, names)).toBe('PM Shubham and PE Dheer have not submitted any candidate.')
    expect(jobLateText(j, { pm: true, pe: true }, names, 'pe')).toBe('You have not submitted any candidate for it.')
    expect(jobLateText(j, { pm: true, pe: false }, names)).toBe('PE Dheer has submitted, but PM Shubham has not sent any candidate to the Client Team.')
    expect(jobLateText(job({ ...withPm, submitBy: due }), { pm: true, pe: false }, names, 'pm')).toBe('You have not assigned a PE yet, and no candidate has been submitted.')
  })
})

describe('job opening age', () => {
  const at = (d: number, h = 10) => new Date(2026, 9, d, h).getTime()
  it('is 1 on the day it was added and grows by calendar day', () => {
    expect(jobAgeDays({ createdAt: at(1, 23) }, at(1, 23))).toBe(1)
    expect(jobAgeDays({ createdAt: at(1, 23) }, at(2, 1))).toBe(2)
    expect(jobAgeDays({ createdAt: at(1) }, at(9))).toBe(9)
    expect(jobAgeDays({}, at(9))).toBeNull()
  })
  it('starts again from 1 when the priority changes', () => {
    expect(jobAgeDays({ createdAt: at(1), priorityChangedAt: at(10) }, at(10, 18))).toBe(1)
  })
  it('turns orange after 7 days and red after 12', () => {
    expect([7, 8, 12, 13].map(jobAgeTone)).toEqual([null, 'orange', 'orange', 'red'])
  })
})
