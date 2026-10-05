/**
 * Workflow configuration — the single place to change stages, status labels
 * and which fixed status options each role may pick at each stage.
 */
import type { Application, CtStatus, PmStatus, Role, Side, Stage } from '../types'
import { fmtDateTime } from './dates'

export const STAGE_NAMES: Record<Stage, string> = {
  pe_submitted: 'New from PE – with PM',
  pe_query: 'Doubt – with PE',
  new_submission: 'New submission',
  cv_with_client: 'CV with client',
  rescheduling: 'Getting new dates',
  interview_scheduled: 'Interview scheduled',
  debrief_pending: 'Debrief pending',
  closed_placed: 'Placed',
  closed_rejected: 'Rejected',
  closed_backout: 'Candidate backout',
}

export const isClosed = (stage: Stage) => stage === 'closed_placed' || stage === 'closed_rejected' || stage === 'closed_backout'

/** A PE's candidate the PM rejected never reached the Client Team (no Client Team member set). */
export const rejectedByPm = (app: Pick<Application, 'stage' | 'assignedClientTeam'>) => app.stage === 'closed_rejected' && !app.assignedClientTeam

/** "Rejected by PM" / "Rejected by client" / "Candidate backout" / "Candidate placed" for a closed record. */
export function outcomeLabel(app: Pick<Application, 'stage' | 'assignedClientTeam'>): string {
  if (app.stage === 'closed_placed') return 'Candidate placed'
  if (app.stage === 'closed_backout') return 'Candidate backout'
  return rejectedByPm(app) ? 'Rejected by PM' : 'Rejected by client'
}

// ---------- side statuses ----------

/** PM status, Client Team status and who must act next — all derived from the stage + two flags. */
export function deriveStatuses(
  stage: Stage,
  pmDatesSubmitted: boolean,
  pmDebriefDone: boolean,
  ctDatesSubmitted = false,
): { pmStatus: PmStatus; clientTeamStatus: CtStatus; next: (Side | 'PE')[] } {
  switch (stage) {
    case 'pe_submitted':
      return { pmStatus: 'pending_pe_submission', clientTeamStatus: 'not_sent_yet', next: ['PM'] }
    case 'pe_query':
      return { pmStatus: 'query_to_pe', clientTeamStatus: 'not_sent_yet', next: ['PE'] }
    case 'new_submission':
      return { pmStatus: 'submitted_to_ct', clientTeamStatus: 'pending_new_submission', next: ['ClientTeam'] }
    case 'cv_with_client':
      return { pmStatus: 'cv_with_client', clientTeamStatus: 'pending_client_dates', next: ['ClientTeam'] }
    case 'rescheduling':
      if (pmDatesSubmitted) return { pmStatus: 'candidate_dates_submitted', clientTeamStatus: 'pending_schedule', next: ['ClientTeam'] }
      return ctDatesSubmitted
        ? { pmStatus: 'pending_candidate_dates', clientTeamStatus: 'client_dates_submitted', next: ['PM'] }
        : { pmStatus: 'pending_candidate_dates', clientTeamStatus: 'pending_new_client_dates', next: ['PM', 'ClientTeam'] }
    case 'interview_scheduled':
      return { pmStatus: 'interview_scheduled', clientTeamStatus: 'interview_scheduled', next: [] }
    case 'debrief_pending':
      return pmDebriefDone
        ? { pmStatus: 'candidate_debrief_received', clientTeamStatus: 'pending_client_debrief', next: ['ClientTeam'] }
        : { pmStatus: 'pending_candidate_debrief', clientTeamStatus: 'pending_client_debrief', next: ['PM', 'ClientTeam'] }
    case 'closed_placed':
      return { pmStatus: 'placed', clientTeamStatus: 'placed', next: [] }
    case 'closed_rejected':
      return { pmStatus: 'rejected', clientTeamStatus: 'rejected', next: [] }
    case 'closed_backout':
      return { pmStatus: 'backout', clientTeamStatus: 'backout', next: [] }
  }
}

const INTERVIEW_TEMPLATE = 'Interview scheduled at {at} – in progress'

export const PM_STATUS_LABELS: Record<PmStatus, string> = {
  pending_pe_submission: 'Pending – new candidate from {pe}: send, reject or raise a doubt',
  query_to_pe: 'Doubt sent to {pe} – waiting for the answer',
  submitted_to_ct: 'Submitted CV to {ct}',
  cv_with_client: 'CV submitted to client',
  pending_candidate_dates: 'Pending – get new available date from candidate',
  candidate_dates_submitted: 'New candidate dates submitted – waiting for {ct}',
  interview_scheduled: INTERVIEW_TEMPLATE,
  pending_candidate_debrief: 'Pending – get debrief from candidate',
  candidate_debrief_received: 'Debrief received from candidate',
  placed: 'Candidate placed',
  rejected: 'Candidate rejected',
  backout: 'Candidate backout',
}

