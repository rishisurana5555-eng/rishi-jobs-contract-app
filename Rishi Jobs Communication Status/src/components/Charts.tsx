import { Empty } from './ui'

/**
 * Report graph colours. Each measure keeps its colour in every graph (checked for colour-blind
 * separation in the orders used: volume → interviews → placed → rejected; volume ↔ job openings).
 * Some are light on white, so every bar also shows its number.
 */
export const SERIES_COLORS = {
  /** candidates added, submissions, CVs sent */
  volume: '#2a78d6',
  interviews: '#eda100',
  placed: '#1baf7a',
  rejected: '#4a3aa7',
  jobs: '#eb6834',
} as const

export interface Series {
  name: string
  color: string
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {series.map((s) => (
        <span key={s.name} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  )
}

/**
 * Horizontal bars, one group per row (a person, a client…), one bar per series, each with its
 * number at the end. Rows are sorted biggest first; past `limit` the rest are left to the table.
 */
export function BarChart({ rows, series, limit = 15 }: { rows: { label: string; values: number[] }[]; series: Series[]; limit?: number }) {
  const withNumbers = rows.filter((r) => r.values.some((v) => v > 0))
  if (!withNumbers.length) return <Empty>Nothing to show for this period.</Empty>
  const sorted = [...withNumbers].sort((a, b) => {
    for (let i = 0; i < a.values.length; i++) if (b.values[i] !== a.values[i]) return b.values[i] - a.values[i]
    return a.label.localeCompare(b.label)
  })
  const shown = sorted.slice(0, limit)
  const max = Math.max(1, ...shown.flatMap((r) => r.values))
  return (
    <div>
      <Legend series={series} />
      <ul className="space-y-2">
        {shown.map((r) => (
          <li
            key={r.label}
            className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-3 rounded-md px-1 py-0.5 hover:bg-slate-50"
            title={`${r.label}: ${series.map((s, i) => `${s.name} ${r.values[i]}`).join(' · ')}`}
          >
            <span className="truncate text-sm text-slate-700">{r.label}</span>
            <div className="flex flex-col gap-0.5">
              {series.map((s, i) => (
                <div key={s.name} className="flex items-center gap-1.5">
                  <div
                    className="h-2.5 rounded-r"
                    style={{ width: `calc((100% - 2.25rem) * ${r.values[i] / max})`, minWidth: r.values[i] ? 2 : 0, backgroundColor: s.color }}
                  />
                  <span className="text-[11px] leading-none tabular-nums text-slate-600">{r.values[i]}</span>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {sorted.length > shown.length && (
        <p className="mt-2 text-xs text-slate-500">
          Showing the top {shown.length} of {sorted.length}. The table and CSV have all of them.
        </p>
      )}
    </div>
  )
}

/** Columns over time (day / week / month), one column per series, numbers on top. */
export function ColumnChart({ points, series }: { points: { label: string; values: number[] }[]; series: Series[] }) {
  if (!points.length) return <Empty>Nothing to show for this period.</Empty>
  const max = Math.max(1, ...points.flatMap((p) => p.values))
  // Many points: fixed-width columns that scroll sideways; labels on every few columns only.
  const labelEvery = Math.ceil(points.length / 16)
  return (
    <div>
      <Legend series={series} />
      <div className="overflow-x-auto overflow-y-hidden">
        <div className="flex h-44 min-w-full items-end gap-1 border-b border-slate-200" style={{ width: points.length > 16 ? points.length * 28 : undefined }}>
          {points.map((p) => (
            <div
              key={p.label}
              className="flex h-full min-w-5 flex-1 items-end justify-center gap-0.5 hover:bg-slate-50"
              title={`${p.label}: ${series.map((s, i) => `${s.name} ${p.values[i]}`).join(' · ')}`}
            >
              {series.map((s, i) => (
                <div key={s.name} className="flex h-full w-1/2 max-w-5 flex-col items-center justify-end">
                  {p.values[i] > 0 && <span className="text-[10px] tabular-nums text-slate-600">{p.values[i]}</span>}
                  <div className="w-full rounded-t" style={{ height: `${(p.values[i] / max) * 80}%`, minHeight: p.values[i] ? 2 : 0, backgroundColor: s.color }} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex min-w-full gap-1 pt-1" style={{ width: points.length > 16 ? points.length * 28 : undefined }}>
          {points.map((p, i) => (
            <span key={p.label} className="h-3 min-w-5 flex-1 whitespace-nowrap text-center text-[10px] leading-3 text-slate-500">
              {i % labelEvery === 0 ? p.label : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Steps of a funnel: count and % of the first step. */
export function FunnelChart({ steps }: { steps: { label: string; count: number; pct: number }[] }) {
  if (!steps[0]?.count) return <Empty>No submissions added in this period.</Empty>
  return (
    <ul className="space-y-2.5">
      {steps.map((s) => (
        <li key={s.label} title={`${s.label}: ${s.count} (${s.pct}%)`}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium text-slate-700">{s.label}</span>
            <span className="tabular-nums text-slate-600">
              {s.count} <span className="text-slate-400">· {s.pct}%</span>
            </span>
          </div>
          <div className="h-3 rounded-full bg-slate-100">
            <div className="h-3 rounded-full" style={{ width: `${Math.max(s.pct, s.count ? 1 : 0)}%`, backgroundColor: SERIES_COLORS.volume }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
