import { useEffect } from 'react'

/** After this long without a click, key press, scroll or touch, the person is signed out. */
export const IDLE_SIGN_OUT_MS = 12 * 3_600_000
const KEY = 'rj-last-active'
const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const

const read = () => {
  try {
    return Number(localStorage.getItem(KEY)) || null
  } catch {
    return null
  }
}
const write = (t: number) => {
  try {
    localStorage.setItem(KEY, String(t))
  } catch {
    /* storage blocked: the in-memory timer below still works */
  }
}

/** A fresh login starts the 12 hours again (an old time left from an earlier login must not count). */
export const resetIdle = () => write(Date.now())

/**
 * Signs the person out after 12 hours of inactivity in all of the browser's tabs. The last activity
 * is kept in localStorage (shared by the tabs), so it also catches a computer that slept.
 * (Closing every tab of the app signs out by itself: see browserSession.ts.)
 */
export function useIdleSignOut(active: boolean, signOut: () => void) {
  useEffect(() => {
    if (!active) return
    let last = read() ?? Date.now()
    const check = () => {
      // Activity in another tab counts too.
      last = Math.max(last, read() ?? 0)
      if (Date.now() - last > IDLE_SIGN_OUT_MS) {
        try {
          localStorage.removeItem(KEY)
        } catch {
          /* ignore */
        }
        signOut()
        return true
      }
      return false
    }
    if (check()) return
    write(last)
    const onActivity = () => {
      const now = Date.now()
      // Writing at most every 30 seconds is plenty for a 12-hour limit.
      if (now - last > 30_000) write(now)
      last = now
    }
    for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true, capture: true })
    const timer = setInterval(check, 60_000)
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity, { capture: true })
      clearInterval(timer)
    }
  }, [active, signOut])
}
