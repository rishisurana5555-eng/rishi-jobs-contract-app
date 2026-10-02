import { useEffect, useState } from 'react'
import { playSound } from '../alarm/sound'
import { useApp } from '../context/AppContext'
import { isAdminRole, type AppUser, type JobOpening, type JobStatus, type Role } from '../types'
import { fmtDateTime, timeAgo } from '../workflow/dates'
import { JOB_STATUS_LABEL, jobStatusWarning, jobStep, jobStepLabel, jobTodo } from '../workflow/jobs'
import type { Tone } from '../workflow/workflow'
import { AddCandidateForm } from './AddCandidateForm'
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

/** Red: waiting for me (to assign it, or — a PE — to submit a candidate for it); green: with a PE who has; yellow: with someone else. */
function useJobTone() {
  const { jobWaitsForMe } = useApp()
  return (j: JobOpening): Tone => (jobWaitsForMe(j) ? 'red' : jobStep(j) === 'with_pe' ? 'green' : 'yellow')
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
  const shown = searched
    .filter((j) => !status || j.status === status)
    .sort((a, b) => a.clientName.localeCompare(b.clientName) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const count = (s: JobStatus) => searched.filter((j) => j.status === s).length

  return (
    <section className="space-y-3">
      <p className="text-sm text-slate-500">
        {isAdminRole(me.role)
          ? 'New job openings from the Client Team come to you. Open one to read it and assign it to a PM.'
          : me.role === 'PM'
            ? 'Job openings the Admin assigned to you. Open one to read it and assign it to one of your PEs.'
            : me.role === 'PE'
              ? 'Job openings your PM assigned to you. Open one to read it and add candidates for it.'
              : 'Your clients’ job openings and who they are assigned to.'}
      </p>
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
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, job title or ID…" className="w-full py-1.5 sm:ml-auto sm:w-64" />
      </div>

      {!shown.length ? (
        <Empty>{base.length ? 'No job openings match.' : filter === 'mine' ? 'Nothing waiting for you.' : 'No job openings yet.'}</Empty>
      ) : (
        <JobTable jobs={shown} onOpen={show} />
      )}
    </section>
  )
}

function JobTable({ jobs, onOpen }: { jobs: JobOpening[]; onOpen: (id: string) => void }) {
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
            <th className="px-3 py-2">Job opening</th>
            <th className="px-3 py-2">Client</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Assigned</th>
            <th className="px-3 py-2 text-right" title={me.role === 'PE' ? 'Candidates you have submitted for this job opening' : 'Candidates submitted for this job opening'}>
              {me.role === 'PE' ? 'My submissions' : 'Submissions'}
            </th>
            <th className="px-3 py-2">Added</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {jobs.map((j) => {
            const a = action(j)
            return (
              <tr key={j.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(j.id)}>
                <td className="px-3 py-2">
                  <span className="font-medium text-slate-900">{j.title}</span> <span className="text-xs text-slate-400">{j.id}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{j.clientName}</td>
                <td className="px-3 py-2">
                  <StatusPill status={j.status} />
                </td>
                <td className="px-3 py-2">
                  <ToneBadge tone={tone(j)} className="whitespace-nowrap">{label(j)}</ToneBadge>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{submissions.get(j.id) ?? 0}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{j.createdAt ? timeAgo(j.createdAt, now) : '—'}</td>
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
    <Modal title={`Add Candidate — ${j.title} at ${j.clientName}`} onClose={onClose} wide>
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
  const { me, nameOf, apps, now } = useApp()
  const tone = useJobTone()
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
            <StatusPill status={j.status} />
            <ToneBadge tone={tone(j)}>{label(j)}</ToneBadge>
          </div>
        </div>

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
  const list = apps.filter((a) => a.jobId === j.id).sort((a, b) => b.createdAt - a.createdAt)
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
function AssignForm({ label, people, current, onAssign }: { label: 'PM' | 'PE'; people: AppUser[]; current: string | null; onAssign: (userId: string | null, note: string) => Promise<void> }) {
  const { nameOf } = useApp()
  const [userId, setUserId] = useState(current ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** "assigned successfully", until the next change */
  const [done, setDone] = useState<string | null>(null)
  const changed = userId !== (current ?? '')
  // Someone else changed it meanwhile: show the person it is with now.
  useEffect(() => setUserId(current ?? ''), [current])

  async function assign() {
    if (!userId && label === 'PM') return setError('Choose the PM.')
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await onAssign(userId || null, note)
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
  const { users, me, backend } = useApp()
  const pms = users.filter((u) => u.role === 'PM' && u.active !== false).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <AssignForm
      label="PM"
      people={pms}
      current={j.assignedPM}
      onAssign={(userId, note) => backend.assignJob(j.id, { to: 'PM', userId, by: me, note })}
    />
  )
}

function AssignPe({ job: j }: { job: JobOpening }) {
  const { users, me, backend } = useApp()
  const pes = users.filter((u) => u.role === 'PE' && u.active !== false)
  // The PM's own PEs; if none report to them, every PE.
  const mine = pes.filter((u) => u.reportsTo === me.id)
  return (
    <AssignForm
      label="PE"
      people={(mine.length ? mine : pes).sort((a, b) => a.name.localeCompare(b.name))}
      current={j.assignedPE}
      onAssign={(userId, note) => backend.assignJob(j.id, { to: 'PE', userId, by: me, note })}
    />
  )
}
