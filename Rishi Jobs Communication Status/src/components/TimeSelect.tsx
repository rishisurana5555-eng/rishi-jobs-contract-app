import { cx } from './ui'

const pad = (n: number) => String(n).padStart(2, '0')
const MINUTES = ['00', '15', '30', '45']
const selectCls =
  'rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100'

function parse(value: string) {
  if (!value) return null
  const [h, m] = value.split(':').map(Number)
  return { h12: h % 12 === 0 ? 12 : h % 12, m: pad(m), ap: h >= 12 ? 'PM' : 'AM' }
}

const to24 = (h12: number, m: string, ap: string) => `${pad((h12 % 12) + (ap === 'PM' ? 12 : 0))}:${m}`

/** Working-hours guess when an hour is first picked: 8–11 → AM, 12 and 1–7 → PM. */
const guessPeriod = (h12: number) => (h12 >= 8 && h12 <= 11 ? 'AM' : 'PM')

/**
 * 12-hour time picker (hour / minute / AM-PM). Value is stored as 24-hour "HH:MM"
 * (or "" when `optional` and no hour is chosen).
 */
export function TimeSelect({
  value,
  onChange,
  optional,
  label,
  className,
}: {
  value: string
  onChange: (v: string) => void
  optional?: boolean
  label: string
  className?: string
}) {
  const t = parse(value)
  const minutes = t && !MINUTES.includes(t.m) ? [...MINUTES, t.m].sort() : MINUTES
  return (
    <span className={cx('inline-flex items-center gap-1', className)} role="group" aria-label={label}>
      <select
        aria-label={`${label} hour`}
        className={selectCls}
        value={t ? t.h12 : ''}
        onChange={(e) => {
          if (!e.target.value) return onChange('')
          const h = Number(e.target.value)
          onChange(to24(h, t?.m ?? '00', t?.ap ?? guessPeriod(h)))
        }}
      >
        {(optional || !t) && <option value="">{optional ? '--' : 'Hour'}</option>}
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-slate-400">:</span>
      <select aria-label={`${label} minute`} className={selectCls} value={t?.m ?? '00'} disabled={!t} onChange={(e) => t && onChange(to24(t.h12, e.target.value, t.ap))}>
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select aria-label={`${label} AM/PM`} className={selectCls} value={t?.ap ?? 'AM'} disabled={!t} onChange={(e) => t && onChange(to24(t.h12, t.m, e.target.value))}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </span>
  )
}
