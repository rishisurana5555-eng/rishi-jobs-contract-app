import { useEffect, useRef, useState } from 'react'
import { playSound, unlockAudio, type SoundKind } from '../alarm/sound'
import { useApp } from '../context/AppContext'
import { isAdminRole, ROLE_LABELS } from '../types'
import { timeAgo } from '../workflow/dates'
import { isMyTurn } from '../workflow/workflow'
import { GlobalSearchButton } from './GlobalSearch'
import { cx } from './ui'


export function Header() {
  const { me, unread, actionRequired, openApp, now, unreadMessages, setMessagesOpen } = useApp()
  const [open, setOpen] = useState(false)
  // Read afresh on every render: the app also asks for it by itself (see AppContext).
  const [, setPerm] = useState<NotificationPermission>('default')
  const perm: NotificationPermission = typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    const n = actionRequired.length
    document.title = n ? `(${n}) Rishi Jobs – Action required` : 'Rishi Jobs – Coordination Dashboard'
  }, [actionRequired.length])

  const showBell = !isAdminRole(me.role)
  const list = [...unread].sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)

  return (
    <header className="sticky top-0 z-20 bg-brand-800 text-white shadow">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2 sm:px-6">
        <img src="/logo.png" alt="Rishi Jobs" className="h-11 w-11 rounded-full bg-white object-contain p-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-base font-extrabold leading-tight tracking-wide">RISHI JOBS</div>
          <div className="truncate text-[11px] text-brand-200">PM ↔ Client Team Coordination</div>
        </div>

        <GlobalSearchButton />

        {showBell && (
          <div className="relative" ref={ref}>
            <button onClick={() => setOpen((o) => !o)} className="relative rounded-full p-2 hover:bg-white/10" aria-label={`${unread.length} unread updates`}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {unread.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold">
                  {unread.length}
                </span>
              )}
            </button>
            {open && (
              <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl bg-white text-slate-800 shadow-2xl ring-1 ring-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm font-semibold">
                  Unread updates
                  <span className="text-xs font-normal text-slate-500">{actionRequired.length} need your action</span>
                </div>
                <ul className="max-h-96 overflow-y-auto">
                  {list.length ? (
                    list.map((a) => (
                      <li key={a.id}>
                        <button
                          onClick={() => {
                            openApp(a.id)
                            setOpen(false)
                          }}
                          className="w-full border-b border-slate-50 px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate font-semibold">{a.candidateName}</span>
                            <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(a.lastUpdatedAt, now)}</span>
                          </div>
                          <div className="truncate text-xs text-slate-600">
                            {a.lastUpdatedByName}: {a.lastActionType === 'note' ? 'added a note' : a.lastActionLabel}
                          </div>
                          {isMyTurn(a, me.id, now) && <span className="text-[10px] font-bold uppercase text-red-600">Action required</span>}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="px-3 py-6 text-center text-sm text-slate-500">You’re all caught up.</li>
                  )}
                </ul>
                {perm === 'default' && (
                  <button
                    onClick={() => Notification.requestPermission().then(setPerm)}
                    className="w-full bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 hover:bg-brand-100"
                  >
                    🔔 Enable desktop alerts and reminders (when this tab is in the background)
                  </button>
                )}
                {perm === 'denied' && (
                  <p className="bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    🔕 Desktop alerts are blocked in this browser. To allow them, click the 🔒 icon at the left of the address bar → Notifications → Allow, then
                    reload the page.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {(isAdminRole(me.role) || me.role === 'PE') && (
          <button
            onClick={() => setMessagesOpen(true)}
            className="relative rounded-full p-2 hover:bg-white/10"
            aria-label={`Messages, ${unreadMessages.length} unread`}
            title={me.role === 'PE' ? 'Messages with the admins' : 'Messages from PEs'}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {unreadMessages.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold">
                {unreadMessages.length}
              </span>
            )}
          </button>
        )}

        <div className="hidden text-right sm:block">
          <div className="text-sm font-semibold">{me.name}</div>
          <div className="text-[11px] text-brand-200">{ROLE_LABELS[me.role]}</div>
        </div>
        <UserMenu />
      </div>
    </header>
  )
}

const TEST_SOUNDS: [SoundKind, string][] = [
  ['success', 'Status / done'],
  ['notify', 'Notification'],
  ['alert', 'Alert / warning'],
  ['alarm', 'Reminder alarm'],
]

function UserMenu() {
  const { backend, me } = useApp()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-sm font-bold hover:bg-white/25"
        aria-label="Account menu"
      >
        {me.name.slice(0, 1)}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl bg-white text-sm text-slate-800 shadow-2xl ring-1 ring-slate-200" onMouseLeave={() => setOpen(false)}>
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="font-semibold">{me.name}</div>
            <div className="truncate text-xs text-slate-500">User ID: {me.userId}</div>
          </div>
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">🔊 Test sounds</div>
            <div className="grid grid-cols-2 gap-1">
              {TEST_SOUNDS.map(([kind, label]) => (
                <button
                  key={kind}
                  onClick={() => {
                    unlockAudio()
                    playSound(kind, 'test')
                  }}
                  className="rounded bg-slate-50 px-2 py-1 text-left text-xs hover:bg-slate-100"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => backend.signOut()} className={cx('w-full px-3 py-2 text-left text-red-600 hover:bg-red-50')}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
