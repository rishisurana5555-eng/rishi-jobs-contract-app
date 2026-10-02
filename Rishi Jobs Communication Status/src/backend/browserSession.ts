/**
 * "Has the app stayed open since the person logged in?"
 *
 * The login itself is kept by Firebase for the whole browser (every tab shares it). It must end once
 * every tab of the app has been closed — even when the browser itself stays open, or brings back its
 * cookies on restart ("continue where you left off"), so a browser-session cookie alone is not enough.
 *
 * So every open tab of the app shows it is alive: it writes the time to localStorage every few seconds
 * (and as it closes or reloads), and answers "anyone there?" on a BroadcastChannel (background tabs
 * write less often, as browsers slow down their timers, but still answer at once). When the app starts
 * with a saved login, it was open all along if the last sign of life is only seconds old (a reload) or
 * another tab answers. Otherwise every tab had been closed, and the person is signed out.
 */
const BEAT_KEY = 'rj-tab-alive'
const CHANNEL = 'rj-tabs'
const BEAT_EVERY_MS = 5_000
/** A sign of life this recent means a tab of the app was open (or this one just reloaded). */
const FRESH_MS = 10_000
/** How long to wait for another tab to answer. */
const ANSWER_WAIT_MS = 700
/** Kept from the earlier check, as a second sign: browsers delete it when they close (unless they restore it). */
const COOKIE = 'rj-browser-session'

const readBeat = () => {
  try {
    return Number(localStorage.getItem(BEAT_KEY)) || 0
  } catch {
    return 0
  }
}
const beat = () => {
  try {
    localStorage.setItem(BEAT_KEY, String(Date.now()))
  } catch {
    /* storage blocked: the other tabs still answer on the channel */
  }
}

/** The last sign of life before this page started (read before this tab adds its own). */
const lastBeatBeforeStart = readBeat()
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null

/**
 * Only a tab whose login is confirmed (logged in here, or found to have stayed open) keeps the app
 * open for others. Tabs the browser restores together, still checking, must not vouch for each other.
 */
let confirmed = false
function confirmOpen() {
  if (confirmed) return
  confirmed = true
  beat()
  setInterval(beat, BEAT_EVERY_MS)
  // Closing or reloading: the last sign of life is "now", so a reload finds it fresh.
  window.addEventListener('pagehide', beat)
  document.addEventListener('visibilitychange', beat)
}
channel?.addEventListener('message', (e) => {
  if (e.data === 'anyone-there' && confirmed) channel.postMessage('here')
})

/** Does another open tab of the app answer? */
function anotherTabAnswers(): Promise<boolean> {
  if (!channel) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent) => {
      if (e.data !== 'here') return
      clearTimeout(timer)
      channel.removeEventListener('message', onMessage)
      resolve(true)
    }
    const timer = setTimeout(() => {
      channel.removeEventListener('message', onMessage)
      resolve(false)
    }, ANSWER_WAIT_MS)
    channel.addEventListener('message', onMessage)
    channel.postMessage('anyone-there')
  })
}

/**
 * At the start of this page, with a saved login: has the app stayed open since (another tab still
 * open, or this tab reloading)? Asked once per page; after that this tab itself keeps the app open.
 */
let answer: Promise<boolean> | null = null
export function appStayedOpen(): Promise<boolean> {
  answer ??= (async () => {
    if (!document.cookie.split('; ').some((c) => c === `${COOKIE}=1`)) return false
    const open = (lastBeatBeforeStart > 0 && Date.now() - lastBeatBeforeStart < FRESH_MS) || (await anotherTabAnswers())
    if (open) confirmOpen()
    return open
  })()
  return answer
}

/** A login in this page: the app is open from now on. */
export function markBrowserSession() {
  answer = Promise.resolve(true)
  confirmOpen()
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE}=1; path=/; SameSite=Strict${secure}`
}
