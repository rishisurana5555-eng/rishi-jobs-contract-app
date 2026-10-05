import { useEffect, useState } from 'react'
import { ApplicationTable } from '../components/ApplicationTable'
import { FilterBar, useCountBoxes, useSearch } from '../components/DashboardWidgets'
import { CandidatesList } from '../components/CandidatesList'
import { JobOpenings } from '../components/JobOpenings'
import { Button, Card, Empty, Select, Tabs, cx } from '../components/ui'
import { useApp } from '../context/AppContext'
import { ROLE_LABELS, type Application } from '../types'
import { duration } from '../workflow/dates'
import { beforeClientTeam, isClosed } from '../workflow/workflow'
import { ReportsPage } from './ReportsPage'
import { SetupPage } from './SetupPage'

type Filter = 'open' | 'from_pe' | 'stuck' | 'interview' | 'debrief' | 'placed' | 'rejected' | 'backout' | 'all'

export function AdminDashboard() {
  const { me, jobsToAssign } = useApp()
  const [tab, setTab] = useState<'overview' | 'jobs' | 'candidates' | 'reports' | 'setup'>(jobsToAssign.length ? 'jobs' : 'overview')
  const { openJobId } = useApp()
  useEffect(() => {
    if (openJobId) setTab('jobs')
  }, [openJobId])
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{ROLE_LABELS[me.role]} overview</h1>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            ['overview', 'Overview'],
            ['jobs', jobsToAssign.length ? `Job openings (${jobsToAssign.length} to assign)` : 'Job openings'],
            ['candidates', 'Candidates'],
            ['reports', 'Reports'],
            ['setup', 'Clients, jobs & team'],
          ]}
        />
      </div>
      {tab === 'overview' ? <Overview onOpenJobs={() => setTab('jobs')} /> : tab === 'jobs' ? <JobOpenings /> : tab === 'candidates' ? <CandidatesList searchFirst /> : tab === 'reports' ? <ReportsPage /> : <SetupPage />}
    </div>
  )
}

/**
 * The count boxes at the top (each opens its list), then a status, person, client or search picks the
 * submissions to show below. The team rollup opens on request. Lists are A–Z.
 */
