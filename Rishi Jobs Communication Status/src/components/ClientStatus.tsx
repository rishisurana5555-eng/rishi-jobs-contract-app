import { useState } from 'react'
import { useApp } from '../context/AppContext'
import type { Application } from '../types'
import { fmtDateTime, timeAgo } from '../workflow/dates'
import { beforeClientTeam, isClosed } from '../workflow/workflow'
import { StatCard } from './DashboardWidgets'
import { StatusBadge } from './StatusBadge'
import { Card, Empty, Select } from './ui'

/**
 * The Client Team's view of each of their clients: every candidate submitted for it so far (also those
 * still with the PE / PM), when, by whom, and where each one is now.
 */
export function ClientStatus() {
  const { clients, apps } = useApp()
  const [clientId, setClientId] = useState('')
  const mine = [...clients].sort((a, b) => a.name.localeCompare(b.name))
  const shown = mine.filter((c) => !clientId || c.id === clientId)

  if (!mine.length) return <Empty>You don’t look after any client yet.</Empty>

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-auto py-1.5" aria-label="Client">
          <option value="">All my clients ({mine.length})</option>
          {mine.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      {shown.map((c) => (
        <ClientCard
          key={c.id}
          name={c.name}
          id={c.id}
          apps={apps.filter((a) => a.clientId === c.id)}
        />
      ))}
    </section>
  )
}

function ClientCard({ name, id, apps }: { name: string; id: string; apps: Application[] }) {
  const { nameOf, names, openApp, now } = useApp()
  const count = (test: (a: Application) => boolean) => apps.filter(test).length
  const first = apps.length ? Math.min(...apps.map((a) => a.createdAt)) : null
  const latest = apps.length ? Math.max(...apps.map((a) => a.createdAt)) : null
  const rows = [...apps].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <Card
      title={
        <span>
          {name} <span className="text-xs font-normal text-slate-400">{id}</span>
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <StatCard label="Submissions till date" value={apps.length} />
        <StatCard label="With PE / PM" value={count((a) => beforeClientTeam(a.stage))} tone="amber" />
        <StatCard label="With you / client" value={count((a) => !beforeClientTeam(a.stage) && a.stage !== 'interview_scheduled' && !isClosed(a.stage))} />
        <StatCard label="Interview scheduled" value={count((a) => a.stage === 'interview_scheduled')} tone="blue" />
        <StatCard label="Placed" value={count((a) => a.stage === 'closed_placed')} tone="green" />
        <StatCard label="Rejected" value={count((a) => a.stage === 'closed_rejected')} />
        <StatCard label="Backout" value={count((a) => a.stage === 'closed_backout')} />
      </div>
      {first && latest && (
        <p className="mt-2 text-xs text-slate-500">
          First submission {fmtDateTime(first)} · latest {fmtDateTime(latest)}
        </p>
      )}

      {!rows.length ? (
        <p className="mt-3 text-sm text-slate-400">No candidates submitted for this client yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Candidate</th>
                <th className="px-3 py-2">Job opening</th>
                <th className="px-3 py-2">Submitted on</th>
                <th className="px-3 py-2">By (PE)</th>
                <th className="px-3 py-2">PM</th>
                <th className="px-3 py-2">Current status</th>
                <th className="px-3 py-2">Last update</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openApp(a.id)}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-900">{a.candidateName}</span> <span className="text-xs text-slate-400">{a.candidateId}</span>
                  </td>
                  <td className="px-3 py-2">{a.jobTitle}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{fmtDateTime(a.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{nameOf(a.assignedPE)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{nameOf(a.assignedPM)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge app={a} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500" title={fmtDateTime(a.lastUpdatedAt)}>
                    {timeAgo(a.lastUpdatedAt, now)} · {names(a.lastUpdatedBy) ?? a.lastUpdatedByName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
