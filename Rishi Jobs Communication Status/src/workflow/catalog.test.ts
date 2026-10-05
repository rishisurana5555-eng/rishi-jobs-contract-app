import { describe, expect, it } from 'vitest'
import type { Client, JobOpening } from '../types'
import { clientChanges, jobChanges } from './catalog'

const client: Client = { id: 'CL-0001', name: 'Acme', contactPerson: 'Ravi', assignedClientTeam: 'ct1' }
const job = { id: 'JB-0001', title: 'Accountant', details: 'GST', status: 'open' } as JobOpening

describe('client / job opening edits', () => {
  it('lists what changed in a client', () => {
    expect(clientChanges(client, { ...client })).toEqual([])
    const names = (id: string) => ({ ct1: 'Dipanshi', ct2: 'Neha' })[id]
    expect(clientChanges(client, { ...client, name: 'Acme Ltd', assignedClientTeam: 'ct2' }, names)).toEqual(['Name: Acme → Acme Ltd', 'Client Team: Dipanshi → Neha'])
  })

  it('lists what changed in a job opening; a missing priority is Active', () => {
    expect(jobChanges(job, { ...job, priority: 'active' })).toEqual([])
    expect(jobChanges(job, { ...job, title: 'Senior Accountant', status: 'on-hold', priority: 'second_priority' })).toEqual([
      'Title: Accountant → Senior Accountant',
      'Status: Open → On hold',
      'Job status: Active → Second priority',
    ])
    expect(jobChanges(job, { ...job, details: 'GST, TDS' })).toEqual(['Job details changed'])
    expect(jobChanges(job, { ...job, submitBy: null })).toEqual([])
    expect(jobChanges(job, { ...job, submitBy: new Date(2026, 9, 5, 18, 0).getTime() })).toEqual(['Submissions due by: no deadline → 5 Oct, 6:00 PM'])
  })
})
