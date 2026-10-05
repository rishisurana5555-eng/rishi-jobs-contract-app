import { useEffect, useState } from 'react'
import { AddCandidateForm } from '../components/AddCandidateForm'
import { ApplicationTable } from '../components/ApplicationTable'
import { FilterBar, StatusFilter, useCountBoxes, useSearch } from '../components/DashboardWidgets'
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
  const { me, apps, jobs, openApp, setMessagesOpen, unreadMessages, actionRequired } = useApp()
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
  const of = (f: Filter) => apps.filter(tests.find((t) => t[0] === f)![2])
  const count = (f: Filter) => of(f).length
  const test = tests.find((t) => t[0] === filter)![2]
  // My action required: the PM's doubts and "unanswered" candidates waiting for me.
  const box = (key: Filter, label: string, tone: 'amber' | 'slate' | 'blue' | 'green', empty: string) => ({ key, label, count: count(key), tone, apps: of(key), empty })
  const { boxes, page } = useCountBoxes(
    [
      { key: 'action', label: 'My action required', count: actionRequired.length, tone: 'red', apps: actionRequired, empty: '🎉 Nothing needs your action right now.' },
      box('with_pm', 'Submitted to PM', 'amber', 'No candidates with your PM.'),
      box('in_progress', 'With Client Team / client', 'slate', 'No candidates with the Client Team or client.'),
      box('interview', 'Interviews scheduled', 'blue', 'No interviews scheduled.'),
      box('placed', 'Placed', 'green', 'No candidates placed yet.'),
    ],
    'pe',
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Hello, {me.name}</h1>
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
      ) : page ? (
        page
      ) : (
      <>
      {boxes}

      <FilterBar search={search} onSearch={setSearch}>
        <StatusFilter value={filter} onChange={setFilter} options={tests.map(([f, label]) => [f, label, count(f)])} />
      </FilterBar>
      <ColorLegend />
      <ApplicationTable apps={apps.filter((a) => test(a) && match(a))} variant="pe" empty="No candidates here yet. Use “＋ Add Candidate” to add one." />
      </>
      )}

      {adding && (
        <Modal title="Add Candidate" onClose={() => setAdding(false)} full>
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
