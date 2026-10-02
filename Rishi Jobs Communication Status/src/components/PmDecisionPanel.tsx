import { useState, type FormEvent } from 'react'
import { useApp } from '../context/AppContext'
import type { Application } from '../types'
import { Alert, Button, Field, Textarea, cx } from './ui'

type Choice = 'send' | 'query' | 'reject'

/**
 * PM, on a candidate added by a PE: three choices — pass it to the Client Team (the "Send" form),
 * ask the PE a question (it goes back to the PE until they answer), or reject it (closes the record).
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
  ]

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (choice !== 'query' && choice !== 'reject') return
    setError(null)
    if (!text.trim()) return setError(choice === 'query' ? 'Write your question.' : 'Write the reason for rejecting.')
    if (choice === 'reject' && !confirm(`Reject ${app.candidateName}? This closes the record.`)) return
    setBusy(true)
    try {
      await perform(app.id, { kind: choice === 'query' ? 'pm_query' : 'pm_reject', message: text })
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
      <p className="text-sm text-slate-700">
        {pe} added this candidate. Choose one: <b>Send</b> to the Client Team, <b>Reject</b>, or raise a <b>Doubt</b> with {pe}.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
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

      {(choice === 'query' || choice === 'reject') && (
        <form onSubmit={submit} className="space-y-3">
          <Field label={choice === 'query' ? `Your doubt / question to ${pe}` : 'Reason for rejecting'} required>
            <Textarea
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={choice === 'query' ? 'e.g. Has the candidate handled GST filing on their own?' : 'e.g. Experience does not match the job requirement.'}
              autoFocus
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" busy={busy} variant={choice === 'reject' ? 'danger' : undefined}>
              {choice === 'query' ? `Send question to ${pe}` : 'Reject candidate'}
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

/** PE: the PM raised a doubt about their candidate; the answer sends the candidate back to the PM. */
export function PeAnswerPanel({ app }: { app: Application }) {
  const { perform, nameOf } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!text.trim()) return setError('Write your answer.')
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
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Doubt from {nameOf(app.assignedPM)}</div>
        <p className="mt-1 whitespace-pre-wrap text-slate-800">{app.lastActionMessage || app.latestMessage}</p>
      </div>
      <Field label="Your answer" required>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Answer your PM’s doubt" />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" busy={busy}>
        Send answer to {nameOf(app.assignedPM)}
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
