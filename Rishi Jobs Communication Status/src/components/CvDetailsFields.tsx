import type { CvDetailsData } from '../workflow/engine'
import { Suggestion } from './Suggestion'
import { Field, Input, Select, Textarea } from './ui'

/** Same choices as the CV editor (rishijobs-revisedcvs). */
export const NOTICE_PERIODS = ['Immediate', '15 days', '30 days', '60 days', '90 days'] as const
const OTHER = 'Other'

export type CvDetails = Required<Omit<CvDetailsData, 'candidateEmail'>>

export const blankCvDetails = (): CvDetails => ({ currentSalary: '', expectedSalary: '', noticePeriod: '', recruiterNote: '' })

const SALARY_RE = /^\d+(\.\d+)?$/

/** The first thing missing or wrong, or null. Every field is required, as in the CV editor. */
export function cvDetailsProblem(d: CvDetails): string | null {
  for (const [label, v] of [['current salary', d.currentSalary], ['expected salary', d.expectedSalary]] as const) {
    if (!v.trim()) return `Enter the ${label} (LPA).`
    if (!SALARY_RE.test(v.trim())) return `The ${label} must be in LPA — digits only, decimals allowed (e.g. 18 or 18.5).`
  }
  if (!d.noticePeriod.trim()) return 'Choose the notice period (for “Other”, enter the number of days).'
  if (!d.recruiterNote.trim()) return 'Write a recruiter note — it is printed on the revised CV.'
  return null
}

/**
 * Current / expected salary (LPA), notice period and recruiter note — the details printed on the
 * revised CV. Same fields and rules as the CV editor, so they can be passed straight to it.
 * "Other" notice periods are a number of days, stored as "45 days".
 */
export function CvDetailsFields({
  value,
  onChange,
  noteHint = true,
  suggestions = {},
}: {
  value: CvDetails
  onChange: (v: CvDetails) => void
  noteHint?: boolean
  /** values read from the CV, offered under their fields */
  suggestions?: Partial<Pick<CvDetails, 'currentSalary' | 'expectedSalary' | 'noticePeriod'>>
}) {
  const set = (patch: Partial<CvDetails>) => onChange({ ...value, ...patch })
  const known = !value.noticePeriod || (NOTICE_PERIODS as readonly string[]).includes(value.noticePeriod)
  // ' ' = "Other" chosen, days not typed yet.
  const choice = !value.noticePeriod ? '' : known ? value.noticePeriod : OTHER
  const otherDays = known ? '' : (value.noticePeriod.match(/\d+/)?.[0] ?? '')
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Current salary (LPA)" required group>
        <Input inputMode="decimal" value={value.currentSalary} onChange={(e) => set({ currentSalary: e.target.value })} placeholder="e.g. 18 or 18.5" aria-label="Current salary (LPA)" />
        <Suggestion value={suggestions.currentSalary} current={value.currentSalary} onUse={() => set({ currentSalary: suggestions.currentSalary! })} />
      </Field>
      <Field label="Expected salary (LPA)" required group>
        <Input inputMode="decimal" value={value.expectedSalary} onChange={(e) => set({ expectedSalary: e.target.value })} placeholder="e.g. 24" aria-label="Expected salary (LPA)" />
        <Suggestion value={suggestions.expectedSalary} current={value.expectedSalary} onUse={() => set({ expectedSalary: suggestions.expectedSalary! })} />
      </Field>
      <Field label="Notice period" required group>
        <Select value={choice} onChange={(e) => set({ noticePeriod: e.target.value === OTHER ? ' ' : e.target.value })} aria-label="Notice period">
          <option value="">— Select —</option>
          {NOTICE_PERIODS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={OTHER}>Other</option>
        </Select>
        <Suggestion value={suggestions.noticePeriod} current={value.noticePeriod} onUse={() => set({ noticePeriod: suggestions.noticePeriod! })} />
      </Field>
      <Field label="If other, number of days">
        <Input
          inputMode="numeric"
          value={otherDays}
          onChange={(e) => {
            const days = e.target.value.replace(/\D/g, '').slice(0, 3)
            set({ noticePeriod: days ? `${days} days` : ' ' })
          }}
          placeholder="e.g. 45"
          disabled={choice !== OTHER}
        />
      </Field>
      <Field
        label="Recruiter note"
        required
        className="sm:col-span-2"
        hint={noteHint ? 'Printed on the revised CV for the client. If the expected salary is more than 30% above the current one, the CV shows “As per industry norms”.' : undefined}
      >
        <Textarea
          rows={3}
          value={value.recruiterNote}
          onChange={(e) => set({ recruiterNote: e.target.value })}
          placeholder="Why this candidate fits — availability, strengths, anything the client should know."
        />
      </Field>
    </div>
  )
}
