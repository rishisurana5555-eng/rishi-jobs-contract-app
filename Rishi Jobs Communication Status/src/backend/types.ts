import type { AdminMessage, AppUser, JobNote, Application, AvailabilityRound, CandidateProfile, CatalogLogEntry, Client, Delegation, Interview, JobOpening, TimelineEntry } from '../types'
import type { Names } from '../workflow/workflow'
import type { PhoneOwner } from '../components/PhoneInput'
import type { Action, Actor } from '../workflow/engine'

export type Unsub = () => void

/** Admin → PM, or PM → PE (null: no PE). A note written with it goes into the job opening's notes. */
export interface JobAssignment {
  to: 'PM' | 'PE'
  userId: string | null
  by: Pick<AppUser, 'id' | 'name' | 'role'>
  note: string
  /** the person's name, for the job opening's log */
  userName?: string
  /** Admin → PM: 1st / 2nd / 3rd delegation */
  delegation?: Delegation
}

/** Who adds / edits a client or job opening, and why (the reason is compulsory for an edit). */
export interface CatalogChange {
  by: Pick<AppUser, 'id' | 'name' | 'role'>
  reason?: string
  /** people's names, for the log */
  names?: Names
}

export interface DeleteResult {
  /** submissions deleted */
  submissions: number
  /** CV files moved to the Drive trash; null when the upload script can't do that yet */
  trashedFiles: number | null
}

/**
 * Everything the UI needs from storage, implemented by firebaseBackend (Firestore + Auth; CV files go to the CV upload server).
 */
export interface Backend {
  onAuth(cb: (user: AppUser | null) => void, onError: (e: Error) => void): Unsub
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  /** Owner only: creates a Firebase Authentication login and returns its uid. */
  createLogin(userId: string, password: string): Promise<string>

  listenUsers(cb: (users: AppUser[]) => void): Unsub
  /** Admins: every client. Client Team: the clients they look after. PMs and PEs read no clients (their job openings carry the client's name). */
  listenClients(me: AppUser, cb: (clients: Client[]) => void): Unsub
  /** Admins: every job opening. Others: only those they are on (Client Team: their clients'; PM / PE: assigned to them). */
  listenJobs(me: AppUser, cb: (jobs: JobOpening[]) => void): Unsub
  /** userState/{uid}.catalogSeenAt: newest client/job creation this user has been alerted about (null = no record yet). */
  listenCatalogSeen(uid: string, cb: (seenAt: number | null) => void): Unsub
  markCatalogSeen(uid: string, seenAt: number): Promise<void>
  /** Applications visible to `me` (by role), live. */
  listenApplications(me: AppUser, cb: (apps: Application[]) => void, onError: (e: Error) => void): Unsub
  listenTimeline(appId: string, cb: (entries: TimelineEntry[]) => void): Unsub
  /** Admins: the history entries of every submission, with the submission's id, once (for Reports). */
  loadAllTimeline(): Promise<(TimelineEntry & { appId: string })[]>
  listenRounds(appId: string, cb: (rounds: AvailabilityRound[]) => void): Unsub
  listenInterviews(appId: string, cb: (interviews: Interview[]) => void): Unsub

  /** Runs a workflow action in one transaction. Returns the application id. */
  perform(appId: string | null, actor: Actor, action: Action): Promise<string>
  markRead(appId: string, userId: string): Promise<void>
  /**
   * Uploads to the CV server at VITE_CV_UPLOAD_URL; returns the file's link (stored in Firebase).
   * Pass the same uploadId when the same file is sent again, so it is never saved twice.
   */
  uploadCv(file: File, uploadId?: string): Promise<{ url: string; name: string }>
  /** Moves an uploaded CV to the Drive trash (its record was never saved). False when the upload script can't. */
  discardCv(url: string): Promise<boolean>

  /** PE: their conversations. Admins: conversations with them or with all admins. Live, newest first. */
  listenMessages(me: AppUser, cb: (messages: AdminMessage[]) => void): Unsub
  sendMessage(message: Omit<AdminMessage, 'id'>): Promise<void>
  markMessageRead(messageId: string, userId: string): Promise<void>

  /** Candidate profiles the person may see: their own (PE / PM), or all (admins); none for the Client Team. Live. */
  listenCandidates(me: AppUser, cb: (candidates: CandidateProfile[]) => void): Unsub
  /**
   * Which candidate already has this number (phoneIndex), or null. Anyone can look a number up, even
   * for another PE's candidate they can't see; it only says the candidate's ID and PE.
   */
  lookupPhone(number: string): Promise<PhoneOwner | null>
  /** Every submission of this candidate that `me` can reach (to show before deleting). */
  findCandidateApps(candidateId: string, me: AppUser): Promise<Application[]>
  /**
   * Deletes the candidate everywhere: every submission with its whole history (timeline, dates,
   * interviews), the profile, and moves their CV files to the Drive trash. The Super Admin only.
   */
  deleteCandidate(candidateId: string, me: AppUser): Promise<DeleteResult>
  /** Submissions to this client's jobs (to show before deleting). */
  findClientApps(clientId: string): Promise<Application[]>
  /**
   * Deletes a client: its job openings and every submission to it with its history (and the revised
   * CVs made for it). The candidates themselves are kept (their profiles).
   */
  deleteClient(clientId: string, by: Pick<AppUser, 'id' | 'name' | 'role'>): Promise<DeleteResult>

  /**
   * Saves a client; a new one gets the next CL- number and returns it. An edit needs a reason and is
   * stamped (lastEdit) on the client and its job openings, so the admins and their PM / PE are alerted.
   * Changing the client's name or Client Team member is copied onto its job openings. Every save is logged.
   */
  saveClient(client: Client, change: CatalogChange): Promise<string>
  /**
   * A new job opening (empty id) gets the next JB- number; an existing one only has its title, details,
   * status, priority and submission deadline changed, needs a reason, and is stamped (lastEdit). Every save is logged.
   */
  saveJob(job: JobOpening, change: CatalogChange): Promise<void>
  /** A client's / job opening's log, newest first (live). */
  listenCatalogLog(kind: 'client' | 'job', id: string, cb: (entries: CatalogLogEntry[]) => void): Unsub
  /** Admins: every client's and job opening's log (also of deleted ones), newest first, once. */
  loadAllCatalogLog(): Promise<CatalogLogEntry[]>
  /** Admin → PM (clears the PE) or PM → PE hand-down. */
  assignJob(jobId: string, change: JobAssignment): Promise<void>
  /** Adds a note to the job opening's notes (everyone on the job opening sees it). */
  addJobNote(jobId: string, note: JobNote): Promise<void>
  saveUser(user: AppUser): Promise<void>
  newId(): string
}
