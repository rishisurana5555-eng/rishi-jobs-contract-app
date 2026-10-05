import { useApp } from '../context/AppContext'
import { isAdminRole } from '../types'
import { duration, fmtDateTime } from '../workflow/dates'
import { jobLateText } from '../workflow/jobs'
import { ctLabel } from '../workflow/workflow'
import { Button } from './ui'

/**
 * The job openings whose submission deadline (set by the Client Team) has passed without a submission,
 * at the top of every tab until a candidate is submitted: the PM and PE see their pending work, the
 * admins see who has not submitted.
 */
export function DeadlineAlerts() {
  const { me, lateJobs, jobLateForMe, names, now, openJob } = useApp()
  const admin = isAdminRole(me.role)
  if (!lateJobs.length || !(admin || me.role === 'PM' || me.role === 'PE')) return null

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-red-300 bg-red-50 shadow-sm" role="alert">
      <div className="flex items-center gap-2 bg-red-600 px-4 py-2 text-white">
        <span className="animate-pulse text-lg" aria-hidden>
          ⏰
        </span>
        <h2 className="text-sm font-bold">
          {admin
            ? `Submission deadline missed – ${lateJobs.length} job opening${lateJobs.length > 1 ? 's' : ''}`
            : `Pending work alert – submission deadline passed (${lateJobs.length})`}
        </h2>
      </div>
      <ul className="divide-y divide-red-100">
        {lateJobs.map((j) => {
          const late = jobLateForMe(j)!
          return (
            <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900">
                  {j.title} <span className="font-normal text-slate-500">· {j.clientName}</span> <span className="text-xs font-normal text-slate-400">{j.id}</span>
                </div>
                <div className="text-xs leading-snug text-red-800">
                  {jobLateText(j, late, names, me.id)} {!admin && 'Submit as soon as possible.'}
                </div>
                <div className="text-[11px] text-slate-500">
                  Was due by {fmtDateTime(j.submitBy!)} · {duration(now - j.submitBy!)} overdue
                </div>
              </div>
              <Button variant="secondary" className="shrink-0 px-2.5 py-1 text-xs" onClick={() => openJob(j.id)}>
                Open
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Red alerts at the top of every tab for the admins: a PE's candidate the PM marked unanswered with no
 * reply for 48 hours (all admins), and a CV with the client whose Client Team status has not changed
 * for 6 days (Super Admin). Each stays until the status moves on.
 */
export function StaleAlerts() {
  const { peUnansweredLate, ctStale, nameOf, names, now, openApp } = useApp()
  const groups = [
    {
      key: 'pe',
      icon: '⚠',
      title: `PE has not answered for 48 hours – ${peUnansweredLate.length} candidate${peUnansweredLate.length > 1 ? 's' : ''}`,
      rows: peUnansweredLate.map((a) => ({
        a,
        text: `${nameOf(a.assignedPM)} marked the candidate unanswered; ${nameOf(a.assignedPE)} has not replied.`,
        since: a.stageSince,
      })),
    },
    {
      key: 'ct',
      icon: '🔴',
      title: `Client Team status unchanged for 6 days – ${ctStale.length} candidate${ctStale.length > 1 ? 's' : ''}`,
      rows: ctStale.map((a) => ({
        a,
        text: `${nameOf(a.assignedClientTeam)} · ${ctLabel(a, undefined, names)}`,
        since: a.ctStatusSince ?? a.stageSince,
      })),
    },
  ].filter((g) => g.rows.length)
  if (!groups.length) return null

  return (
    <>
      {groups.map((g) => (
        <div key={g.key} className="mb-4 overflow-hidden rounded-xl border border-red-300 bg-red-50 shadow-sm" role="alert">
          <div className="flex items-center gap-2 bg-red-600 px-4 py-2 text-white">
            <span className="animate-pulse text-lg" aria-hidden>
              {g.icon}
            </span>
            <h2 className="text-sm font-bold">{g.title}</h2>
          </div>
          <ul className="divide-y divide-red-100">
            {g.rows.map(({ a, text, since }) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900">
                    {a.candidateName} <span className="font-normal text-slate-500">· {a.jobTitle} · {a.clientName}</span>{' '}
                    <span className="text-xs font-normal text-slate-400">{a.candidateId}</span>
                  </div>
                  <div className="text-xs leading-snug text-red-800">{text}</div>
                  <div className="text-[11px] text-slate-500">
                    Since {fmtDateTime(since)} · {duration(now - since)}
                  </div>
                </div>
                <Button variant="secondary" className="shrink-0 px-2.5 py-1 text-xs" onClick={() => openApp(a.id)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}
