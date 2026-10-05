import { useState, type FormEvent } from 'react'
import { playSound } from '../alarm/sound'
import { properName } from '../workflow/names'
import { AllCatalogLog, CatalogLogModal } from '../components/CatalogLog'
import { DeleteClientDialog } from '../components/DeleteDialogs'
import { ToneBadge } from '../components/StatusBadge'
import { TimeSelect } from '../components/TimeSelect'
import { Alert, Button, Card, Field, Input, Select, Textarea } from '../components/ui'
import { useApp } from '../context/AppContext'
import { canEditCatalog, isAdminRole, JOB_PRIORITY_LABEL, ROLE_LABELS, type AppUser, type Client, type JobOpening, type JobPriority, type JobStatus, type Role } from '../types'
import { delegationLabel, dueLabel, priorityLabel } from '../workflow/catalog'
import { toDateAndTime, toEpoch, todayIso } from '../workflow/dates'
import { JOB_STATUS_LABEL, jobStep, jobStepLabel } from '../workflow/jobs'

const ROLES: Role[] = ['SuperAdmin', 'Admin', 'PM', 'ClientTeam', 'PE']

/** A new job opening for this client: it goes to the admins first, who assign the PM. */
function newJob(client: Pick<Client, 'id' | 'name' | 'assignedClientTeam'>, { title, details, note, priority, dueDate, dueTime }: JobDraft, me: AppUser): JobOpening {
  const now = Date.now()
  return {
    id: '',
    clientId: client.id,
    clientName: client.name,
    title: title.trim(),
    details: details.trim(),
    status: 'open',
    priority,
    submitBy: draftSubmitBy({ dueDate, dueTime }),
    delegation: null,
    assignedClientTeam: client.assignedClientTeam,
    assignedPM: null,
    pmAssignedAt: null,
    pmAssignedBy: null,
    pmAssignedByName: null,
    assignedPE: null,
    peAssignedAt: null,
    peAssignedBy: null,
    peAssignedByName: null,
    // A note written with the job opening goes into its notes, for the admins.
    notes: note.trim() ? [{ by: me.id, byName: me.name, role: me.role, text: note.trim(), at: now }] : [],
    createdAt: now,
    createdBy: me.id,
    createdByName: me.name,
  }
}

/** dueDate (YYYY-MM-DD) + dueTime (HH:MM): the optional "submissions due by" deadline; both empty = none. */
type JobDraft = { title: string; details: string; note: string; priority: JobPriority; dueDate: string; dueTime: string }
const blankJobDraft = (): JobDraft => ({ title: '', details: '', note: '', priority: 'active', dueDate: '', dueTime: '' })

const draftSubmitBy = ({ dueDate, dueTime }: Pick<JobDraft, 'dueDate' | 'dueTime'>) => (dueDate && dueTime ? toEpoch(dueDate, dueTime) : null)
const dueDraft = (submitBy: number | null | undefined) => (submitBy ? { dueDate: toDateAndTime(submitBy).date, dueTime: toDateAndTime(submitBy).time } : { dueDate: '', dueTime: '' })

/** What is wrong with the deadline as entered (null: fine). An unchanged deadline may already have passed. */
function dueError(draft: Pick<JobDraft, 'dueDate' | 'dueTime'>, saved: number | null | undefined) {
  if (!draft.dueDate !== !draft.dueTime) return draft.dueDate ? 'Choose the time too.' : 'Choose the date too.'
  const at = draftSubmitBy(draft)
  if (at && at !== (saved ?? null) && at <= Date.now()) return 'The deadline must be later than now.'
  return null
}

/** "Submissions due by": a date and a 12-hour time, both optional together. */
function DueByField({ draft, onChange }: { draft: Pick<JobDraft, 'dueDate' | 'dueTime'>; onChange: (v: Pick<JobDraft, 'dueDate' | 'dueTime'>) => void }) {
  return (
    <Field label="Submissions due by (optional)">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" min={todayIso()} value={draft.dueDate} onChange={(e) => onChange({ ...draft, dueDate: e.target.value })} className="w-40" aria-label="Due date" />
        <TimeSelect label="Due time" value={draft.dueTime} onChange={(dueTime) => onChange({ ...draft, dueTime })} />
        {(draft.dueDate || draft.dueTime) && (
          <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => onChange({ dueDate: '', dueTime: '' })}>
            Clear
          </Button>
        )}
      </div>
    </Field>
  )
}

