/**
 * Reads the common details off a CV (PDF) in the browser, to pre-fill the "Add candidate" form.
 * Nothing leaves the computer. Every value is a best guess the PE can correct.
 */

import { properName } from '../workflow/names'

export interface CvFacts {
  candidateName?: string
  candidateContactNumber?: string
  candidateEmail?: string
  /** LPA, digits only */
  currentSalary?: string
  expectedSalary?: string
  noticePeriod?: string
  /** the CV's phone number was hidden, incomplete or missing: ask the candidate for it */
  phoneWarning?: string
}

export interface Line {
  text: string
  /** font size (largest on the line) */
  size: number
  page: number
  /** 0 = top of the page, 1 = bottom */
  top: number
  /** left edge, in points (missing in older tests) */
  x?: number
}

/** One piece of text as pdf.js gives it: position (PDF points, y up), width and font size. */
export interface TextPiece {
  str: string
  x: number
  y: number
  width: number
  size: number
}

/**
 * Pieces of one page → its visual lines, top to bottom.
 * - Pieces on the same baseline (within a fraction of the font size — a name set in two fonts
 *   can sit a point apart) form one row.
 * - A row is split where a wide gap separates two blocks (a name on the left, contact details on
 *   the right), so each block is judged on its own.
 * - A space is only put between pieces that have a gap between them, so "Mal" + "hotra" stays one word.
 */
export function groupLines(pieces: TextPiece[], pageHeight: number, page: number): Line[] {
  const rows: { y: number; size: number; items: TextPiece[] }[] = []
  for (const it of [...pieces].filter((p) => p.str.trim()).sort((a, b) => b.y - a.y)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(1.5, 0.4 * Math.min(r.size, it.size)))
    if (row) {
      row.items.push(it)
      row.size = Math.max(row.size, it.size)
    } else rows.push({ y: it.y, size: it.size, items: [it] })
  }
  const lines: Line[] = []
  for (const row of rows) {
    const items = row.items.sort((a, b) => a.x - b.x)
    let seg: TextPiece[] = []
    const flush = () => {
      let text = ''
      seg.forEach((it, i) => {
        const prev = seg[i - 1]
        const gap = prev ? it.x - (prev.x + prev.width) : 0
        text += prev && gap > 0.15 * Math.min(prev.size, it.size) ? ' ' + it.str : it.str
      })
      text = text.replace(/\s+/g, ' ').trim()
      if (text) lines.push({ text, size: Math.max(...seg.map((s) => s.size)), page, top: 1 - row.y / pageHeight, x: seg[0].x })
      seg = []
    }
    for (const it of items) {
      const prev = seg[seg.length - 1]
      if (prev && it.x - (prev.x + prev.width) > Math.max(24, 3 * Math.max(prev.size, it.size))) flush()
      seg.push(it)
    }
    flush()
  }
  return lines.sort((a, b) => a.top - b.top || (a.x ?? 0) - (b.x ?? 0))
}

async function readLines(file: File): Promise<Line[]> {
  // Loaded only when a CV is picked, so the rest of the app stays small.
  // The "legacy" build: the standard one needs the very newest browsers (e.g. Uint8Array.prototype.toHex)
  // and fails on every PDF in a browser that is only a little older.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  const lines: Line[] = []
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
      const page = await doc.getPage(p)
      const height = page.getViewport({ scale: 1 }).height
      const content = await page.getTextContent()
      const pieces: TextPiece[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const [, , , d, x, y] = item.transform
        pieces.push({ str: item.str, x, y, width: item.width, size: Math.abs(d) || item.height })
      }
      lines.push(...groupLines(pieces, height, p))
      page.cleanup()
    }
  } finally {
    void task.destroy()
  }
  return lines.sort((a, b) => a.page - b.page || a.top - b.top || (a.x ?? 0) - (b.x ?? 0))
}

const NOT_A_NAME = /\b(resume|résumé|curriculum|vitae|cv|profile|summary|objective|contact|email|phone|mobile|address|experience|education|skills|page)\b/i

/** 2–4 words of letters (dots allowed for initials), not a heading. Same idea as the CV editor's name detection. */
function looksLikeName(text: string) {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length < 3 || t.length > 40 || NOT_A_NAME.test(t) || /[@\d]/.test(t)) return false
  const words = t.split(' ')
  return words.length >= 1 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))
}

const oneWord = (l: Line) => !l.text.trim().includes(' ')

/**
 * The largest name-like line in the top third of page 1 (where virtually every CV puts the name).
 * A name set as two lines ("ISHITA" above "MALHOTRA"), or as two blocks on one row, is joined back
 * together: a single word with another single name-like word of about the same size right beside it.
 */
function findName(lines: Line[]) {
  const top = lines.filter((l) => l.page === 1 && l.top <= 0.33)
  let best: Line | null = null
  for (const l of top) {
    if (!looksLikeName(l.text)) continue
    if (!best || l.size > best.size + 0.5 || (Math.abs(l.size - best.size) <= 0.5 && l.top < best.top)) best = l
  }
  if (!best) return undefined
  let name = best.text
  if (oneWord(best)) {
    const i = top.indexOf(best)
    const partner = [top[i - 1], top[i + 1]].find(
      (l) =>
        l &&
        oneWord(l) &&
        looksLikeName(l.text) &&
        l.size >= best.size * 0.7 &&
        l.size <= best.size / 0.7 &&
        Math.abs(l.top - best.top) <= 0.08,
    )
    if (partner) {
      const first = Math.abs(partner.top - best.top) < 0.01 ? (partner.x ?? 0) < (best.x ?? 0) : partner.top < best.top
      name = first ? `${partner.text} ${best.text}` : `${best.text} ${partner.text}`
    }
  }
  return properName(name)
}

