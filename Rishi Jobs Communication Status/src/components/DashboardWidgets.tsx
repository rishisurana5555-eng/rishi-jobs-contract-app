import { useState, type ReactNode } from 'react'
import type { Application } from '../types'
import { ApplicationTable, type TableVariant } from './ApplicationTable'
import { ColorLegend } from './StatusBadge'
import { Button, Input, Select, cx } from './ui'

export function StatCard({ label, value, tone = 'slate', onClick, active }: { label: string; value: number; tone?: 'red' | 'blue' | 'slate' | 'amber' | 'green'; onClick?: () => void; active?: boolean }) {
  const colors = {
    red: 'text-red-600',
    blue: 'text-sky-600',
    slate: 'text-slate-800',
    amber: 'text-amber-600',
    green: 'text-emerald-600',
  }[tone]
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cx(
        'rounded-lg border bg-white px-3 py-2 text-left shadow-sm transition-colors enabled:hover:border-brand-200',
        active ? 'border-brand-700 ring-2 ring-brand-100' : 'border-slate-200',
      )}
    >
      <div className={cx('text-xl font-bold leading-tight', colors)}>{value}</div>
      <div className="text-[11px] font-medium leading-tight text-slate-500">{label}</div>
    </button>
  )
}

/** One line: "Filters" title, the filter dropdowns (children), and the search box on the right. */
export function FilterBar({ children, search, onSearch }: { children?: ReactNode; search: string; onSearch: (s: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filters</span>
      {children}
      <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search name, ID, client, phone…" className="w-full py-1.5 sm:ml-auto sm:w-64" />
    </div>
  )
}

/** Status dropdown; each option shows how many records it matches. */
export function StatusFilter<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string, number][] }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as T)} className="w-auto py-1.5" aria-label="Status filter">
      {options.map(([v, label, count]) => (
        <option key={v} value={v}>
          {label} ({count})
        </option>
      ))}
    </Select>
  )
}

export function useSearch() {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const match = (a: Application) =>
    !q ||
    [a.candidateName, a.candidateId, a.clientName, a.jobTitle, a.candidateContactNumber, a.clientId].some((s) => s.toLowerCase().includes(q))
  return { search, setSearch, match }
}

export const byRecent = (a: Application, b: Application) => b.lastUpdatedAt - a.lastUpdatedAt

/**
 * One count box on a dashboard. Clicking it opens a page listing its candidates (`apps`), or runs
 * `onOpen` instead (e.g. an Admin's job openings to assign).
 */
export interface CountBoxDef {
  key: string
  label: string
  count: number
  tone: 'red' | 'amber' | 'blue' | 'green' | 'slate'
  apps?: Application[]
  onOpen?: () => void
  /** shown on its page when it lists nothing */
  empty?: string
}

const COUNT_TONE = { red: 'text-red-600', amber: 'text-amber-600', blue: 'text-sky-600', green: 'text-emerald-600', slate: 'text-slate-800' } as const

function CountBox({ box, onOpen, big }: { box: CountBoxDef; onOpen: () => void; big?: boolean }) {
  return (
    <button
      onClick={onOpen}
      className={cx(
        'flex w-full items-center justify-between gap-3 rounded-xl border bg-white px-4 text-left shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/40',
        big ? 'py-4' : 'py-3',
        big && box.count > 0 ? 'border-red-300' : 'border-slate-200',
      )}
    >
      <div className={cx('min-w-0 font-semibold text-slate-800', big ? 'text-base' : 'text-sm')}>{box.label}</div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={cx('font-bold tabular-nums leading-none', big ? 'text-4xl' : 'text-2xl', COUNT_TONE[box.tone])}>{box.count}</span>
        <span className="text-slate-400" aria-hidden>
          →
        </span>
      </div>
    </button>
  )
}

/** One count box opened: every candidate it counts (A–Z), with search, until "Back". */
function BoxListPage({ box, variant, onBack }: { box: CountBoxDef; variant: TableVariant; onBack: () => void }) {
  const { search, setSearch, match } = useSearch()
  const apps = box.apps ?? []
  return (
    <section className="space-y-3">
      <Button variant="ghost" onClick={onBack}>
        ← Back to dashboard
      </Button>
      <h2 className="text-lg font-bold text-slate-900">
        {box.label} ({apps.length})
      </h2>
      <FilterBar search={search} onSearch={setSearch} />
      <ColorLegend />
      <ApplicationTable apps={apps.filter(match)} variant={variant} empty={apps.length ? 'No candidates match your search.' : (box.empty ?? 'Nothing here.')} />
    </section>
  )
}

const GRID_COLS: Record<number, string> = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }

/**
 * The dashboard's count boxes, the same for every user type: the first ("My action required") on its
 * own row across the left half of the page, the others in a row below it; the right half stays empty.
 * Each opens a page of its own listing those candidates. `page` is that page while one is open (show it
 * instead of the dashboard), else null.
 */
export function useCountBoxes(defs: CountBoxDef[], variant: TableVariant): { boxes: ReactNode; page: ReactNode | null } {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const opened = defs.find((d) => d.key === openKey)
  const open = (d: CountBoxDef) => {
    if (d.onOpen) return d.onOpen()
    setOpenKey(d.key)
    window.scrollTo({ top: 0 })
  }
  const [first, ...rest] = defs
  return {
    page: opened ? <BoxListPage box={opened} variant={variant} onBack={() => setOpenKey(null)} /> : null,
    boxes: (
      <div className="space-y-3 lg:w-1/2">
        {first && <CountBox box={first} onOpen={() => open(first)} big />}
        {rest.length > 0 && (
          // Two or three side by side; four as 2 × 2; five or six as rows of three.
          <div className={cx('grid grid-cols-2 gap-3', GRID_COLS[rest.length === 4 ? 2 : Math.min(rest.length, 3)])}>
            {rest.map((d) => (
              <CountBox key={d.key} box={d} onOpen={() => open(d)} />
            ))}
          </div>
        )}
      </div>
    ),
  }
}