function Overview({ onOpenJobs }: { onOpenJobs: () => void }) {
  const { apps, users, clients, now, nameOf, jobsToAssign } = useApp()
  const [filter, setFilter] = useState<Filter | ''>('')
  const [person, setPerson] = useState('')
  const [clientId, setClientId] = useState('')
  const [showTeam, setShowTeam] = useState(false)
  const { search, setSearch, match } = useSearch()

  const STUCK_MS = 48 * 3_600_000
  const tests: [Filter, string, (a: Application) => boolean][] = [
    ['open', 'Open', (a) => !isClosed(a.stage)],
    ['from_pe', 'New from PE – with PM', (a) => beforeClientTeam(a.stage)],
    ['stuck', 'Stuck > 48h', (a) => !isClosed(a.stage) && a.nextActionBy.length > 0 && now - a.stageSince > STUCK_MS],
    ['interview', 'Interview scheduled', (a) => a.stage === 'interview_scheduled'],
    ['debrief', 'Debrief pending', (a) => a.stage === 'debrief_pending'],
    ['placed', 'Placed', (a) => a.stage === 'closed_placed'],
    ['rejected', 'Rejected', (a) => a.stage === 'closed_rejected'],
    ['backout', 'Candidate backout', (a) => a.stage === 'closed_backout'],
    ['all', 'All', () => true],
  ]
  const testOf = (f: Filter) => tests.find((t) => t[0] === f)![2]
  const count = (f: Filter) => apps.filter(testOf(f)).length
  const onPerson = (a: Application, id: string) => a.assignedPM === id || a.assignedClientTeam === id || a.assignedPE === id
  const chosen = !!(filter || person || clientId || search.trim())
  const shown = chosen
    ? apps.filter((a) => (!filter || testOf(filter)(a)) && match(a) && (!person || onPerson(a, person)) && (!clientId || a.clientId === clientId))
    : []
  const clear = () => {
    setFilter('')
    setPerson('')
    setClientId('')
    setSearch('')
  }

  const team = users
    .filter((u) => u.role === 'PE' || u.role === 'PM' || u.role === 'ClientTeam')
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))
  const roleShort = (r: string) => (r === 'ClientTeam' ? 'Client Team' : r)
  const box = (f: Filter, label: string, tone: 'red' | 'blue' | 'green' | 'slate') => ({ key: f, label, count: count(f), tone, apps: apps.filter(testOf(f)), empty: 'No submissions here.' })
  // An admin's own action: the new job openings waiting for them to assign a PM (opens Job openings).
  const { boxes, page } = useCountBoxes(
    [
      { key: 'action', label: 'My action required – job openings to assign', count: jobsToAssign.length, tone: 'red', onOpen: onOpenJobs },
      box('open', 'Open submissions', 'slate'),
      box('stuck', 'Stuck > 48h', 'red'),
      box('interview', 'Interviews scheduled', 'blue'),
      box('placed', 'Placed', 'green'),
      box('rejected', 'Rejected', 'slate'),
      box('backout', 'Candidate backout', 'slate'),
    ],
    'admin',
  )
  if (page) return page

  return (
    <>
      {boxes}

      <section className="space-y-3">
        <FilterBar search={search} onSearch={setSearch}>
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter | '')} className="w-auto py-1.5" aria-label="Status filter">
            <option value="">— Status —</option>
            {tests.map(([f, label]) => (
              <option key={f} value={f}>
                {label} ({count(f)})
              </option>
            ))}
          </Select>
          <Select value={person} onChange={(e) => setPerson(e.target.value)} className="w-auto py-1.5" aria-label="Person filter">
            <option value="">— Person —</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {nameOf(u.id)} ({roleShort(u.role)})
              </option>
            ))}
          </Select>
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-auto py-1.5" aria-label="Client filter">
            <option value="">— Client —</option>
            {[...clients]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
          {chosen && (
            <Button variant="ghost" className="py-1 text-xs" onClick={clear}>
              Clear
            </Button>
          )}
        </FilterBar>
        {chosen ? (
          <ApplicationTable apps={shown} variant="admin" empty="No submissions match." />
        ) : (
          <Empty>Choose a status, person or client, or search — the matching submissions are shown here.</Empty>
        )}
      </section>

      <div>
        <Button variant="secondary" onClick={() => setShowTeam(!showTeam)}>
          {showTeam ? 'Hide team rollup' : 'Show team rollup'}
        </Button>
      </div>
      {showTeam && (
        <Card title="Team rollup">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1.5 pr-3">Person</th>
                  <th className="py-1.5 pr-3">Role</th>
                  <th className="py-1.5 pr-3 text-right">Open</th>
                  <th className="py-1.5 pr-3 text-right">Pending on them</th>
                  <th className="py-1.5 pr-3 text-right">Oldest pending</th>
                  <th className="py-1.5 text-right">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {team.map((u) => {
                  const mine = apps.filter((a) => onPerson(a, u.id))
                  const pending = mine.filter((a) => a.nextActionBy.includes(u.id))
                  const oldest = pending.length ? Math.min(...pending.map((a) => a.stageSince)) : null
                  return (
                    <tr key={u.id} className={cx('cursor-pointer hover:bg-slate-50', person === u.id && 'bg-brand-50')} onClick={() => setPerson(person === u.id ? '' : u.id)}>
                      <td className="py-2 pr-3 font-medium">{u.name}</td>
                      <td className="py-2 pr-3 text-slate-500">{roleShort(u.role)}</td>
                      <td className="py-2 pr-3 text-right">{mine.filter((a) => !isClosed(a.stage)).length}</td>
                      <td className={cx('py-2 pr-3 text-right', pending.length && 'font-semibold text-red-700')}>{pending.length}</td>
                      <td className={cx('py-2 pr-3 text-right', oldest && now - oldest > STUCK_MS && 'font-semibold text-red-700')}>
                        {oldest ? duration(now - oldest) : '—'}
                      </td>
                      <td className="py-2 text-right">{mine.filter((a) => a.stage === 'closed_placed').length}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">Click a person to show their submissions above.</p>
        </Card>
      )}
    </>
  )
}
