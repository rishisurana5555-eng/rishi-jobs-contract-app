import type { Slot } from '../types'
import { todayIso } from '../workflow/dates'
import { TimeSelect } from './TimeSelect'
import { Button, Input } from './ui'

/** Editable list of available dates, each with an optional 12-hour time window. */
export function DatesInput({ value, onChange }: { value: Slot[]; onChange: (slots: Slot[]) => void }) {
  const rows = value.length ? value : [{ date: '' }]
  const set = (i: number, patch: Partial<Slot>) => onChange(rows.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  return (
    <div className="space-y-2">
      {rows.map((s, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" min={todayIso()} value={s.date} onChange={(e) => set(i, { date: e.target.value })} className="w-40" aria-label="Date" />
            <TimeSelect label="From" optional value={s.from ?? ''} onChange={(from) => set(i, { from })} />
            <span className="text-xs text-slate-400">to</span>
            <TimeSelect label="To" optional value={s.to ?? ''} onChange={(to) => set(i, { to })} />
            {rows.length > 1 && (
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="px-1 text-slate-400 hover:text-red-600" aria-label="Remove date">
                ✕
              </button>
            )}
          </div>
          {s.from && s.to && s.to <= s.from && <p className="mt-1 text-xs text-red-600">End time must be after the start time.</p>}
          {!s.from && s.to && <p className="mt-1 text-xs text-red-600">Add a start time too.</p>}
        </div>
      ))}
      <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => onChange([...rows, { date: '' }])}>
        + Add another date
      </Button>
      <p className="text-xs text-slate-500">Time window is optional — leave it as “--” if the whole day works.</p>
    </div>
  )
}
