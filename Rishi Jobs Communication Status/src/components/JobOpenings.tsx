import { useEffect, useState } from 'react'
import { playSound } from '../alarm/sound'
import { useApp } from '../context/AppContext'
import { DELEGATION_LABEL, isAdminRole, JOB_PRIORITY_LABEL, type AppUser, type Delegation, type JobOpening, type JobPriority, type JobStatus, type Role } from '../types'
import { delegationLabel, priorityLabel } from '../workflow/catalog'
import { duration, fmtDateTime, timeAgo } from '../workflow/dates'
import { JOB_STATUS_LABEL, jobAgeDays, jobAgeFrom, jobAgeTone, jobLateText, jobStatusWarning, jobStep, jobStepLabel, jobTodo } from '../workflow/jobs'
import type { Tone } from '../workflow/workflow'
import { AddCandidateForm } from './AddCandidateForm'
import { CatalogLog } from './CatalogLog'
import { StatusBadge, ToneBadge } from './StatusBadge'
import { Alert, Button, Card, Empty, Input, Modal, Select, Tabs, Textarea, cx } from './ui'

const STATUS_STYLE: Record<JobStatus, string> = {
  open: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  'on-hold': 'bg-amber-50 text-amber-900 ring-amber-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200',
}
const ROLE_SHORT: Record<Role, string> = { SuperAdmin: 'Super Admin', Admin: 'Admin', PM: 'PM', ClientTeam: 'Client Team', PE: 'PE' }

function StatusPill({ status }: { status: JobStatus }) {
  return <span className={cx('inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', STATUS_STYLE[status])}>{JOB_STATUS_LABEL[status]}</span>
}

/** Job status (Active / Second priority) and, once a PM is assigned, the delegation. */
function PriorityPills({ job: j }: { job: JobOpening }) {
  return (
    <>
      <span
        className={cx(
          'inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
          (j.priority ?? 'active') === 'active' ? 'bg-sky-50 text-sky-800 ring-sky-200' : 'bg-orange-50 text-orange-800 ring-orange-200',
        )}
      >
        {priorityLabel(j.priority)}
      </span>
      {j.delegation && (
        <span className="inline-block whitespace-nowrap rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-inset ring-violet-200">
          {delegationLabel(j.delegation)}
        </span>
      )}
    </>
  )
}

/**
 * Red: waiting for me (to assign it, or — a PE — to submit a candidate for it), or its submission deadline
 * was missed; green: with a PE who has; yellow: with someone else.
 */
function useJobTone() {
  const { jobWaitsForMe, jobLateForMe } = useApp()
  return (j: JobOpening): Tone => (jobWaitsForMe(j) || jobLateForMe(j) ? 'red' : jobStep(j) === 'with_pe' ? 'green' : 'yellow')
}

/** The columns the job openings table can be sorted by (the arrow next to the header). */
type SortKey = 'job' | 'client' | 'status' | 'age'
interface Sort {
  key: SortKey
  /** asc: A–Z; for Age, youngest first; for Status, open → on hold → closed (Active before Second priority) */
  asc: boolean
}

const STATUS_ORDER: Record<JobStatus, number> = { open: 0, 'on-hold': 1, closed: 2 }
const SORTS: Record<SortKey, (a: JobOpening, b: JobOpening) => number> = {
  job: (a, b) => a.title.localeCompare(b.title),
  client: (a, b) => a.clientName.localeCompare(b.clientName),
  status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || priorityLabel(a.priority).localeCompare(priorityLabel(b.priority)),
  age: (a, b) => (jobAgeFrom(b) ?? 0) - (jobAgeFrom(a) ?? 0),
}
/** Ties: by job title, then client (always A–Z). */
const sortJobs = (list: JobOpening[], { key, asc }: Sort) =>
  [...list].sort((a, b) => (asc ? 1 : -1) * SORTS[key](a, b) || SORTS.job(a, b) || SORTS.client(a, b))

