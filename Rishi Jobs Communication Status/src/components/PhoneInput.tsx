import { Input, Select } from './ui'

/** Country calling codes offered next to the phone number; India first (the default). */
export const COUNTRY_CODES: [code: string, country: string][] = [
  ['+91', 'India'],
  ['+971', 'UAE'],
  ['+966', 'Saudi Arabia'],
  ['+974', 'Qatar'],
  ['+968', 'Oman'],
  ['+965', 'Kuwait'],
  ['+973', 'Bahrain'],
  ['+1', 'USA / Canada'],
  ['+44', 'UK'],
  ['+61', 'Australia'],
  ['+65', 'Singapore'],
  ['+60', 'Malaysia'],
  ['+49', 'Germany'],
  ['+977', 'Nepal'],
  ['+880', 'Bangladesh'],
  ['+94', 'Sri Lanka'],
]
const DEFAULT_CODE = '+91'

/** "+91 9876543210" (or an older free-typed number) → code + the number's digits. */
export function splitPhone(value: string): { code: string; number: string } {
  const v = value.trim()
  if (v.startsWith('+')) {
    const digits = v.slice(1).replace(/\D/g, '')
    // Longest matching code first, so +971 isn't read as +9…
    const match = [...COUNTRY_CODES].sort((a, b) => b[0].length - a[0].length).find(([c]) => digits.startsWith(c.slice(1)))
    if (match) return { code: match[0], number: digits.slice(match[0].length - 1) }
  }
  let digits = v.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return { code: DEFAULT_CODE, number: digits }
}

/** For lists and details: the number without its country code. */
export const displayPhone = (value: string) => splitPhone(value).number || value

export const joinPhone = (code: string, number: string) => (number ? `${code} ${number}` : '')

/**
 * The number as one key, whatever way it was typed: "+91 98765 43210", "09876543210" → "919876543210".
 * phoneIndex/{key} says which candidate has the number (keep in sync with scripts/phone-index.mjs). Blank → null.
 */
export function phoneKey(value: string): string | null {
  const { code, number } = splitPhone(value)
  return number ? code.slice(1) + number : null
}

/** Who already has a number (phoneIndex/{key}). */
export interface PhoneOwner {
  candidateId: string
  /** the PE who added that candidate */
  pe: string | null
}

/** No two people share a number: shown when the number already belongs to another candidate. */
export const duplicatePhoneMessage = (owner: PhoneOwner, myId: string) =>
  owner.pe === myId
    ? `This number is already registered as ${owner.candidateId}, added by you. Contact your PM/Admin.`
    : `This number is already registered as ${owner.candidateId} by another PE. Contact your PM/Admin.`

/** What is wrong with the number, or null. Indian numbers need 10 digits; others 6–14. */
export function phoneProblem(value: string): string | null {
  const { code, number } = splitPhone(value)
  if (!number) return 'Enter the candidate’s contact number.'
  if (code === '+91' && number.length !== 10) return 'An Indian mobile number has 10 digits (without +91).'
  if (number.length < 6 || number.length > 14) return 'Enter a valid contact number for the selected country.'
  return null
}

/** The optional second number: blank is fine; otherwise it must be valid and differ from the first. */
export function altPhoneProblem(value: string, first: string): string | null {
  if (!splitPhone(value).number) return null
  const problem = phoneProblem(value)
  if (problem) return `Second contact number: ${problem}`
  if (value.replace(/\D/g, '') === first.replace(/\D/g, '')) return 'The second contact number is the same as the first one.'
  return null
}

/** Country code dropdown (default +91 India) + the number itself, digits only. Value is "+91 9876543210". */
export function PhoneInput({ value, onChange, required }: { value: string; onChange: (v: string) => void; required?: boolean }) {
  const { code, number } = splitPhone(value)
  return (
    <div className="flex gap-2">
      <Select value={code} onChange={(e) => onChange(joinPhone(e.target.value, number))} className="w-36 shrink-0" aria-label="Country code">
        {COUNTRY_CODES.map(([c, country]) => (
          <option key={c} value={c}>
            {c} {country}
          </option>
        ))}
      </Select>
      <Input
        type="tel"
        inputMode="numeric"
        value={number}
        onChange={(e) => onChange(joinPhone(code, e.target.value.replace(/\D/g, '').slice(0, 14)))}
        placeholder={code === '+91' ? '10-digit mobile number' : 'Phone number'}
        required={required}
        aria-label="Phone number"
      />
    </div>
  )
}
