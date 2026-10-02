import { describe, expect, it } from 'vitest'
import { duplicatePhoneMessage, joinPhone, phoneKey, phoneProblem, splitPhone } from './PhoneInput'

describe('phone number with country code', () => {
  it('reads new and older formats', () => {
    expect(splitPhone('+91 9876543210')).toEqual({ code: '+91', number: '9876543210' })
    expect(splitPhone('+91 98765 43210')).toEqual({ code: '+91', number: '9876543210' })
    expect(splitPhone('98765-43210')).toEqual({ code: '+91', number: '9876543210' })
    expect(splitPhone('09876543210')).toEqual({ code: '+91', number: '9876543210' })
    expect(splitPhone('+971 50 123 4567')).toEqual({ code: '+971', number: '501234567' })
    expect(splitPhone('+44 20 7946 0912')).toEqual({ code: '+44', number: '2079460912' })
    expect(splitPhone('')).toEqual({ code: '+91', number: '' })
  })

  it('stores "+code number" and checks the length', () => {
    expect(joinPhone('+91', '9876543210')).toBe('+91 9876543210')
    expect(joinPhone('+91', '')).toBe('')
    expect(phoneProblem('+91 9876543210')).toBeNull()
    expect(phoneProblem('+91 98765')).toMatch(/10 digits/)
    expect(phoneProblem('+971 501234567')).toBeNull()
    expect(phoneProblem('')).toMatch(/Enter/)
  })

  it('gives every way of typing a number the same key', () => {
    for (const n of ['+91 9876543210', '+91 98765 43210', '9876543210', '09876543210', '919876543210', '+919876543210'])
      expect(phoneKey(n)).toBe('919876543210')
    expect(phoneKey('+971 50 123 4567')).toBe('971501234567')
    expect(phoneKey(`+${phoneKey('+977 9812345678')}`)).toBe('9779812345678')
    expect(phoneKey('')).toBeNull()
    expect(phoneKey('+91 ')).toBeNull()
  })

  it('says who has the number', () => {
    expect(duplicatePhoneMessage({ candidateId: 'CN-0042', pe: 'pe2' }, 'pe1')).toBe(
      'This number is already registered as CN-0042 by another PE. Contact your PM/Admin.',
    )
    expect(duplicatePhoneMessage({ candidateId: 'CN-0042', pe: 'pe1' }, 'pe1')).toMatch(/added by you/)
  })
})
