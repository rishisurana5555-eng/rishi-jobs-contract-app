/**
 * Workflow engine. Pure functions: given the current record and an action, return
 * every write needed (application doc, availability rounds, interviews, timeline).
 * The backends apply the whole plan in one transaction, so stage, both side
 * statuses, nextActionBy and the timeline entry can never drift apart.
 */
import type {
  ActorRole,
  Application,
  AvailabilityRound,
  CandidateProfile,
  Interview,
  InterviewMode,
  Role,
  Side,
  Slot,
  Stage,
  TimelineEntry,
  TimelineType,
} from '../types'
import { cleanSlots, endOfDay, fmtDateTime } from './dates'
import { properName } from './names'
import {
  beforeClientTeam,
  DEBRIEF_AFTER_MS,
  deriveStatuses,
  hasInterviewToDebrief,
  isClosed,
  optionByCode,
  PE_ANSWER_LABEL,
  PE_REACHED_LABEL,
  PE_SUBMIT_LABEL,
  peAddedLabel,
  sideOf,
  SUBMIT_LABEL,
  type OptionCode,
} from './workflow'

export class WorkflowError extends Error {}

export interface Actor {
  id: string
  name: string
  role: Role | 'System'
}

export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'System', role: 'System' }

/** Details printed on the revised CV. The PE fills them in; the PM can edit them. */
export interface CvDetailsData {
  candidateEmail?: string
  currentSalary?: string
  expectedSalary?: string
  noticePeriod?: string
  recruiterNote?: string
}

export interface SubmitData extends CvDetailsData {
  candidateId: string
  candidateName: string
  candidateContactNumber: string
  /** optional second number */
  candidateAltContactNumber?: string
  revisedCvUrl: string
  revisedCvName: string | null
  originalCvUrl: string | null
  originalCvName?: string | null
  jobId: string
  jobTitle: string
  clientId: string
  clientName: string
  assignedPE: string | null
  assignedClientTeam: string
  /** older forms only: the available dates are now written in the message */
  candidateDates?: Slot[]
}

export interface InterviewInput {
  scheduledAt: number
  mode: InterviewMode
  meetingDetails: string
}

/** A PE adds a candidate for their PM: original CV and details, no revised CV yet. */
export interface PeSubmitData extends CvDetailsData {
  /** an existing candidate being sent to another client (empty/absent = a new candidate) */
  candidateId?: string
  candidateName: string
  candidateContactNumber: string
  /** optional second number */
  candidateAltContactNumber?: string
  originalCvUrl: string
  originalCvName: string | null
  jobId: string
  jobTitle: string
  clientId: string
  clientName: string
  /** the PM the job opening is assigned to */
  assignedPM: string
  /** the client's Client Team member, who follows the candidate's status before it reaches them */
  watchClientTeam?: string
  /** older forms only: the available dates are now written in the message */
  candidateDates?: Slot[]
}

/** Candidates only enter the workflow through a PE (pe_submit); their PM then sends them on (send_to_ct). */
export type Action =
  | { kind: 'pe_submit'; data: PeSubmitData; message?: string }
  /** PM: revised CV + (possibly edited) details of a PE's candidate → Client Team */
  | { kind: 'send_to_ct'; data: SubmitData; message?: string; /** why the PM selected the candidate */ reason: string }
  /** PM, on a PE's candidate: reject it (message = the reason) */
  | { kind: 'pm_reject'; message: string }
  /** PM, on a PE's candidate: the candidate is not answering (message = the reason / details); stays with the PM, the PE is told */
  | { kind: 'pm_unanswered'; message: string }
  /** PM, on a PE's candidate: ask the PE a question before deciding */
  | { kind: 'pm_query'; message: string }
  /** PM: generated the revised CV, checked it and confirmed it (a history entry only; nothing else changes, nobody is alerted) */
  | { kind: 'cv_checked'; fileName: string }
  /** PM: clicked "Generate revised CV" and got the revised CV back (a history entry only; nobody is alerted) */
  | { kind: 'cv_generated'; fileName: string }
  /** Client Team: opened / downloaded the revised CV (a history entry only; nobody is alerted) */
  | { kind: 'cv_downloaded' }
  /** Client Team: ask the PM a question about the candidate; it is the PM's turn until they answer (the status doesn't move) */
  | { kind: 'ct_doubt'; message: string }
  /** PM: answer the Client Team's doubt */
  | { kind: 'ct_doubt_answer'; message: string }
  /** PE: answer the PM's question; the candidate goes back to the PM */
  | { kind: 'pe_answer'; message: string }
  /** PE or PM: the candidate backed out, at any point (message = the reason); closes the record */
  | { kind: 'candidate_backout'; message: string }
  | {
      kind: 'status'
      code: OptionCode
      message?: string
      clientDates?: Slot[]
      candidateDates?: Slot[]
      interview?: InterviewInput
      debrief?: string
      /** client_asked_wait / candidate_asked_wait: answer expected by this time */
      waitUntil?: number
    }
  | { kind: 'save_client_dates'; clientDates?: Slot[]; message: string }
  | { kind: 'note'; message: string }
  /** write/edit a debrief for any held interview (PM → candidate debrief, Client Team → client debrief) */
  | { kind: 'save_debrief'; interviewId: string; debrief: string }
  | { kind: 'auto_debrief' }

