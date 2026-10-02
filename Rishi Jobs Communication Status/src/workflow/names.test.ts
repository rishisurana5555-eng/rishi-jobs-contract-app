import { expect, it } from 'vitest'
import { properName } from './names'

it('capitalises the first letter of every name', () => {
  expect(properName('ravi kumar')).toBe('Ravi Kumar')
  expect(properName('RAVI KUMAR')).toBe('Ravi Kumar')
  expect(properName('  archita   m. makwana ')).toBe('Archita M. Makwana')
  expect(properName('mary-jane o\'brien')).toBe("Mary-Jane O'Brien")
  expect(properName('john McDonald')).toBe('John McDonald')
  expect(properName('')).toBe('')
})
