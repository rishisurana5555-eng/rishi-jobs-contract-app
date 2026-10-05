import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import type { CatalogLogEntry, Role } from '../types'
import { fmtDateTime } from '../workflow/dates'
import { Alert, Button, Modal, Spinner, cx } from './ui'

const ROLE_SHORT: Record<Role, string> = { SuperAdmin: 'Super Admin', Admin: 'Admin', PM: 'PM', ClientTeam: 'Client Team', PE: 'PE' }

const ACTION_LABEL: Record<CatalogLogEntry['action'], string> = {
  created: 'Added',
  edited: 'Edited',
  assigned_pm: 'PM assigned',
  assigned_pe: 'PE assigned',
  note: 'Note',
  deleted: 'Deleted',
}

const ACTION_STYLE: Record<CatalogLogEntry['action'], string> = {
  created: 'bg-emerald-100 text-emerald-800',
  edited: 'bg-amber-100 text-amber-900',
  assigned_pm: 'bg-brand-100 text-brand-800',
  assigned_pe: 'bg-teal-100 text-teal-800',
  note: 'bg-slate-100 text-slate-700',
  deleted: 'bg-red-100 text-red-800',
}

/** Log entries, newest first: when, who, what — and the reason given for an edit. */
export function CatalogLogList({ entries, showSubject }: { entries: CatalogLogEntry[]; showSubject?: boolean }) {
  const { me } = useApp()
  if (!entries.length) return <p className="text-sm italic text-slate-400">Nothing logged yet.</p>
  return (
    <ol className="space-y-2">
      {entries.map((e) => (
        <li key={e.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span className={cx('rounded px-1.5 py-0.5 font-semibold', ACTION_STYLE[e.action])}>{ACTION_LABEL[e.action]}</span>
            <span>{fmtDateTime(e.at)}</span>
            <span>
              by <b className="text-slate-700">{e.by === me.id ? 'You' : e.byName}</b> ({ROLE_SHORT[e.role] ?? e.role})
            </span>
            {showSubject && (
              <span className="text-slate-400">
                · {e.kind === 'job' ? `${e.jobTitle} (${e.jobId}) at ${e.clientName}` : `${e.clientName} (${e.clientId})`}
              </span>
            )}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{e.summary}</p>
          {e.reason && (
            <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-amber-950">
              <b>Reason:</b> {e.reason}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

/** One client's or job opening's log, live. */
export function CatalogLog({ kind, id }: { kind: 'client' | 'job'; id: string }) {
  const { backend } = useApp()
  const [entries, setEntries] = useState<CatalogLogEntry[] | null>(null)
  useEffect(() => {
    setEntries(null)
    return backend.listenCatalogLog(kind, id, setEntries)
  }, [backend, kind, id])
  return entries ? <CatalogLogList entries={entries} /> : <Spinner />
}

export function CatalogLogModal({ kind, id, title, onClose }: { kind: 'client' | 'job'; id: string; title: string; onClose: () => void }) {
  return (
    <Modal title={`Log — ${title}`} onClose={onClose} wide>
      <CatalogLog kind={kind} id={id} />
    </Modal>
  )
}

/** Admins: every client's and job opening's log, including deleted ones. */
export function AllCatalogLog() {
  const { backend } = useApp()
  const [entries, setEntries] = useState<CatalogLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [limit, setLimit] = useState(50)
  const load = () => {
    setBusy(true)
    setError(null)
    backend
      .loadAllCatalogLog()
      .then(setEntries)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }
  useEffect(load, [backend])
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="secondary" className="py-1 text-xs" onClick={load} busy={busy}>
          Refresh
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {entries ? <CatalogLogList entries={entries.slice(0, limit)} showSubject /> : !error && <Spinner />}
      {entries && entries.length > limit && (
        <Button variant="ghost" className="text-xs" onClick={() => setLimit((n) => n + 50)}>
          Show more ({entries.length - limit} older)
        </Button>
      )}
    </div>
  )
}
