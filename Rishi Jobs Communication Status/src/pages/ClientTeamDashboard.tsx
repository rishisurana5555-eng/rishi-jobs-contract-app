import { useEffect, useState } from 'react'
import { ApplicationTable } from '../components/ApplicationTable'
import { byRecent, DashboardTop, FilterBar, StatCard, StatusFilter, useSearch } from '../components/DashboardWidgets'
import { ClientStatus } from '../components/ClientStatus'
import { JobOpenings } from '../components/JobOpenings'
import { ColorLegend } from '../components/StatusBadge'
import { Empty, Select, cx } from '../components/ui'
import { useApp } from '../context/AppContext'
import type { Application, Stage } from '../types'
import { beforeClientTeam, isClosed, isMyTurn } from '../workflow/workflow'
import { SetupPage } from './SetupPage'

type Filter = 'action' | 'all' | 'unread' | 'with_pm' | Stage | 'completed'

export function ClientTeamDashboard() {
  const { me } = useApp()
  const [tab, setTab] = useState<'submissions' | 'status' | 'jobs' | 'setup'>('submissions')
  const { openJobId } = useApp()
  useEffect(() => {
    if (openJobId) setTab('jobs')
  }, [openJobId])
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Hello, {me.name}</h1>
          <p className="text-sm text-slate-500">Submissions for your clients — including candidates still with the PE / PM.</p>
        </div>
        <div className="flex rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200">
          {(['submissions', 'status', 'jobs', 'setup'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cx('rounded-md px-3 py-1.5 text-sm font-medium', tab === t ? 'bg-brand-800 text-white' : 'text-slate-600')}
            >
              {t === 'submissions' ? 'Submissions' : t === 'status' ? 'Client status' : t === 'jobs' ? 'Job openings' : 'Clients & jobs'}
            </button>
          ))}
        </div>
      </div>
      {tab === 'submissions' ? <Submissions /> : tab === 'status' ? <ClientStatus /> : tab === 'jobs' ? <JobOpenings /> : <SetupPage includeTeam={false} />}
    </div>
  )
}

function Submissions() {
  const { me, apps, actionRequired, unread, clients, users, now } = useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [clientId, setClientId] = useState('')
  const [pmId, setPmId] = useState('')
  const { search, setSearch, match } = useSearch()

  const tests: [Filter, string, (a: Application) => boolean][] = [
    ['action', 'My Action Required', (a) => isMyTurn(a, me.id, now)],
    ['all', 'All', () => true],
    ['unread', 'Unread', (a) => a.unreadFor.includes(me.id)],
    ['with_pm', 'With PE / PM – not sent yet', (a) => beforeClientTeam(a.stage)],
    ['new_submission', 'New submissions', (a) => a.stage === 'new_submission'],
    ['cv_with_client', 'CV with client', (a) => a.stage === 'cv_with_client'],
    ['rescheduling', 'Getting new dates', (a) => a.stage === 'rescheduling'],
    ['interview_scheduled', 'Interview scheduled', (a) => a.stage === 'interview_scheduled'],
    ['debrief_pending', 'Debrief pending', (a) => a.stage === 'debrief_pending'],
    ['completed', 'Completed', (a) => isClosed(a.stage)],
  ]
  const test = tests.find((t) => t[0] === filter)![2]
  const shown = apps.filter((a) => test(a) && match(a) && (!clientId || a.clientId === clientId) && (!pmId || a.assignedPM === pmId)).sort(byRecent)

  // Every client and every PM, not only those that already have submissions.
  const allClients = [...clients].sort((a, b) => a.name.localeCompare(b.name))
  const allPms = users.filter((u) => u.role === 'PM' && u.active !== false).sort((a, b) => a.name.localeCompare(b.name))

  // Client → Job opening → candidates
  const groups = new Map<string, { name: string; jobs: Map<string, { title: string; apps: Application[] }> }>()
  for (const a of shown) {
    const g = groups.get(a.clientId) ?? { name: a.clientName, jobs: new Map() }
    const j = g.jobs.get(a.jobId) ?? { title: a.jobTitle, apps: [] }
    j.apps.push(a)
    g.jobs.set(a.jobId, j)
    groups.set(a.clientId, g)
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))

  return (
    <div className="space-y-5">
      <DashboardTop
        actionApps={actionRequired}
        stats={
          <>
            <StatCard label="Action required" value={actionRequired.length} tone="red" onClick={() => setFilter('action')} active={filter === 'action'} />
            <StatCard label="Unread updates" value={unread.length} tone="amber" onClick={() => setFilter('unread')} active={filter === 'unread'} />
            <StatCard label="New submissions" value={apps.filter((a) => a.stage === 'new_submission').length} onClick={() => setFilter('new_submission')} active={filter === 'new_submission'} />
            <StatCard label="Interviews scheduled" value={apps.filter((a) => a.stage === 'interview_scheduled').length} tone="blue" onClick={() => setFilter('interview_scheduled')} active={filter === 'interview_scheduled'} />
          </>
        }
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">By client</h2>
        <FilterBar search={search} onSearch={setSearch}>
          <StatusFilter value={filter} onChange={setFilter} options={tests.map(([f, label, t]) => [f, label, apps.filter(t).length])} />
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-auto py-1.5" aria-label="Client filter">
            <option value="">All clients</option>
            {allClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={pmId} onChange={(e) => setPmId(e.target.value)} className="w-auto py-1.5" aria-label="PM filter">
            <option value="">All PMs</option>
            {allPms.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </FilterBar>
        <ColorLegend />

        {sortedGroups.length ? (
          sortedGroups.map(([cid, g]) => (
            <div key={cid} className="space-y-2">
              <h3 className="flex items-baseline gap-2 pt-2 text-base font-bold text-brand-800">
                {g.name} <span className="text-xs font-normal text-slate-400">{cid}</span>
              </h3>
              {[...g.jobs.entries()].map(([jid, j]) => (
                <div key={jid} className="space-y-1.5 pl-0 sm:pl-3">
                  <h4 className="text-sm font-semibold text-slate-600">
                    {j.title} <span className="font-normal text-slate-400">· {j.apps.length} candidate{j.apps.length > 1 ? 's' : ''}</span>
                  </h4>
                  <ApplicationTable apps={j.apps} variant="ct" />
                </div>
              ))}
            </div>
          ))
        ) : (
          <Empty>No submissions match this filter.</Empty>
        )}
      </section>
    </div>
  )
}
