import { useState, type FormEvent } from 'react'
import { useApp } from '../context/AppContext'
import type { Application } from '../types'
import { Alert, Button, Field, Textarea, cx } from './ui'

type Choice = 'send' | 'query' | 'reject' | 'unanswered'

const REASON_LABEL = { query: 'Your doubt / question to {pe}', reject: 'Reason for rejecting', unanswered: 'Reason — why is it unanswered?' } as const
const REASON_MISSING = { query: 'Write your question.', reject: 'Write the reason for rejecting.', unanswered: 'Write the reason it is unanswered.' } as const
const REASON_PLACEHOLDER = {
  query: 'e.g. Has the candidate handled GST filing on their own?',
  reject: 'e.g. Experience does not match the job requirement.',
  unanswered: 'e.g. Called the candidate twice today, no answer; sent a WhatsApp message.',
} as const
const ACTION_KIND = { query: 'pm_query', reject: 'pm_reject', unanswered: 'pm_unanswered' } as const

/**
 * PM, on a candidate added by a PE: four choices — pass it to the Client Team (the "Send" form, which
 * asks the reason for selection), ask the PE a question (it goes back to the PE until they answer),
 * reject it (closes the record), or mark it unanswered (it goes to the PE to reach the candidate, and comes
 * back when the PE says they answered). Each asks a reason.
 */
export function PmDecisionPanel({ app }: { app: Application }) {
  const { perform, nameOf, setSendToCtId } = useApp()
  const [choice, setChoice] = useState<Choice | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pe = nameOf(app.assignedPE)

  const choices: [Choice, string, string][] = [
    ['send', '✓ Send', 'Revise the CV and send the candidate to the Client Team.'],
    ['reject', '✕ Reject', `Not suitable — the record is closed and ${pe} is told why.`],
    ['query', '? Doubt', `Ask ${pe} a question — they must answer before you decide.`],
    ['unanswered', '☎ Unanswered', `The candidate is not answering — ${pe} is asked to reach them and tell you when they answer.`],
  ]

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!choice || choice === 'send') return
    setError(null)
    if (!text.trim()) return setError(REASON_MISSING[choice])
    if (choice === 'reject' && !confirm(`Reject ${app.candidateName}? This closes the record.`)) return
    setBusy(true)
    try {
      await perform(app.id, { kind: ACTION_KIND[choice], message: text })
      setText('')
      setChoice(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {app.peAnswered && app.peUnanswered && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          ☎ <b>{pe}: the candidate answered — connect with them, then choose below.</b>
          {app.lastActionMessage && <p className="mt-0.5 whitespace-pre-wrap">“{app.lastActionMessage}”</p>}
        </div>
      )}
      <p className="text-sm text-slate-700">
        {pe} added this candidate. Choose one: <b>Send</b> to the Client Team, <b>Reject</b>, raise a <b>Doubt</b> with {pe}, or mark it <b>Unanswered</b>. Each asks
        for a reason, which goes into the history.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {choices.map(([c, label, hint]) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setError(null)
              if (c === 'send') return setSendToCtId(app.id)
              setChoice(c)
            }}
            className={cx(
              'rounded-lg border p-3 text-left text-sm transition',
              choice === c ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 bg-white hover:border-slate-300',
              c === 'reject' && 'text-red-700',
            )}
          >
            <div className="font-semibold">{label}</div>
            <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
          </button>
        ))}
      </div>

      {choice && choice !== 'send' && (
        <form onSubmit={submit} className="space-y-3">
          <Field label={REASON_LABEL[choice].replace('{pe}', pe)} required>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={REASON_PLACEHOLDER[choice]} autoFocus />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" busy={busy} variant={choice === 'reject' ? 'danger' : undefined}>
              {choice === 'query' ? `Send question to ${pe}` : choice === 'reject' ? 'Reject candidate' : 'Mark as unanswered'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setChoice(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * PE: the PM raised a doubt about their candidate, or could not reach the candidate (unanswered). The
 * answer — or the message that the candidate answered — sends the candidate back to the PM.
 */
export function PeAnswerPanel({ app }: { app: Application }) {
  const { perform, nameOf } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pm = nameOf(app.assignedPM)
  const unanswered = !!app.peUnanswered

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!text.trim()) return setError(unanswered ? `Write your message to ${pm}.` : 'Write your answer.')
    setBusy(true)
    try {
      await perform(app.id, { kind: 'pe_answer', message: text })
      setText('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {unanswered ? `Marked unanswered by ${pm} — reason` : `Doubt from ${pm}`}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-slate-800">{app.lastActionMessage || app.latestMessage}</p>
      </div>
      {unanswered && <p className="text-sm text-slate-600">Call the candidate. When they answer, tell {pm} here so {pm} can connect with them.</p>}
      <Field label={unanswered ? `Message to ${pm}` : 'Your answer'} required>
        <Textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={unanswered ? 'e.g. The candidate answered at 4 PM and is available now — please call them.' : 'Answer your PM’s doubt'}
        />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" busy={busy}>
        {unanswered ? `Candidate answered — tell ${pm}` : `Send answer to ${pm}`}
      </Button>
    </form>
  )
}

/** PE or PM: the candidate backed out — at any point before the record is closed. Closes it for everyone. */
export function BackoutControl({ app }: { app: Application }) {
  const { perform } = useApp()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!reason.trim()) return setError('Write the reason for the backout.')
    if (!confirm(`Mark ${app.candidateName} as "Candidate backout"? This closes the record for everyone.`)) return
    setBusy(true)
    try {
      await perform(app.id, { kind: 'candidate_backout', message: reason })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  if (!open)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Has the candidate backed out (no longer interested, took another offer…)?</p>
        <Button type="button" variant="secondary" className="text-red-700" onClick={() => setOpen(true)}>
          Candidate backout
        </Button>
      </div>
    )
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Reason for the backout" required>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Accepted another offer; not interested in relocating" autoFocus />
      </Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" busy={busy}>
          Mark as candidate backout
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
