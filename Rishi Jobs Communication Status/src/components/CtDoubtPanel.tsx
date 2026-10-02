import { useState, type FormEvent } from 'react'
import { useApp } from '../context/AppContext'
import type { Application } from '../types'
import { fmtDateTime } from '../workflow/dates'
import { beforeClientTeam, isClosed } from '../workflow/workflow'
import { Alert, Button, Textarea } from './ui'

/**
 * Doubts between the Client Team and the PM on a candidate already with the Client Team. The Client
 * Team member asks; it is the PM's turn (red, reminded every 10 minutes) until they answer. The
 * candidate's status doesn't move meanwhile.
 */
export function CtDoubtPanel({ app, side }: { app: Application; side: 'PM' | 'ClientTeam' | null }) {
  const { nameOf } = useApp()
  const open = !isClosed(app.stage) && !beforeClientTeam(app.stage)
  const doubt = app.ctDoubt
  const last = app.lastCtDoubt
  if (!doubt && !last && !(side === 'ClientTeam' && open)) return null

  return (
    <div className="space-y-3 text-sm">
      {doubt && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
          <div className="text-xs text-amber-800">
            {side === 'ClientTeam' ? 'Your doubt' : `Doubt from ${doubt.byName}`} · {fmtDateTime(doubt.at)}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-slate-900">{doubt.text}</p>
          {side !== 'PM' && <p className="mt-1 text-xs font-medium text-amber-800">Waiting for {nameOf(app.assignedPM)} to answer.</p>}
        </div>
      )}
      {side === 'PM' && doubt && <Reply appId={app.id} to={doubt.byName} />}
      {side === 'ClientTeam' && open && !doubt && <Ask appId={app.id} pm={nameOf(app.assignedPM)} />}
      {last && (
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="text-xs text-slate-500">
            Last doubt from {last.byName} · {fmtDateTime(last.at)}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{last.text}</p>
          <div className="mt-2 text-xs text-slate-500">
            Answer from {last.answeredByName} · {fmtDateTime(last.answeredAt)}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap font-medium text-slate-900">{last.answer}</p>
        </div>
      )}
    </div>
  )
}

function useSend(appId: string, kind: 'ct_doubt' | 'ct_doubt_answer') {
  const { perform } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      await perform(appId, { kind, message: text })
      setText('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { text, setText, busy, error, submit }
}

function Ask({ appId, pm }: { appId: string; pm: string }) {
  const { text, setText, busy, error, submit } = useSend(appId, 'ct_doubt')
  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Your question for ${pm} — e.g. Client asks if the candidate can relocate to Pune`} />
      {error && <Alert>{error}</Alert>}
      <Button type="submit" variant="secondary" busy={busy} disabled={!text.trim()}>
        {busy ? 'Sending…' : `Raise a doubt to ${pm}`}
      </Button>
      <p className="text-xs text-slate-500">{pm} is alerted and reminded every 10 minutes until they answer. You can keep updating the status meanwhile.</p>
    </form>
  )
}

function Reply({ appId, to }: { appId: string; to: string }) {
  const { text, setText, busy, error, submit } = useSend(appId, 'ct_doubt_answer')
  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" autoFocus />
      {error && <Alert>{error}</Alert>}
      <Button type="submit" busy={busy} disabled={!text.trim()}>
        {busy ? 'Sending…' : `Send answer to ${to}`}
      </Button>
    </form>
  )
}
