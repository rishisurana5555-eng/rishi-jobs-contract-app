import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useApp } from '../context/AppContext'
import type { Application } from '../types'
import { properName } from '../workflow/names'
import { SEND_TO_CT_LABEL } from '../workflow/workflow'
import { ClientJobFields, usePlacementLists, type KeptPlacement } from './ClientJobFields'
import { cvDetailsProblem, CvDetailsFields, type CvDetails } from './CvDetailsFields'
import { CvEditorPanel, type RevisedCv } from './CvEditorPanel'
import { altPhoneProblem, duplicatePhoneMessage, phoneProblem, PhoneInput } from './PhoneInput'
import { UploadNote } from './UploadNote'
import { useBackgroundUpload } from './useBackgroundUpload'
import { usePhoneTaken } from './usePhoneTaken'
import { Alert, Button, Field, Input, Modal, Textarea } from './ui'

/** Same as the CV editor's file names (cv_filename in cv_processor.py). */
const fileSafe = (text: string) => text.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** Opened from the "Send this candidate to Client Team" button (row or detail panel). */
export function SendToClientTeamModal() {
  const { sendToCtId, setSendToCtId, apps, openApp } = useApp()
  const app = apps.find((a) => a.id === sendToCtId)
  if (!sendToCtId || !app) return null
  return (
    <Modal title={`${SEND_TO_CT_LABEL} — ${app.candidateName}`} onClose={() => setSendToCtId(null)} wide>
      <SendToClientTeamForm
        app={app}
        onDone={(id) => {
          setSendToCtId(null)
          openApp(id)
        }}
      />
    </Modal>
  )
}

/**
 * PM: a PE's candidate → Client Team. Everything the PE entered is filled in and editable; one
 * click revises the original CV with those details (or a revised CV is uploaded / linked by hand).
 */
