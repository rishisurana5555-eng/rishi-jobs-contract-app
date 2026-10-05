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
 * when their client is deleted. PEs can send their candidate to another client; only the Super Admin can
 * delete a candidate. The PM sees them as a table.
 * With `searchFirst` (admins), nothing is listed until something is searched for.
 */
export function CandidatesList({ searchFirst = false }: { searchFirst?: boolean }) {
  const { candidates, apps, me, nameOf, names, now, openApp, setDeletingCandidate } = useApp()
  const canDelete = me.role === 'SuperAdmin'
  const [sending, setSending] = useState<CandidateProfile | null>(null)
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const list = candidates
    .filter((c) => !q || [c.candidateName, c.id, c.candidateContactNumber, c.candidateAltContactNumber, c.candidateEmail].some((s) => (s ?? '').toLowerCase().includes(q)))
    .sort((a, b) => a.candidateName.localeCompare(b.candidateName))

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
      ) : me.role === 'PM' ? (
        <CandidateTable list={list} />
      ) : (
        <ul className="space-y-2">
          {list.map((c) => {
            const sent = apps.filter((a) => a.candidateId === c.id).sort((a, b) => a.clientName.localeCompare(b.clientName) || a.jobTitle.localeCompare(b.jobTitle))
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
                    {canDelete && (
                      <Button
                        variant="ghost"
                        className="px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                        onClick={() => setDeletingCandidate({ candidateId: c.id, name: c.candidateName })}
                      >
                        🗑 Delete
                      </Button>
                    )}
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
        <Modal title={`Send ${sending.candidateName} to another client`} onClose={() => setSending(null)} full>
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

/** The PM's candidates, one row each (A–Z): contact, the PE who added them, and every client / job they were sent to. */
function CandidateTable({ list }: { list: CandidateProfile[] }) {
  const { apps, me, nameOf, names, now, openApp } = useApp()
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Candidate</th>
            <th className="px-3 py-2">Contact</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">PE</th>
            <th className="px-3 py-2">Added</th>
            <th className="px-3 py-2">Client / Job — status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((c) => {
            const sent = apps.filter((a) => a.candidateId === c.id).sort((a, b) => a.clientName.localeCompare(b.clientName) || a.jobTitle.localeCompare(b.jobTitle))
            return (
              <tr key={c.id} className="align-top">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{c.candidateName}</div>
                  <div className="text-xs text-slate-400">{c.id}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                  {displayPhone(c.candidateContactNumber)}
                  {c.candidateAltContactNumber && <div className="text-xs text-slate-400">{displayPhone(c.candidateAltContactNumber)}</div>}
                </td>
                <td className="px-3 py-2 text-slate-600">{c.candidateEmail || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2">{nameOf(c.pe)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{timeAgo(c.createdAt, now)}</td>
                <td className="px-3 py-2">
                  {sent.length ? (
                    <div className="flex flex-col items-start gap-1">
                      {sent.map((a) => (
                        <button key={a.id} onClick={() => openApp(a.id)} className="text-left" title="Open this submission">
                          <ToneBadge tone={toneFor(a, me.id, now)}>
                            <b>{a.clientName}</b> · {a.jobTitle} — {viewerLabel(a, me.id, me.role, now, names)}
                          </ToneBadge>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs italic text-slate-400">Not linked to any client.</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
