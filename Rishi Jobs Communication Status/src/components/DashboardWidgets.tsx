import { useState, type ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import type { Application } from '../types'
import { viewerLabel } from '../workflow/workflow'
import { Card, Input, Select, cx } from './ui'

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

/** "My Action Required": only records where the viewer is in nextActionBy, oldest first. */
export function ActionRequired({ apps }: { apps: Application[] }) {
  const { me, openApp, names } = useApp()
  const list = [...apps].sort((a, b) => a.stageSince - b.stageSince)
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">{list.length}</span>
          My Action Required
        </span>
      }
      className={cx(list.length > 0 && 'border-red-200')}
    >
      {list.length ? (
        <ul className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2 overflow-y-auto">
          {list.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => openApp(a.id)}
                className="h-full w-full rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-left transition-colors hover:bg-red-50"
              >
                <div className="truncate text-sm font-semibold text-slate-900">{a.candidateName}</div>
                <div className="text-xs leading-snug text-red-800">{viewerLabel(a, me.id, me.role, undefined, names)}</div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">🎉 Nothing needs your action right now.</p>
      )}
    </Card>
  )
}

/** Compact count boxes (2×2) beside a wider "My Action Required" panel. */
export function DashboardTop({ stats, actionApps }: { stats: ReactNode; actionApps: Application[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="grid grid-cols-2 content-start gap-2 sm:grid-cols-4 lg:grid-cols-2">{stats}</div>
      <div className="lg:col-span-2">
        <ActionRequired apps={actionApps} />
      </div>
    </div>
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