function SendToClientTeamForm({ app, onDone }: { app: Application; onDone: (appId: string) => void }) {
  const { me, perform, nameOf } = useApp()
  // The candidate's own client and job opening stay available even if the job opening has since moved to another PM.
  const keep: KeptPlacement = {
    clientId: app.clientId,
    clientName: app.clientName,
    jobId: app.jobId,
    jobTitle: app.jobTitle,
    assignedClientTeam: app.watchClientTeam ?? '',
  }
  const { clients, jobs } = usePlacementLists(keep)
  const [candidateName, setCandidateName] = useState(app.candidateName)
  const [contact, setContact] = useState(app.candidateContactNumber)
  const [altContact, setAltContact] = useState(app.candidateAltContactNumber ?? '')
  const [email, setEmail] = useState(app.candidateEmail ?? '')
  // A corrected number must not be another candidate's.
  const contactTaken = usePhoneTaken(contact, app.candidateId)
  const altTaken = usePhoneTaken(altContact, app.candidateId)
  const taken = contactTaken ?? altTaken
  const [place, setPlace] = useState({ clientId: app.clientId, jobId: app.jobId })
  const [details, setDetails] = useState<CvDetails>({
    currentSalary: app.currentSalary ?? '',
    expectedSalary: app.expectedSalary ?? '',
    noticePeriod: app.noticePeriod ?? '',
    recruiterNote: app.recruiterNote ?? '',
  })
  const [cvMode, setCvMode] = useState<'editor' | 'upload' | 'link'>('editor')
  const [revised, setRevised] = useState<File | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  // Uploads to Drive as soon as the revised CV is ready, so Send only has to save.
  const upload = useBackgroundUpload(cvMode !== 'link' ? revised : null)
  const [cvLink, setCvLink] = useState('')
  // Starts with what the PE wrote (the candidate's available dates), for the PM to check and pass on.
  // (not the PE's last answer to a doubt).
  const [message, setMessage] = useState(app.availabilityNote ?? app.latestMessage ?? '')
  /** why the PM selected this candidate: goes into the history */
  const [reason, setReason] = useState('')
  /** the revised CV preview is open (it opens by itself as soon as a revised CV is ready) */
  const [reviewing, setReviewing] = useState(false)
  /** the PM confirmed they checked this revised CV (reset whenever the revised CV changes) */
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  /** what the Send button is doing right now */
  const [step, setStep] = useState('')
  const [error, setError] = useState<string | null>(null)

  const client = clients.find((c) => c.id === place.clientId)
  // Job title printed on the revised CV and used in its file name: always typed in by the PM (never filled in).
  const [jobTitleForCv, setCvJobTitle] = useState('')
  const previewUrl = useMemo(() => (revised ? URL.createObjectURL(revised) : null), [revised])
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl])
  // Every new revised CV must be checked: open it straight away and ask for a fresh confirmation.
  useEffect(() => {
    setChecked(false)
    setReviewing(!!revised)
  }, [revised])
  useEffect(() => setChecked(false), [cvLink])

  /**
   * What still stops the candidate being sent (null: ready). The Send button stays disabled until the
   * revised CV is made, checked and confirmed, and every detail is right.
   */
  function sendProblem(): string | null {
    if (!candidateName.trim()) return 'Enter the candidate’s name.'
    const phone = phoneProblem(contact)
    if (phone) return phone
    const alt = altPhoneProblem(altContact, contact)
    if (alt) return alt
    if (taken) return duplicatePhoneMessage(taken, me.id)
    if (!place.clientId || !place.jobId) return 'Choose the client and the job opening.'
    const detailsProblem = cvDetailsProblem(details)
    if (detailsProblem) return detailsProblem
    if (cvMode === 'editor' && !jobTitleForCv.trim()) return 'Type the job title for the revised CV.'
    if (cvMode !== 'link' && !revised) return cvMode === 'editor' ? 'Generate the revised CV first (or upload the revised CV).' : 'Upload the revised CV.'
    if (cvMode === 'link' && !/^https?:\/\//i.test(cvLink.trim())) return 'Paste a valid link to the revised CV (starting with https://).'
    if (!checked) return 'Open and check the revised CV, then confirm it.'
    if (!message.trim()) return 'Write the candidate’s available interview dates in the message box.'
    if (!reason.trim()) return 'Write the reason for selection.'
    return null
  }
  const blocker = sendProblem()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (blocker) return setError(blocker)
    setBusy(true)
    setStep(cvMode !== 'link' ? 'Saving the revised CV to Google Drive…' : 'Saving…')
    /** the revised CV uploaded by this send: trashed again if the candidate can't be sent */
    let uploaded: string | null = null
    try {
      let revisedCvUrl = cvLink.trim()
      let revisedCvName: string | null = null
      if (cvMode !== 'link' && revised) {
        // Only saved to Drive now, as the candidate is sent.
        const up = await upload.ensure()
        revisedCvUrl = uploaded = up.url
        revisedCvName = up.name
      }
      setStep('Saving…')
      const id = await perform(app.id, {
        kind: 'send_to_ct',
        message,
        reason,
        data: {
          candidateId: app.candidateId,
          candidateName,
          candidateContactNumber: contact,
          candidateAltContactNumber: altContact,
          candidateEmail: email,
          revisedCvUrl,
          revisedCvName,
          originalCvUrl: app.originalCvUrl,
          jobId: place.jobId,
          jobTitle: jobs.find((j) => j.id === place.jobId)?.title ?? '',
          clientId: place.clientId,
          clientName: client?.name ?? '',
          assignedPE: app.assignedPE,
          assignedClientTeam: client?.assignedClientTeam ?? '',
          ...details,
        },
      })
      onDone(id)
    } catch (err) {
      if (uploaded) await upload.discard(uploaded)
      setError((err as Error).message)
    } finally {
      setBusy(false)
      setStep('')
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Alert tone="info">
        Added by <b>{nameOf(app.assignedPE)}</b>. Check the details, generate the revised CV, then send it to the Client Team.
        {app.originalCvUrl && (
          <>
            {' '}
            <a href={app.originalCvUrl} target="_blank" rel="noreferrer" className="font-medium underline">
              Open original CV ↗
            </a>
          </>
        )}
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Row 1: name + email · Row 2: both contact numbers · Row 3: client + job opening */}
        <Field label="Candidate name" required>
          <Input value={candidateName} onChange={(e) => setCandidateName(e.target.value)} onBlur={() => setCandidateName(properName)} required />
        </Field>
        <Field label="Candidate email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Candidate contact number" required group>
          <PhoneInput value={contact} onChange={setContact} required />
          {contactTaken && (
            <div className="mt-1.5">
              <Alert>⚠ {duplicatePhoneMessage(contactTaken, me.id)}</Alert>
            </div>
          )}
        </Field>
        <Field label="Second contact number (optional)" group>
          <PhoneInput value={altContact} onChange={setAltContact} />
          {altTaken && (
            <div className="mt-1.5">
              <Alert>⚠ {duplicatePhoneMessage(altTaken, me.id)}</Alert>
            </div>
          )}
        </Field>
        <ClientJobFields clientId={place.clientId} jobId={place.jobId} onChange={setPlace} keep={keep} />
      </div>

      <CvDetailsFields value={details} onChange={setDetails} />

      <Field label="Revised CV" required group>
        <div className="mb-2 flex flex-wrap gap-3 text-sm">
          {(
            [
              ['editor', 'Generate from the original CV'],
              ['upload', 'Upload file'],
              ['link', 'Paste link'],
            ] as const
          ).map(([m, label]) => (
            <label key={m} className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={cvMode === m}
                onChange={() => {
                  setCvMode(m)
                  setRevised(null)
                  setWarnings([])
                }}
              />
              {label}
            </label>
          ))}
        </div>
        {cvMode === 'editor' && (
          <>
          <Field
            label="Job title for the revised CV"
            required
            className="mb-2 sm:max-w-md"
            hint={`File name: ${[fileSafe(candidateName) || 'Candidate', fileSafe(jobTitleForCv), 'RishiJobs'].filter(Boolean).join('_')}.pdf`}
          >
            <Input value={jobTitleForCv} onChange={(e) => setCvJobTitle(e.target.value)} placeholder="Type the job title, e.g. Senior Accountant" required />
          </Field>
          <CvEditorPanel
            input={{ candidateName, jobTitle: jobTitleForCv, originalCvUrl: app.originalCvUrl, ...details }}
            done={!!revised}
            onRevised={({ file, details: d, warnings: w }: RevisedCv) => {
              setRevised(file)
              setWarnings(w)
              // Into the candidate's history: when the PM generated the revised CV.
              perform(app.id, { kind: 'cv_generated', fileName: file.name }).catch((e: Error) =>
                setError(`The revised CV is ready, but it could not be written in the history: ${e.message}`),
              )
              // If the PM opened the editor and changed something there, keep the form in step.
              if (d?.candidateName) setCandidateName(d.candidateName)
              // Only the CV-detail fields; the job stays as chosen in this form.
              if (d) setDetails((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(d).filter(([k, v]) => k in cur && typeof v === 'string')) }))
            }}
          />
          </>
        )}
        {cvMode === 'upload' && (
          <Input key="file" type="file" accept=".pdf,.doc,.docx" onChange={(e) => setRevised(e.target.files?.[0] ?? null)} />
        )}
        {cvMode === 'link' && <Input key="link" type="url" value={cvLink} onChange={(e) => setCvLink(e.target.value)} placeholder="https://drive.google.com/…" />}
        {cvMode !== 'link' && revised && (
          <div
            className={
              checked
                ? 'mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
                : 'mt-2 flex flex-wrap items-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950'
            }
          >
            {checked ? '✓ Revised CV checked:' : '⚠ Not checked yet:'} <b className="truncate">{revised.name}</b>
            <UploadNote state={upload.state} />
            <button type="button" onClick={() => setReviewing(true)} className="ml-auto shrink-0 text-xs font-bold underline">
              {checked ? 'Open again' : 'Open & check the revised CV'}
            </button>
          </div>
        )}
        {cvMode === 'link' && /^https?:\/\//i.test(cvLink.trim()) && (
          <label className="mt-2 flex items-start gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
            <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>
              I have opened and checked the revised CV at this link.{' '}
              <a href={cvLink.trim()} target="_blank" rel="noreferrer" className="underline">
                Open it ↗
              </a>
            </span>
          </label>
        )}
        {cvMode === 'editor' && revised && warnings.length > 0 && (
          <div className="mt-2">
            <Alert tone="warn">
              Please check the revised CV (Preview):
              <ul className="ml-4 mt-1 list-disc">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
      </Field>

      <Field
        label="Candidate available interview dates & message to the Client Team"
        required
        hint={`Write the dates (and times) the candidate is available for an interview, along with anything else to share. ${nameOf(app.assignedPE)}’s message is filled in — check and edit it.`}
      >
        <Textarea
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Available: 12 Oct 10am–1pm, 14 Oct after 3pm. Prefers afternoons."
          required
        />
      </Field>

      <Field label="Reason for selection" required hint="Why this candidate is a fit for the job — it is written in the candidate’s history.">
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. 5 years of GST filing, matches the salary range, can join in 30 days."
          required
        />
      </Field>

      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {busy && <span className="text-sm text-slate-500">{step} Please wait — don’t close this window.</span>}
        {!busy && blocker && <span className="text-sm font-medium text-amber-700">⚠ To send: {blocker}</span>}
        <Button type="submit" busy={busy} disabled={!!blocker} title={blocker ?? undefined}>
          {busy ? 'Sending…' : `Send to Client Team${client ? ` (${nameOf(client.assignedClientTeam)})` : ''}`}
        </Button>
      </div>

      {reviewing && revised && previewUrl && (
        <RevisedCvReview
          url={previewUrl}
          name={revised.name}
          warnings={cvMode === 'editor' ? warnings : []}
          onConfirm={() => {
            setChecked(true)
            setReviewing(false)
            setError(null)
            // Into the candidate's history: who made and checked the revised CV, and when.
            perform(app.id, { kind: 'cv_checked', fileName: revised.name }).catch((e: Error) =>
              setError(`The revised CV is confirmed, but it could not be written in the history: ${e.message}`),
            )
          }}
          onClose={() => setReviewing(false)}
        />
      )}
    </form>
  )
}

