import { playSound } from '../alarm/sound'
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

export const cx = (...c: (string | number | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-800 text-white hover:bg-brand-700 disabled:bg-slate-400',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100',
}

/** A small spinning circle, in the text colour — "please wait". */
export function Spin({ className }: { className?: string }) {
  return <span aria-hidden className={cx('inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />
}

/**
 * `busy`: the action is running — shows a spinner, and the button can't be clicked again until it
 * finishes (so nothing is sent twice).
 */
export function Button({
  variant = 'primary',
  className,
  busy,
  disabled,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...p}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        busy ? 'cursor-wait' : '',
        VARIANTS[variant],
        className,
      )}
    >
      {busy && <Spin />}
      {children}
    </button>
  )
}

/** Labelled form row. Use `group` when it wraps several controls (a <label> may only wrap one). */
export function Field({ label, required, hint, children, className, group }: { label: string; required?: boolean; hint?: ReactNode; children: ReactNode; className?: string; group?: boolean }) {
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className={cx('block', className)}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </Tag>
  )
}

const inputCls =
  'rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100'
/** Full width and py-2 unless the caller sets its own width / vertical padding. */
const fieldCls = (className?: string) =>
  cx(inputCls, !/(^|\s)w-/.test(className ?? '') && 'w-full', !/(^|\s)py-/.test(className ?? '') && 'py-2', className)

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={fieldCls(className)} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={fieldCls(className)} />
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={2} {...p} className={fieldCls(cx('resize-y', className))} />
)

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'warn' | 'info' | 'ok'; children: ReactNode }) {
  // Errors and warnings get the (harsher) alert sound when they appear.
  useEffect(() => {
    if (tone === 'error' || tone === 'warn') playSound('alert')
  }, [tone])
  const cls = {
    error: 'border-red-200 bg-red-50 text-red-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-brand-100 bg-brand-50 text-brand-800',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  }[tone]
  return <div className={cx('rounded-lg border px-3 py-2 text-sm', cls)}>{children}</div>
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  full,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  /** the whole screen, edge to edge (a CV beside a form); the body scrolls under a fixed header */
  full?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className={cx('fixed inset-0 z-40 flex items-start justify-center bg-slate-900/40', full ? '' : 'overflow-y-auto p-0 sm:p-6')} onMouseDown={onClose}>
      <div
        className={cx('w-full bg-white shadow-xl', full ? 'flex h-full flex-col' : cx('min-h-full sm:min-h-0 sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'))}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            ✕
          </button>
        </header>
        <div className={full ? 'min-h-0 flex-1 overflow-y-auto p-3 sm:p-4' : 'p-5'}>{children}</div>
      </div>
    </div>
  )
}

/** Segmented tab switcher, e.g. Submissions | Candidates. */
export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cx('rounded-md px-3 py-1.5 text-sm font-medium', value === key ? 'bg-brand-800 text-white' : 'text-slate-600 hover:bg-slate-50')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
      <Spin className="border-slate-300 border-t-brand-700" />
      {label}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>
}