export interface EngineContext {
  app: Application | null
  /** the availability round doc for app.currentInterviewRound / app.currentAttempt */
  round: AvailabilityRound | null
  /** the interview doc for app.currentInterviewId */
  interview: Interview | null
  /** save_debrief only: the interview doc for action.interviewId */
  targetInterview?: Interview | null
  actor: Actor
  now: number
  /** id for a new application (pe_submit only) */
  newId?: string
  /** pe_submit of a new candidate: the next candidate ID (CN-0001, CN-0002, …) */
  newCandidateId?: string
}

export interface WritePlan {
  app: Application
  isNew: boolean
  rounds: { id: string; data: Partial<AvailabilityRound> }[]
  interviews: { id: string; data: Partial<Interview> }[]
  timeline: Omit<TimelineEntry, 'id'>[]
  /** the candidate's profile, merged into candidates/{id} */
  candidate?: { id: string; data: Partial<CandidateProfile> }
}

export const roundDocId = (round: number, attempt: number) => `r${round}-a${attempt}`

const participants = (app: Application) =>
  [...new Set([app.assignedPM, app.assignedClientTeam, app.assignedPE].filter((x): x is string => !!x))]

const digits = (s: string) => s.replace(/\D/g, '')

/** Cleans slots and checks time windows; empty is allowed. */
function validSlots(slots: Slot[] | undefined): Slot[] {
  const clean = cleanSlots(slots ?? [])
  for (const s of clean) {
    if (s.to && !s.from) throw new WorkflowError('Each time window needs a start time.')
    if (s.from && s.to && s.to <= s.from) throw new WorkflowError('Each time window must end after it starts.')
  }
  return clean
}

function requireText(text: string | undefined, what: string): string {
  const t = (text ?? '').trim()
  if (!t) throw new WorkflowError(`${what} is required.`)
  return t
}

function newRound(round: number, attempt: number, now: number, candidateDates: Slot[] = []): AvailabilityRound {
  return {
    id: roundDocId(round, attempt),
    interviewRound: round,
    attemptNumber: attempt,
    candidateDates,
    clientDates: [],
    matchResult: 'pending',
    createdAt: now,
    updatedAt: now,
  }
}

/** Writes stage-derived fields: both side statuses and nextActionBy. */
function applyDerived(app: Application) {
  const d = deriveStatuses(app.stage, app.pmDatesSubmitted, app.pmDebriefDone, app.ctDatesSubmitted ?? false)
  app.pmStatus = d.pmStatus
  app.clientTeamStatus = d.clientTeamStatus
  app.nextActionBy = d.next
    .map((s) => (s === 'PM' ? app.assignedPM : s === 'PE' ? (app.assignedPE ?? '') : app.assignedClientTeam))
    .filter(Boolean)
  // An open doubt from the Client Team is the PM's to answer, whatever the status.
  if (app.ctDoubt && !isClosed(app.stage) && !app.nextActionBy.includes(app.assignedPM)) app.nextActionBy.push(app.assignedPM)
}

/** The available dates are written in the message box, so wherever dates are needed the message is required. */
function requireDatesMessage(message: string | undefined, whose: string): string {
  const t = (message ?? '').trim()
  if (!t) throw new WorkflowError(`Write the ${whose} available dates in the message box.`)
  return t
}

/** Salaries are in LPA: digits with an optional decimal point (same rule as the CV editor). */
const SALARY_RE = /^\d+(\.\d+)?$/

/** Checks and cleans what every candidate needs: when the PE adds it and when the PM sends it on. */
function candidateBasics(
  d: CvDetailsData & { candidateName: string; candidateContactNumber: string; candidateAltContactNumber?: string; candidateDates?: Slot[] },
) {
  const candidateName = properName(requireText(d.candidateName, 'Candidate name'))
  const contact = requireText(d.candidateContactNumber, 'Candidate contact number')
  if (digits(contact).length < 10) throw new WorkflowError('Enter a valid candidate contact number (at least 10 digits).')
  const altContact = (d.candidateAltContactNumber ?? '').trim()
  if (altContact && digits(altContact).length < 10) throw new WorkflowError('Enter a valid second contact number (at least 10 digits), or leave it blank.')
  if (altContact && digits(altContact) === digits(contact)) throw new WorkflowError('The second contact number is the same as the first one.')
  const extras: Required<CvDetailsData> = {
    candidateEmail: (d.candidateEmail ?? '').trim(),
    currentSalary: (d.currentSalary ?? '').trim(),
    expectedSalary: (d.expectedSalary ?? '').trim(),
    noticePeriod: (d.noticePeriod ?? '').trim(),
    recruiterNote: (d.recruiterNote ?? '').trim(),
  }
  for (const [label, v] of [['Current salary', extras.currentSalary], ['Expected salary', extras.expectedSalary]] as const)
    if (v && !SALARY_RE.test(v)) throw new WorkflowError(`${label} must be in LPA — digits only, decimals allowed (e.g. 18 or 18.5).`)
  if (extras.candidateEmail && !/^\S+@\S+\.\S+$/.test(extras.candidateEmail)) throw new WorkflowError('Enter a valid candidate email, or leave it blank.')
  return { candidateName, contact, altContact, extras, candidateDates: validSlots(d.candidateDates) }
}

