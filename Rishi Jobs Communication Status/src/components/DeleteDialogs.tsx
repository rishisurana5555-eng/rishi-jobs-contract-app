import { useEffect, useState } from 'react'
import type { DeleteResult } from '../backend'
import { useApp } from '../context/AppContext'
import type { Application, Client } from '../types'
import { isClosed, STAGE_NAMES } from '../workflow/workflow'
import { Alert, Button, Modal, Spin } from './ui'

const trashNote = (r: DeleteResult) =>
  r.trashedFiles === null
    ? ' The CV files are still in Google Drive: the upload script needs updating to move them to the trash.'
    : r.trashedFiles
      ? ` ${r.trashedFiles} CV file${r.trashedFiles > 1 ? 's were' : ' was'} moved to the Drive trash.`
      : ''

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    load().then(setData, (e: Error) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { data, error }
}

function Submissions({ list }: { list: Application[] }) {
  return (
    <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm text-slate-700">
      {list.map((a) => (
        <li key={a.id}>
          <b>{a.candidateName}</b> — {a.clientName} · {a.jobTitle} <span className="text-slate-500">({STAGE_NAMES[a.stage]})</span>
        </li>
      ))}
    </ul>
  )
}

/** "Delete candidate": shows everything that goes, then deletes the candidate everywhere. */
export function DeleteCandidateDialog({ candidateId, name, onClose, onDeleted }: { candidateId: string; name: string; onClose: () => void; onDeleted?: () => void }) {
  const { backend, me } = useApp()
  const { data: list, error: loadError } = useLoad(() => backend.findCandidateApps(candidateId, me))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const r = await backend.deleteCandidate(candidateId, me)
      setDone(`${name} was deleted, with ${r.submissions} submission${r.submissions === 1 ? '' : 's'} and all history.${trashNote(r)}`)
      onDeleted?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Delete candidate — ${name}`} onClose={onClose}>
      {done ? (
        <div className="space-y-3">
          <Alert tone="ok">{done}</Alert>
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p>
            This deletes <b>{name}</b> ({candidateId}) <b>everywhere</b> and can’t be undone:
          </p>
          {loadError ? (
            <Alert>{loadError}</Alert>
          ) : !list ? (
            <p className="flex items-center gap-2 text-slate-500">
              <Spin /> Finding everything linked to this candidate…
            </p>
          ) : list.length ? (
            <>
              <p className="text-slate-700">
                {list.length} submission{list.length > 1 ? 's' : ''} to clients{list.some((a) => isClosed(a.stage)) ? ' (including placed / rejected ones)' : ''}:
              </p>
              <Submissions list={list} />
            </>
          ) : (
            <p className="text-slate-700">No submissions to clients.</p>
          )}
          <p className="text-slate-700">
            with their whole history — status changes, notes, available dates, interviews and debriefs — the candidate’s details, and their CV
            files (moved to the Google Drive trash).
          </p>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={run} busy={busy} disabled={!list}>
              {busy ? 'Deleting…' : 'Delete candidate'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** "Delete client": its job openings and the submissions to it go; the candidates stay. */
export function DeleteClientDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const { backend, jobs, me } = useApp()
  const { data: list, error: loadError } = useLoad(() => backend.findClientApps(client.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const clientJobs = jobs.filter((j) => j.clientId === client.id)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const r = await backend.deleteClient(client.id, me)
      setDone(`${client.name} was deleted, with ${clientJobs.length} job opening${clientJobs.length === 1 ? '' : 's'} and ${r.submissions} submission${r.submissions === 1 ? '' : 's'}. The candidates are kept.${trashNote(r)}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Delete client — ${client.name}`} onClose={onClose}>
      {done ? (
        <div className="space-y-3">
          <Alert tone="ok">{done}</Alert>
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p>
            This deletes the client <b>{client.name}</b> and can’t be undone:
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
            <li>
              {clientJobs.length} job opening{clientJobs.length === 1 ? '' : 's'}
              {clientJobs.length > 0 && `: ${clientJobs.map((j) => j.title).join(', ')}`}
            </li>
            <li>
              {!list ? (
                <span className="inline-flex items-center gap-2 text-slate-500">
                  <Spin /> Finding the candidates sent to this client…
                </span>
              ) : (
                `${list.length} candidate submission${list.length === 1 ? '' : 's'} to this client, with their history, interviews and the revised CVs made for it`
              )}
            </li>
          </ul>
          {list && list.length > 0 && <Submissions list={list} />}
          {loadError && <Alert>{loadError}</Alert>}
          <Alert tone="info">
            The candidates themselves are <b>kept</b> (name, contact, original CV and details) in the Candidates list — only their link to this client
            is removed. Their submissions to other clients are not touched.
          </Alert>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={run} busy={busy} disabled={!list}>
              {busy ? 'Deleting…' : 'Delete client'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
