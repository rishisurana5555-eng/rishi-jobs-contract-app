import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import type { Application } from '../types'
import { viewerLabel } from '../workflow/workflow'
import { displayPhone } from './PhoneInput'
import { Modal, cx } from './ui'

type Hit =
  | { kind: 'candidate'; id: string; name: string; sub: string }
  | { kind: 'job'; id: string; name: string; sub: string }
  | { kind: 'client'; id: string; name: string; sub: string }

const KIND_LABEL = { candidate: 'Candidate', job: 'Job opening', client: 'Client' } as const

/**
 * Header search box: type a candidate (CN-…), job opening (JB-…) or client (CL-…) ID, or a name,
 * right in the header; matches drop down below it, and picking one shows its details.
 */
export function GlobalSearchButton() {
  const { apps, candidates, jobs, clients, nameOf } = useApp()
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [picked, setPicked] = useState<Hit | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setFocused(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // Candidates: profiles the person can see, plus any on the submissions they can see.
  const people = useMemo(() => {
    const m = new Map<string, { id: string; name: string; phone: string }>()
    for (const a of apps) m.set(a.candidateId, { id: a.candidateId, name: a.candidateName, phone: a.candidateContactNumber })
    for (const c of candidates) m.set(c.id, { id: c.id, name: c.candidateName, phone: c.candidateContactNumber })
    return [...m.values()]
  }, [apps, candidates])

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id
  const term = q.trim().toLowerCase()
  const hits: Hit[] = !term
    ? []
    : [
        ...people.map((p): Hit => ({ kind: 'candidate', id: p.id, name: p.name, sub: displayPhone(p.phone) })),
        ...jobs.map((j): Hit => ({ kind: 'job', id: j.id, name: j.title, sub: `${clientName(j.clientId)} · ${j.status}` })),
        ...clients.map((c): Hit => ({ kind: 'client', id: c.id, name: c.name, sub: `Client Team: ${nameOf(c.assignedClientTeam)}` })),
      ]
        .filter((h) => h.id.toLowerCase().includes(term) || h.name.toLowerCase().includes(term))
        // An exact ID match first, then IDs that start with what was typed.
        .sort((a, b) => rank(a, term) - rank(b, term) || a.id.localeCompare(b.id))
        .slice(0, 30)

  const pick = (h: Hit) => {
    setPicked(h)
    setFocused(false)
  }

  return (
    <div className="relative" ref={box}>
      <div className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 focus-within:bg-white focus-within:text-slate-900">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setFocused(true)
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) pick(hits[0])
            if (e.key === 'Escape') setFocused(false)
          }}
          placeholder="Search ID…"
          aria-label="Search a candidate, job opening or client by ID or name"
          className="w-28 bg-transparent text-sm placeholder:text-brand-200 focus:outline-none sm:w-52"
        />
        {q && (
          <button onClick={() => setQ('')} className="text-xs opacity-60 hover:opacity-100" aria-label="Clear search">
            ✕
          </button>
        )}
      </div>
      {focused && term && (
        <div className="absolute right-0 z-30 mt-2 w-[26rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl bg-white text-slate-800 shadow-2xl ring-1 ring-slate-200">
          {!hits.length ? (
            <p className="px-3 py-4 text-center text-sm text-slate-500">Nothing found for “{q.trim()}”.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {hits.map((h) => (
                <li key={`${h.kind}:${h.id}`}>
                  <button onClick={() => pick(h)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50">
                    <span
                      className={cx(
                        'w-24 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold',
                        h.kind === 'candidate'
                          ? 'bg-brand-50 text-brand-700'
                          : h.kind === 'job'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-emerald-50 text-emerald-800',
                      )}
                    >
                      {KIND_LABEL[h.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {h.id} <span className="font-normal text-slate-700">· {h.name}</span>
                      </span>
                      <span className="block truncate text-xs text-slate-500">{h.sub}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {picked && <SearchResult picked={picked} onPick={setPicked} onClose={() => setPicked(null)} />}
    </div>
  )
}

/** Details of the picked candidate / job opening / client, with the submissions the person can see. */
function SearchResult({ picked, onPick, onClose }: { picked: Hit; onPick: (h: Hit) => void; onClose: () => void }) {
  const { apps, jobs, openApp, me, names, now } = useApp()
  const openSubmission = (a: Application) => {
    onClose()
    openApp(a.id)
  }

  const related = apps.filter((a) => (picked.kind === 'candidate' ? a.candidateId : picked.kind === 'job' ? a.jobId : a.clientId) === picked.id)

  return (
    <Modal title={`${KIND_LABEL[picked.kind]} ${picked.id}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="text-lg font-bold text-slate-900">{picked.name}</div>
          <div className="text-sm text-slate-500">{picked.sub}</div>
        </div>

        {picked.kind === 'client' && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Job openings</h3>
            <ul className="divide-y divide-slate-100 text-sm">
              {jobs
                .filter((j) => j.clientId === picked.id)
                .map((j) => (
                  <li key={j.id}>
                    <button
                      onClick={() => onPick({ kind: 'job', id: j.id, name: j.title, sub: `${picked.name} · ${j.status}` })}
                      className="w-full py-1.5 text-left hover:bg-slate-50"
                    >
                      <b>{j.id}</b> · {j.title} <span className="text-xs text-slate-500">({j.status})</span>
                    </button>
                  </li>
                ))}
              {!jobs.some((j) => j.clientId === picked.id) && <li className="py-1.5 text-slate-500">No job openings.</li>}
            </ul>
          </div>
        )}

        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Submissions you can see ({related.length})</h3>
          {related.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {related
                .sort((a, b) => a.candidateName.localeCompare(b.candidateName) || a.clientName.localeCompare(b.clientName))
                .map((a) => (
                  <li key={a.id}>
                    <button onClick={() => openSubmission(a)} className="w-full py-2 text-left hover:bg-slate-50">
                      <div className="font-medium text-slate-900">
                        {a.candidateName} <span className="text-xs font-normal text-slate-400">{a.candidateId}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {a.jobTitle} ({a.jobId}) at {a.clientName} ({a.clientId})
                      </div>
                      <div className="text-xs text-slate-700">{viewerLabel(a, me.id, me.role, now, names)}</div>
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No submissions that you can see.</p>
          )}
        </div>
      </div>
    </Modal>
  )
}

function rank(h: Hit, term: string) {
  const id = h.id.toLowerCase()
  if (id === term) return 0
  if (id.startsWith(term)) return 1
  if (id.includes(term)) return 2
  return 3
}