function requirePlacement(d: Pick<SubmitData, 'clientId' | 'jobId' | 'assignedClientTeam'>) {
  if (!d.clientId || !d.jobId) throw new WorkflowError('Choose the client and job opening.')
  if (!d.assignedClientTeam) throw new WorkflowError('This client has no Client Team member assigned. Ask Admin to set one.')
}

type FreshFields = Pick<
  Application,
  | 'candidateId'
  | 'candidateName'
  | 'candidateContactNumber'
  | 'candidateAltContactNumber'
  | 'originalCvUrl'
  | 'originalCvName'
  | 'revisedCvUrl'
  | 'revisedCvName'
  | 'jobId'
  | 'jobTitle'
  | 'clientId'
  | 'clientName'
  | 'assignedPE'
  | 'assignedPM'
  | 'assignedClientTeam'
  | 'watchClientTeam'
  | 'stage'
  | 'latestCandidateDates'
  | 'latestMessage'
  | 'lastActionLabel'
> &
  Required<CvDetailsData>

/** A record at the start of the workflow (no interview history yet), last changed by `actor`. */
function freshApp(id: string, now: number, actor: Actor, fields: FreshFields): Application {
  const app: Application = {
    ...fields,
    id,
    pmStatus: 'submitted_to_ct',
    clientTeamStatus: 'pending_new_submission',
    currentInterviewRound: 1,
    currentAttempt: 1,
    currentInterviewId: null,
    pmDatesSubmitted: true,
    ctDatesSubmitted: false,
    pmDebriefDone: false,
    latestClientDates: [],
    scheduledInterviewAt: null,
    interviewEndsAt: null,
    outcome: null,
    clientWaitUntil: null,
    candidateWaitUntil: null,
    createdAt: now,
    createdBy: actor.id,
    stageSince: now,
    ctStatusSince: now,
    lastUpdatedBy: actor.id,
    lastUpdatedByName: actor.name,
    lastUpdatedAt: now,
    lastActionMessage: fields.latestMessage,
    // Both the PE's first note and the PM's message to the Client Team are the candidate's available dates.
    availabilityNote: fields.latestMessage,
    peAnswered: false,
    lastActionType: 'status_change',
    unreadFor: [],
    nextActionBy: [],
    notificationType: 'action_required',
  }
  applyDerived(app)
  app.unreadFor = participants(app).filter((id) => id !== actor.id)
  return app
}

/** "Revised CV uploaded" + "Submitted CV to Client Team" (with the candidate dates), by the PM. */
function submittedToCtTimeline(actor: Actor, now: number, fromStage: Stage | null, revisedCvName: string | null | undefined, message: string, dates: Slot[] | null) {
  const base = { side: 'PM' as const, interviewRound: 1, actor: actor.id, actorName: actor.name, actorRole: 'PM' as const }
  const entries: Omit<TimelineEntry, 'id'>[] = [
    {
      ...base,
      type: 'cv_upload',
      fromStage: null,
      toStage: null,
      statusCode: null,
      statusLabel: `Revised CV uploaded${revisedCvName ? `: ${revisedCvName}` : ''}`,
      message: '',
      dates: null,
      timestamp: now,
    },
    {
      ...base,
      type: 'status_change',
      fromStage,
      toStage: 'new_submission',
      statusCode: 'submitted_to_ct',
      statusLabel: SUBMIT_LABEL,
      message,
      dates,
      timestamp: now + 1,
    },
  ]
  return entries
}

/** The candidate's own details, as kept on their profile. */
function profileDetails(app: Application): Partial<CandidateProfile> {
  return {
    candidateName: app.candidateName,
    candidateContactNumber: app.candidateContactNumber,
    candidateAltContactNumber: app.candidateAltContactNumber ?? '',
    candidateEmail: app.candidateEmail ?? '',
    originalCvUrl: app.originalCvUrl,
    originalCvName: app.originalCvName ?? null,
    currentSalary: app.currentSalary ?? '',
    expectedSalary: app.expectedSalary ?? '',
    noticePeriod: app.noticePeriod ?? '',
    recruiterNote: app.recruiterNote ?? '',
  }
}

