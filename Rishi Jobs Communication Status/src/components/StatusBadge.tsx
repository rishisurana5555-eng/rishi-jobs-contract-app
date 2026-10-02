import type { ReactNode } from 'react'
import type { Application } from '../types'
import { toneFor, viewerLabel, type Tone } from '../workflow/workflow'
import { useApp } from '../context/AppContext'
import { cx } from './ui'

export const TONE_STYLES: Record<Tone, { badge: string; dot: string; row: string; name: string }> = {
  red: { badge: 'bg-red-50 text-red-800 ring-red-200', dot: 'bg-red-500', row: 'border-l-red-500', name: 'Your action' },
  yellow: { badge: 'bg-amber-50 text-amber-900 ring-amber-200', dot: 'bg-amber-400', row: 'border-l-amber-400', name: 'Waiting on other side' },
  blue: { badge: 'bg-sky-50 text-sky-800 ring-sky-200', dot: 'bg-sky-500', row: 'border-l-sky-500', name: 'Interview scheduled / waiting' },
  green: { badge: 'bg-emerald-50 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500', row: 'border-l-emerald-500', name: 'Placed' },
  grey: { badge: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400', row: 'border-l-slate-300', name: 'Rejected' },
}

export function ToneBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-start gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset', TONE_STYLES[tone].badge, className)}>
      <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', TONE_STYLES[tone].dot)} />
      <span>{children}</span>
    </span>
  )
}

/** Status as the current viewer should see it (their own side's label and color). */
export function StatusBadge({ app, className }: { app: Application; className?: string }) {
  const { me, names } = useApp()
  return (
    <ToneBadge tone={toneFor(app, me.id)} className={className}>
      {viewerLabel(app, me.id, me.role, undefined, names)}
    </ToneBadge>
  )
}

export function ColorLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {(Object.keys(TONE_STYLES) as Tone[]).map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className={cx('h-2 w-2 rounded-full', TONE_STYLES[t].dot)} />
          {TONE_STYLES[t].name}
        </span>
      ))}
    </div>
  )
}

/** "You", "Dipanshi", "You & Dipanshi" or "—" */
export function useNextActionText() {
  const { me, nameOf } = useApp()
  return (app: Application) =>
    app.nextActionBy.length ? app.nextActionBy.map((id) => (id === me.id ? 'You' : nameOf(id))).join(' & ') : '—'
}
