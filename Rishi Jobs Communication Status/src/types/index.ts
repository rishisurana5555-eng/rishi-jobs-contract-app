export type Role = 'PM' | 'ClientTeam' | 'PE' | 'Admin' | 'SuperAdmin'

/**
 * User types as shown on screen. Admins see everything and manage setup; the Super Admin (Rishi)
 * can also add, edit and deactivate Admin accounts.
 */
export const ROLE_LABELS: Record<Role, string> = {
  SuperAdmin: 'Super Admin',
  Admin: 'Admin',
  PM: 'Placement Manager (PM)',
  ClientTeam: 'Client Team',
  PE: 'Placement Executive (PE)',
}

export const isAdminRole = (role: Role) => role === 'Admin' || role === 'SuperAdmin'

/** Firestore users/{uid}. The password is never stored here — only in Firebase Authentication. */
export interface AppUser {
  id: string
  /** login ID, e.g. "shubham" */
  userId: string
  name: string
  role: Role
  contactNumber: string
  /** personal/work email for contact (not used to log in) */
  email: string
  /** PE → PM link */
  reportsTo?: string | null
  active: boolean
  /**
   * Admins only: the Super Admin has allowed them to add and edit clients and job openings (the Client
   * Team's work). Missing = not allowed. Also enforced in firestore.rules.
   */
  canEditCatalog?: boolean
}

/** Adds and edits clients and job openings: the Client Team, the Super Admin, and Admins the Super Admin allowed. */
export const canEditCatalog = (u: Pick<AppUser, 'role' | 'canEditCatalog'>) =>
  u.role === 'ClientTeam' || u.role === 'SuperAdmin' || (u.role === 'Admin' && u.canEditCatalog === true)

/** Who added a client / job opening and when (drives the one-time "new client / job" alert). Missing on older records. */
export interface CreatedStamp {
  createdAt?: number
  createdBy?: string
  createdByName?: string
}

/**
 * The last edit of a client / job opening (the reason is compulsory). It drives the one-time "edited"
 * alert to the admins and the PM / PE on the job openings. A client edit is also stamped on its job
 * openings (what: 'client'), so their PM and PE hear of it. Missing until the first edit.
 */
export interface CatalogEdit {
  at: number
  by: string
  byName: string
  role: Role
  reason: string
  /** what was changed, e.g. "Title: Accountant → Senior Accountant" */
  summary: string
  what: 'client' | 'job'
}

export interface Client extends CreatedStamp {
  id: string
  name: string
  contactPerson: string
  assignedClientTeam: string
  /**
   * How many job openings were added together with the client (0 = none). Tells the admins at once
   * which alert to show: one per new job opening, or "new client added without a job opening".
   * Missing on older records.
   */
  jobsAtCreation?: number
  lastEdit?: CatalogEdit
}

export type JobStatus = 'open' | 'closed' | 'on-hold'

/** Chosen when the job opening is added (and editable): how urgent it is. Missing on older records = active. */
export type JobPriority = 'active' | 'second_priority'
export const JOB_PRIORITY_LABEL: Record<JobPriority, string> = { active: 'Active', second_priority: 'Second priority' }

/** Chosen by the Admin when assigning the PM. */
export type Delegation = 1 | 2 | 3
export const DELEGATION_LABEL: Record<Delegation, string> = { 1: '1st delegation', 2: '2nd delegation', 3: '3rd delegation' }

/**
 * One line of a client's / job opening's log: clients/{id}/log and jobOpenings/{id}/log. Written with
 * every change (added, edited with its reason, assigned, status, notes, deleted). Never changed.
 */
export interface CatalogLogEntry {
  id: string
  kind: 'client' | 'job'
  action: 'created' | 'edited' | 'assigned_pm' | 'assigned_pe' | 'note' | 'deleted'
  clientId: string
  clientName: string
  jobId?: string
  jobTitle?: string
  /** what happened / what changed */
  summary: string
  /** the reason given (compulsory for edits) */
  reason: string
  by: string
  byName: string
  role: Role
  at: number
}

/**
 * Firestore candidates/{id}: the candidate themself, apart from any client. Each submission to a
 * client's job (an Application) points to it by candidateId, so one candidate can be sent to
 * several clients, and deleting a client keeps the candidate.
 */
export interface CandidateProfile {
  /** the candidate ID shown in lists, e.g. C-3F9A1B (= Application.candidateId) */
  id: string
  candidateName: string
  candidateContactNumber: string
  /** a second number for the candidate (optional; missing on older records) */
  candidateAltContactNumber?: string
  candidateEmail: string
  originalCvUrl: string | null
  originalCvName: string | null
  currentSalary: string
  expectedSalary: string
  noticePeriod: string
  recruiterNote: string
  /** the PE who added the candidate, and their PM */
  pe: string | null
  pm: string | null
  /** who (besides the admins) can see and manage the candidate: the PE and the PM */
  people: string[]
  createdAt: number
  createdBy: string
  updatedAt: number
}

