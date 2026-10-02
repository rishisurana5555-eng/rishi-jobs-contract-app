import { useState } from 'react'
import { useApp } from '../context/AppContext'
import type { CandidateProfile } from '../types'
import { timeAgo } from '../workflow/dates'
import { toneFor, viewerLabel } from '../workflow/workflow'
import { AddCandidateForm } from './AddCandidateForm'
import { displayPhone } from './PhoneInput'
import { ToneBadge } from './StatusBadge'
import { Button, Empty, Input, Modal } from './ui'

/**
 * Every candidate the person can see, with the clients each one was sent to. A candidate stays here
 * when their client is deleted. PEs can send their candidate to another client; anyone can delete.
 * With `searchFirst` (admins), nothing is listed until something is searched for.
 */
export function CandidatesList({ searchFirst = false }: { searchFirst?: boolean }) {
  const { candidates, apps, me, nameOf, names, now, openApp, setDeletingCandidate } = useApp()
  const [sending, setSending] = useState<CandidateProfile | null>(null)
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const list = candidates
    .filter((c) => !q || [c.candidateName, c.id, c.candidateContactNumber, c.candidateAltContactNumber, c.candidateEmail].some((s) => (s ?? '').toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{list.length} candidates</span>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, ID, phone, email…" className="w-full py-1.5 sm:ml-auto sm:w-64" />
      </div>
      {searchFirst && !q ? (
        <Empty>Search by name, candidate ID, phone or email to see a candidate.</Empty>
      ) : !list.length ? (
        <Empty>{candidates.length ? 'No candidates match.' : 'No candidates yet.'}</Empty>
      ) : (
        <ul className="space-y-2">
          {list.map((c) => {
            const sent = apps.filter((a) => a.candidateId === c.id).sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
            return (
              <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">
                      {c.candidateName} <span className="text-xs font-normal text-slate-400">{c.id}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
                      <span>{displayPhone(c.candidateContactNumber)}</span>
                      {c.candidateAltContactNumber && <span>{displayPhone(c.candidateAltContactNumber)}</span>}
                      {c.candidateEmail && <span>{c.candidateEmail}</span>}
                      {c.originalCvUrl && (
                        <a href={c.originalCvUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">
                          Original CV
                        </a>
                      )}
                      <span>
                        Added by {c.pe === me.id ? 'you' : nameOf(c.pe)} · {timeAgo(c.createdAt, now)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {me.role === 'PE' && c.pe === me.id && (
                      <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setSending(c)}>
                        ➜ Send to another client
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                      onClick={() => setDeletingCandidate({ candidateId: c.id, name: c.candidateName })}
                    >
                      🗑 Delete
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sent.length ? (
                    sent.map((a) => (
                      <button key={a.id} onClick={() => openApp(a.id)} className="text-left" title="Open this submission">
                        <ToneBadge tone={toneFor(a, me.id, now)}>
                          <b>{a.clientName}</b> · {a.jobTitle} — {viewerLabel(a, me.id, me.role, now, names)}
                        </ToneBadge>
                      </button>
                    ))
                  ) : (
                    <span className="text-xs italic text-slate-400">Not linked to any client{me.role === 'PE' && c.pe === me.id ? ' — use “Send to another client”' : ''}.</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {sending && (
        <Modal title={`Send ${sending.candidateName} to another client`} onClose={() => setSending(null)} wide>
          <AddCandidateForm
            existing={sending}
            onDone={(id) => {
              setSending(null)
              openApp(id)
            }}
          />
        </Modal>
      )}
    </section>
  )
}
