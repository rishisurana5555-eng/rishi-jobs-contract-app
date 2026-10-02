import type { Slot } from '../types'
import { cleanSlots, findMatches, fmtSlot, slotMatchesDate } from '../workflow/dates'
import { Button, cx } from './ui'

function Column({ title, slots, matchDates }: { title: string; slots: Slot[]; matchDates: Slot[] }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {slots.length ? (
        <ul className="space-y-1">
          {slots.map((s, i) => {
            const hit = slotMatchesDate(matchDates, s.date)
            return (
              <li key={i} className={cx('rounded-md px-2 py-1 text-sm', hit ? 'bg-emerald-100 font-medium text-emerald-900' : 'bg-slate-50 text-slate-700')}>
                {hit && '✓ '}
                {fmtSlot(s)}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-md bg-slate-50 px-2 py-1 text-sm italic text-slate-400">No dates yet</p>
      )}
    </div>
  )
}

/** Candidate vs client dates side by side, with overlaps highlighted and an optional one-click schedule. */
export function AvailabilityMatcher({
  candidateDates,
  clientDates,
  onPick,
}: {
  candidateDates: Slot[]
  clientDates: Slot[]
  onPick?: (slot: Slot) => void
}) {
  const cand = cleanSlots(candidateDates)
  const client = cleanSlots(clientDates)
  const matches = findMatches(cand, client)
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="flex gap-3">
        <Column title="Candidate dates" slots={cand} matchDates={matches} />
        <Column title="Client dates" slots={client} matchDates={matches} />
      </div>
      {cand.length > 0 && client.length > 0 && (
        matches.length ? (
          <div className="rounded-md bg-emerald-50 p-2">
            <div className="mb-1 text-xs font-semibold text-emerald-800">
              {matches.length} matching slot{matches.length > 1 ? 's' : ''}
            </div>
            <ul className="space-y-1">
              {matches.map((m, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm text-emerald-900">
                  <span>{fmtSlot(m)}</span>
                  {onPick && (
                    <Button type="button" className="px-2 py-1 text-xs" onClick={() => onPick(m)}>
                      Schedule on this date
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">
            No matching dates.
            {onPick && <> Choose <b>“Dates don’t match – new dates needed”</b> so both sides collect new dates.</>}
          </div>
        )
      )}
    </div>
  )
}