export const CT_STATUS_LABELS: Record<CtStatus, string> = {
  not_sent_yet: 'Not yet sent to Client Team',
  pending_new_submission: 'Pending – New submission from {pm}',
  pending_client_dates: 'CV submitted to client – Pending: get client dates',
  pending_new_client_dates: 'Pending – get new available date from client',
  client_dates_submitted: 'New client dates submitted – waiting for {pm} (candidate dates)',
  pending_schedule: 'Pending – get new available date from client / schedule interview',
  interview_scheduled: INTERVIEW_TEMPLATE,
  pending_client_debrief: 'Pending – get debrief from client',
  placed: 'Candidate placed',
  rejected: 'Candidate rejected',
  backout: 'Candidate backout',
}

type LabelInput = Pick<
  Application,
  'currentInterviewRound' | 'scheduledInterviewAt' | 'clientWaitUntil' | 'candidateWaitUntil' | 'assignedPE' | 'assignedPM' | 'assignedClientTeam' | 'peAnswered' | 'peUnanswered'
>

/** The PM's label once the PE has answered their doubt. */
const PE_ANSWERED_STATUS = '{pe} answered your doubt'
/** The PM marked the candidate unanswered: the PE is reaching them; then the PE says they answered. */
const PM_UNANSWERED_STATUS = 'Unanswered – waiting for {pe} to reach the candidate'
const PE_REACHED_STATUS = 'Pending – {pe} says the candidate answered: connect with them, then send, reject, raise a doubt or mark unanswered'

function pmTemplate(app: LabelInput & { pmStatus: PmStatus }) {
  if (app.pmStatus === 'query_to_pe' && app.peUnanswered) return PM_UNANSWERED_STATUS
  if (app.pmStatus === 'pending_pe_submission' && app.peAnswered) return app.peUnanswered ? PE_REACHED_STATUS : PE_ANSWERED_STATUS
  return PM_STATUS_LABELS[app.pmStatus]
}

/** A person's name by user id (undefined if unknown). Status labels show names instead of "PE", "PM" or "Client Team". */
export type Names = (id: string) => string | undefined

/** {pe}, {pm} and {ct} in a label → that person's name, or the role when unknown / not set yet. */
export function withNames(label: string, app: Pick<Application, 'assignedPE' | 'assignedPM' | 'assignedClientTeam'>, names?: Names) {
  const who = (id: string | null | undefined, role: string) => (id && names?.(id)) || role
  // Every occurrence: a label may name the same person twice.
  return label
    .replace(/\{pe\}/g, who(app.assignedPE, 'PE'))
    .replace(/\{pm\}/g, who(app.assignedPM, 'PM'))
    .replace(/\{ct\}/g, who(app.assignedClientTeam, 'Client Team'))
}

/** Who a side waits on: the PM waits on the candidate, the Client Team on the client. */
export const WAIT_WHO: Record<Side, string> = { PM: 'Candidate', ClientTeam: 'Client' }

/** The waiting period agreed for one side (null if none). */
export const waitUntilFor = (app: Pick<Application, 'clientWaitUntil' | 'candidateWaitUntil'>, side: Side) =>
  (side === 'PM' ? app.candidateWaitUntil : app.clientWaitUntil) ?? null

function fill(template: string, app: LabelInput, now: number, side: Side, names?: Names): string {
  // Rejected: say who rejected it.
  if (template === PM_STATUS_LABELS.rejected) template = app.assignedClientTeam ? 'Rejected by client' : 'Rejected by PM'
  let label = withNames(template, app, names).replace('{at}', app.scheduledInterviewAt ? fmtDateTime(app.scheduledInterviewAt) : '—')
  // This side's agreed waiting period replaces its pending label until it ends, then is shown in front of it.
  const until = waitUntilFor(app, side)
  if (until) {
    const who = WAIT_WHO[side]
    label = until > now ? `${who} asked to wait till ${fmtDateTime(until)}` : `${who}'s waiting time over (${fmtDateTime(until)}) – ${label}`
  }
  if (app.currentInterviewRound >= 2) label = `Round ${app.currentInterviewRound} – ${label}`
  return label
}

export const pmLabel = (app: LabelInput & { pmStatus: PmStatus }, now = Date.now(), names?: Names) =>
  fill(pmTemplate(app), app, now, 'PM', names)
