import { useState, type FormEvent } from 'react'
import { extractCvFacts, type CvFacts } from '../cv/extract'
import { useApp } from '../context/AppContext'
import type { CandidateProfile } from '../types'
import { properName } from '../workflow/names'
import { ClientJobFields } from './ClientJobFields'
import { blankCvDetails, cvDetailsProblem, CvDetailsFields, type CvDetails } from './CvDetailsFields'
import { altPhoneProblem, displayPhone, duplicatePhoneMessage, phoneProblem, PhoneInput } from './PhoneInput'
import { Suggestion } from './Suggestion'
import { UploadNote } from './UploadNote'
import { useBackgroundUpload } from './useBackgroundUpload'
import { usePhoneTaken } from './usePhoneTaken'
import { Alert, Button, Field, Input, Spin, Textarea } from './ui'

type Reading = 'idle' | 'reading' | 'done' | 'nothing' | 'failed'

/**
 * PE adds a candidate for a job opening assigned to them; it goes to that job's PM. Step 1 is the original CV: its common details are read off
 * it and filled in below (all editable). The PM then revises the CV and sends it to the Client Team.
 * With `existing`, an existing candidate is sent to another client: their details and saved CV are
 * used, so only the client, job and message are new. The candidate's available dates are written
 * in the message to the PM.
 */