/** A usable phone number off the CV, or why there isn't one (hidden with x's, too short, or none). */
function findPhone(text: string): { phone?: string; warning?: string } {
  for (const m of text.matchAll(/(?:\+?\d[\d\s().-]{8,18}\d)/g)) {
    const digits = m[0].replace(/\D/g, '')
    // 10-13 digits; skip year ranges like 2019-2023
    if (digits.length < 10 || digits.length > 13 || /^(19|20)\d{2}\D+(19|20)\d{2}$/.test(m[0].trim())) continue
    // 10-digit Indian mobiles, or with a 91 / 0 prefix
    const local = digits.slice(-10)
    if (digits.length === 10 || digits.startsWith('91') || digits.startsWith('0'))
      return { phone: /^[6-9]/.test(local) ? `+91 ${local}` : m[0].trim() }
    return { phone: m[0].trim() }
  }
  // Partly hidden: a run of x's / stars right beside a digit, e.g. "94xxx45xxx", "+91 98XXX XXX12".
  const masked = text.match(/(?<![\w@])(?:\+\d{1,3}[\s.-]?)?(?=[\dxX*\s.-]*(?:\d[xX*]{2,}|[xX*]{2,}\d))[\dxX*][\dxX*\s.-]{7,16}[\dxX*](?![\w@])/)
  // Too short: a number of 5-9 digits beside a phone label ("Mobile: 98765 432").
  const short = text.match(/(?:phone|mobile|mob|cell|contact|tel)\b[^\d\n]{0,12}(\+?\d[\d\s().-]{3,14}\d)/i)?.[1]
  const partial = short && short.replace(/\D/g, '').length < 10 ? short.trim() : undefined
  const shown = masked?.[0].trim() ?? partial
  return {
    warning: shown
      ? `The phone number in the CV is incomplete (${shown}). Please ask the candidate for their full, valid 10-digit mobile number.`
      : 'No phone number was found in the CV. Please ask the candidate for their full, valid 10-digit mobile number.',
  }
}

const MONTHLY = String.raw`\/\s*(?:month|mon|m)\b|per\s*month|p\.?\s*m\.?(?=\W|$)|monthly`

/** "12 LPA", "12.5 lakhs", "Rs. 12,00,000", "1200000 p.a.", "1,25,000/month" → "12" / "12.5" / "15" (LPA). */
function toLpa(raw: string): string | undefined {
  const s = raw.toLowerCase().replace(/,/g, '')
  const num = parseFloat(s.match(/\d+(\.\d+)?/)?.[0] ?? '')
  if (!num) return undefined
  let lpa = num
  if (/crore|cr\b/.test(s)) lpa = num * 100
  else if (/lpa|lakh|lac|\bl\b/.test(s)) lpa = num
  else if (num >= 10000) lpa = num / 100000
  else if (num > 200) return undefined
  if (new RegExp(MONTHLY).test(s)) lpa *= 12
  return String(Math.round(lpa * 100) / 100)
}

function findSalary(text: string, labels: string) {
  const amount = String.raw`((?:rs\.?|inr|₹)?\s*[\d,.]+\s*(?:lpa|lakhs?|lacs?|l\b|crores?|cr\b|p\.?a\.?)?\s*(?:${MONTHLY})?)`
  const m = text.match(new RegExp(String.raw`(?:${labels})\s*(?:ctc|salary|package)?\s*[:\-–]?\s*` + amount, 'i'))
  return m ? toLpa(m[1]) : undefined
}

function findNotice(text: string) {
  if (/notice\s*period\s*[:\-–]?\s*(immediate|serving|nil|none|0\s*days)/i.test(text) || /immediate(ly)?\s+(joiner|available)/i.test(text)) return 'Immediate'
  const m = text.match(/notice\s*period\s*(?:of)?\s*[:\-–]?\s*(\d{1,3})\s*(days?|months?)/i)
  if (!m) return undefined
  const days = /month/i.test(m[2]) ? Number(m[1]) * 30 : Number(m[1])
  return days === 0 ? 'Immediate' : `${days} days`
}

export async function extractCvFacts(file: File): Promise<CvFacts> {
  return factsFromLines(await readLines(file))
}

/** The guesses themselves, from the CV's text lines (exported for tests). */
export function factsFromLines(lines: Line[]): CvFacts {
  const text = lines.map((l) => l.text).join('\n')
  const phone = findPhone(text)
  return {
    candidateName: findName(lines),
    candidateEmail: text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0],
    candidateContactNumber: phone.phone,
    phoneWarning: phone.warning,
    currentSalary: findSalary(text, 'current|present|existing'),
    expectedSalary: findSalary(text, 'expected|expectation'),
    noticePeriod: findNotice(text),
  }
}