/** Compulsory with every edit of a client / job opening: it goes into the log and the alert. */
function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Reason for editing" required hint="Written in the log and sent with the alert to the admins and the PM / PE on the job openings.">
      <Textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. The client changed the job title in their latest mail." required />
    </Field>
  )
}

function useSaver() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      playSound('success')
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { error, busy, save }
}

/**
 * Adding and editing clients and job openings is the Client Team's work: an Admin may only once the
 * Super Admin allows it (read from the live team list, so it applies at once).
 */
function useCanEditCatalog() {
  const { me, users } = useApp()
  return canEditCatalog(users.find((u) => u.id === me.id) ?? me)
}

const NOT_ALLOWED = 'Adding and editing clients and job openings is the Client Team’s work. Ask the Super Admin to allow you.'

/** Said on the Clients / Job openings cards to an Admin who may not add or edit them. */
function NotAllowedNote() {
  return <p className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">🔒 {NOT_ALLOWED}</p>
}

/** Clients (and their Client Team member) and job openings; Admins also get the Team section. */
export function SetupPage({ includeTeam = true }: { includeTeam?: boolean }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ClientsCard />
      <JobsCard />
      {includeTeam && (
        <div className="lg:col-span-2">
          <TeamCard />
        </div>
      )}
      <LogCard />
    </div>
  )
}

/** Admins: everything added, edited, assigned or deleted in clients and job openings. */
function LogCard() {
  const { me } = useApp()
  const [open, setOpen] = useState(false)
  if (!isAdminRole(me.role)) return null
  return (
    <div className="lg:col-span-2">
      <Card
        title="Clients & job openings log"
        actions={
          <Button variant="secondary" className="py-1 text-xs" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Show log'}
          </Button>
        }
      >
        {open ? <AllCatalogLog /> : <p className="text-sm text-slate-500">Every client and job opening added, edited (with the reason), assigned or deleted — with date, time and who did it.</p>}
      </Card>
    </div>
  )
}