/** A PE adds a candidate for a job opening assigned to them. It goes to that job's PM (stage pe_submitted); the Client Team member only follows it until the PM sends it on. */
function planPeSubmit(ctx: EngineContext, action: Extract<Action, { kind: 'pe_submit' }>): WritePlan {
  const { actor, now } = ctx
  if (actor.role !== 'PE') throw new WorkflowError('Only a PE can add a candidate for their PM.')
  if (!ctx.newId) throw new WorkflowError('Missing id for the new record.')
  const d = action.data
  const { candidateName, contact, altContact, extras, candidateDates } = candidateBasics(d)
  const originalCvUrl = requireText(d.originalCvUrl, 'Original CV')
  if (!d.clientId || !d.jobId) throw new WorkflowError('Choose the client and job opening.')
  if (!d.assignedPM) throw new WorkflowError('This job opening has no PM yet. Ask Admin to assign it to a PM.')
  requireText(extras.recruiterNote, 'Recruiter note')
  const message = requireDatesMessage(action.message, 'candidate’s')

  const existing = (d.candidateId ?? '').trim()
  const candidateId = existing || ctx.newCandidateId || `C-${ctx.newId.slice(0, 6).toUpperCase()}`
  const app = freshApp(ctx.newId, now, actor, {
    candidateId,
    candidateName,
    candidateContactNumber: contact,
    candidateAltContactNumber: altContact,
    originalCvUrl,
    originalCvName: d.originalCvName || null,
    revisedCvUrl: '',
    revisedCvName: null,
    jobId: d.jobId,
    jobTitle: d.jobTitle,
    clientId: d.clientId,
    clientName: d.clientName,
    assignedPE: actor.id,
    assignedPM: d.assignedPM,
    // Set when the PM sends the candidate on; until then the Client Team member only follows it.
    assignedClientTeam: '',
    watchClientTeam: d.watchClientTeam ?? '',
    stage: 'pe_submitted',
    latestCandidateDates: candidateDates,
    latestMessage: message,
    lastActionLabel: peAddedLabel(actor.name),
    ...extras,
  })
  const base = { side: 'PE' as const, interviewRound: 1, actor: actor.id, actorName: actor.name, actorRole: 'PE' as const }
  const profile: Partial<CandidateProfile> = {
    ...profileDetails(app),
    pe: actor.id,
    pm: d.assignedPM,
    people: [actor.id, d.assignedPM],
    updatedAt: now,
    ...(existing ? {} : { createdAt: now, createdBy: actor.id }),
  }
  return {
    app,
    isNew: true,
    candidate: { id: candidateId, data: profile },
    rounds: [{ id: roundDocId(1, 1), data: newRound(1, 1, now, candidateDates) }],
    interviews: [],
    timeline: [
      {
        ...base,
        type: 'cv_upload',
        fromStage: null,
        toStage: null,
        statusCode: null,
        statusLabel: existing
          ? `Existing candidate sent to ${d.clientName} – ${d.jobTitle}`
          : `Original CV uploaded${d.originalCvName ? `: ${d.originalCvName}` : ''}`,
        message: '',
        dates: null,
        timestamp: now,
      },
      {
        ...base,
        type: 'status_change',
        fromStage: null,
        toStage: 'pe_submitted',
        statusCode: 'pe_submitted',
        statusLabel: PE_SUBMIT_LABEL,
        message,
        dates: candidateDates.length ? candidateDates : null,
        timestamp: now + 1,
      },
    ],
  }
}

/** The PM sends a PE's candidate to the Client Team with the revised CV; the usual workflow runs from here. */
function planSendToCt(ctx: EngineContext, action: Extract<Action, { kind: 'send_to_ct' }>): WritePlan {
  const { actor, now } = ctx
  const prev = ctx.app
  if (!prev) throw new WorkflowError('Record not found.')
  if (prev.assignedPM !== actor.id) throw new WorkflowError('Only the assigned PM can send this candidate to the Client Team.')
  if (prev.stage !== 'pe_submitted') throw new WorkflowError('This candidate has already been sent to the Client Team.')
  const d = action.data
  const { candidateName, contact, altContact, extras, candidateDates } = candidateBasics(d)
  const revisedCvUrl = requireText(d.revisedCvUrl, 'Revised CV')
  requirePlacement(d)
  const message = requireDatesMessage(action.message, 'candidate’s')
  const reason = requireText(action.reason, 'The reason for selection')

  const app = freshApp(prev.id, now, actor, {
    candidateId: prev.candidateId,
    candidateName,
    candidateContactNumber: contact,
    candidateAltContactNumber: altContact,
    originalCvUrl: prev.originalCvUrl,
    originalCvName: prev.originalCvName ?? null,
    revisedCvUrl,
    revisedCvName: d.revisedCvName || null,
    jobId: d.jobId,
    jobTitle: d.jobTitle,
    clientId: d.clientId,
    clientName: d.clientName,
    assignedPE: prev.assignedPE,
    assignedPM: prev.assignedPM,
    assignedClientTeam: d.assignedClientTeam,
    watchClientTeam: d.assignedClientTeam,
    stage: 'new_submission',
    // Dates entered on older forms are kept; new ones are written in the message.
    latestCandidateDates: candidateDates.length ? candidateDates : prev.latestCandidateDates,
    latestMessage: message,
    lastActionLabel: SUBMIT_LABEL,
    ...extras,
  })
  // The record was created by the PE; keep that.
  app.createdAt = prev.createdAt
  app.createdBy = prev.createdBy
  app.lastActionMessage = message
  app.selectionReason = reason
  return {
    app,
    isNew: false,
    // The PM's corrections apply to the candidate everywhere.
    candidate: { id: app.candidateId, data: { ...profileDetails(app), updatedAt: now } },
    rounds: candidateDates.length ? [{ id: roundDocId(1, 1), data: { candidateDates, updatedAt: now } }] : [],
    interviews: [],
    timeline: [
      // The PM's decision first, with the reason for it; then the revised CV and the send.
      {
        type: 'status_change',
        side: 'PM',
        fromStage: 'pe_submitted',
        toStage: null,
        statusCode: 'pm_select',
        statusLabel: `Selected by PM ${actor.name}`,
        message: reason,
        dates: null,
        interviewRound: 1,
        actor: actor.id,
        actorName: actor.name,
        actorRole: 'PM',
        timestamp: now - 1,
      },
      ...submittedToCtTimeline(actor, now, 'pe_submitted', d.revisedCvName, message, candidateDates.length ? candidateDates : null),
    ],
  }
}

