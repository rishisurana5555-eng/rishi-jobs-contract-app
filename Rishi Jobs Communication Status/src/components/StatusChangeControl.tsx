import { useEffect, useState, type FormEvent } from 'react'
import { useApp } from '../context/AppContext'
import type { Application, InterviewMode } from '../types'
import { slotMatchesDate, toEpoch } from '../workflow/dates'
import { hasInterviewToDebrief, optionByCode, optionsFor, sideOf, type OptionCode } from '../workflow/workflow'
import { NoteInput } from './NoteInput'
import { TimeSelect } from './TimeSelect'
import { Alert, Button, Field, Input, Select, Textarea } from './ui'

const CLOSING: OptionCode[] = ['candidate_placed', 'candidate_rejected']

/**
 * Fixed-option status dropdown (filtered to the viewer's role + the record's stage),
 * the extra inputs the chosen option needs, and one message box: sent with the status update,
 * or on its own as a note when no status is chosen.
 */
export function StatusChangeControl({ app }: { app: Application }) {
  const { me, perform, nameOf } = useApp()
  const options = optionsFor(app, me.id)
  const side = sideOf(app, me.id)
  const enteringClientDates = side === 'ClientTeam' && (app.stage === 'cv_with_client' || app.stage === 'rescheduling')

  const [code, setCode] = useState<OptionCode | ''>('')
  const [message, setMessage] = useState('')
  const [ivDate, setIvDate] = useState('')
  const [ivTime, setIvTime] = useState('10:00')
  const [ivMode, setIvMode] = useState<InterviewMode>('video')
  const [ivDetails, setIvDetails] = useState('')
  const [debrief, setDebrief] = useState('')
  const [waitDate, setWaitDate] = useState('')
  const [waitTime, setWaitTime] = useState('17:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // Reset whenever the record moves to another stage/attempt (by us or by the other side).
  const stageKey = `${app.id}|${app.stage}|${app.currentInterviewRound}|${app.currentAttempt}|${app.pmDebriefDone}|${app.pmDatesSubmitted}`
  useEffect(() => {
    setCode('')
    setIvDate('')
    setDebrief('')
    setWaitDate('')
    setError(null)
  }, [stageKey])

  if (!side) return null
  if (!options.length && !enteringClientDates) {
    const waiting = app.nextActionBy.filter((id) => id !== me.id).map(nameOf)
    return (
      <div className="space-y-3">
        {done && <Alert tone="ok">{done}</Alert>}
        <p className="text-sm text-slate-500">
          {waiting.length
            ? `No status change needed from you right now — waiting on ${waiting.join(' & ')}. You can still add a message.`
            : 'No status change available at this stage. You can still add a message.'}
        </p>
        <NoteInput appId={app.id} />
      </div>
    )
  }

  const opt = code ? optionByCode(code) : null
  const fields = opt ? opt.fields(app) : []
  // Only for older records that still have candidate dates saved; new dates are written in messages.
  const ivOffCandidateDates = !!ivDate && app.latestCandidateDates.length > 0 && !slotMatchesDate(app.latestCandidateDates, ivDate)
  const datesInMessage = fields.includes('datesInMessage')
  const datesWho = side === 'PM' ? 'candidate' : 'client'

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await fn()
      setMessage('')
      setDone(okText)
      setTimeout(() => setDone(null), 4000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!opt) {
      if (!message.trim()) return setError('Choose a status or write a message.')
      return void run(() => perform(app.id, { kind: 'note', message }), 'Message added')
    }
    if (datesInMessage && !message.trim()) return setError(`Write the ${datesWho}’s available dates in the message box.`)
    if (CLOSING.includes(opt.code) && !confirm(`Set the final outcome to "${opt.label}"? This closes the record for both sides.`)) return
    void run(
      () =>
        perform(app.id, {
          kind: 'status',
          code: opt.code,
          message,
          debrief,
          waitUntil: fields.includes('waitUntil') && waitDate ? toEpoch(waitDate, waitTime) : undefined,
          interview: fields.includes('interview')
            ? { scheduledAt: ivDate ? toEpoch(ivDate, ivTime) : 0, mode: ivMode, meetingDetails: ivDetails }
            : undefined,
        }),
      `Status updated: ${opt.label}`,
    )
  }

  const sendClientDatesOnly = () => {
    if (!message.trim()) return setError('Write the client’s available dates in the message box first.')
    void run(() => perform(app.id, { kind: 'save_client_dates', message }), 'Client dates sent')
  }

  const messageLabel = datesInMessage
    ? `${datesWho === 'candidate' ? 'Candidate' : 'Client'} available dates & message`
    : enteringClientDates && !code
      ? 'Client available dates / message'
      : 'Message / note'
  const messageHint = datesInMessage
    ? `Required — write the ${datesWho}’s available dates (and times) here, along with anything else you want to share.`
    : code
      ? 'Sent with this status update. Write any available dates here too.'
      : enteringClientDates
        ? 'Write the client’s available dates here and click “Send client dates only”, or add it as a note.'
        : 'No status chosen — this is added as a note without changing the status.'

  return (
    <form onSubmit={submit} className="space-y-4">
      {enteringClientDates && !app.pmDatesSubmitted && app.stage === 'rescheduling' && (
        <p className="text-xs text-slate-500">{nameOf(app.assignedPM)} hasn’t sent the candidate’s new dates yet.</p>
      )}

      <Field label="Update status">
        <Select value={code} onChange={(e) => setCode(e.target.value as OptionCode)}>
          <option value="">— Select a status —</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {fields.includes('interview') && (
        <div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <Field label="Interview date" required>
            <Input type="date" value={ivDate} onChange={(e) => setIvDate(e.target.value)} />
          </Field>
          <Field label="Time" required group>
            <TimeSelect label="Interview time" value={ivTime} onChange={setIvTime} />
          </Field>
          <Field label="Mode" required>
            <Select value={ivMode} onChange={(e) => setIvMode(e.target.value as InterviewMode)}>
              <option value="video">Video</option>
              <option value="phone">Phone</option>
              <option value="in-person">In person</option>
            </Select>
          </Field>
          <Field label="Meeting details / link">
            <Input value={ivDetails} onChange={(e) => setIvDetails(e.target.value)} placeholder="Address, meeting link, contact…" />
          </Field>
          {ivOffCandidateDates && (
            <div className="sm:col-span-2">
              <Alert tone="warn">This date is not in the candidate’s available dates. Make sure the candidate has confirmed it.</Alert>
            </div>
          )}
        </div>
      )}

      {fields.includes('waitUntil') && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`${opt?.code === 'client_asked_wait' ? 'Client' : 'Candidate'} will answer by – date`} required>
              <Input type="date" value={waitDate} onChange={(e) => setWaitDate(e.target.value)} />
            </Field>
            <Field label="Time" required group>
              <TimeSelect label="Wait till time" value={waitTime} onChange={setWaitTime} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">Only your reminder alarms for this candidate pause until this time, then start again if you haven’t updated the status. The other side is still reminded of its own pending work.</p>
        </div>
      )}


      {(fields.includes('candidateDebrief') || fields.includes('clientDebrief')) && (
        <Field label={fields.includes('candidateDebrief') ? 'Candidate debrief' : 'Client debrief'} required>
          <Textarea rows={3} value={debrief} onChange={(e) => setDebrief(e.target.value)} placeholder="What was said about the interview?" />
        </Field>
      )}


      {opt && (CLOSING.includes(opt.code) || opt.code === 'next_round') && hasInterviewToDebrief(app.stage) && !app.pmDebriefDone && (
        <Alert tone="warn">
          {nameOf(app.assignedPM)} has not recorded the candidate debrief yet. You can still go ahead — the debrief can be added later under
          “Availability &amp; interviews”.
        </Alert>
      )}

      <Field label={messageLabel} required={datesInMessage} hint={messageHint}>
        <Textarea
          rows={datesInMessage || enteringClientDates ? 4 : 3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            datesInMessage || (enteringClientDates && !code)
              ? 'e.g. Available: 12 Oct 10am–1pm, 14 Oct after 3pm. Prefers a video interview.'
              : 'e.g. Client asked for one more reference check'
          }
        />
      </Field>

      {error && <Alert>{error}</Alert>}
      {done && <Alert tone="ok">{done}</Alert>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={busy} disabled={!code && !message.trim()} className="w-full sm:w-auto">
          {busy ? 'Saving…' : code ? 'Update Status' : 'Add message'}
        </Button>
        {enteringClientDates && !code && (
          <Button type="button" variant="secondary" busy={busy} disabled={!message.trim()} onClick={sendClientDatesOnly} className="w-full sm:w-auto">
            Send client dates only (no status change)
          </Button>
        )}
      </div>
    </form>
  )
}
