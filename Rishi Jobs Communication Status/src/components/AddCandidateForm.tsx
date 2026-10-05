import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useApp } from '../context/AppContext'
import type { CandidateProfile } from '../types'
import { properName } from '../workflow/names'
import { ClientJobFields } from './ClientJobFields'
import { blankCvDetails, cvDetailsProblem, CvDetailsFields, type CvDetails } from './CvDetailsFields'
import { altPhoneProblem, duplicatePhoneMessage, phoneProblem, PhoneInput } from './PhoneInput'
import { UploadNote } from './UploadNote'
import { useBackgroundUpload } from './useBackgroundUpload'
import { usePhoneTaken } from './usePhoneTaken'
import { Alert, Button, Field, Input, Textarea, cx } from './ui'

/** A Google Drive file link as a page that can be shown inside the app (other links as they are). */
const viewableUrl = (url: string) => {
  const id = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([A-Za-z0-9_-]{10,})/)?.[1]
  return id ? `https://drive.google.com/file/d/${id}/preview` : url
}

/**
 * Opens the PDF without the page thumbnails down the side (more room for the CV itself), fitted to
 * the width. Google Drive's own preview has no thumbnails and ignores this.
 */
const noThumbnails = (url: string) => (url.includes('#') ? url : `${url}#navpanes=0&pagemode=none&view=FitH`)

/** The CV in a window of its own, on the left half of the screen, for someone who prefers that. */
function openCvWindow(url: string) {
  const w = Math.round(window.screen.availWidth / 2)
  window.open(url, 'rj-candidate-cv', `popup,width=${w},height=${window.screen.availHeight},left=0,top=0`)
}

/**
 * PE adds a candidate for a job opening assigned to them; it goes to that job's PM. Step 1 is the
 * original CV: as soon as it is chosen it opens beside the form, and the PE reads it and types the
 * details in by hand (nothing is filled in from it). The PM then revises the CV and sends it to the Client Team.
 * With `existing`, an existing candidate is sent to another client: their details and saved CV are
 * used, so only the client, job and message are new. The candidate's available dates are written
 * in the message to the PM.
 */
export function AddCandidateForm({ onDone, existing, jobId }: { onDone: (appId: string) => void; existing?: CandidateProfile; jobId?: string }) {
  const { me, jobs, clients, perform, nameOf } = useApp()
  const [cvFile, setCvFile] = useState<File | null>(null)
  // Uploads to Drive as soon as the CV is picked (while the PE checks the form), so Send only has to save.
  const upload = useBackgroundUpload(cvFile)
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
  // The CV shown beside the form: the file just chosen, or the existing candidate's saved CV.
  const fileUrl = useMemo(() => (cvFile ? URL.createObjectURL(cvFile) : null), [cvFile])
  useEffect(() => () => void (fileUrl && URL.revokeObjectURL(fileUrl)), [fileUrl])
  const cvUrl = fileUrl ? noThumbnails(fileUrl) : existing?.originalCvUrl ? viewableUrl(existing.originalCvUrl) : null

  function pickCv(file: File | null) {
    setError(null)
    if (file && !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setCvFile(null)
      return setError('Please upload the CV as a PDF — the CV editor that makes the revised CV reads PDFs only.')
    }
    setCvFile(file)
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
    <div className={cx(cvUrl ? 'grid gap-4 lg:grid-cols-2' : 'mx-auto max-w-3xl')}>
      {cvUrl && (
        // The full-screen modal's body scrolls; the CV stays put at its full height while the form scrolls.
        <aside
          className="flex h-[80vh] flex-col overflow-hidden rounded-lg border border-slate-300 bg-slate-100 lg:sticky lg:top-0 lg:h-[calc(100vh-5.25rem)]"
          aria-label="Candidate’s CV"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-300 bg-white px-3 py-1.5 text-xs">
            <span className="truncate font-semibold text-slate-700">📄 {cvFile?.name ?? existing?.originalCvName ?? 'Candidate’s CV'} — read it and fill in the form</span>
            <button type="button" onClick={() => openCvWindow(cvUrl)} className="shrink-0 font-medium text-brand-700 underline">
              Open in a separate window ↗
            </button>
          </div>
          <iframe src={cvUrl} title="Candidate’s CV" className="min-h-0 w-full flex-1" />
        </aside>
      )}
    <form onSubmit={submit} className="min-w-0 space-y-4">
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
          {cvFile
            ? '✓ The CV is open beside this form — read it and type the candidate’s details in below.'
            : 'Upload the CV first — it opens beside the form so you can read it while you fill in the details.'}
        </p>
        {cvFile && (
          <p className="mt-1 text-xs">
            <UploadNote state={upload.state} />
          </p>
        )}
      </section>
      )}

      {hasCv && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Candidate name" required group>
              <Input value={candidateName} onChange={(e) => setCandidateName(e.target.value)} onBlur={() => setCandidateName(properName)} required aria-label="Candidate name" />
            </Field>
            <Field label="Candidate contact number" required group>
              <PhoneInput value={contact} onChange={setContact} required />
              {contactTaken && (
                <div className="mt-1.5">
                  <Alert>⚠ {duplicatePhoneMessage(contactTaken, me.id)}</Alert>
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
            </Field>
            <ClientJobFields clientId={place.clientId} jobId={place.jobId} onChange={setPlace} keepJobId={jobId} />
            <Field label="PM for this job">
              <Input value={jobPm ? nameOf(jobPm) : '— choose the job opening —'} disabled />
            </Field>
          </div>

          <CvDetailsFields value={details} onChange={setDetails} noteHint={false} />

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
    </div>
  )
}