/** A column header with an arrow: click to sort by it; click again to reverse. */
function SortHeader({ label, k, sort, onSort, title }: { label: string; k: SortKey; sort: Sort; onSort: (s: Sort) => void; title?: string }) {
  const on = sort.key === k
  return (
    <th className="px-3 py-2" title={title}>
      <button
        type="button"
        onClick={() => onSort({ key: k, asc: on ? !sort.asc : true })}
        className={cx('inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-800', on && 'text-slate-800')}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span aria-hidden className={cx('text-xs', !on && 'text-slate-300')}>
          {on ? (sort.asc ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}

/** The status shown for a job opening: what I have to do when it waits for me. */
function useJobLabel() {
  const { jobWaitsForMe, names, me } = useApp()
  return (j: JobOpening) => (jobWaitsForMe(j) ? `Your turn – ${jobTodo(j, me).toLowerCase()}` : jobStepLabel(j, names))
}

/**
 * The job openings this person is on, one line each, handed down Client Team → Admin → PM → PE.
 * Clicking a job opening (or its button) opens its page: the details, the notes, and choosing the
 * PM (Admins) or the PE (that PM). The PE adds candidates for it from there.
 */
export function JobOpenings() {
  const { jobs, jobsToAssign, me, openJobId: openId, openJob: setOpenId } = useApp()
  // Admins and PMs assign job openings; a PE submits candidates for theirs.
  const hasTurn = isAdminRole(me.role) || me.role === 'PM' || me.role === 'PE'
  const [filter, setFilter] = useState<'mine' | 'all'>(hasTurn && jobsToAssign.length ? 'mine' : 'all')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<JobStatus | ''>('')
  const [priority, setPriority] = useState<JobPriority | ''>('')
  // Listed A–Z by job title until another column's arrow is clicked.
  const [sort, setSort] = useState<Sort>({ key: 'job', asc: true })
  // Leaving the Job openings tab closes the job opening that was open.
  useEffect(() => () => setOpenId(null), [setOpenId])

  const open = jobs.find((j) => j.id === openId)
  if (open) return <JobPage job={open} onBack={() => setOpenId(null)} />

  const show = (id: string) => {
    setOpenId(id)
    window.scrollTo({ top: 0 })
  }
  const base = filter === 'mine' ? jobsToAssign : jobs
  const q = search.trim().toLowerCase()
  const matches = (j: JobOpening) => !q || [j.clientName, j.title, j.id, j.clientId].some((s) => s.toLowerCase().includes(q))
  const searched = base.filter(matches)
  const shown = sortJobs(
    searched.filter((j) => (!status || j.status === status) && (!priority || (j.priority ?? 'active') === priority)),
    sort,
  )
  const count = (s: JobStatus) => searched.filter((j) => j.status === s).length
  const countPriority = (p: JobPriority) => searched.filter((j) => (j.priority ?? 'active') === p).length

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        {hasTurn && (
          <Tabs
            value={filter}
            onChange={setFilter}
            options={[
              ['mine', `${me.role === 'PE' ? 'Need a candidate' : 'To assign'} (${jobsToAssign.length})`],
              ['all', `All (${jobs.length})`],
            ]}
          />
        )}
        <Select value={status} onChange={(e) => setStatus(e.target.value as JobStatus | '')} className="w-auto py-1.5" aria-label="Job status">
          <option value="">All statuses ({searched.length})</option>
          <option value="open">Open ({count('open')})</option>
          <option value="on-hold">On hold ({count('on-hold')})</option>
          <option value="closed">Closed ({count('closed')})</option>
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value as JobPriority | '')} className="w-auto py-1.5" aria-label="Active or second priority">
          <option value="">Active & second priority ({searched.length})</option>
          {(Object.keys(JOB_PRIORITY_LABEL) as JobPriority[]).map((p) => (
            <option key={p} value={p}>
              {JOB_PRIORITY_LABEL[p]} ({countPriority(p)})
            </option>
          ))}
        </Select>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, job title or ID…" className="w-full py-1.5 sm:ml-auto sm:w-64" />
      </div>

      {!shown.length ? (
        <Empty>{base.length ? 'No job openings match.' : filter === 'mine' ? 'Nothing waiting for you.' : 'No job openings yet.'}</Empty>
      ) : (
        <JobTable jobs={shown} onOpen={show} sort={sort} onSort={setSort} />
      )}
    </section>
  )
}

