import { useEffect, useState } from 'react'
import { ApplicationTable } from '../components/ApplicationTable'
import { FilterBar, StatusFilter, useCountBoxes, useSearch } from '../components/DashboardWidgets'
import { ClientStatus } from '../components/ClientStatus'
import { JobOpenings } from '../components/JobOpenings'
import { ColorLegend } from '../components/StatusBadge'
import { Select, cx } from '../components/ui'
import { useApp } from '../context/AppContext'
import type { Application, Stage } from '../types'
import { isClosed, isMyTurn } from '../workflow/workflow'
import { SetupPage } from './SetupPage'

type Filter = 'action' | 'all' | 'unread' | Stage | 'completed'

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
    ['new_submission', 'New submissions', (a) => a.stage === 'new_submission'],
    ['cv_with_client', 'CV with client', (a) => a.stage === 'cv_with_client'],
    ['rescheduling', 'Getting new dates', (a) => a.stage === 'rescheduling'],
    ['interview_scheduled', 'Interview scheduled', (a) => a.stage === 'interview_scheduled'],
    ['debrief_pending', 'Debrief pending', (a) => a.stage === 'debrief_pending'],
    ['completed', 'Completed', (a) => isClosed(a.stage)],
  ]
  const test = tests.find((t) => t[0] === filter)![2]
  const shown = apps.filter((a) => test(a) && match(a) && (!clientId || a.clientId === clientId) && (!pmId || a.assignedPM === pmId))

  // Every client and every PM, not only those that already have submissions.
  const allClients = [...clients].sort((a, b) => a.name.localeCompare(b.name))
  const allPms = users.filter((u) => u.role === 'PM' && u.active !== false).sort((a, b) => a.name.localeCompare(b.name))

  const stage = (st: Stage) => apps.filter((a) => a.stage === st)
  const { boxes, page } = useCountBoxes(
    [
      { key: 'action', label: 'My action required', count: actionRequired.length, tone: 'red', apps: actionRequired, empty: '🎉 Nothing needs your action right now.' },
      { key: 'unread', label: 'Unread updates', count: unread.length, tone: 'amber', apps: unread, empty: 'No unread updates.' },
      { key: 'new', label: 'New submissions', count: stage('new_submission').length, tone: 'slate', apps: stage('new_submission'), empty: 'No new submissions.' },
      { key: 'interview', label: 'Interviews scheduled', count: stage('interview_scheduled').length, tone: 'blue', apps: stage('interview_scheduled'), empty: 'No interviews scheduled.' },
    ],
    'ct',
  )
  if (page) return page

  return (
    <div className="space-y-5">
      {boxes}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">All candidates ({shown.length})</h2>
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

        {/* One list of every client's candidates: by client (A–Z), then job opening, then candidate. */}
        <ApplicationTable apps={shown} variant="ct" empty="No submissions match this filter." />
      </section>
    </div>
  )
}