/** Everyone of the Admin team, when a PE writes to all of them. */
export const ALL_ADMINS = 'admins'

/**
 * Firestore messages/{id}. A PE starts a conversation with one Admin / the Super Admin, or all of them;
 * the admins reply in it and the PE can answer back.
 */
export interface AdminMessage {
  id: string
  /** the PE the conversation belongs to */
  pe: string
  /** who the conversation is with: an admin's uid, or ALL_ADMINS */
  threadTo: string
  /** the conversation's first message (null for that first message itself) */
  replyTo: string | null
  from: string
  fromName: string
  /** an admin's uid or ALL_ADMINS (PE writing), or the PE's uid (admin replying) */
  to: string
  toName: string
  body: string
  createdAt: number
  /** who has read it (besides the sender) */
  readBy: string[]
}

/**
 * Firestore jobOpenings/{id}. Added by the Client Team, then handed down: an Admin assigns it to one PM,
 * and that PM assigns it to one PE. Only those people (and the client's Client Team member and the
 * admins) see the job opening or are alerted about it.
 */
export interface JobOpening extends CreatedStamp {
  id: string
  clientId: string
  /** copied from the client, so the PM and PE (who can't read clients) see it */
  clientName: string
  title: string
  /** what the job is: requirements, experience, location, salary… */
  details: string
  status: JobStatus
  /** missing on older records = active */
  priority?: JobPriority
  /** When the priority last changed (Active ↔ Second priority): the job's age counts from then. Missing = never. */
  priorityChangedAt?: number | null
  /** set by the Admin with the PM (missing on older records / before a PM is assigned) */
  delegation?: Delegation | null
  /**
   * Set by the Client Team (optional, editable): candidates must be submitted before this time (epoch ms).
   * It goes down with the job opening to the PM and PE; once it passes without a submission, they get the
   * pending work alert and the admins are told. Missing / null = no deadline.
   */
  submitBy?: number | null
  lastEdit?: CatalogEdit
  /** the client's Client Team member (copied from the client) */
  assignedClientTeam: string
  /** null until an Admin assigns it */
  assignedPM: string | null
  pmAssignedAt: number | null
  pmAssignedBy: string | null
  pmAssignedByName: string | null
  /** null until the PM assigns it */
  assignedPE: string | null
  peAssignedAt: number | null
  peAssignedBy: string | null
  peAssignedByName: string | null
  /** Notes from the Client Team, Admin, PM and PE, oldest first — written when handing the job on, or any time. Append-only. */
  notes: JobNote[]
}

export interface JobNote {
  by: string
  byName: string
  role: Role
  text: string
  at: number
}

/** One available slot. `date` is YYYY-MM-DD; `from`/`to` are optional HH:MM. */
export interface Slot {
  date: string
  from?: string
  to?: string
}

export type Stage =
  /** added by a PE; waiting for their PM to revise the CV and send it to the Client Team */
  | 'pe_submitted'
  /** the PM asked the PE a question about a candidate the PE added; waiting for the PE's answer */
  | 'pe_query'
  | 'new_submission'
  | 'cv_with_client'
  | 'rescheduling'
  | 'interview_scheduled'
  | 'debrief_pending'
  | 'closed_placed'
  | 'closed_rejected'
  /** the candidate backed out (set by the PE or the PM, at any point) */
  | 'closed_backout'

export type PmStatus =
  | 'pending_pe_submission'
  | 'query_to_pe'
  | 'submitted_to_ct'
  | 'cv_with_client'
  | 'pending_candidate_dates'
  | 'candidate_dates_submitted'
  | 'interview_scheduled'
  | 'pending_candidate_debrief'
  | 'candidate_debrief_received'
  | 'placed'
  | 'rejected'
  | 'backout'

export type CtStatus =
  | 'not_sent_yet'
  | 'pending_new_submission'
  | 'pending_client_dates'
  | 'pending_new_client_dates'
  | 'client_dates_submitted'
  | 'pending_schedule'
  | 'interview_scheduled'
  | 'pending_client_debrief'
  | 'placed'
  | 'rejected'
  | 'backout'

export type Side = 'PM' | 'ClientTeam'
export type ActorRole = Side | 'PE' | 'System'

export type InterviewMode = 'in-person' | 'phone' | 'video'