function ClientsCard() {
  const { clients, users, backend, nameOf, names, me } = useApp()
  const cts = users.filter((u) => u.role === 'ClientTeam')
  const [editing, setEditing] = useState<Client | null>(null)
  const [reason, setReason] = useState('')
  const [deleting, setDeleting] = useState<Client | null>(null)
  const [logOf, setLogOf] = useState<Client | null>(null)
  const { error, busy, save } = useSaver()
  const canEdit = useCanEditCatalog()
  // Deleting a client takes its job openings and submissions with it: the Super Admin only.
  const canDelete = me.role === 'SuperAdmin'

  // A Client Team member adding a client looks after it themselves unless they pick someone else.
  const blank = (): Client => ({ id: '', name: '', contactPerson: '', assignedClientTeam: me.role === 'ClientTeam' ? me.id : (cts[0]?.id ?? '') })
  const startEditing = (c: Client) => {
    setEditing(c)
    setReason('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const c = {
      ...editing,
      name: editing.name.trim(),
      contactPerson: editing.contactPerson.trim(),
      ...(editing.id ? {} : { createdAt: Date.now(), createdBy: me.id, createdByName: me.name }),
    }
    if (!c.name || !c.assignedClientTeam) return
    if (await save(async () => void (await backend.saveClient(c, { by: me, reason, names })))) setEditing(null)
  }

  return (
    <Card
      title="Clients"
      actions={
        <Button variant="secondary" className="py-1 text-xs" onClick={() => startEditing(blank())} disabled={!canEdit} title={canEdit ? undefined : NOT_ALLOWED}>
          ＋ Add client
        </Button>
      }
    >
      {!canEdit && <NotAllowedNote />}
      {editing && canEdit && (
        <form onSubmit={submit} className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-700">{editing.id ? `Edit client ${editing.id}` : 'New client'}</div>
          <Input placeholder="Client name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
          <Input placeholder="Contact person" value={editing.contactPerson} onChange={(e) => setEditing({ ...editing, contactPerson: e.target.value })} />
          <Select value={editing.assignedClientTeam} onChange={(e) => setEditing({ ...editing, assignedClientTeam: e.target.value })} required>
            <option value="">— Client Team member —</option>
            {cts.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">New submissions for this client go to this Client Team member.</p>
          {editing.id && <ReasonField value={reason} onChange={setReason} />}
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" busy={busy}>Save</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      )}
      <ul className="divide-y divide-slate-100 text-sm">
        {[...clients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="font-medium">{c.name} <span className="text-xs font-normal text-slate-400">{c.id}</span></div>
              <div className="text-xs text-slate-500">
                {c.contactPerson || 'No contact'} · Client Team: {nameOf(c.assignedClientTeam)}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" className="py-1 text-xs" onClick={() => startEditing(c)} disabled={!canEdit} title={canEdit ? undefined : NOT_ALLOWED}>Edit</Button>
              <Button variant="ghost" className="py-1 text-xs" onClick={() => setLogOf(c)}>Log</Button>
              {canDelete && (
                <Button variant="ghost" className="py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => setDeleting(c)}>Delete</Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {canDelete && deleting && <DeleteClientDialog client={deleting} onClose={() => setDeleting(null)} />}
      {logOf && <CatalogLogModal kind="client" id={logOf.id} title={`${logOf.name} (${logOf.id})`} onClose={() => setLogOf(null)} />}
    </Card>
  )
}

type JobForm = JobDraft & { id: string; clientId: string; status: JobStatus; reason: string }

function JobsCard() {
  const { clients, jobs, backend, me, names } = useApp()
  /** a job opening being added (empty id) or edited */
  const [draft, setDraft] = useState<JobForm | null>(null)
  const [logOf, setLogOf] = useState<JobOpening | null>(null)
  const { error, busy, save } = useSaver()
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id
  const draftDueError = draft && dueError(draft, jobs.find((j) => j.id === draft.id)?.submitBy)
  const canEdit = useCanEditCatalog()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft || !draft.title.trim() || !draft.clientId) return
    const existing = jobs.find((j) => j.id === draft.id)
    if (dueError(draft, existing?.submitBy)) return
    const client = clients.find((c) => c.id === draft.clientId)
    if (!existing && !client) return
    const job = existing
      ? { ...existing, title: draft.title.trim(), details: draft.details.trim(), status: draft.status, priority: draft.priority, submitBy: draftSubmitBy(draft) }
      : newJob(client!, draft, me)
    if (await save(() => backend.saveJob(job, { by: me, reason: draft.reason }))) setDraft(null)
  }

  return (
    <Card
      title="Job openings"
      actions={
        <Button
          variant="secondary"
          className="py-1 text-xs"
          onClick={() => setDraft({ id: '', clientId: '', status: 'open', reason: '', ...blankJobDraft() })}
          disabled={!canEdit}
          title={canEdit ? undefined : NOT_ALLOWED}
        >
          ＋ Add job
        </Button>
      }
    >
      {!canEdit && <NotAllowedNote />}
      {draft && canEdit && (
        <form onSubmit={submit} className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-700">{draft.id ? `Edit job opening ${draft.id}` : 'New job opening'}</div>
          <Select value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })} required disabled={!!draft.id}>
            <option value="">— Client —</option>
            {[...clients]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
          <Input placeholder="Job title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
          <Textarea rows={4} placeholder="Job details — requirements, experience, location, salary, number of openings…" value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Job status" required>
              <Select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as JobPriority })} required>
                {(Object.keys(JOB_PRIORITY_LABEL) as JobPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {JOB_PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            </Field>
            {draft.id && (
              <Field label="Open / on hold / closed">
                <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as JobStatus })}>
                  {(Object.keys(JOB_STATUS_LABEL) as JobStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {JOB_STATUS_LABEL[st]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <DueByField draft={draft} onChange={(due) => setDraft({ ...draft, ...due })} />
          {draftDueError && <p className="text-xs text-red-600">{draftDueError}</p>}
          {!draft.id && <Input placeholder="Note for the admins (optional)" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />}
          {!draft.id && <p className="text-xs text-slate-500">The job opening goes to the admins, who assign it to a PM.</p>}
          {draft.id && <ReasonField value={draft.reason} onChange={(reason) => setDraft({ ...draft, reason })} />}
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" busy={busy} disabled={!!draftDueError}>Save</Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </form>
      )}
      <ul className="divide-y divide-slate-100 text-sm">
        {[...jobs]
          .sort((a, b) => clientName(a.clientId).localeCompare(clientName(b.clientId)) || a.title.localeCompare(b.title))
          .map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="font-medium">{j.title} <span className="text-xs font-normal text-slate-400">{j.id}</span></div>
                <div className="text-xs text-slate-500">
                  {j.clientName || clientName(j.clientId)} · {JOB_STATUS_LABEL[j.status]} · {priorityLabel(j.priority)}
                  {j.delegation ? ` · ${delegationLabel(j.delegation)}` : ''}
                  {j.submitBy ? ` · Due by ${dueLabel(j.submitBy)}` : ''}
                </div>
                <ToneBadge tone={jobStep(j) === 'with_pe' ? 'green' : 'yellow'} className="mt-1">{jobStepLabel(j, names)}</ToneBadge>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  className="py-1 text-xs"
                  disabled={!canEdit}
                  title={canEdit ? undefined : NOT_ALLOWED}
                  onClick={() =>
                    setDraft({ id: j.id, clientId: j.clientId, title: j.title, details: j.details ?? '', note: '', priority: j.priority ?? 'active', ...dueDraft(j.submitBy), status: j.status, reason: '' })
                  }
                >
                  Edit
                </Button>
                <Button variant="ghost" className="py-1 text-xs" onClick={() => setLogOf(j)}>Log</Button>
              </div>
            </li>
          ))}
      </ul>
      {logOf && <CatalogLogModal kind="job" id={logOf.id} title={`${logOf.title} (${logOf.id}) at ${logOf.clientName}`} onClose={() => setLogOf(null)} />}
    </Card>
  )
}

const newPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => chars[b % chars.length]).join('')
}

const blankUser = (): AppUser => ({ id: '', userId: '', name: '', role: 'PE', contactNumber: '', email: '', reportsTo: null, active: true })

function TeamCard() {
  const { users, backend, me } = useApp()
  const pms = users.filter((u) => u.role === 'PM')
  const [draft, setDraft] = useState<AppUser | null>(null)
  const [created, setCreated] = useState<{ userId: string; password: string } | null>(null)
  const { error, busy, save } = useSaver()
  const isNew = draft !== null && !draft.id
  // Only the Super Admin can give someone an Admin role or change an Admin's account (also enforced in firestore.rules).
  const superAdmin = me.role === 'SuperAdmin'
  const roleChoices = superAdmin ? ROLES : ROLES.filter((r) => !isAdminRole(r))
  const canEdit = (u: AppUser) => superAdmin || !isAdminRole(u.role)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    const u: AppUser = {
      ...draft,
      userId: draft.userId.trim().toLowerCase(),
      name: properName(draft.name),
      contactNumber: draft.contactNumber.trim(),
      email: draft.email.trim().toLowerCase(),
      reportsTo: draft.role === 'PE' ? (draft.reportsTo ?? null) : null,
      // Only an Admin is ever allowed to add and edit clients and job openings (set by the Super Admin).
      canEditCatalog: draft.role === 'Admin' && draft.canEditCatalog === true,
    }
    if (isNew) {
      if (!/^[a-z0-9._-]{3,30}$/.test(u.userId)) return void alert('User ID: 3–30 characters, letters/numbers/dot/dash only (e.g. shubham).')
      if (users.some((x) => x.userId === u.userId)) return void alert('That User ID is already taken.')
      const password = newPassword()
      const ok = await save(async () => {
        const uid = await backend.createLogin(u.userId, password)
        await backend.saveUser({ ...u, id: uid })
      })
      if (ok) {
        setCreated({ userId: u.userId, password })
        setDraft(null)
      }
    } else if (await save(() => backend.saveUser(u))) setDraft(null)
  }

  return (
    <Card title="Team (users)" actions={<Button variant="secondary" className="py-1 text-xs" onClick={() => setDraft(blankUser())}>＋ Add person</Button>}>
      {created && (
        <div className="mb-3">
          <Alert tone="ok">
            Login created — User ID <b>{created.userId}</b>, password <b className="font-mono">{created.password}</b>. Copy it now and share it
            privately; it is not shown again.{' '}
            <button className="underline" onClick={() => setCreated(null)}>Done</button>
          </Alert>
        </div>
      )}
      {draft && (
        <form onSubmit={submit} className="mb-4 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
          <div className="text-sm font-semibold sm:col-span-3">{isNew ? 'New person' : `Edit ${draft.name}`}</div>
          <Input placeholder="User ID (for login)" value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })} required disabled={!isNew} />
          <Input placeholder="Full name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          <Select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })} disabled={draft.id === me.id}>
            {(roleChoices.includes(draft.role) ? roleChoices : [draft.role, ...roleChoices]).map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </Select>
          <Input type="tel" placeholder="Contact number" value={draft.contactNumber} onChange={(e) => setDraft({ ...draft, contactNumber: e.target.value })} />
          <Input type="email" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          <Select value={draft.reportsTo ?? ''} onChange={(e) => setDraft({ ...draft, reportsTo: e.target.value || null })} disabled={draft.role !== 'PE'}>
            <option value="">Reports to (PEs only)</option>
            {pms.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          {!isNew && draft.id !== me.id && (
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              Active (untick to block this person from logging in)
            </label>
          )}
          {superAdmin && draft.role === 'Admin' && (
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" checked={draft.canEditCatalog === true} onChange={(e) => setDraft({ ...draft, canEditCatalog: e.target.checked })} />
              Allow to add and edit clients and job openings (otherwise the Client Team’s work only)
            </label>
          )}
          {isNew && <p className="text-xs text-slate-500 sm:col-span-3">A password is generated and shown to you once after saving.</p>}
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" busy={busy}>{busy ? 'Saving…' : isNew ? 'Create login' : 'Save'}</Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </form>
      )}
      {error && <div className="mb-2"><Alert>{error}</Alert></div>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1.5 pr-3">Name</th>
              <th className="py-1.5 pr-3">User ID</th>
              <th className="py-1.5 pr-3">Type</th>
              <th className="py-1.5 pr-3">Contact no.</th>
              <th className="py-1.5 pr-3">Email</th>
              <th className="py-1.5 pr-3">Reports to</th>
              <th className="py-1.5 pr-3">Status</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...users].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name)).map((u) => (
              <tr key={u.id} className={u.active === false ? 'text-slate-400' : ''}>
                <td className="py-2 pr-3 font-medium">{u.name}</td>
                <td className="py-2 pr-3 font-mono text-xs">{u.userId}</td>
                <td className="py-2 pr-3">{ROLE_LABELS[u.role]}</td>
                <td className="py-2 pr-3">{u.contactNumber || '—'}</td>
                <td className="py-2 pr-3">{u.email || '—'}</td>
                <td className="py-2 pr-3">{u.role === 'PE' ? (pms.find((p) => p.id === u.reportsTo)?.name ?? '—') : '—'}</td>
                <td className="py-2 pr-3">
                  {u.active === false ? 'Deactivated' : 'Active'}
                  {u.role === 'Admin' && u.canEditCatalog && <div className="text-[11px] text-slate-500">Can add / edit clients & jobs</div>}
                </td>
                <td className="py-2 text-right">
                  {canEdit(u) ? (
                    <Button variant="ghost" className="py-1 text-xs" onClick={() => setDraft({ ...blankUser(), ...u })}>Edit</Button>
                  ) : (
                    <span className="text-xs text-slate-400" title="Only the Super Admin can change Admin accounts">Super Admin only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
