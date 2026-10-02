/**
 * Alert sounds, generated with the Web Audio API (no sound files to host).
 *
 *   'success' — smooth, rising chime: a status changed or something you did worked.
 *   'notify'  — calm, soft two-note bell: a note, a new client / job opening, other information.
 *   'alert'   — a bit harsh, buzzy triple beep: action required, an error or a warning.
 *   'alarm'   — ~6 seconds of alarm-clock beeping: work has been pending for 10+ minutes.
 *
 * Every sound can be stopped: pass a `key` to playSound and call stopSound(key) when the
 * banner, pop-up or desktop notification it belongs to is closed.
 *
 * Browsers only allow sound after the person has clicked or typed on the page once.
 * `unlockAudio` is hooked to the first click/keypress; until then `soundBlocked()` is true
 * and the reminder dialog asks the user to click anywhere to turn sound on.
 */

export type SoundKind = 'success' | 'notify' | 'alert' | 'alarm'

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  ctx ??= new AudioContext()
  return ctx
}

export function unlockAudio() {
  const c = audio()
  if (c && c.state === 'suspended') void c.resume()
}

export const soundBlocked = () => audio()?.state !== 'running'

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, unlockAudio, { capture: true })
}

interface Note {
  freq: number
  /** seconds after the sound starts */
  at: number
  length: number
  volume: number
  wave: OscillatorType
  /** soft = gentle attack and a long natural fade (bell-like); hard = flat, clipped beep */
  shape: 'soft' | 'hard'
}

function note(c: AudioContext, out: AudioNode, t0: number, n: Note) {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = n.wave
  osc.frequency.value = n.freq
  const start = t0 + n.at
  const end = start + n.length
  gain.gain.setValueAtTime(0, start)
  if (n.shape === 'soft') {
    gain.gain.linearRampToValueAtTime(n.volume, start + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
  } else {
    gain.gain.linearRampToValueAtTime(n.volume, start + 0.005)
    gain.gain.setValueAtTime(n.volume, end - 0.02)
    gain.gain.linearRampToValueAtTime(0, end)
  }
  osc.connect(gain).connect(out)
  osc.start(start)
  osc.stop(end + 0.02)
}

const soft = (freq: number, at: number, length: number, volume: number, wave: OscillatorType = 'sine'): Note => ({ freq, at, length, volume, wave, shape: 'soft' })
const hard = (freq: number, at: number, length: number, volume: number, wave: OscillatorType = 'square'): Note => ({ freq, at, length, volume, wave, shape: 'hard' })

function score(kind: SoundKind): Note[] {
  switch (kind) {
    case 'success':
      // C major arpeggio C5–E5–G5–C6, overlapping sine bells with a gentle octave shimmer.
      return [523.25, 659.25, 783.99, 1046.5].flatMap((f, i) => [soft(f, i * 0.11, 0.9 - i * 0.05, 0.16), soft(f * 2, i * 0.11, 0.35, 0.03)])
    case 'notify':
      // Calm "ding… dong": two low, quiet triangle-wave bells with a long fade.
      return [soft(659.25, 0, 1.3, 0.13, 'triangle'), soft(493.88, 0.38, 1.6, 0.11, 'triangle')]
    case 'alert':
      // Three buzzy falling pairs (sawtooth) — noticeably rougher than the chimes.
      return [0, 0.42, 0.84].flatMap((at) => [hard(740, at, 0.13, 0.16, 'sawtooth'), hard(554.37, at + 0.16, 0.18, 0.16, 'sawtooth')])
    case 'alarm':
      // Four quick beeps, a short pause, repeated six times.
      return Array.from({ length: 24 }, (_, i) => {
        const burst = Math.floor(i / 4)
        return hard(burst % 2 ? 1046 : 988, burst + (i % 4) * 0.16, 0.1, 0.3)
      })
  }
}

/** Sounds currently playing (or scheduled), by key, so they can be stopped early. */
const playing = new Map<string, { out: GainNode; endsAt: number }>()
let autoKey = 0

/**
 * Plays a sound. Returns its key; stopSound(key) cuts it off. Playing again under a key that is
 * still sounding replaces it (so repeated alarms don't pile up).
 */
export function playSound(kind: SoundKind, key = `sound-${++autoKey}`): string {
  const c = audio()
  if (!c) return key
  if (c.state === 'suspended') void c.resume()
  stopSound(key)
  const out = c.createGain()
  out.connect(c.destination)
  const t0 = c.currentTime + 0.05
  const notes = score(kind)
  for (const n of notes) note(c, out, t0, n)
  const endsAt = t0 + Math.max(...notes.map((n) => n.at + n.length)) + 0.1
  playing.set(key, { out, endsAt })
  setTimeout(() => {
    if (playing.get(key)?.out === out) playing.delete(key)
    out.disconnect()
  }, (endsAt - c.currentTime) * 1000 + 200)
  return key
}

/** Stops a sound right away (a quick fade avoids a click). Safe to call for a sound that already ended. */
export function stopSound(key: string | undefined) {
  if (!key) return
  const p = playing.get(key)
  const c = audio()
  if (!p || !c) return
  playing.delete(key)
  const now = c.currentTime
  p.out.gain.cancelScheduledValues(now)
  p.out.gain.setValueAtTime(p.out.gain.value, now)
  p.out.gain.linearRampToValueAtTime(0, now + 0.05)
  setTimeout(() => p.out.disconnect(), 100)
}
