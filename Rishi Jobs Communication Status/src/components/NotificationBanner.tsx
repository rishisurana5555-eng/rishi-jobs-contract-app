import { useEffect } from 'react'
import { useApp, type Toast } from '../context/AppContext'
import { cx } from './ui'

const MAX_SHOWN = 3

/**
 * Instant top-of-page alerts for changes made by the other side. Rendered in the page flow
 * (sticky under the header) so they never cover buttons.
 */
export function NotificationBanner() {
  const { toasts, dismissToast } = useApp()
  if (!toasts.length) return null
  const hidden = toasts.length - MAX_SHOWN
  return (
    <div className="sticky top-[60px] z-10 mb-4 space-y-2" aria-live="polite">
      {toasts.slice(0, MAX_SHOWN).map((t) => (
        <Banner key={t.id} toast={t} />
      ))}
      {hidden > 0 && (
        <button onClick={() => toasts.slice(MAX_SHOWN).forEach((t) => dismissToast(t.id))} className="text-xs text-slate-500 hover:underline">
          +{hidden} more (see the bell) — dismiss
        </button>
      )}
    </div>
  )
}

function Banner({ toast }: { toast: Toast }) {
  const { openApp, dismissToast, setMessagesOpen, openJob } = useApp()
  useEffect(() => {
    // Informational alerts fade away; action-required ones and new client / job announcements stay until closed.
    if (toast.actionRequired || toast.announcement || toast.isMessage) return
    const t = setTimeout(() => dismissToast(toast.id), 10_000)
    return () => clearTimeout(t)
  }, [toast, dismissToast])

  return (
    <div
      className={cx(
        'animate-slide-in flex cursor-pointer items-start gap-3 rounded-xl border-l-4 bg-white px-4 py-2.5 shadow-md ring-1 ring-slate-200 hover:bg-slate-50',
        toast.actionRequired ? 'border-l-red-500' : toast.announcement ? 'border-l-emerald-500' : 'border-l-brand-500',
      )}
      onClick={() => {
        if (toast.appId) return openApp(toast.appId)
        dismissToast(toast.id)
        if (toast.isMessage) setMessagesOpen(true)
        if (toast.jobId) openJob(toast.jobId)
      }}
      role="alert"
    >
      <div className="min-w-0 flex-1 text-sm">
        {toast.actionRequired && (
          <span className="mr-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Action required</span>
        )}
        <span className="font-semibold text-slate-900">{toast.title}</span>
        {toast.body && <span className="text-slate-700">: {toast.body}</span>}
        {toast.message && <span className="italic text-slate-600"> — “{toast.message}”</span>}
      </div>
      {(toast.appId || toast.jobId) && <span className="hidden shrink-0 text-xs font-medium text-brand-600 sm:inline">Open →</span>}
      <button
        onClick={(e) => {
          e.stopPropagation()
          dismissToast(toast.id)
        }}
        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