export interface Application {
  id: string
  candidateId: string
  candidateName: string
  candidateContactNumber: string
  /** a second number for the candidate (optional; missing on older records) */
  candidateAltContactNumber?: string
  originalCvUrl: string | null
  originalCvName?: string | null
  /** '' until the PM has revised the CV of a candidate added by a PE */
  revisedCvUrl: string
  revisedCvName: string | null
  // Details for the revised CV (entered by the PE, editable by the PM). Missing on older records.
  candidateEmail?: string
  /** LPA, digits with an optional decimal point, e.g. "18.5" */
  currentSalary?: string
  expectedSalary?: string
  noticePeriod?: string
  recruiterNote?: string
  /**
   * The note with the candidate's available dates, as the PE first wrote it (and as the PM passed it on
   * to the Client Team). Doubts and answers between the PM and PE never replace it. Missing on older records.
   */
  availabilityNote?: string
  /** The PM's reason for selecting the candidate (sending them to the Client Team). Missing on older records. */
  selectionReason?: string
  /** pe_submitted: the PE has answered the PM's doubt (cleared when the PM raises another) */
  peAnswered?: boolean
  /**
   * pe_query / pe_submitted: the PM marked the candidate unanswered (could not reach them), so the PE is to
   * reach the candidate and tell the PM when they answer — rather than a doubt to answer. Stays set after
   * the PE's message until the PM raises a doubt. Missing on older records = false.
   */
  peUnanswered?: boolean
  /**
   * A doubt the Client Team raised with the PM, waiting for the PM's answer (null once answered).
   * It makes it the PM's turn without moving the candidate's status.
   */
  ctDoubt?: CtDoubt | null
  /** The last doubt the Client Team raised, with the PM's answer (shown on the candidate to both). */
  lastCtDoubt?: CtDoubt & { answer: string; answeredAt: number; answeredByName: string }
  jobId: string
  jobTitle: string
  clientId: string
  clientName: string
  assignedPE: string | null
  assignedPM: string
  assignedClientTeam: string
  /**
   * The client's Client Team member, from the moment the PE adds the candidate (assignedClientTeam is
   * only set once the PM sends it on). They follow the status from then, without acting or being alerted.
   */
  watchClientTeam?: string

  // workflow state
  stage: Stage
  pmStatus: PmStatus
  clientTeamStatus: CtStatus
  currentInterviewRound: number
  /** attempt number inside the current interview round (1 = first try, 2+ = after a mismatch/reschedule) */
  currentAttempt: number
  currentInterviewId: string | null
  /** rescheduling: has the PM sent candidate dates for the current attempt? */
  pmDatesSubmitted: boolean
  /** rescheduling: has the Client Team entered client dates for the current attempt? (missing on older records = false) */
  ctDatesSubmitted?: boolean
  /** debrief_pending: has the PM recorded the candidate debrief? */
  pmDebriefDone: boolean
  latestCandidateDates: Slot[]
  latestClientDates: Slot[]
  scheduledInterviewAt: number | null
  /** interview time + 5 minutes; after this the system moves to debrief_pending */
  interviewEndsAt: number | null
  outcome: null | 'placed' | 'rejected' | 'backout'
  /** closed_backout: why the candidate backed out */
  backoutReason?: string
  /** closed records: the stage it was closed from (for the stepper). Missing on older records. */
  closedFromStage?: Stage
  /**
   * debrief_pending: the client asked to wait till this time — pauses only the Client Team's reminders.
   * Cleared on any stage change.
   */
  clientWaitUntil?: number | null
  /** debrief_pending: the candidate asked to wait till this time — pauses only the PM's reminders. Cleared with the candidate debrief or any stage change. */
  candidateWaitUntil?: number | null

  createdAt: number
  createdBy: string
  stageSince: number
  /** when the Client Team status last changed (missing on older records: stageSince) */
  ctStatusSince?: number
  lastUpdatedBy: string
  lastUpdatedByName: string
  lastUpdatedAt: number
  latestMessage: string
  /** message typed with the most recent change only (empty if none) */
  lastActionMessage: string
  lastActionLabel: string
  lastActionType: TimelineType
  unreadFor: string[]
  nextActionBy: string[]
  notificationType: 'action_required' | 'informational'
}

export interface CtDoubt {
  text: string
  at: number
  by: string
  byName: string
}

export type TimelineType =
  | 'status_change'
  | 'note'
  | 'cv_upload'
  | 'availability_update'
  | 'interview'
  | 'debrief'
  | 'system'

export interface TimelineEntry {
  id: string
  type: TimelineType
  side: ActorRole
  fromStage: Stage | null
  toStage: Stage | null
  statusCode: string | null
  statusLabel: string | null
  message: string
  dates: Slot[] | null
  interviewRound: number
  actor: string
  actorName: string
  actorRole: ActorRole
  timestamp: number
}

export type MatchResult = 'pending' | 'matched' | 'no-match'

export interface AvailabilityRound {
  id: string
  interviewRound: number
  attemptNumber: number
  candidateDates: Slot[]
  clientDates: Slot[]
  matchResult: MatchResult
  createdAt: number
  updatedAt: number
}

export interface Interview {
  id: string
  interviewRound: number
  attemptNumber: number
  scheduledAt: number
  endsAt: number
  mode: InterviewMode
  meetingDetails: string
  status: 'scheduled' | 'completed' | 'cancelled'
  candidateDebrief: string | null
  clientDebrief: string | null
  candidateDebriefAt: number | null
  clientDebriefAt: number | null
  createdAt: number
}