/**
 * Opens by itself as soon as a revised CV is ready: the PM has to look at it and confirm before
 * it can be sent. Closing without confirming leaves the Send button blocked.
 */
function RevisedCvReview({ url, name, warnings, onConfirm, onClose }: { url: string; name: string; warnings: string[]; onConfirm: () => void; onClose: () => void }) {
  // Opens over the whole window; "Full screen" also hides the browser's own bars.
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => () => void (document.fullscreenElement && document.exitFullscreen().catch(() => {})), [])
  const close = (fn: () => void) => () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    fn()
  }
  return (
    <div ref={box} className="fixed inset-0 z-50 flex bg-white" role="dialog" aria-modal="true" aria-label="Check the revised CV">
      <div className="flex h-full w-full flex-col bg-white">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900">Check the revised CV before sending</h2>
            <p className="truncate text-xs text-slate-500">{name}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button type="button" className="text-xs font-medium text-brand-600 underline" onClick={() => box.current?.requestFullscreen?.().catch(() => {})}>
              ⛶ Full screen
            </button>
            <a href={url} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 underline">
              Open in a new tab ↗
            </a>
          </div>
        </header>
        {warnings.length > 0 && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            <b>Look carefully at:</b> {warnings.join(' · ')}
          </div>
        )}
        <iframe src={url.startsWith('blob:') ? `${url}#navpanes=0&pagemode=none&view=FitH` : url} title="Revised CV" className="min-h-0 w-full flex-1 bg-slate-100" />
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-4 py-3">
          <p className="mr-auto text-sm font-semibold text-slate-700">Read the whole CV. You can’t send it to the Client Team until you confirm.</p>
          <Button type="button" variant="secondary" onClick={close(onClose)}>
            Close – not checked yet
          </Button>
          <Button type="button" onClick={close(onConfirm)}>
            ✓ I have checked the revised CV
          </Button>
        </footer>
      </div>
    </div>
  )
}
