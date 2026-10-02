import { useState, type FormEvent } from 'react'
import { playSound } from '../alarm/sound'
import { properName } from '../workflow/names'
import { DeleteClientDialog } from '../components/DeleteDialogs'
import { ToneBadge } from '../components/StatusBadge'
import { Alert, Button, Card, Input, Select, Textarea } from '../components/ui'
import { useApp } from '../context/AppContext'
import { isAdminRole, ROLE_LABELS, type AppUser, type Client, type JobOpening, type JobStatus, type Role } from '../types'
import { jobStep, jobStepLabel } from '../workflow/jobs'

const ROLES: Role[] = ['SuperAdmin', 'Admin', 'PM', 'ClientTeam', 'PE']

/** A new job opening for this client: it goes to the admins first, who assign the PM. */
function newJob(client: Pick<Client, 'id' | 'name' | 'assignedClientTeam'>, { title, details, note }: JobDraft, me: AppUser): JobOpening {
  const now = Date.now()
  return {
    id: '',
    clientId: client.id,
    clientName: client.name,
    title: title.trim(),
    details: details.trim(),
    status: 'open',
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

type JobDraft = { title: string; details: string; note: string }
const blankJobDraft = (): JobDraft => ({ title: '', details: '', note: '' })

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
    </div>
  )
}

