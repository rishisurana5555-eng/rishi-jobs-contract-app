import type { Slot } from '../types'

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

/** Removes blank rows, de-duplicates and sorts by date/time. */
export function cleanSlots(slots: Slot[]): Slot[] {
  const seen = new Set<string>()
  const out: Slot[] = []
  for (const s of slots) {
    if (!s.date) continue
    const slot: Slot = { date: s.date }
    if (s.from) slot.from = s.from
    if (s.to) slot.to = s.to
    const key = `${slot.date}|${slot.from ?? ''}|${slot.to ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(slot)
  }
  return out.sort((a, b) => (a.date + (a.from ?? '')).localeCompare(b.date + (b.from ?? '')))
}

/**
 * Overlapping slots between candidate and client availability.
 * Same date = match. If both sides gave a time window, the windows must overlap
 * and the result is the overlap; if only one side gave times, those times are used.
 */
export function findMatches(candidate: Slot[], client: Slot[]): Slot[] {
  const out: Slot[] = []
  for (const c of candidate) {
    for (const k of client) {
      if (!c.date || c.date !== k.date) continue
      const cHas = !!(c.from && c.to)
      const kHas = !!(k.from && k.to)
      if (cHas && kHas) {
        const from = Math.max(toMin(c.from!), toMin(k.from!))
        const to = Math.min(toMin(c.to!), toMin(k.to!))
        if (from < to) out.push({ date: c.date, from: fromMin(from), to: fromMin(to) })
      } else if (cHas) {
        out.push({ date: c.date, from: c.from, to: c.to })
      } else if (kHas) {
        out.push({ date: k.date, from: k.from, to: k.to })
      } else {
        out.push({ date: c.date })
      }
    }
  }
  return cleanSlots(out)
}

export const slotMatchesDate = (slots: Slot[], date: string) => slots.some((s) => s.date === date)

/** Epoch ms of the last moment of the local day that contains `ms`. */
export function endOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/** Combines YYYY-MM-DD and HH:MM (local time) into epoch ms. */
export function toEpoch(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = (time || '00:00').split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm).getTime()
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Today as YYYY-MM-DD (local time), e.g. the earliest date a date input allows. */
export const todayIso = () => toDateAndTime(Date.now()).date

/** Epoch ms → local YYYY-MM-DD and HH:MM (the inverse of toEpoch). */
export function toDateAndTime(ms: number): { date: string; time: string } {
  const d = new Date(ms)
  return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
}

// ---------- display formatting ----------

export function fmtDateTime(ms: number): string {
  const d = new Date(ms)
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()
  return `${date}, ${time}`
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`
}

export function fmtIsoDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function fmtSlot(s: Slot): string {
  const time = s.from && s.to ? ` · ${fmtTime(s.from)}–${fmtTime(s.to)}` : s.from ? ` · from ${fmtTime(s.from)}` : ''
  return fmtIsoDate(s.date) + time
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function duration(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