export function planAction(ctx: EngineContext, action: Action): WritePlan {
  if (action.kind === 'pe_submit') return planPeSubmit(ctx, action)
  if (action.kind === 'send_to_ct') return planSendToCt(ctx, action)

  const { actor, now } = ctx
  const prev = ctx.app
  if (!prev) throw new WorkflowError('Record not found.')

  const isSystem = actor.role === 'System'
  const side: Side | null = isSystem ? null : sideOf(prev, actor.id)
  // The PE only acts on a record to answer their PM's question.
  // The PE acts on a record only to answer their PM's question or to report that the candidate backed out.
  const isPeAct = actor.role === 'PE' && prev.assignedPE === actor.id && (action.kind === 'pe_answer' || action.kind === 'candidate_backout')
  if (action.kind === 'pe_answer' && !isPeAct) throw new WorkflowError('Only the PE who added this candidate can answer.')
  if (action.kind === 'candidate_backout' && !isPeAct && side !== 'PM') throw new WorkflowError('Only the PE or the PM can mark a candidate backout.')
  if (!isSystem && !side && !isPeAct) throw new WorkflowError('Only the assigned PM or Client Team member can update this record.')

  const app: Application = { ...prev }
  const rounds: WritePlan['rounds'] = []
  const interviews: WritePlan['interviews'] = []
  const curRoundId = roundDocId(prev.currentInterviewRound, prev.currentAttempt)
  const message = 'message' in action ? (action.message ?? '').trim() : ''

  let type: TimelineType
  let statusCode: string | null = null
  let statusLabel: string
  let dates: Slot[] | null = null
  let entryRound = prev.currentInterviewRound
  let debriefText = ''

  const startNewAttempt = (round: number, attempt: number) => {
    app.currentInterviewRound = round
    app.currentAttempt = attempt
    app.pmDatesSubmitted = false
    app.ctDatesSubmitted = false
    rounds.push({ id: roundDocId(round, attempt), data: newRound(round, attempt, now) })
  }

  switch (action.kind) {
    case 'note': {
      requireText(action.message, 'Note')
      type = 'note'
      statusLabel = 'Note'
      break
    }

    case 'pm_reject':
    case 'pm_query': {
      if (side !== 'PM') throw new WorkflowError('Only the assigned PM can do this.')
      if (prev.stage !== 'pe_submitted') throw new WorkflowError('This candidate is no longer waiting for your decision. Please refresh.')
      const reject = action.kind === 'pm_reject'
      requireText(action.message, reject ? 'The reason for rejecting' : 'Your question')
      type = 'status_change'
      statusCode = action.kind
      if (reject) {
        app.stage = 'closed_rejected'
        app.outcome = 'rejected'
        statusLabel = `Rejected by PM ${actor.name}`
      } else {
        app.stage = 'pe_query'
        app.peAnswered = false
        app.peUnanswered = false
        statusLabel = `PM ${actor.name} raised a doubt`
      }
      break
    }

    // The PM could not reach the candidate: it goes to the PE (their turn) to reach them, like a doubt.
    case 'pm_unanswered': {
      if (side !== 'PM') throw new WorkflowError('Only the assigned PM can do this.')
      if (prev.stage !== 'pe_submitted') throw new WorkflowError('This candidate is no longer waiting for your decision. Please refresh.')
      requireText(action.message, 'The reason')
      app.stage = 'pe_query'
      app.peAnswered = false
      app.peUnanswered = true
      type = 'status_change'
      statusCode = 'pm_unanswered'
      statusLabel = `Marked unanswered by PM ${actor.name}`
      break
    }

    case 'candidate_backout': {
      if (isClosed(prev.stage)) throw new WorkflowError('This record is already closed.')
      app.backoutReason = requireText(action.message, 'The reason for the backout')
      app.stage = 'closed_backout'
      app.outcome = 'backout'
      type = 'status_change'
      statusCode = 'candidate_backout'
      statusLabel = `Candidate backout (marked by ${isPeAct ? 'PE' : 'PM'} ${actor.name})`
      break
    }

    case 'cv_checked': {
      if (side !== 'PM') throw new WorkflowError('Only the assigned PM revises the CV.')
      if (prev.stage !== 'pe_submitted') throw new WorkflowError('This candidate has already been sent to the Client Team.')
      type = 'cv_upload'
      statusCode = 'cv_checked'
      statusLabel = `Revised CV made and checked by PM ${actor.name}${action.fileName ? ` (${action.fileName})` : ''}`
      break
    }

    case 'cv_generated': {
      if (side !== 'PM') throw new WorkflowError('Only the assigned PM revises the CV.')
      if (prev.stage !== 'pe_submitted') throw new WorkflowError('This candidate has already been sent to the Client Team.')
      type = 'cv_upload'
      statusCode = 'cv_generated'
      statusLabel = `Revised CV generated by PM ${actor.name}${action.fileName ? ` (${action.fileName})` : ''}`
      break
    }

    case 'cv_downloaded': {
      if (side !== 'ClientTeam') throw new WorkflowError('Only the Client Team member on this candidate can do this.')
      if (!prev.revisedCvUrl) throw new WorkflowError('There is no revised CV yet.')
      type = 'cv_upload'
      statusCode = 'cv_downloaded'
      statusLabel = `Revised CV downloaded by ${actor.name}`
      break
    }

    case 'ct_doubt': {
      if (side !== 'ClientTeam') throw new WorkflowError('Only the Client Team member on this candidate can raise a doubt with the PM.')
      if (isClosed(prev.stage) || beforeClientTeam(prev.stage)) throw new WorkflowError('A doubt can only be raised while the candidate is with the Client Team.')
      if (prev.ctDoubt) throw new WorkflowError('Your earlier doubt is still waiting for the PM’s answer.')
      const text = requireText(action.message, 'Your question')
      app.ctDoubt = { text, at: now, by: actor.id, byName: actor.name }
      type = 'note'
      statusCode = 'ct_doubt'
      statusLabel = `Client Team ${actor.name} raised a doubt`
      break
    }

    case 'ct_doubt_answer': {
      if (side !== 'PM') throw new WorkflowError('Only the assigned PM can answer the Client Team’s doubt.')
      if (!prev.ctDoubt) throw new WorkflowError('There is no open doubt from the Client Team. Please refresh.')
      const answer = requireText(action.message, 'Your answer')
      app.lastCtDoubt = { ...prev.ctDoubt, answer, answeredAt: now, answeredByName: actor.name }
      app.ctDoubt = null
      type = 'note'
      statusCode = 'ct_doubt_answer'
      statusLabel = `PM ${actor.name} answered the Client Team’s doubt`
      break
    }

    case 'pe_answer': {
      if (prev.stage !== 'pe_query') throw new WorkflowError('There is nothing from the PM waiting for your reply. Please refresh.')
      requireText(action.message, prev.peUnanswered ? 'Your message to the PM' : 'Your answer')
      app.stage = 'pe_submitted'
      app.peAnswered = true
      type = 'status_change'
      statusCode = prev.peUnanswered ? 'pe_reached' : 'pe_answer'
      statusLabel = prev.peUnanswered ? PE_REACHED_LABEL : PE_ANSWER_LABEL
      break
    }

    case 'auto_debrief': {
      if (prev.stage !== 'interview_scheduled') throw new WorkflowError('Interview is no longer scheduled.')
      if (!prev.interviewEndsAt || prev.interviewEndsAt > now) throw new WorkflowError('Interview time has not passed yet.')
      if (prev.currentInterviewId) interviews.push({ id: prev.currentInterviewId, data: { status: 'completed' } })
      app.stage = 'debrief_pending'
      app.pmDebriefDone = false
      type = 'system'
      statusCode = 'debrief_pending'
      statusLabel = 'Interview time passed – debrief pending on both sides'
      break
    }

    case 'save_client_dates': {
      if (side !== 'ClientTeam') throw new WorkflowError('Only the Client Team enters client dates.')
      if (prev.stage !== 'cv_with_client' && prev.stage !== 'rescheduling')
        throw new WorkflowError('Client dates can only be entered before the interview is scheduled.')
      requireDatesMessage(action.message, 'client’s')
      const clientDates = validSlots(action.clientDates)
      if (clientDates.length) {
        app.latestClientDates = clientDates
        rounds.push({ id: curRoundId, data: { clientDates, updatedAt: now } })
        dates = clientDates
      }
      if (prev.stage === 'rescheduling') app.ctDatesSubmitted = true
      type = 'availability_update'
      statusLabel = 'Client available dates sent'
      break
    }

    case 'save_debrief': {
      const iv = ctx.targetInterview
      if (!iv || iv.id !== action.interviewId) throw new WorkflowError('Interview not found.')
      if (iv.status === 'cancelled') throw new WorkflowError('This interview was rescheduled; add the debrief to the interview that took place.')
      if (iv.status !== 'completed' && iv.scheduledAt > now) throw new WorkflowError('The debrief can be written once the interview has started.')
      const text = requireText(action.debrief, 'Debrief')
      const isPm = side === 'PM'
      interviews.push({ id: iv.id, data: isPm ? { candidateDebrief: text, candidateDebriefAt: now } : { clientDebrief: text, clientDebriefAt: now } })
      if (isPm && prev.stage === 'debrief_pending' && iv.id === prev.currentInterviewId) app.pmDebriefDone = true
      type = 'debrief'
      entryRound = iv.interviewRound
      statusLabel = `Round ${iv.interviewRound} ${isPm ? 'candidate' : 'client'} debrief saved`
      debriefText = text
      break
    }

    case 'status': {
      const opt = optionByCode(action.code)
      if (opt.side !== side) throw new WorkflowError(`"${opt.label}" can only be set by the ${opt.side === 'PM' ? 'PM' : 'Client Team'}.`)
      if (!opt.stages.includes(prev.stage) || !(opt.available?.(prev) ?? true))
        throw new WorkflowError(`"${opt.label}" is not allowed at this stage. The record may have just been updated — please refresh.`)
      statusCode = opt.code
      statusLabel = opt.label
      type = 'status_change'

      switch (opt.code) {
        case 'cv_submitted_to_client':
          app.stage = 'cv_with_client'
          break

        case 'interview_scheduled': {
          const clientDates = validSlots(action.clientDates)
          const iv = action.interview
          if (!iv || !iv.scheduledAt) throw new WorkflowError('Pick the interview date and time.')
          if (endOfDay(iv.scheduledAt) < now) throw new WorkflowError('The interview date has already passed.')
          const interviewId = curRoundId
          const endsAt = iv.scheduledAt + DEBRIEF_AFTER_MS
          rounds.push({ id: curRoundId, data: { ...(clientDates.length ? { clientDates } : {}), matchResult: 'matched', updatedAt: now } })
          interviews.push({
            id: interviewId,
            data: {
              id: interviewId,
              interviewRound: prev.currentInterviewRound,
              attemptNumber: prev.currentAttempt,
              scheduledAt: iv.scheduledAt,
              endsAt,
              mode: iv.mode,
              meetingDetails: iv.meetingDetails.trim(),
              status: 'scheduled',
              candidateDebrief: null,
              clientDebrief: null,
              candidateDebriefAt: null,
              clientDebriefAt: null,
              createdAt: now,
            },
          })
          if (clientDates.length) app.latestClientDates = clientDates
          app.scheduledInterviewAt = iv.scheduledAt
          app.interviewEndsAt = endsAt
          app.currentInterviewId = interviewId
          app.stage = 'interview_scheduled'
          type = 'interview'
          statusLabel = `Interview scheduled at ${fmtDateTime(iv.scheduledAt)} (${iv.mode})`
          dates = clientDates.length ? clientDates : null
          break
        }

        case 'dates_mismatch': {
          requireDatesMessage(action.message, 'client’s new')
          const clientDates = validSlots(action.clientDates)
          rounds.push({ id: curRoundId, data: { ...(clientDates.length ? { clientDates } : {}), matchResult: 'no-match', updatedAt: now } })
          if (clientDates.length) {
            app.latestClientDates = clientDates
            dates = clientDates
          }
          startNewAttempt(prev.currentInterviewRound, prev.currentAttempt + 1)
          app.stage = 'rescheduling'
          break
        }

        case 'new_candidate_dates': {
          requireDatesMessage(action.message, 'candidate’s new')
          const candidateDates = validSlots(action.candidateDates)
          if (candidateDates.length) {
            rounds.push({ id: curRoundId, data: { candidateDates, updatedAt: now } })
            app.latestCandidateDates = candidateDates
            dates = candidateDates
          }
          app.pmDatesSubmitted = true
          type = 'availability_update'
          break
        }

        case 'reschedule': {
          if (prev.currentInterviewId) interviews.push({ id: prev.currentInterviewId, data: { status: 'cancelled' } })
          app.scheduledInterviewAt = null
          app.interviewEndsAt = null
          app.currentInterviewId = null
          startNewAttempt(prev.currentInterviewRound, prev.currentAttempt + 1)
          app.stage = 'rescheduling'
          type = 'interview'
          break
        }

        case 'candidate_debrief': {
          const debrief = requireText(action.debrief, 'Candidate debrief')
          if (prev.currentInterviewId)
            interviews.push({ id: prev.currentInterviewId, data: { candidateDebrief: debrief, candidateDebriefAt: now } })
          app.pmDebriefDone = true
          type = 'debrief'
          break
        }

        case 'client_asked_wait':
        case 'candidate_asked_wait': {
          if (!action.waitUntil) throw new WorkflowError('Pick the date and time they asked you to wait till.')
          if (action.waitUntil <= now) throw new WorkflowError('The waiting time must be in the future.')
          // Only this side's reminders pause; the other side keeps its own pending work and reminders.
          if (opt.code === 'client_asked_wait') app.clientWaitUntil = action.waitUntil
          else app.candidateWaitUntil = action.waitUntil
          statusLabel = `${opt.code === 'client_asked_wait' ? 'Client' : 'Candidate'} asked to wait till ${fmtDateTime(action.waitUntil)}`
          break
        }

        case 'next_round':
        case 'candidate_placed':
        case 'candidate_rejected': {
          const needsDebrief = hasInterviewToDebrief(prev.stage)
          const debrief = needsDebrief ? requireText(action.debrief, 'Client debrief') : (action.debrief ?? '').trim()
          const nextDates = opt.code === 'next_round' ? validSlots(action.clientDates) : []
          if (prev.currentInterviewId && (debrief || prev.stage === 'interview_scheduled'))
            interviews.push({
              id: prev.currentInterviewId,
              data: {
                ...(debrief ? { clientDebrief: debrief, clientDebriefAt: now } : {}),
                ...(prev.stage === 'interview_scheduled' ? { status: 'completed' as const } : {}),
              },
            })
          if (needsDebrief) type = 'debrief'
          if (opt.code === 'next_round') {
            startNewAttempt(prev.currentInterviewRound + 1, 1)
            app.pmDebriefDone = false
            app.scheduledInterviewAt = null
            app.interviewEndsAt = null
            app.currentInterviewId = null
            app.latestCandidateDates = []
            app.latestClientDates = nextDates
            if (nextDates.length) {
              // Client already gave dates for the next round: only the candidate's dates are pending.
              app.ctDatesSubmitted = true
              Object.assign(rounds[rounds.length - 1].data, { clientDates: nextDates })
              dates = nextDates
            }
            app.stage = 'rescheduling'
          } else if (opt.code === 'candidate_placed') {
            app.stage = 'closed_placed'
            app.outcome = 'placed'
          } else {
            app.stage = 'closed_rejected'
            app.outcome = 'rejected'
          }
          break
        }
      }
      break
    }
  }

  applyDerived(app)
  if (isClosed(app.stage) && !isClosed(prev.stage)) app.closedFromStage = prev.stage
  // A closed candidate needs no answer any more.
  if (isClosed(app.stage)) app.ctDoubt = null
  // A waiting period only belongs to the stage it was agreed in; the candidate's ends with their debrief.
  if (app.stage !== prev.stage) {
    app.clientWaitUntil = null
    app.candidateWaitUntil = null
  } else if (app.pmDebriefDone && !prev.pmDebriefDone) {
    app.candidateWaitUntil = null
  }
  if (app.pmStatus !== prev.pmStatus || app.clientTeamStatus !== prev.clientTeamStatus) app.stageSince = now
  if (app.clientTeamStatus !== prev.clientTeamStatus) app.ctStatusSince = now

  // A history-only entry (the PM generated / checked the revised CV, the Client Team downloaded it)
  // alerts nobody; a doubt between the Client Team and the PM, and its answer, only the other of the two.
  const recipients =
    action.kind === 'cv_checked' || action.kind === 'cv_generated' || action.kind === 'cv_downloaded'
      ? []
      : action.kind === 'ct_doubt'
        ? [app.assignedPM]
        : action.kind === 'ct_doubt_answer'
          ? [app.assignedClientTeam]
          : participants(app).filter((id) => id !== actor.id)
  app.unreadFor = [...new Set([...prev.unreadFor, ...recipients])].filter((id) => id !== actor.id)
  app.lastUpdatedBy = actor.id
  app.lastUpdatedByName = actor.name
  app.lastUpdatedAt = now
  app.lastActionLabel = statusLabel
  app.lastActionType = type
  if (message) app.latestMessage = message
  // For a saved debrief with no separate message, the alert shows the debrief itself.
  app.lastActionMessage = message || debriefText
  app.notificationType = app.unreadFor.some((id) => app.nextActionBy.includes(id)) ? 'action_required' : 'informational'

  const actorRole: ActorRole = isSystem ? 'System' : isPeAct ? 'PE' : side!
  return {
    app,
    isNew: false,
    rounds,
    interviews,
    timeline: [
      {
        type,
        side: actorRole,
        fromStage: prev.stage,
        toStage: app.stage,
        statusCode,
        statusLabel,
        message: message || debriefText,
        dates,
        interviewRound: entryRound,
        actor: actor.id,
        actorName: actor.name,
        actorRole,
        timestamp: now,
      },
    ],
  }
}

/** True when the record is waiting for the automatic "interview passed → debrief" move. */
export const needsAutoDebrief = (app: Application, now = Date.now()) =>
  app.stage === 'interview_scheduled' && !!app.interviewEndsAt && app.interviewEndsAt < now
