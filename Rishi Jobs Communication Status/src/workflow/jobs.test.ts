import { describe, expect, it } from 'vitest'
import type { JobOpening, Role } from '../types'
import { jobEventsFor, jobNeedsMe, jobStep, jobStepLabel, jobTurnSince } from './jobs'

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
})
