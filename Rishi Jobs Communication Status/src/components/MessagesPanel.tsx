import { useEffect, useState, type FormEvent } from 'react'
import { useApp } from '../context/AppContext'
import { ALL_ADMINS, isAdminRole, ROLE_LABELS, type AdminMessage } from '../types'
import { fmtDateTime, timeAgo } from '../workflow/dates'
import { Alert, Button, Empty, Field, Modal, Select, Textarea, cx } from './ui'

const MAX_LENGTH = 2000

interface Thread {
  root: AdminMessage
  /** root first, then replies, oldest → newest */
  items: AdminMessage[]
  lastAt: number
}

/** Groups messages into conversations (newest activity first). */
function threadsOf(messages: AdminMessage[]): Thread[] {
  const byRoot = new Map<string, AdminMessage[]>()
  for (const m of messages) {
    const key = m.replyTo ?? m.id
    byRoot.set(key, [...(byRoot.get(key) ?? []), m])
  }
  const threads: Thread[] = []
  for (const [rootId, list] of byRoot) {
    const root = list.find((m) => m.id === rootId)
    if (!root) continue
    const items = [...list].sort((a, b) => a.createdAt - b.createdAt)
    threads.push({ root, items, lastAt: items[items.length - 1].createdAt })
  }
  return threads.sort((a, b) => b.lastAt - a.lastAt)
}

/** PE: start a conversation with an Admin / the Super Admin (or all of them). Both sides reply in it. */
export function MessagesModal() {
  const { messagesOpen, setMessagesOpen, me } = useApp()
  if (!messagesOpen) return null
  const admin = isAdminRole(me.role)
  return (
    <Modal title={admin ? 'Messages from PEs' : 'Messages with the admins'} onClose={() => setMessagesOpen(false)} wide>
      <Conversations admin={admin} />
    </Modal>
  )
}

function Conversations({ admin }: { admin: boolean }) {
  const { me, messages, backend } = useApp()
  // While the window is open, everything shown from others is marked read; the dot stays until it is closed.
  const [highlight, setHighlight] = useState(() => new Set<string>())
  useEffect(() => {
    const unread = messages.filter((m) => m.from !== me.id && !m.readBy.includes(me.id))
    if (!unread.length) return
    setHighlight((h) => new Set([...h, ...unread.map((m) => m.id)]))
    for (const m of unread) backend.markMessageRead(m.id, me.id).catch(console.error)
  }, [messages, backend, me.id])

  const threads = threadsOf(messages)
  return (
    <div className="space-y-5">
      {!admin && <NewMessage />}
      <section className="space-y-3">
        {!admin && <h3 className="text-sm font-semibold text-slate-700">Your conversations</h3>}
        {threads.length ? (
          <ul className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {threads.map((t) => (
              <ThreadView key={t.root.id} thread={t} admin={admin} highlight={highlight} />
            ))}
          </ul>
        ) : (
          <Empty>{admin ? 'No messages yet. PEs can write to you from their dashboard.' : 'You haven’t sent any messages yet.'}</Empty>
        )}
      </section>
    </div>
  )
}

function useAdmins() {
  const { users } = useApp()
  return users
    .filter((u) => isAdminRole(u.role) && u.active !== false)
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'SuperAdmin' ? -1 : 1))
}

function NewMessage() {
  const { me, backend } = useApp()
  const admins = useAdmins()
  const [to, setTo] = useState(ALL_ADMINS)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function send(e: FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return setError('Write your message first.')
    setBusy(true)
    setError(null)
    setSent(false)
    try {
      await backend.sendMessage({
        pe: me.id,
        threadTo: to,
        replyTo: null,
        from: me.id,
        fromName: me.name,
        to,
        toName: admins.find((a) => a.id === to)?.name ?? 'All admins',
        body: text,
        createdAt: Date.now(),
        readBy: [],
      })
      setBody('')
      setSent(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={send} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-semibold text-slate-700">New message</h3>
      <Field label="To">
        <Select value={to} onChange={(e) => setTo(e.target.value)}>
          <option value={ALL_ADMINS}>All admins ({admins.map((a) => a.name).join(', ')})</option>
          {admins.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {ROLE_LABELS[a.role]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Message" hint={`${body.length}/${MAX_LENGTH}`}>
        <Textarea rows={4} maxLength={MAX_LENGTH} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write anything you want to tell the admins…" autoFocus />
      </Field>
      {error && <Alert>{error}</Alert>}
      {sent && <Alert tone="ok">Message sent.</Alert>}
      <div className="flex justify-end">
        <Button type="submit" busy={busy}>
          {busy ? 'Sending…' : 'Send message'}
        </Button>
      </div>
    </form>
  )
}

function ThreadView({ thread, admin, highlight }: { thread: Thread; admin: boolean; highlight: Set<string> }) {
  const { me, backend, nameOf, now } = useApp()
  const { root } = thread
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const withWhom = root.threadTo === ALL_ADMINS ? 'all admins' : root.threadTo === me.id ? 'you' : nameOf(root.threadTo)
  const title = admin ? `${nameOf(root.pe)} → ${withWhom}` : `With ${root.threadTo === ALL_ADMINS ? 'all admins' : nameOf(root.threadTo)}`
  const lastFromOther = [...thread.items].reverse().find((m) => m.from !== me.id)

  async function send(e: FormEvent) {
    e.preventDefault()
    const text = reply.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    try {
      // Admins answer the PE; the PE answers whoever the conversation is with.
      const to = admin ? root.pe : root.threadTo
      await backend.sendMessage({
        pe: root.pe,
        threadTo: root.threadTo,
        replyTo: root.id,
        from: me.id,
        fromName: me.name,
        to,
        toName: admin ? nameOf(root.pe) : root.threadTo === ALL_ADMINS ? 'All admins' : nameOf(root.threadTo),
        body: text,
        createdAt: Date.now(),
        readBy: [],
      })
      setReply('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
        <span className="text-sm font-semibold text-slate-800">{title}</span>
        <span className="ml-auto">
          {thread.items.length} message{thread.items.length > 1 ? 's' : ''} · {timeAgo(thread.lastAt, now)}
        </span>
      </div>
      <ol className="space-y-2 px-3 py-2">
        {thread.items.map((m) => {
          const mine = m.from === me.id
          return (
            <li key={m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cx(
                  'max-w-[85%] rounded-lg px-3 py-1.5',
                  mine ? 'bg-brand-50 text-slate-800' : 'bg-slate-100 text-slate-800',
                  highlight.has(m.id) && 'ring-2 ring-red-300',
                )}
              >
                <div className="text-[11px] text-slate-500" title={fmtDateTime(m.createdAt)}>
                  <b className="text-slate-700">{mine ? 'You' : m.fromName}</b> · {timeAgo(m.createdAt, now)}
                  {mine && m.readBy.length > 0 && <span className="ml-1 text-emerald-700">· ✓ Read</span>}
                </div>
                <p className="whitespace-pre-wrap text-sm">{m.body}</p>
              </div>
            </li>
          )
        })}
      </ol>
      <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-100 px-3 py-2">
        <Textarea
          rows={1}
          maxLength={MAX_LENGTH}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={lastFromOther ? `Reply to ${lastFromOther.fromName}…` : 'Add to this conversation…'}
          aria-label="Reply"
        />
        <Button type="submit" busy={busy} disabled={!reply.trim()} className="shrink-0">
          {busy ? 'Sending…' : 'Reply'}
        </Button>
      </form>
      {error && (
        <div className="px-3 pb-2">
          <Alert>{error}</Alert>
        </div>
      )}
    </li>
  )
}