function ClientsCard() {
  const { clients, users, backend, nameOf, me } = useApp()
  const cts = users.filter((u) => u.role === 'ClientTeam')
  const [editing, setEditing] = useState<Client | null>(null)
  const [deleting, setDeleting] = useState<Client | null>(null)
  /** job openings typed in with a new client */
  const [newJobs, setNewJobs] = useState<JobDraft[]>([])
  const { error, busy, save } = useSaver()

  // A Client Team member adding a client looks after it themselves unless they pick someone else.
  const blank = (): Client => ({ id: '', name: '', contactPerson: '', assignedClientTeam: me.role === 'ClientTeam' ? me.id : (cts[0]?.id ?? '') })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const jobsToAdd = editing.id ? [] : newJobs.filter((j) => j.title.trim())
    const c = {
      ...editing,
      name: editing.name.trim(),
      contactPerson: editing.contactPerson.trim(),
      // A new client says how many job openings come with it, so the admins are alerted at once with the right message.
      ...(editing.id ? {} : { createdAt: Date.now(), createdBy: me.id, createdByName: me.name, jobsAtCreation: jobsToAdd.length }),
    }
    if (!c.name || !c.assignedClientTeam) return
    const ok = await save(async () => {
      const id = await backend.saveClient(c)
      // Each job opening goes to the admins, who assign it to a PM.
      for (const j of jobsToAdd) await backend.saveJob(newJob({ ...c, id }, j, me))
    })
    if (ok) {
      setEditing(null)
      setNewJobs([])
    }
  }

  const startAdding = () => {
    setEditing(blank())
    setNewJobs([blankJobDraft()])
  }
  const setNewJob = (i: number, patch: Partial<JobDraft>) => setNewJobs((list) => list.map((j, k) => (k === i ? { ...j, ...patch } : j)))

  return (
    <Card title="Clients" actions={<Button variant="secondary" className="py-1 text-xs" onClick={startAdding}>＋ Add client</Button>}>
      {editing && (
        <form onSubmit={submit} className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3">
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
          {!editing.id && (
            <div className="space-y-2 border-t border-slate-200 pt-2">
              <div className="text-sm font-semibold text-slate-700">Job openings</div>
              {newJobs.map((j, i) => (
                <div key={i} className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2">
                  <div className="flex gap-2">
                    <Input placeholder={`Job title ${i + 1}`} value={j.title} onChange={(e) => setNewJob(i, { title: e.target.value })} />
                    {newJobs.length > 1 && (
                      <Button type="button" variant="ghost" className="py-1 text-xs" onClick={() => setNewJobs((list) => list.filter((_, k) => k !== i))}>
                        Remove
                      </Button>
                    )}
                  </div>
                  <Textarea rows={3} placeholder="Job details — requirements, experience, location, salary, number of openings…" value={j.details} onChange={(e) => setNewJob(i, { details: e.target.value })} />
                  <Input placeholder="Note for the admins (optional)" value={j.note} onChange={(e) => setNewJob(i, { note: e.target.value })} />
                </div>
              ))}
              <Button type="button" variant="secondary" className="py-1 text-xs" onClick={() => setNewJobs((list) => [...list, blankJobDraft()])}>
                ＋ Another job opening
              </Button>
              <p className="text-xs text-slate-500">The client and its job openings go to the admins, who assign each job opening to a PM.</p>
            </div>
          )}
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
              <Button variant="ghost" className="py-1 text-xs" onClick={() => setEditing(c)}>Edit</Button>
              <Button variant="ghost" className="py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => setDeleting(c)}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>
      {deleting && <DeleteClientDialog client={deleting} onClose={() => setDeleting(null)} />}
    </Card>
  )
}

function JobsCard() {
  const { clients, jobs, backend, me, names } = useApp()
  /** a job opening being added (empty id) or edited */
  const [draft, setDraft] = useState<(JobDraft & { id: string; clientId: string }) | null>(null)
  const { error, busy, save } = useSaver()
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft || !draft.title.trim() || !draft.clientId) return
    const existing = jobs.find((j) => j.id === draft.id)
    const client = clients.find((c) => c.id === draft.clientId)
    if (!existing && !client) return
    const job = existing ? { ...existing, title: draft.title.trim(), details: draft.details.trim() } : newJob(client!, draft, me)
    if (await save(() => backend.saveJob(job))) setDraft(null)
  }

  return (
    <Card
      title="Job openings"
      actions={<Button variant="secondary" className="py-1 text-xs" onClick={() => setDraft({ id: '', clientId: '', ...blankJobDraft() })}>＋ Add job</Button>}
    >
      {draft && (
        <form onSubmit={submit} className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3">
          <Select value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })} required disabled={!!draft.id}>
            <option value="">— Client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input placeholder="Job title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
          <Textarea rows={4} placeholder="Job details — requirements, experience, location, salary, number of openings…" value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} />
          {!draft.id && <Input placeholder="Note for the admins (optional)" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />}
          {!draft.id && <p className="text-xs text-slate-500">The job opening goes to the admins, who assign it to a PM.</p>}
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" busy={busy}>Save</Button>
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
                <div className="text-xs text-slate-500">{j.clientName || clientName(j.clientId)}</div>
                <ToneBadge tone={jobStep(j) === 'with_pe' ? 'green' : 'yellow'} className="mt-1">{jobStepLabel(j, names)}</ToneBadge>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" className="py-1 text-xs" onClick={() => setDraft({ id: j.id, clientId: j.clientId, title: j.title, details: j.details ?? '', note: '' })}>
                  Edit
                </Button>
                <Select
                  value={j.status}
                  onChange={(e) => void save(() => backend.saveJob({ ...j, status: e.target.value as JobStatus }))}
                  disabled={busy}
                  className="w-auto py-1 text-xs"
                >
                  <option value="open">Open</option>
                  <option value="on-hold">On hold</option>
                  <option value="closed">Closed</option>
                </Select>
              </div>
            </li>
          ))}
      </ul>
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
                <td className="py-2 pr-3">{u.active === false ? 'Deactivated' : 'Active'}</td>
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
      <p className="mt-2 text-xs text-slate-500">
        Passwords are kept only in Firebase Authentication, never in this table. To reset one, run <code>npm run users -- reset &lt;userId&gt;</code>.
        {!superAdmin && ' Only the Super Admin can add or change Admin accounts.'}
      </p>
    </Card>
  )
}
