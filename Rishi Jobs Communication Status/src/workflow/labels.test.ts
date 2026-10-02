import { expect, it } from 'vitest'
import type { Application } from '../types'
import { ctLabel, pmLabel, viewerLabel } from './workflow'

const people: Record<string, string> = { pe1: 'Bhavya', pm1: 'Shubham', ct1: 'Vanshika' }
const names = (id: string) => people[id]
const app = (more: Partial<Application>) =>
  ({ assignedPE: 'pe1', assignedPM: 'pm1', assignedClientTeam: 'ct1', currentInterviewRound: 1, scheduledInterviewAt: null, nextActionBy: [], ...more }) as Application

it('shows the PE, PM and Client Team member by name', () => {
  const fromPe = app({ stage: 'pe_submitted', pmStatus: 'pending_pe_submission', clientTeamStatus: 'not_sent_yet', assignedClientTeam: '' })
  expect(pmLabel(fromPe, 0, names)).toBe('Pending – new candidate from Bhavya: send, reject or raise a doubt')
  expect(viewerLabel(fromPe, 'pe1', 'PE', 0, names)).toBe('Submitted new candidate to Shubham')
  expect(viewerLabel(fromPe, 'admin', 'Admin', 0, names)).toBe('Pending – new candidate from Bhavya: send, reject or raise a doubt')

  const sent = app({ stage: 'new_submission', pmStatus: 'submitted_to_ct', clientTeamStatus: 'pending_new_submission' })
  expect(pmLabel(sent, 0, names)).toBe('Submitted CV to Vanshika')
  expect(ctLabel(sent, 0, names)).toBe('Pending – New submission from Shubham')

  const dates = app({ stage: 'rescheduling', pmStatus: 'candidate_dates_submitted', clientTeamStatus: 'client_dates_submitted', currentInterviewRound: 2 })
  expect(pmLabel(dates, 0, names)).toBe('Round 2 – New candidate dates submitted – waiting for Vanshika')
  expect(ctLabel(dates, 0, names)).toBe('Round 2 – New client dates submitted – waiting for Shubham (candidate dates)')
})

it('falls back to the role when the name is unknown', () => {
  const sent = app({ stage: 'new_submission', pmStatus: 'submitted_to_ct', clientTeamStatus: 'pending_new_submission', assignedPM: 'gone' })
  expect(ctLabel(sent, 0, names)).toBe('Pending – New submission from PM')
  expect(pmLabel(sent)).toBe('Submitted CV to Client Team')
})
