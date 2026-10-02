import { describe, expect, it } from 'vitest'
import { factsFromLines, groupLines, type Line, type TextPiece } from './extract'

const line = (text: string, top: number, size = 10, page = 1): Line => ({ text, top, size, page })

describe('CV auto-fill', () => {
  it('reads name, email, phone, salaries and notice period', () => {
    const facts = factsFromLines([
      line('CURRICULUM VITAE', 0.03, 14),
      line('PRIYA RAMAN', 0.06, 22),
      line('Senior Accountant', 0.09, 12),
      line('priya.raman@example.com | +91 98765-43210 | Pune', 0.11),
      line('Experience 2016 - 2024', 0.3),
      line('Current CTC: 12.5 LPA', 0.8),
      line('Expected Salary : 1,25,000/month', 0.82),
      line('Notice Period: 2 months', 0.84),
    ])
    expect(facts).toEqual({
      candidateName: 'Priya Raman',
      candidateEmail: 'priya.raman@example.com',
      candidateContactNumber: '+91 9876543210',
      currentSalary: '12.5',
      expectedSalary: '15',
      noticePeriod: '60 days',
    })
  })

  it('understands rupee amounts and immediate joiners, and leaves out what it cannot find', () => {
    const facts = factsFromLines([line('Rahul Verma', 0.05, 18), line('Present salary Rs. 9,00,000 p.a.', 0.5), line('Immediate joiner', 0.6)])
    expect(facts.currentSalary).toBe('9')
    expect(facts.noticePeriod).toBe('Immediate')
    expect(facts.expectedSalary).toBeUndefined()
    expect(facts.candidateEmail).toBeUndefined()
    // a year range is not a phone number
    expect(factsFromLines([line('2019 - 2023', 0.2)]).candidateContactNumber).toBeUndefined()
  })
})

describe('reading the name', () => {
  const piece = (str: string, x: number, y: number, size = 10, width = str.length * size * 0.5): TextPiece => ({ str, x, y, width, size })

  it('keeps a first name and surname in two fonts on one line (a point apart)', () => {
    const lines = groupLines([piece('Ishita', 50, 780, 24), piece('Malhotra', 130, 781.5, 26), piece('Product Manager', 50, 750, 12)], 842, 1)
    expect(lines.map((l) => l.text)).toEqual(['Ishita Malhotra', 'Product Manager'])
    expect(factsFromLines(lines).candidateName).toBe('Ishita Malhotra')
  })

  it('does not split a word pdf.js gave in two pieces, and splits far-apart blocks', () => {
    const lines = groupLines([piece('Mal', 50, 700, 20, 30), piece('hotra', 80, 700, 20, 50), piece('ishita@example.com', 400, 700)], 842, 1)
    expect(lines.map((l) => l.text)).toEqual(['Malhotra', 'ishita@example.com'])
  })

  it('joins a name set as two lines', () => {
    const facts = factsFromLines([
      line('ISHITA', 0.05, 26),
      line('MALHOTRA', 0.09, 26),
      line('Product Manager', 0.13, 12),
      line('ishita.m@example.com', 0.16),
    ])
    expect(facts.candidateName).toBe('Ishita Malhotra')
  })

  it('joins a first name and surname that sit on one row as separate blocks', () => {
    const facts = factsFromLines([{ ...line('Malhotra', 0.05, 24), x: 200 }, { ...line('Ishita', 0.05, 24), x: 50 }, line('Designer', 0.09, 12)])
    expect(facts.candidateName).toBe('Ishita Malhotra')
  })

  it('does not add the job title to a one-word name', () => {
    expect(factsFromLines([line('Ishita', 0.05, 24), line('Designer', 0.08, 12)]).candidateName).toBe('Ishita')
  })
})

describe('phone number warnings', () => {
  it('warns when the number is partly hidden', () => {
    const facts = factsFromLines([line('Ishita Malhotra', 0.05, 22), line('ishita@example.com | 94xxx45xxx | Gurugram', 0.1)])
    expect(facts.candidateContactNumber).toBeUndefined()
    expect(facts.phoneWarning).toMatch(/incomplete \(94xxx45xxx\).*full, valid 10-digit mobile number/)
  })

  it('warns when the number is too short or missing', () => {
    expect(factsFromLines([line('Mobile: 98765 432', 0.1)]).phoneWarning).toMatch(/incomplete \(98765 432\)/)
    expect(factsFromLines([line('Ishita Malhotra', 0.05, 22)]).phoneWarning).toMatch(/No phone number was found/)
  })

  it('no warning when a full number is there', () => {
    expect(factsFromLines([line('+91 98765 43210', 0.1)]).phoneWarning).toBeUndefined()
  })
})