export const ctLabel = (app: LabelInput & { clientTeamStatus: CtStatus }, now = Date.now(), names?: Names) =>
  fill(CT_STATUS_LABELS[app.clientTeamStatus], app, now, 'ClientTeam', names)
export const sideLabel = (app: Application, side: Side, now = Date.now(), names?: Names) =>
  side === 'PM' ? pmLabel(app, now, names) : ctLabel(app, now, names)

// ---------- fixed status options (the dropdown) ----------

export type OptionCode =
  | 'cv_submitted_to_client'
  | 'interview_scheduled'
  | 'dates_mismatch'
  | 'new_candidate_dates'
  | 'reschedule'
  | 'candidate_debrief'
  | 'next_round'
  | 'candidate_placed'
  | 'candidate_rejected'
  | 'client_asked_wait'
  | 'candidate_asked_wait'

/** Extra inputs an option needs. */
export type OptionField =
  | 'interview'
  /** the message box must be filled in: it carries the available dates (there are no separate date inputs) */
  | 'datesInMessage'
  | 'candidateDebrief'
  | 'clientDebrief'
  | 'waitUntil'

export interface StatusOption {
  code: OptionCode
  label: string
  side: Side
  stages: Stage[]
  fields: (app: Application) => OptionField[]
  available?: (app: Application) => boolean
}

export const SUBMIT_LABEL = 'Submitted CV to Client Team'
/** What the PE sees until their PM sends the candidate on (saved as is in the history; shown with the PM's name). */
export const PE_SUBMIT_LABEL = 'Submitted new candidate to PM'
const PE_SUBMIT_STATUS = 'Submitted new candidate to {pm}'
const PE_QUERY_STATUS = 'Pending – {pm} raised a doubt: please answer'
const PE_UNANSWERED_STATUS = 'Pending – {pm} could not reach the candidate: call the candidate and let {pm} know when they answer'
/** What the Client Team member sees while their client's candidate is still with the PE and PM. */
const CT_FOLLOW_STATUS = { pe_submitted: 'New candidate from {pe} – with {pm}, not sent to you yet', pe_query: '{pm} raised a doubt with {pe} – not sent to you yet' } as const
export const PE_ANSWER_LABEL = 'PE answered the doubt'
export const PE_REACHED_LABEL = 'PE: the candidate answered – PM to connect with them'
export const peAddedLabel = (peName: string) => `New candidate added by PE ${peName}`
/** The PM's button on a candidate added by a PE. */
export const SEND_TO_CT_LABEL = 'Send this candidate to Client Team'

/** A candidate added by a PE that this PM still has to reject, question or send to the Client Team. */
export const awaitingSend = (app: Application, userId: string) => app.stage === 'pe_submitted' && app.assignedPM === userId

/** The PM asked this PE a question about their candidate and is waiting for the answer. */
/** The PM marked a PE's candidate unanswered and the PE has not replied for this long: the admins are alerted. */
export const PE_UNANSWERED_ALERT_MS = 48 * 3_600_000
/** When the PE's reply to an "unanswered" became overdue for the admins (null: not overdue). */
export function peUnansweredOverdueAt(app: Application, now: number): number | null {
  if (app.stage !== 'pe_query' || !app.peUnanswered) return null
  const at = app.stageSince + PE_UNANSWERED_ALERT_MS
  return now >= at ? at : null
}

/** The CV is with the client and the Client Team status has not changed for this long: the Super Admin is alerted. */
export const CT_STALE_ALERT_MS = 6 * 86_400_000
const CT_STALE_STAGES: readonly Stage[] = ['cv_with_client', 'rescheduling', 'debrief_pending']
/** Since when the Client Team status has stood still past the limit (null: not stale, or the client asked to wait). */
export function ctStaleSince(app: Application, now: number): number | null {
  if (!CT_STALE_STAGES.includes(app.stage) || (app.clientWaitUntil ?? 0) > now) return null
  const since = app.ctStatusSince ?? app.stageSince
  return now - since >= CT_STALE_ALERT_MS ? since : null
}

export const awaitingPeAnswer = (app: Application, userId: string) => app.stage === 'pe_query' && app.assignedPE === userId

/** Still with the PE and PM — not sent to the Client Team yet. */
export const beforeClientTeam = (stage: Stage) => stage === 'pe_submitted' || stage === 'pe_query'