export function AddCandidateForm({ onDone, existing, jobId }: { onDone: (appId: string) => void; existing?: CandidateProfile; jobId?: string }) {
  const { me, jobs, clients, perform, nameOf } = useApp()
  const [cvFile, setCvFile] = useState<File | null>(null)
  // Uploads to Drive as soon as the CV is picked (while the PE checks the form), so Send only has to save.
  const upload = useBackgroundUpload(cvFile)
  const [reading, setReading] = useState<Reading>('idle')
  const [candidateName, setCandidateName] = useState(existing?.candidateName ?? '')
  const [contact, setContact] = useState(existing?.candidateContactNumber ?? '')
  /** optional second number */
  const [altContact, setAltContact] = useState(existing?.candidateAltContactNumber ?? '')
  const [email, setEmail] = useState(existing?.candidateEmail ?? '')
  // No two people share a number: another candidate's number can't be used.
  const contactTaken = usePhoneTaken(contact, existing?.id)
  const altTaken = usePhoneTaken(altContact, existing?.id)
  const taken = contactTaken ?? altTaken
  const [place, setPlace] = useState(() => ({ clientId: jobs.find((j) => j.id === jobId)?.clientId ?? '', jobId: jobId ?? '' }))
  // The candidate goes to the PM the job opening is assigned to.
  const jobPm = jobs.find((j) => j.id === place.jobId)?.assignedPM ?? null
  const noJobs = !jobId && !jobs.some((j) => j.status === 'open')
  const [details, setDetails] = useState<CvDetails>(() =>
    existing
      ? { currentSalary: existing.currentSalary, expectedSalary: existing.expectedSalary, noticePeriod: existing.noticePeriod, recruiterNote: existing.recruiterNote }
      : blankCvDetails(),
  )
  const hasCv = !!cvFile || !!existing?.originalCvUrl
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  /** what the Send button is doing right now */
  const [step, setStep] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** details read from the CV, offered under their fields as suggestions (never filled in by themselves) */
  const [suggested, setSuggested] = useState<CvFacts>({})
  /** the CV's phone number was hidden, incomplete or missing */
  const [phoneWarning, setPhoneWarning] = useState<string | null>(null)

  async function pickCv(file: File | null) {
    setCvFile(file)
    setError(null)
    setPhoneWarning(null)
    setSuggested({})
    if (!file) return setReading('idle')
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setCvFile(null)
      return setError('Please upload the CV as a PDF — the CV editor that makes the revised CV reads PDFs only.')
    }
    setReading('reading')
    try {
      const facts = await extractCvFacts(file)
      const { phoneWarning: warning, ...found } = facts
      setSuggested({ ...found, candidateName: found.candidateName && properName(found.candidateName) })
      setPhoneWarning(warning ?? null)
      setReading(Object.values(found).some(Boolean) ? 'done' : 'nothing')
    } catch (e) {
      console.error(e)
      setReading('failed')
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!hasCv) return setError('Upload the candidate’s original CV first.')
    if (!place.jobId) return setError('Choose the client and job opening.')
    if (!jobPm) return setError('This job opening has no PM. Ask Admin.')
    const phone = phoneProblem(contact)
    if (phone) return setError(phone)
    const alt = altPhoneProblem(altContact, contact)
    if (alt) return setError(alt)
    if (taken) return setError(duplicatePhoneMessage(taken, me.id))
    if (!message.trim()) return setError('Write the candidate’s available interview dates in the message box.')
    const detailsProblem = cvDetailsProblem(details)
    if (detailsProblem) return setError(detailsProblem)
    setBusy(true)
    setStep(cvFile ? 'Saving the CV to Google Drive…' : 'Saving…')
    /** the CV uploaded by this send: trashed again if the candidate can't be saved */
    let uploaded: string | null = null
    try {
      // The new CV is only saved to Drive now; otherwise the existing candidate's saved CV.
      const up = cvFile ? await upload.ensure() : { url: existing?.originalCvUrl ?? '', name: existing?.originalCvName ?? null }
      if (cvFile) uploaded = up.url
      const job = jobs.find((j) => j.id === place.jobId)
      setStep('Saving…')
      const id = await perform(null, {
        kind: 'pe_submit',
        message,
        data: {
          candidateId: existing?.id,
          candidateName,
          candidateContactNumber: contact,
          candidateAltContactNumber: altContact,
          candidateEmail: email,
          originalCvUrl: up.url,
          originalCvName: up.name,
          jobId: place.jobId,
          jobTitle: job?.title ?? '',
          clientId: place.clientId,
          clientName: clients.find((c) => c.id === place.clientId)?.name ?? '',
          assignedPM: jobPm,
          watchClientTeam: jobs.find((j) => j.id === place.jobId)?.assignedClientTeam ?? '',
          ...details,
        },
      })
      onDone(id)
    } catch (err) {
      // The candidate wasn't added: their CV doesn't stay in Google Drive.
      if (uploaded) await upload.discard(uploaded)
      setError((err as Error).message)
    } finally {
      setBusy(false)
      setStep('')
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {noJobs && <Alert tone="warn">No open job opening is assigned to you yet, so you can’t send candidates. Your PM assigns job openings to you.</Alert>}

      {existing ? (
        <Alert tone="info">
          Sending <b>{existing.candidateName}</b> ({existing.id}) to another client. Their details and saved CV are filled in — choose the client and job, and write the
          available dates in the message.
          {existing.originalCvUrl && (
            <>
              {' '}
              <a href={existing.originalCvUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                Open saved CV ↗
              </a>
            </>
          )}
        </Alert>
      ) : (
      <section className="rounded-lg border border-brand-100 bg-brand-50/50 p-3">
        <Field label="Step 1 — Candidate’s original CV (PDF)" required>
          <Input type="file" accept=".pdf,application/pdf" onChange={(e) => void pickCv(e.target.files?.[0] ?? null)} autoFocus />
        </Field>
        <p className="mt-1.5 text-xs text-slate-600">
          {reading === 'idle' && 'Upload the CV first — the name, phone, email and any salary / notice period found in it are suggested under their fields.'}
          {reading === 'reading' && (
            <span className="inline-flex items-center gap-2 font-medium text-brand-700">
              <Spin /> Reading the CV for suggestions…
            </span>
          )}
          {reading === 'done' && '✓ Details read from the CV are shown as suggestions under their fields.'}
          {reading === 'nothing' && 'No details could be read from this CV (it may be a scan). Please fill them in below.'}
          {reading === 'failed' && 'This PDF could not be read. You can still fill in the details below by hand.'}
        </p>
        {cvFile && (
          <p className="mt-1 text-xs">
            <UploadNote state={upload.state} />
          </p>
        )}
      </section>
      )}

      {reading === 'done' && (
        <div role="alert" className="rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3 text-amber-950">
          <p className="text-base font-bold">⚠ Check each suggestion against the CV before you use it.</p>
          <p className="mt-1 text-sm font-bold">
            Under the fields below you’ll see “Suggestion:” with a value read automatically from the CV. It may be wrong or incomplete. If it is
            correct, click it to fill it in; otherwise type the right value yourself.
          </p>
        </div>
      )}

      {hasCv && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Candidate name" required group>
              <Input value={candidateName} onChange={(e) => setCandidateName(e.target.value)} onBlur={() => setCandidateName(properName)} required aria-label="Candidate name" />
              <Suggestion value={suggested.candidateName} current={candidateName} onUse={() => setCandidateName(suggested.candidateName!)} />
            </Field>
            <Field label="Candidate contact number" required group>
              <PhoneInput value={contact} onChange={setContact} required />
              <Suggestion
                value={suggested.candidateContactNumber && displayPhone(suggested.candidateContactNumber)}
                current={displayPhone(contact)}
                onUse={() => setContact(suggested.candidateContactNumber!)}
              />
              {contactTaken && (
                <div className="mt-1.5">
                  <Alert>⚠ {duplicatePhoneMessage(contactTaken, me.id)}</Alert>
                </div>
              )}
              {/* Until a valid number is typed in. */}
              {phoneWarning && phoneProblem(contact) && (
                <div className="mt-1.5">
                  <Alert tone="warn">⚠ {phoneWarning}</Alert>
                </div>
              )}
            </Field>
            <Field label="Second contact number (optional)" group hint="If the candidate has another number, add it here.">
              <PhoneInput value={altContact} onChange={setAltContact} />
              {altTaken && (
                <div className="mt-1.5">
                  <Alert>⚠ {duplicatePhoneMessage(altTaken, me.id)}</Alert>
                </div>
              )}
            </Field>
            <Field label="Candidate email" group>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" aria-label="Candidate email" />
              <Suggestion value={suggested.candidateEmail} current={email} onUse={() => setEmail(suggested.candidateEmail!)} />
            </Field>
            <ClientJobFields clientId={place.clientId} jobId={place.jobId} onChange={setPlace} keepJobId={jobId} />
            <Field label="PM for this job">
              <Input value={jobPm ? nameOf(jobPm) : '— choose the job opening —'} disabled />
            </Field>
          </div>

          <CvDetailsFields value={details} onChange={setDetails} noteHint={false} suggestions={suggested} />

          <Field
            label="Candidate available interview dates & message to the PM"
            required
            hint="Write the dates (and times) the candidate is available for an interview, along with anything else you want to share with the PM."
          >
            <Textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Available: 12 Oct 10am–1pm, 14 Oct after 3pm. Prefers afternoons; can join in 30 days."
              required
            />
          </Field>
        </>
      )}

      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {busy && <span className="text-sm text-slate-500">{step} Please wait — don’t close this window.</span>}
        <Button type="submit" busy={busy} disabled={!hasCv || noJobs || !!taken}>
          {busy ? 'Sending…' : `Send to PM${jobPm ? ` (${nameOf(jobPm)})` : ''}`}
        </Button>
      </div>
    </form>
  )
}
