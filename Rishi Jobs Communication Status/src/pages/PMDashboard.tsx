import { useEffect, useState } from 'react'
import { ApplicationTable } from '../components/ApplicationTable'
import { ColorLegend } from '../components/StatusBadge'
import { byRecent, DashboardTop, FilterBar, StatCard, StatusFilter, useSearch } from '../components/DashboardWidgets'
import { CandidatesList } from '../components/CandidatesList'
import { JobOpenings } from '../components/JobOpenings'
import { Select, Tabs } from '../components/ui'
import { useApp } from '../context/AppContext'
import type { Application } from '../types'
import { awaitingSend, isClosed, isMyTurn } from '../workflow/workflow'

type Filter = 'action' | 'from_pe' | 'all' | 'unread' | 'waiting' | 'recent' | 'interview' | 'debrief' | 'completed'

export function PMDashboard() {
  const { me, apps, actionRequired, unread, now, users, jobsToAssign } = useApp()
  const [ctId, setCtId] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [tab, setTab] = useState<'submissions' | 'jobs' | 'candidates'>(jobsToAssign.length ? 'jobs' : 'submissions')
  const { openJobId } = useApp()
  useEffect(() => {
    if (openJobId) setTab('jobs')
  }, [openJobId])
  const { search, setSearch, match } = useSearch()

  const tests: Record<Filter, [string, (a: Application) => boolean]> = {
    action: ['My Action Required', (a) => isMyTurn(a, me.id, now)],
    from_pe: ['New from PEs – to decide', (a) => awaitingSend(a, me.id)],
    all: ['All my candidates', () => true],
    unread: ['Unread', (a) => a.unreadFor.includes(me.id)],
    waiting: ['Waiting for Client Team', (a) => a.nextActionBy.includes(a.assignedClientTeam) && !a.nextActionBy.includes(me.id)],
    recent: ['Recently Updated', (a) => now - a.lastUpdatedAt < 24 * 3_600_000],
    interview: ['Interview Scheduled', (a) => a.stage === 'interview_scheduled'],
    debrief: ['Debrief Pending', (a) => a.stage === 'debrief_pending'],
    completed: ['Completed', (a) => isClosed(a.stage)],
  }
  const shown = apps.filter((a) => tests[filter][1](a) && match(a) && (!ctId || a.assignedClientTeam === ctId)).sort(byRecent)
  const fromPe = apps.filter(tests.from_pe[1]).sort((a, b) => a.createdAt - b.createdAt)
  const clientTeam = users.filter((u) => u.role === 'ClientTeam' && u.active !== false).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Hello, {me.name}</h1>
          <p className="text-sm text-slate-500">Assign your job openings to your PEs; check the candidates they add, revise the CV and send them to the Client Team.</p>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            ['submissions', 'Submissions'],
            ['jobs', jobsToAssign.length ? `Job openings (${jobsToAssign.length} to assign)` : 'Job openings'],
            ['candidates', 'Candidates'],
          ]}
        />
      </div>

      {tab === 'jobs' ? (
        <JobOpenings />
      ) : tab === 'candidates' ? (
        <CandidatesList />
      ) : (
      <>
      <DashboardTop
        actionApps={actionRequired}
        stats={
          <>
            <StatCard label="Action required" value={actionRequired.length} tone="red" onClick={() => setFilter('action')} active={filter === 'action'} />
            <StatCard label="New from PEs – to send" value={fromPe.length} tone="red" onClick={() => setFilter('from_pe')} active={filter === 'from_pe'} />
            <StatCard label="Unread updates" value={unread.length} tone="amber" onClick={() => setFilter('unread')} active={filter === 'unread'} />
            <StatCard label="Interviews scheduled" value={apps.filter(tests.interview[1]).length} tone="blue" onClick={() => setFilter('interview')} active={filter === 'interview'} />
          </>
        }
      />


      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">All my candidates</h2>
        <FilterBar search={search} onSearch={setSearch}>
          <StatusFilter value={filter} onChange={setFilter} options={(Object.keys(tests) as Filter[]).map((f) => [f, tests[f][0], apps.filter(tests[f][1]).length])} />
          <Select value={ctId} onChange={(e) => setCtId(e.target.value)} className="w-auto py-1.5" aria-label="Client Team filter">
            <option value="">All Client Team</option>
            {clientTeam.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </FilterBar>
        <ColorLegend />
        <ApplicationTable apps={shown} variant="pm" empty="No candidates match this filter. New candidates arrive here when your PEs add them." />
      </section>
      </>
      )}

    </div>
  )
}