function JobTable({ jobs, onOpen, sort, onSort }: { jobs: JobOpening[]; onOpen: (id: string) => void; sort: Sort; onSort: (s: Sort) => void }) {
  const { me, now, jobWaitsForMe, apps } = useApp()
  const tone = useJobTone()
  const label = useJobLabel()
  const [adding, setAdding] = useState<JobOpening | null>(null)
  // Submissions for each job opening that this person can see: a PE's own, a PM's (from all their PEs),
  // or all of them for the admins and the client's Client Team member.
  const submissions = new Map<string, number>()
  for (const a of apps) submissions.set(a.jobId, (submissions.get(a.jobId) ?? 0) + 1)

  // The button at the end of the row: the next thing this person does with the job opening.
  const action = (j: JobOpening): { label: string; primary: boolean; run?: () => void } => {
    if (isAdminRole(me.role)) return j.assignedPM ? { label: 'Change PM', primary: false } : { label: 'Assign to PM', primary: true }
    if (me.role === 'PM' && j.assignedPM === me.id) return j.assignedPE ? { label: 'Change PE', primary: false } : { label: 'Assign to PE', primary: true }
    if (me.role === 'PE' && j.assignedPE === me.id) return { label: '＋ Add candidate', primary: jobWaitsForMe(j), run: () => setAdding(j) }
    return { label: 'View', primary: false }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <SortHeader label="Job opening" k="job" sort={sort} onSort={onSort} />
            <SortHeader label="Client" k="client" sort={sort} onSort={onSort} />
            <SortHeader label="Status" k="status" sort={sort} onSort={onSort} />
            <th className="px-3 py-2">Assigned</th>
            <th className="px-3 py-2 text-right" title={me.role === 'PE' ? 'Candidates you have submitted for this job opening' : 'Candidates submitted for this job opening'}>
              {me.role === 'PE' ? 'My submissions' : 'Submissions'}
            </th>
            <SortHeader label="Age" k="age" sort={sort} onSort={onSort} title="Days since the job opening was added, or since its priority last changed (day 1 = that day)" />
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {jobs.map((j) => {
            const a = action(j)
            const age = jobAgeDays(j, now)
            const ageTone = jobAgeTone(age)
            const from = jobAgeFrom(j)
            return (
              // Older than 7 days: orange row; older than 12 days: red row.
              <tr
                key={j.id}
                className={cx(
                  'cursor-pointer border-l-4',
                  ageTone === 'red' ? 'border-l-red-500 bg-red-50 hover:bg-red-100' : ageTone === 'orange' ? 'border-l-orange-400 bg-orange-50 hover:bg-orange-100' : 'border-l-transparent hover:bg-slate-50',
                )}
                onClick={() => onOpen(j.id)}
              >
                <td className="px-3 py-2">
                  <span className="font-medium text-slate-900">{j.title}</span> <span className="text-xs text-slate-400">{j.id}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{j.clientName}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <StatusPill status={j.status} />
                    <PriorityPills job={j} />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <ToneBadge tone={tone(j)} className="whitespace-nowrap">{label(j)}</ToneBadge>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{submissions.get(j.id) ?? 0}</td>
                <td
                  className={cx('px-3 py-2 whitespace-nowrap text-xs', ageTone === 'red' ? 'font-bold text-red-700' : ageTone === 'orange' ? 'font-bold text-orange-700' : 'text-slate-500')}
                  title={from ? `${j.priorityChangedAt ? 'Priority changed' : 'Added'} ${fmtDateTime(from)}` : undefined}
                >
                  {age == null ? '—' : `${age} day${age > 1 ? 's' : ''}`}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant={a.primary ? 'primary' : 'secondary'}
                    className="whitespace-nowrap px-2.5 py-1 text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (a.run) a.run()
                      else onOpen(j.id)
                    }}
                  >
                    {a.label}
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {adding && <AddCandidateModal job={adding} onClose={() => setAdding(null)} />}
    </div>
  )
}

function AddCandidateModal({ job: j, onClose }: { job: JobOpening; onClose: () => void }) {
  const { openApp } = useApp()
  return (
    <Modal title={`Add Candidate — ${j.title} at ${j.clientName}`} onClose={onClose} full>
      <AddCandidateForm
        jobId={j.id}
        onDone={(id) => {
          onClose()
          openApp(id)
        }}
      />
    </Modal>
  )
}

/** One job opening: its details and notes, and handing it on (Admin → PM, PM → PE). */
function JobPage({ job: j, onBack }: { job: JobOpening; onBack: () => void }) {
  const { me, nameOf, names, apps, now, jobLateForMe } = useApp()
  const tone = useJobTone()
  const late = jobLateForMe(j)
  const label = useJobLabel()
  const [adding, setAdding] = useState(false)
  const candidates = apps.filter((a) => a.jobId === j.id).length
  const warning = (me.role === 'PM' || me.role === 'PE') && jobStatusWarning(j)

  return (
    <section className="space-y-4">
      <Button variant="ghost" onClick={onBack}>
        ← All job openings
      </Button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">
              {j.title} <span className="text-sm font-normal text-slate-400">{j.id}</span>
            </h2>
            <div className="text-sm text-slate-600">
              {j.clientName} <span className="text-slate-400">({j.clientId})</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Added by {j.createdByName ?? '—'}
              {j.createdAt ? ` · ${fmtDateTime(j.createdAt)}` : ''} · Client Team: {nameOf(j.assignedClientTeam)}
              {candidates > 0 && ` · ${candidates} candidate${candidates > 1 ? 's' : ''}`}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap justify-end gap-1">
              <StatusPill status={j.status} />
              <PriorityPills job={j} />
            </div>
            <ToneBadge tone={tone(j)}>{label(j)}</ToneBadge>
          </div>
        </div>

        {j.submitBy && (
          <div className={cx('mt-3 rounded-lg border px-3 py-2 text-sm', late ? 'border-red-300 bg-red-50 text-red-800' : 'border-sky-200 bg-sky-50 text-sky-900')}>
            {late ? '⏰ ' : '📅 '}
            <b>Submissions due by {fmtDateTime(j.submitBy)}</b>
            {late
              ? ` — the deadline passed ${duration(now - j.submitBy)} ago. ${jobLateText(j, late, names, me.id)}`
              : now >= j.submitBy
                ? ' — the deadline has passed.'
                : ` — ${duration(j.submitBy - now)} left. Candidates must be submitted before this time.`}
          </div>
        )}

        {warning && (
          <div className="mt-3">
            <Alert tone="warn">⚠ {warning}</Alert>
          </div>
        )}


        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Job details</h3>
        {j.details ? (
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{j.details}</p>
        ) : (
          <p className="mt-1 text-sm italic text-slate-400">No details written.</p>
        )}

        {/* The notes (Client Team, admins, PM, PE) belong with the details: read together before acting. */}
        <Notes job={j} now={now} />

        {me.role === 'PE' && j.assignedPE === me.id && (
          <div className="mt-4 flex justify-end">
            <Button onClick={() => setAdding(true)}>＋ Add candidate for this job</Button>
          </div>
        )}
      </Card>

      {isAdminRole(me.role) && <AssignPm job={j} />}
      {me.role === 'PM' && j.assignedPM === me.id && <AssignPe job={j} />}

      <JobCandidates job={j} />

      <Card title="Log — every change to this job opening">
        <CatalogLog kind="job" id={j.id} />
      </Card>

      {adding && <AddCandidateModal job={j} onClose={() => setAdding(false)} />}
    </section>
  )
}

/**
 * Every candidate submitted for this job opening that this person can see. A job opening can change PM
 * (and PE): candidates submitted before stay with the PM / PE who submitted them, and are marked.
 */
function JobCandidates({ job: j }: { job: JobOpening }) {
  const { apps, me, nameOf, openApp } = useApp()
  const list = apps.filter((a) => a.jobId === j.id).sort((a, b) => a.candidateName.localeCompare(b.candidateName))
  const earlier = (id: string | null, current: string | null) => !!id && id !== current
  return (
    <Card title={`Candidates for this job (${list.length})`}>
      {!list.length ? (
        <p className="text-sm text-slate-400">{me.role === 'PE' || me.role === 'PM' ? 'You have no candidates for this job opening yet.' : 'No candidates submitted yet.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1.5 pr-3">Candidate</th>
                <th className="py-1.5 pr-3">PE</th>
                <th className="py-1.5 pr-3">PM</th>
                <th className="py-1.5 pr-3">Submitted on</th>
                <th className="py-1.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openApp(a.id)}>
                  <td className="py-2 pr-3">
                    <span className="font-medium text-slate-900">{a.candidateName}</span> <span className="text-xs text-slate-400">{a.candidateId}</span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {nameOf(a.assignedPE)}
                    {earlier(a.assignedPE, j.assignedPE) && <span className="block text-[11px] text-amber-700">earlier PE</span>}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {nameOf(a.assignedPM)}
                    {earlier(a.assignedPM, j.assignedPM) && <span className="block text-[11px] text-amber-700">earlier PM</span>}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-xs">{fmtDateTime(a.createdAt)}</td>
                  <td className="py-2">
                    <StatusBadge app={a} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.some((a) => earlier(a.assignedPM, j.assignedPM)) && (
        <p className="mt-2 text-xs text-slate-500">
          This job opening has moved to another PM since some candidates were submitted. Those candidates stay with the PM and PE who submitted them, who carry on with them.
        </p>
      )}
    </Card>
  )
}

function Notes({ job: j, now }: { job: JobOpening; now: number }) {
  const { me, backend } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notes = j.notes ?? []

  async function add() {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      await backend.addJobNote(j.id, { by: me.id, byName: me.name, role: me.role, text: text.trim(), at: Date.now() })
      setText('')
      playSound('success')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes ({notes.length})</h3>
      {notes.length ? (
        <ul className="mt-1 space-y-2">
          {notes.map((n, i) => (
            <li key={i} className={cx('rounded-lg px-3 py-2 text-sm', n.by === me.id ? 'bg-brand-50' : 'bg-slate-50')}>
              <div className="text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{n.by === me.id ? 'You' : n.byName}</span> ({ROLE_SHORT[n.role]}) ·{' '}
                <span title={fmtDateTime(n.at)}>{timeAgo(n.at, now)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{n.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm italic text-slate-400">No notes yet.</p>
      )}
      <div className="mt-2 space-y-2">
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note — everyone on this job opening sees it." />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={add} busy={busy} disabled={!text.trim()}>
            Add note
          </Button>
        </div>
      </div>
    </section>
  )
}

/** Choose the person and, optionally, write a note: it goes into the notes, for them to read. */
function AssignForm({
  label,
  people,
  current,
  currentDelegation,
  onAssign,
}: {
  label: 'PM' | 'PE'
  people: AppUser[]
  current: string | null
  /** PM only: the job opening's delegation now */
  currentDelegation?: Delegation | null
  onAssign: (userId: string | null, note: string, delegation?: Delegation) => Promise<void>
}) {
  const { nameOf } = useApp()
  const [userId, setUserId] = useState(current ?? '')
  const [delegation, setDelegation] = useState<Delegation | ''>(currentDelegation ?? '')
  useEffect(() => setDelegation(currentDelegation ?? ''), [currentDelegation])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** "assigned successfully", until the next change */
  const [done, setDone] = useState<string | null>(null)
  const changed = userId !== (current ?? '') || (label === 'PM' && delegation !== (currentDelegation ?? ''))
  // Someone else changed it meanwhile: show the person it is with now.
  useEffect(() => setUserId(current ?? ''), [current])

  async function assign() {
    if (!userId && label === 'PM') return setError('Choose the PM.')
    if (label === 'PM' && !delegation) return setError('Choose the delegation (1st, 2nd or 3rd).')
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await onAssign(userId || null, note, delegation || undefined)
      setNote('')
      setDone(userId ? `✓ Job opening assigned to ${label} ${nameOf(userId)} successfully.${note.trim() ? ' Your note was added to the notes.' : ''}` : `✓ The PE was removed from this job opening.`)
      playSound('success')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={current ? `Assigned ${label}` : `Assign to a ${label}`}>
      <div className="space-y-2">
        <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="sm:w-72">
          <option value="">{label === 'PE' && current ? '— No PE —' : `— Choose the ${label} —`}</option>
          {people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        {label === 'PM' && (
          <Select value={delegation} onChange={(e) => setDelegation(e.target.value ? (Number(e.target.value) as Delegation) : '')} className="sm:w-72" aria-label="Delegation">
            <option value="">— Choose the delegation —</option>
            {([1, 2, 3] as Delegation[]).map((d) => (
              <option key={d} value={d}>
                {DELEGATION_LABEL[d]}
              </option>
            ))}
          </Select>
        )}
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Note for the ${label} (optional) — it is added to the job opening's notes above.`} />
        {current && changed && (
          <p className="text-xs text-slate-500">
            {label === 'PM' ? 'The new PM chooses the PE again. ' : ''}Candidates already submitted for this job stay with {nameOf(current)}
            {label === 'PM' ? ' and their PE' : ''}, who carry on with them; new candidates go to the new {label}.
          </p>
        )}
        {error && <Alert>{error}</Alert>}
        {done && <Alert tone="ok">{done}</Alert>}
        <div className="flex justify-end">
          <Button onClick={assign} busy={busy} disabled={!changed}>
            {current ? `Change ${label}` : `Assign to ${label}`}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function AssignPm({ job: j }: { job: JobOpening }) {
  const { users, me, backend, nameOf } = useApp()
  const pms = users.filter((u) => u.role === 'PM' && u.active !== false).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <AssignForm
      label="PM"
      people={pms}
      current={j.assignedPM}
      currentDelegation={j.delegation}
      onAssign={(userId, note, delegation) => backend.assignJob(j.id, { to: 'PM', userId, by: me, note, delegation, userName: nameOf(userId) })}
    />
  )
}

function AssignPe({ job: j }: { job: JobOpening }) {
  const { users, me, backend, nameOf } = useApp()
  const pes = users.filter((u) => u.role === 'PE' && u.active !== false)
  // The PM's own PEs; if none report to them, every PE.
  const mine = pes.filter((u) => u.reportsTo === me.id)
  return (
    <AssignForm
      label="PE"
      people={(mine.length ? mine : pes).sort((a, b) => a.name.localeCompare(b.name))}
      current={j.assignedPE}
      onAssign={(userId, note) => backend.assignJob(j.id, { to: 'PE', userId, by: me, note, userName: nameOf(userId) })}
    />
  )
}
