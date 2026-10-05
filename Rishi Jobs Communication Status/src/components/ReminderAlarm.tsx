import { useEffect, useState } from 'react'
import { playSound, soundBlocked, unlockAudio } from '../alarm/sound'
import { useApp } from '../context/AppContext'
import { duration, fmtDateTime } from '../workflow/dates'
import { jobLateText, jobTodo, jobTurnSince } from '../workflow/jobs'
import { isMyTurn, pendingSince, viewerLabel } from '../workflow/workflow'
import { Button } from './ui'

/**
 * The 10-minute "work is pending" alarm. Shown over everything (with sound) until the user
 * acknowledges it; it comes back 10 minutes later while any of the records is still their turn.
 */
export function ReminderAlarm() {
  const { reminder, dismissReminder, apps, jobs, jobWaitsForMe, jobLateForMe, openJob, me, now, openApp, names } = useApp()
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (reminder) setBlocked(soundBlocked())
  }, [reminder])

  // Records whose status changed since the alarm (by me or the other side) drop off the list.
  const list = reminder
    ? apps.filter((a) => reminder.appIds.includes(a.id) && isMyTurn(a, me.id, Math.max(now, reminder.at))).sort((a, b) => a.candidateName.localeCompare(b.candidateName))
    : []
  // Job openings waiting for me (to assign, or to find a candidate for), or whose submission deadline I missed, until that is done.
  const jobList = reminder
    ? jobs.filter((j) => reminder.jobIds.includes(j.id) && (jobWaitsForMe(j) || jobLateForMe(j))).sort((a, b) => a.title.localeCompare(b.title) || a.clientName.localeCompare(b.clientName))
    : []
  const count = list.length + jobList.length

  useEffect(() => {
    if (reminder && !count) dismissReminder()
  }, [reminder, count, dismissReminder])

  if (!reminder || !count) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3" role="alertdialog" aria-labelledby="reminder-title">
      <div className="animate-slide-in w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-4 ring-red-500">
        <div className="flex items-center gap-3 bg-red-600 px-5 py-3 text-white">
          <span className="animate-pulse text-3xl" aria-hidden>
            ⏰
          </span>
          <div>
            <h2 id="reminder-title" className="text-lg font-bold leading-tight">
              Work pending — it’s your turn
            </h2>
            <p className="text-sm text-red-100">Please finish {count > 1 ? 'these' : 'this'} as soon as possible. You’ll be reminded every 10 minutes.</p>
          </div>
        </div>

        <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto">
          {jobList.map((j) => {
            const late = jobLateForMe(j)
            return (
            <li key={j.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900">
                  📋 {j.title} <span className="font-normal text-slate-500">· {j.clientName}</span>
                </div>
                {late ? (
                  <>
                    <div className="text-xs font-semibold leading-snug text-red-700">⏰ Submission deadline passed – {jobLateText(j, late, names, me.id)}</div>
                    <div className="text-[11px] text-slate-500">
                      Was due by {fmtDateTime(j.submitBy!)} ({duration(now - j.submitBy!)} ago)
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs leading-snug text-red-800">Job opening – {jobTodo(j, me)}</div>
                    <div className="text-[11px] text-slate-500">Pending for {duration(now - jobTurnSince(j, me))}</div>
                  </>
                )}
              </div>
              <Button
                variant="secondary"
                className="shrink-0 text-xs"
                onClick={() => {
                  dismissReminder()
                  openJob(j.id)
                }}
              >
                Open
              </Button>
            </li>
            )
          })}
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {a.candidateName} <span className="font-normal text-slate-500">· {a.clientName}</span>
                </div>
                <div className="text-xs leading-snug text-red-800">{viewerLabel(a, me.id, me.role, now, names)}</div>
                <div className="text-[11px] text-slate-500">Pending for {duration(now - pendingSince(a, me.id))}</div>
              </div>
              <Button
                variant="secondary"
                className="shrink-0 text-xs"
                onClick={() => {
                  dismissReminder()
                  openApp(a.id)
                }}
              >
                Open
              </Button>
            </li>
          ))}
        </ul>

        {blocked && (
          <button
            onClick={() => {
              unlockAudio()
              playSound('notify')
              setBlocked(false)
            }}
            className="w-full bg-amber-50 px-5 py-2 text-left text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            🔇 The browser blocked the alarm sound. Click here to turn sound on for future reminders.
          </button>
        )}

        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <Button onClick={dismissReminder}>OK, I’m on it</Button>
        </div>
      </div>
    </div>
  )
}
