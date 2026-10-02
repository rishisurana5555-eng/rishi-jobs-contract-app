import { useState } from 'react'
import type { AvailabilityRound, Interview, Side } from '../types'
import { findMatches, fmtDateTime, fmtSlot } from '../workflow/dates'
import { Alert, Button, Textarea, cx } from './ui'

const IV_STATUS = {
  scheduled: { text: 'Scheduled', cls: 'bg-sky-100 text-sky-800' },
  in_progress: { text: 'In progress', cls: 'bg-sky-100 text-sky-800' },
  completed: { text: 'Completed', cls: 'bg-emerald-100 text-emerald-800' },
  cancelled: { text: 'Rescheduled', cls: 'bg-slate-200 text-slate-600 line-through' },
}

const MODE = { video: 'Video', phone: 'Phone', 'in-person': 'In person' }

/** Every round's availability attempts and interviews, newest round first. */
export function InterviewPanel({
  rounds,
  interviews,
  now,
  side,
  onSaveDebrief,
}: {
  rounds: AvailabilityRound[]
  interviews: Interview[]
  now: number
  /** viewer's side: PM may write the candidate debrief, Client Team the client debrief */
  side?: Side | null
  onSaveDebrief?: (interviewId: string, text: string) => Promise<unknown>
}) {
  const roundNos = [...new Set([...rounds.map((r) => r.interviewRound), ...interviews.map((i) => i.interviewRound)])].sort((a, b) => b - a)
  if (!roundNos.length) return <p className="text-sm text-slate-500">No availability recorded yet.</p>
  return (
    <div className="space-y-4">
      {roundNos.map((n) => (
        <div key={n} className="rounded-lg border border-slate-200">
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold">Round {n}</div>
          <div className="space-y-3 p-3">
            {rounds
              .filter((r) => r.interviewRound === n)
              .sort((a, b) => a.attemptNumber - b.attemptNumber)
              .map((r) => {
                const matches = findMatches(r.candidateDates, r.clientDates)
                return (
                  <div key={r.id} className="text-sm">
                    <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold">Attempt {r.attemptNumber}</span>
                      <span
                        className={cx(
                          'rounded px-1.5 py-0.5',
                          r.matchResult === 'matched' && 'bg-emerald-100 text-emerald-800',
                          r.matchResult === 'no-match' && 'bg-red-100 text-red-800',
                          r.matchResult === 'pending' && 'bg-amber-100 text-amber-800',
                        )}
                      >
                        {r.matchResult === 'no-match' ? 'No match' : r.matchResult === 'matched' ? 'Matched' : 'Pending'}
                      </span>
                    </div>
                    {/* Older records only: available dates are now written in the messages (see the timeline). */}
                    {r.candidateDates.length + r.clientDates.length === 0 ? (
                      <div className="text-xs italic text-slate-400">Available dates are in the messages — see the timeline.</div>
                    ) : (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {(['candidateDates', 'clientDates'] as const).map((k) => (
                        <div key={k}>
                          <div className="text-slate-400">{k === 'candidateDates' ? 'Candidate' : 'Client'}</div>
                          {r[k].length ? (
                            r[k].map((s, i) => (
                              <div key={i} className={cx(matches.some((m) => m.date === s.date) && 'font-semibold text-emerald-700')}>
                                {fmtSlot(s)}
                              </div>
                            ))
                          ) : (
                            <div className="italic text-slate-400">—</div>
                          )}
                        </div>
                      ))}
                    </div>
                    )}
                  </div>
                )
              })}

            {interviews
              .filter((i) => i.interviewRound === n)
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((iv) => {
                const st = iv.status === 'scheduled' && now >= new Date(iv.scheduledAt).setHours(0, 0, 0, 0) ? 'in_progress' : iv.status
                // Debriefs can be written once the interview has started, for any round (also after moving to the next round).
                const held = iv.status === 'completed' || (iv.status === 'scheduled' && iv.scheduledAt <= now)
                const save = (text: string) => onSaveDebrief!(iv.id, text)
                return (
                  <div key={iv.id} className="rounded-md bg-slate-50 p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">🤝 {fmtDateTime(iv.scheduledAt)}</span>
                      <span className="text-xs text-slate-500">{MODE[iv.mode]}</span>
                      <span className={cx('rounded px-1.5 py-0.5 text-xs', IV_STATUS[st].cls)}>{IV_STATUS[st].text}</span>
                    </div>
                    {iv.meetingDetails && <div className="mt-1 break-words text-xs text-slate-600">{iv.meetingDetails}</div>}
                    {iv.status !== 'cancelled' && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <Debrief title="Candidate debrief (PM)" text={iv.candidateDebrief} at={iv.candidateDebriefAt} onSave={held && side === 'PM' && onSaveDebrief ? save : undefined} />
                        <Debrief title="Client debrief (Client Team)" text={iv.clientDebrief} at={iv.clientDebriefAt} onSave={held && side === 'ClientTeam' && onSaveDebrief ? save : undefined} />
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}

function Debrief({ title, text, at, onSave }: { title: string; text: string | null; at: number | null; onSave?: (text: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!onSave || !draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onSave(draft)
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded border border-slate-200 bg-white p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-500">{title}</span>
        {onSave && !editing && (
          <button
            type="button"
            className="font-medium text-brand-600 hover:underline"
            onClick={() => {
              setDraft(text ?? '')
              setEditing(true)
            }}
          >
            {text ? 'Edit' : '+ Add debrief'}
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-1 space-y-1.5">
          <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What was said about this interview?" autoFocus />
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="button" className="px-2 py-1 text-xs" busy={busy} disabled={!draft.trim()} onClick={submit}>
              {busy ? 'Saving…' : 'Save debrief'}
            </Button>
            <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : text ? (
        <>
          <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{text}</p>
          {at && <p className="mt-0.5 text-[10px] text-slate-400">{fmtDateTime(at)}</p>}
        </>
      ) : (
        <p className="mt-0.5 italic text-slate-400">Not recorded yet</p>
      )}
    </div>
  )
}
