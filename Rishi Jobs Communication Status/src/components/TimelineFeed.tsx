import type { TimelineEntry, TimelineType } from '../types'
import { fmtDateTime, fmtSlot, timeAgo } from '../workflow/dates'
import { useApp } from '../context/AppContext'
import { cx } from './ui'

const ICONS: Record<TimelineType, string> = {
  status_change: '●',
  note: '✎',
  cv_upload: '📄',
  availability_update: '📅',
  interview: '🤝',
  debrief: '💬',
  system: '⚙',
}

const SIDE_STYLES = {
  PM: 'bg-brand-100 text-brand-800',
  ClientTeam: 'bg-violet-100 text-violet-800',
  PE: 'bg-teal-100 text-teal-800',
  System: 'bg-slate-200 text-slate-600',
}

/** Append-only history: every status change (with its message), note, date update, interview, debrief and system move. */
export function TimelineFeed({ entries }: { entries: TimelineEntry[] }) {
  const { me, now } = useApp()
  if (!entries.length) return <p className="text-sm text-slate-500">No history yet.</p>
  const list = [...entries].reverse()
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {list.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[30px] flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px]">
            {ICONS[e.type]}
          </span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span className={cx('rounded px-1.5 py-0.5 font-semibold', SIDE_STYLES[e.actorRole])}>
              {e.actor === me.id ? 'You' : e.actorName}
            </span>
            <span title={fmtDateTime(e.timestamp)}>
              {fmtDateTime(e.timestamp)} · {timeAgo(e.timestamp, now)}
            </span>
            {e.interviewRound > 1 && <span className="rounded bg-slate-100 px-1.5">Round {e.interviewRound}</span>}
          </div>
          {e.type !== 'note' && <div className="mt-0.5 text-sm font-medium text-slate-800">{e.statusLabel}</div>}
          {e.dates && e.dates.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {e.dates.map((d, i) => (
                <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  {fmtSlot(d)}
                </span>
              ))}
            </div>
          )}
          {e.message && (
            <div className={cx('mt-1 whitespace-pre-wrap rounded-lg px-3 py-2 text-sm', e.type === 'note' ? 'bg-amber-50 text-amber-950' : 'bg-slate-50 text-slate-700')}>
              {e.type === 'note' ? e.message : `“${e.message}”`}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}
