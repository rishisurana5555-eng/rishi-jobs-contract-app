import { useApp } from '../context/AppContext'
import { Field, Select } from './ui'

/**
 * The client and job opening a submission is already for, as saved on it. A job opening can move to
 * another PM / PE after candidates were submitted for it: those candidates stay with the PM / PE who
 * had them, so their own client and job opening must stay selectable even though that person no
 * longer sees the job opening.
 */
export interface KeptPlacement {
  clientId: string
  clientName: string
  jobId: string
  jobTitle: string
  assignedClientTeam: string
}

/** Clients and job openings to choose from: the person's own, plus `keep`. */
export function usePlacementLists(keep?: KeptPlacement) {
  const { clients, jobs } = useApp()
  const allClients = [...clients.map((c) => ({ id: c.id, name: c.name, assignedClientTeam: c.assignedClientTeam }))]
  const allJobs = [...jobs.map((j) => ({ id: j.id, clientId: j.clientId, title: j.title, status: j.status }))]
  if (keep?.clientId && !allClients.some((c) => c.id === keep.clientId))
    allClients.push({ id: keep.clientId, name: keep.clientName, assignedClientTeam: keep.assignedClientTeam })
  if (keep?.jobId && !allJobs.some((j) => j.id === keep.jobId)) allJobs.push({ id: keep.jobId, clientId: keep.clientId, title: keep.jobTitle, status: 'open' })
  return { clients: allClients, jobs: allJobs }
}

/** Client + open job opening dropdowns. `keepJobId` stays listed even if that job is no longer open; `keep` even if it isn't this person's. */
export function ClientJobFields({
  clientId,
  jobId,
  onChange,
  keepJobId,
  keep,
}: {
  clientId: string
  jobId: string
  onChange: (v: { clientId: string; jobId: string }) => void
  keepJobId?: string
  keep?: KeptPlacement
}) {
  const { nameOf } = useApp()
  const { clients, jobs } = usePlacementLists(keep)
  const kept = keepJobId ?? keep?.jobId
  const client = clients.find((c) => c.id === clientId)
  const clientJobs = jobs.filter((j) => j.clientId === clientId && (j.status === 'open' || j.id === kept))
  return (
    <>
      <Field label="Client" required hint={client && `Client Team: ${nameOf(client.assignedClientTeam)}`}>
        <Select value={clientId} onChange={(e) => onChange({ clientId: e.target.value, jobId: '' })} required>
          <option value="">— Select client —</option>
          {[...clients]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Job opening" required>
        <Select value={jobId} onChange={(e) => onChange({ clientId, jobId: e.target.value })} required disabled={!clientId}>
          <option value="">{clientId && !clientJobs.length ? 'No open jobs for this client' : '— Select job —'}</option>
          {clientJobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </Select>
      </Field>
    </>
  )
}
