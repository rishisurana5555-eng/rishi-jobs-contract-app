import { useEffect, useRef, useState } from 'react'
import type { CvDetails } from './CvDetailsFields'
import { Alert, Button } from './ui'

/** The Rishi Jobs CV editor (Streamlit app in the "cv process" folder). */
export const CV_EDITOR_URL = (import.meta.env.VITE_CV_EDITOR_URL as string | undefined) || 'https://rishijobs-revisedcvs.streamlit.app'

/** A cold (sleeping) Streamlit app can take a while to start. */
const GENERATE_TIMEOUT_MS = 120_000

/** Messages the CV editor posts back to the dashboard. */
type EditorMessage =
  | {
      type: 'rishijobs:revised-cv'
      fileName: string
      /** the PDF, base64 */
      data: string
      details?: Partial<CvDetails> & { candidateName?: string }
      /** e.g. "looks like a scan: nothing could be removed" */
      warnings?: string[]
    }
  | { type: 'rishijobs:revise-problems'; problems: string[] }

export interface EditorInput extends CvDetails {
  candidateName: string
  /** printed on the revised CV and used in its file name */
  jobTitle: string
  originalCvUrl: string | null
}

export interface RevisedCv {
  file: File
  details?: Partial<CvDetails> & { candidateName?: string }
  warnings: string[]
}

/** What the CV editor needs; it refuses to generate without these. */
export function editorInputProblems(input: EditorInput): string[] {
  const p: string[] = []
  if (!input.originalCvUrl) p.push('There is no original CV to revise — upload a revised CV instead.')
  if (!input.candidateName.trim()) p.push('Enter the candidate’s name.')
  if (!input.jobTitle.trim()) p.push('Enter the job title for the revised CV (it is used in the file name).')
  if (!input.currentSalary.trim()) p.push('Enter the current salary.')
  if (!input.expectedSalary.trim()) p.push('Enter the expected salary.')
  if (!input.noticePeriod.trim()) p.push('Choose the notice period.')
  if (!input.recruiterNote.trim()) p.push('Write the recruiter note.')
  return p
}

function editorLink(input: EditorInput, auto: boolean) {
  const q = new URLSearchParams({
    from: 'dashboard',
    origin: window.location.origin,
    candidate_name: input.candidateName,
    job_title: input.jobTitle,
    current_salary: input.currentSalary,
    expected_salary: input.expectedSalary,
    notice_period: input.noticePeriod.trim(),
    recruiter_note: input.recruiterNote,
  })
  if (input.originalCvUrl) q.set('cv_url', input.originalCvUrl)
  if (auto) {
    q.set('embed', 'true')
    q.set('auto', '1')
    // A fresh editor session every time, so it generates with the current details.
    q.set('run', String(Date.now()))
  }
  return `${CV_EDITOR_URL.replace(/\/$/, '')}/?${q}`
}

/** True when `source` is `target` or a frame inside it (the editor's reply comes from a frame within the Streamlit page). */
function comesFrom(source: MessageEventSource | null, targets: (Window | null | undefined)[]) {
  let w = source as Window | null
  for (let i = 0; w && i < 8; i++) {
    if (targets.includes(w)) return true
    if (w.parent === w) break
    w = w.parent
  }
  return false
}

function toPdfFile(fileName: string, data: string): File | null {
  try {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return null
    return new File([bytes], fileName || 'Revised_CV_RishiJobs.pdf', { type: 'application/pdf' })
  } catch {
    return null
  }
}

type State = { kind: 'idle' } | { kind: 'working'; src: string } | { kind: 'problems'; problems: string[] } | { kind: 'failed'; text: string }

/**
 * One click: the CV editor runs out of sight with the original CV and the details from the form,
 * generates the revised CV and hands it straight back (`onRevised`). Nothing to open or download.
 * If it can't (a missing field, the editor asleep), the reason is shown, with the editor as a fallback.
 */
export function CvEditorPanel({ input, onRevised, done }: { input: EditorInput; onRevised: (cv: RevisedCv) => void; done: boolean }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const frame = useRef<HTMLIFrameElement>(null)
  const popup = useRef<Window | null>(null)
  const onRevisedRef = useRef(onRevised)
  onRevisedRef.current = onRevised

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as EditorMessage | undefined
      if (!msg || !comesFrom(e.source, [frame.current?.contentWindow, popup.current])) return
      if (msg.type === 'rishijobs:revise-problems') return setState({ kind: 'problems', problems: msg.problems })
      if (msg.type !== 'rishijobs:revised-cv') return
      const file = toPdfFile(msg.fileName, msg.data)
      if (!file) return setState({ kind: 'failed', text: 'The CV editor sent back something that is not a PDF. Please try again.' })
      setState({ kind: 'idle' })
      onRevisedRef.current({ file, details: msg.details, warnings: msg.warnings ?? [] })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (state.kind !== 'working') return
    const t = setTimeout(
      () =>
        setState({
          kind: 'failed',
          text: 'The CV editor did not answer in time — it may have been asleep. Click “Generate” again (it is usually awake by now), or open the CV editor below.',
        }),
      GENERATE_TIMEOUT_MS,
    )
    return () => clearTimeout(t)
  }, [state])

  function generate() {
    const problems = editorInputProblems(input)
    if (problems.length) return setState({ kind: 'problems', problems })
    setState({ kind: 'working', src: editorLink(input, true) })
  }

  const working = state.kind === 'working'
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={generate} busy={working}>
          {working ? 'Generating…' : done ? '↻ Generate again with the details above' : '✎ Generate revised CV'}
        </Button>
        <button
          type="button"
          className="text-xs text-slate-500 underline hover:text-slate-700"
          onClick={() => (popup.current = window.open(editorLink(input, false), 'rj-cv-editor'))}
        >
          or open the CV editor yourself ↗
        </button>
      </div>
      {working && (
        <p className="text-sm text-slate-600">
          Revising the original CV with the details above… this usually takes a few seconds (up to a minute if the CV editor was asleep).
        </p>
      )}
      {state.kind === 'problems' && (
        <Alert tone="warn">
          The revised CV could not be generated yet:
          <ul className="ml-4 mt-1 list-disc">
            {state.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}
      {state.kind === 'failed' && <Alert tone="warn">{state.text}</Alert>}
      {working && (
        // Out of sight: the editor only has to run, not be seen.
        <iframe ref={frame} src={state.src} title="CV editor (working)" aria-hidden className="pointer-events-none fixed -left-[2000px] top-0 h-[600px] w-[800px] opacity-0" tabIndex={-1} />
      )}
    </div>
  )
}