export const STATUS_OPTIONS: StatusOption[] = [
  {
    code: 'cv_submitted_to_client',
    label: 'CV submitted to client',
    side: 'ClientTeam',
    stages: ['new_submission'],
    fields: () => [],
  },
  {
    code: 'interview_scheduled',
    label: 'Interview scheduled',
    side: 'ClientTeam',
    stages: ['cv_with_client', 'rescheduling'],
    fields: () => ['interview'],
  },
  {
    code: 'dates_mismatch',
    label: "Dates don't match – new dates needed",
    side: 'ClientTeam',
    stages: ['cv_with_client', 'rescheduling'],
    fields: () => ['datesInMessage'],
  },
  {
    code: 'new_candidate_dates',
    label: 'New candidate dates submitted',
    side: 'PM',
    stages: ['rescheduling'],
    fields: () => ['datesInMessage'],
  },
  {
    code: 'reschedule',
    label: 'Reschedule – new dates needed',
    side: 'ClientTeam',
    stages: ['interview_scheduled'],
    fields: () => [],
  },
  {
    code: 'candidate_debrief',
    label: 'Debrief received from candidate',
    side: 'PM',
    stages: ['debrief_pending'],
    fields: () => ['candidateDebrief'],
    available: (app) => !app.pmDebriefDone,
  },
  // Outcomes are available as soon as the interview is scheduled (client feedback can come any time).
  {
    code: 'next_round',
    label: 'Debrief received – next round required',
    side: 'ClientTeam',
    stages: ['interview_scheduled', 'debrief_pending'],
    fields: () => ['clientDebrief'],
  },
  {
    code: 'candidate_placed',
    label: 'Candidate placed',
    side: 'ClientTeam',
    stages: ['interview_scheduled', 'debrief_pending'],
    fields: () => ['clientDebrief'],
  },
  {
    // Also offered before any interview, for when the client rejects the CV outright.
    code: 'candidate_rejected',
    label: 'Candidate rejected',
    side: 'ClientTeam',
    stages: ['cv_with_client', 'rescheduling', 'interview_scheduled', 'debrief_pending'],
    fields: (app) => (hasInterviewToDebrief(app.stage) ? ['clientDebrief'] : []),
  },
  // After the interview the client or candidate may ask for time before giving their answer.
  // The stage stays the same; only the side that was asked to wait has its reminders paused.
  {
    code: 'candidate_asked_wait',
    label: 'Candidate asked to wait till… (date & time)',
    side: 'PM',
    stages: ['debrief_pending'],
    fields: () => ['waitUntil'],
    available: (app) => !app.pmDebriefDone,
  },
  {
    code: 'client_asked_wait',
    label: 'Client asked to wait till… (date & time)',
    side: 'ClientTeam',
    stages: ['debrief_pending'],
    fields: () => ['waitUntil'],
  },
]

/** Stages where an interview has been held (or is set), so an outcome needs the client's debrief. */
export const hasInterviewToDebrief = (stage: Stage) => stage === 'interview_scheduled' || stage === 'debrief_pending'

/** How long after the interview start time the system moves the record to "debrief pending". */
export const DEBRIEF_AFTER_MS = 5 * 60_000

export const optionByCode = (code: OptionCode) => STATUS_OPTIONS.find((o) => o.code === code)!

/** Which side of an application a user is on (null for Admin/PE/unrelated users). */
export function sideOf(app: Application, userId: string): Side | null {
  if (app.assignedPM === userId) return 'PM'
  if (app.assignedClientTeam === userId) return 'ClientTeam'
  return null
}

export function optionsFor(app: Application, userId: string): StatusOption[] {
  const side = sideOf(app, userId)
  if (!side) return []
  return STATUS_OPTIONS.filter((o) => o.side === side && o.stages.includes(app.stage) && (o.available?.(app) ?? true))
}

// ---------- whose turn it is + reminders ----------

/** The waiting period agreed for this side (client for the Client Team, candidate for the PM) is still running. */
export const isWaiting = (app: Application, side: Side, now = Date.now()) => (waitUntilFor(app, side) ?? 0) > now

/** The user must act now: they are in nextActionBy and their own side has no waiting period running. */
export function isMyTurn(app: Application, userId: string, now = Date.now()) {
  if (!app.nextActionBy.includes(userId)) return false
  const side = sideOf(app, userId)
  return !side || !isWaiting(app, side, now)
}

/** While it is someone's turn, the alarm repeats this often until the status changes. */
export const REMINDER_EVERY_MS = 10 * 60_000

/**
 * When the user's first reminder alarm is due: 10 minutes after the turn started, or — after a
 * waiting period agreed for their side — the moment that period ends.
 * (During "interview scheduled" nobody is pending; the turn starts when the system moves the
 * record to "debrief pending" after the interview time.)
 */
