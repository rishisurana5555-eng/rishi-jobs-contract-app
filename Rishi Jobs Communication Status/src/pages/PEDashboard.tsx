import { useEffect, useState } from 'react'
import { AddCandidateForm } from '../components/AddCandidateForm'
import { ApplicationTable } from '../components/ApplicationTable'
import { byRecent, FilterBar, StatCard, StatusFilter, useSearch } from '../components/DashboardWidgets'
import { ColorLegend } from '../components/StatusBadge'
import { CandidatesList } from '../components/CandidatesList'
import { JobOpenings } from '../components/JobOpenings'
import { Button, Modal, Tabs } from '../components/ui'
import { useApp } from '../context/AppContext'
import type { Application } from '../types'
import { beforeClientTeam, isClosed } from '../workflow/workflow'

type Filter = 'all' | 'with_pm' | 'in_progress' | 'interview' | 'placed' | 'rejected' | 'backout'

/**
 * PEs add candidates for the job openings assigned to them (each goes to that job's PM), and follow every candidate they are on: status on both sides,
 * interviews and the full history (open a candidate). The PM and Client Team update the status.
 */
export function PEDashboard() {
  const { me, apps, jobs, openApp, setMessagesOpen, unreadMessages } = useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)
  const [tab, setTab] = useState<'submissions' | 'jobs' | 'candidates'>('submissions')
  const { openJobId } = useApp()
  useEffect(() => {
    if (openJobId) setTab('jobs')
  }, [openJobId])
  const { search, setSearch, match } = useSearch()

  const tests: [Filter, string, (a: Application) => boolean][] = [
    ['all', 'All my candidates', () => true],
    ['with_pm', 'Submitted to PM', (a) => beforeClientTeam(a.stage)],
    ['in_progress', 'With Client Team / client', (a) => !beforeClientTeam(a.stage) && a.stage !== 'interview_scheduled' && !isClosed(a.stage)],
    ['interview', 'Interview scheduled', (a) => a.stage === 'interview_scheduled'],
    ['placed', 'Placed', (a) => a.stage === 'closed_placed'],
    ['rejected', 'Rejected', (a) => a.stage === 'closed_rejected'],
    ['backout', 'Candidate backout', (a) => a.stage === 'closed_backout'],
  ]
  const count = (f: Filter) => apps.filter(tests.find((t) => t[0] === f)![2]).length
  const test = tests.find((t) => t[0] === filter)![2]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Hello, {me.name}</h1>
          <p className="text-sm text-slate-500">Add candidates for the job openings your PM assigned to you, and follow their status.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setMessagesOpen(true)}>
            ✉ Message Admin{unreadMessages.length > 0 && <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white">{unreadMessages.length} new</span>}
          </Button>
          <Button onClick={() => setAdding(true)}>＋ Add Candidate</Button>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          ['submissions', 'Submissions to clients'],
          ['jobs', `My job openings (${jobs.length})`],
          ['candidates', 'My candidates'],
        ]}
      />

      {tab === 'jobs' ? (
        <JobOpenings />
      ) : tab === 'candidates' ? (
        <CandidatesList />
      ) : (
      <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Submitted to PM" value={count('with_pm')} tone="amber" onClick={() => setFilter('with_pm')} active={filter === 'with_pm'} />
        <StatCard label="With Client Team / client" value={count('in_progress')} onClick={() => setFilter('in_progress')} active={filter === 'in_progress'} />
        <StatCard label="Interviews scheduled" value={count('interview')} tone="blue" onClick={() => setFilter('interview')} active={filter === 'interview'} />
        <StatCard label="Placed" value={count('placed')} tone="green" onClick={() => setFilter('placed')} active={filter === 'placed'} />
      </div>

      <FilterBar search={search} onSearch={setSearch}>
        <StatusFilter value={filter} onChange={setFilter} options={tests.map(([f, label]) => [f, label, count(f)])} />
      </FilterBar>
      <ColorLegend />
      <ApplicationTable apps={apps.filter((a) => test(a) && match(a)).sort(byRecent)} variant="pe" empty="No candidates here yet. Use “＋ Add Candidate” to add one." />
      </>
      )}

      {adding && (
        <Modal title="Add Candidate" onClose={() => setAdding(false)} wide>
          <AddCandidateForm
            onDone={(id) => {
              setAdding(false)
              openApp(id)
            }}
          />
        </Modal>
      )}
    </div>
  )
}