export function firstReminderAt(app: Application, userId: string) {
  if (doubtOnly(app, userId)) return app.ctDoubt!.at + REMINDER_EVERY_MS
  const side = sideOf(app, userId)
  return (side && waitUntilFor(app, side)) || app.stageSince + REMINDER_EVERY_MS
}

/** The PM's turn only because the Client Team raised a doubt (the status itself waits on someone else). */
function doubtOnly(app: Application, userId: string) {
  if (!app.ctDoubt || app.assignedPM !== userId || isClosed(app.stage)) return false
  return !deriveStatuses(app.stage, app.pmDatesSubmitted, app.pmDebriefDone, app.ctDatesSubmitted ?? false).next.includes('PM')
}

/** Since when the user has been pending (for "pending for 25m"). */
export function pendingSince(app: Application, userId: string) {
  if (doubtOnly(app, userId)) return app.ctDoubt!.at
  const side = sideOf(app, userId)
  return (side && waitUntilFor(app, side)) || app.stageSince
}

// ---------- color logic (computed per viewer, never stored) ----------

export type Tone = 'red' | 'yellow' | 'blue' | 'green' | 'grey'

export function toneFor(app: Application, viewerId: string, now = Date.now()): Tone {
  if (app.stage === 'closed_placed') return 'green'
  if (app.stage === 'closed_rejected' || app.stage === 'closed_backout') return 'grey'
  if (isMyTurn(app, viewerId, now)) return 'red'
  const side = sideOf(app, viewerId)
  if (app.stage === 'interview_scheduled' || (side && isWaiting(app, side, now))) return 'blue'
  return 'yellow'
}

/** Status label a viewer should see: their own side's; a PE sees the PM side's; Admins the Client Team side's. */
export function viewerLabel(app: Application, viewerId: string, role: Role, now = Date.now(), names?: Names): string {
  const side = sideOf(app, viewerId)
  // An open doubt from the Client Team: the PM is asked to answer; the Client Team member waits for it.
  if (side && app.ctDoubt && !isClosed(app.stage)) {
    if (side === 'PM') {
      const ask = withNames('Pending – {ct} raised a doubt: please answer', app, names)
      return doubtOnly(app, viewerId) ? ask : `${ask} · ${sideLabel(app, side, now, names)}`
    }
    return `${sideLabel(app, side, now, names)} · ${withNames('waiting for {pm} to answer your doubt', app, names)}`
  }
  if (side) return sideLabel(app, side, now, names)
  if (role === 'PE') {
    if (app.stage === 'pe_submitted') return withNames(PE_SUBMIT_STATUS, app, names)
    if (app.stage === 'pe_query') return withNames(app.peUnanswered ? PE_UNANSWERED_STATUS : PE_QUERY_STATUS, app, names)
    return pmLabel(app, now, names)
  }
  if (role === 'ClientTeam' && (app.stage === 'pe_submitted' || app.stage === 'pe_query'))
    return withNames(app.stage === 'pe_query' && app.peUnanswered ? '{pm} could not reach the candidate – with {pe}, not sent to you yet' : CT_FOLLOW_STATUS[app.stage], app, names)
  return beforeClientTeam(app.stage) ? pmLabel(app, now, names) : ctLabel(app, now, names)
}

// ---------- stepper ----------

export const STEPS = ['CV to Client Team', 'CV to client', 'Interview scheduled', 'Debrief', 'Outcome'] as const

export function stepIndex(stage: Stage): number {
  switch (stage) {
    case 'pe_submitted':
    case 'pe_query':
    case 'new_submission':
      return 0
    case 'cv_with_client':
      return 1
    case 'rescheduling':
    case 'interview_scheduled':
      return 2
    case 'debrief_pending':
      return 3
    default:
      return 4
  }
}

/**
 * How many steps a closed record really completed (the Outcome step is shown separately):
 * a candidate rejected by the PM or backing out early never reached the Client Team, so nothing is ticked.
 */
export function stepsDone(app: Pick<Application, 'stage' | 'assignedClientTeam' | 'closedFromStage' | 'currentInterviewRound' | 'currentInterviewId'>): number {
  if (app.stage === 'closed_placed') return 4
  const from = app.closedFromStage
  if (app.stage === 'closed_backout') return from ? Math.min(stepIndex(from), 4) : 0
  // closed_rejected
  if (!app.assignedClientTeam) return 0
  if (from) return from === 'interview_scheduled' || from === 'debrief_pending' ? 4 : from === 'new_submission' ? 1 : 2
  // older records: tell from what is saved
  return app.currentInterviewRound > 1 || app.currentInterviewId ? 4 : 2
}
