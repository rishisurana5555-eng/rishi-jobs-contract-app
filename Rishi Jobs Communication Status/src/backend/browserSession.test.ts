import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Each fresh import of browserSession.ts is one tab of the app. The tabs share localStorage and the
 * browser-session cookie, and talk over BroadcastChannel, as in a browser.
 */
type Tab = typeof import('./browserSession')

const channels: BroadcastChannel[] = []
class TrackedChannel extends BroadcastChannel {
  constructor(name: string) {
    super(name)
    channels.push(this)
  }
}

let storage: Map<string, string>
let cookie: string

async function openTab(): Promise<Tab & { close: () => void }> {
  vi.resetModules()
  const before = channels.length
  const tab = await import('./browserSession')
  const own = channels.slice(before)
  // Closing a tab: it stops answering.
  return { ...tab, close: () => own.forEach((c) => c.close()) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T10:00:00'))
  storage = new Map()
  cookie = ''
  vi.stubGlobal('BroadcastChannel', TrackedChannel)
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  })
  vi.stubGlobal('location', { protocol: 'http:' })
  vi.stubGlobal('window', { addEventListener: () => {} })
  vi.stubGlobal('document', {
    addEventListener: () => {},
    get cookie() {
      return cookie
    },
    set cookie(v: string) {
      // Keep just "name=value", like a browser does.
      cookie = v.split(';')[0]
    },
  })
})

afterEach(() => {
  channels.splice(0).forEach((c) => c.close())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const later = (ms: number) => vi.setSystemTime(Date.now() + ms)

describe('signed out once every tab of the app is closed', () => {
  it('signs out when every tab was closed, even though the browser stayed open', async () => {
    const a = await openTab()
    a.markBrowserSession() // logged in
    a.close()
    later(60 * 60_000)
    const b = await openTab()
    expect(await b.appStayedOpen()).toBe(false)
  })

  it('also when closed and opened again a minute later', async () => {
    const a = await openTab()
    a.markBrowserSession()
    a.close()
    later(60_000)
    expect(await (await openTab()).appStayedOpen()).toBe(false)
  })

  it('keeps the login on a reload', async () => {
    const a = await openTab()
    a.markBrowserSession()
    a.close()
    later(2_000)
    expect(await (await openTab()).appStayedOpen()).toBe(true)
  })

  it('keeps the login when another tab is still open, even a background tab that went quiet', async () => {
    const a = await openTab()
    a.markBrowserSession()
    later(60 * 60_000) // a's last sign of life in storage is an hour old, but it still answers
    const b = await openTab()
    expect(await b.appStayedOpen()).toBe(true)
    // b now keeps the app open too: closing a, then opening c, still finds b.
    a.close()
    later(60 * 60_000)
    expect(await (await openTab()).appStayedOpen()).toBe(true)
  })

  it('signs out tabs the browser restores together (they don’t vouch for each other)', async () => {
    const a = await openTab()
    a.markBrowserSession()
    a.close()
    later(8 * 60 * 60_000)
    const [b, c] = await Promise.all([openTab(), openTab()])
    expect(await Promise.all([b.appStayedOpen(), c.appStayedOpen()])).toEqual([false, false])
  })

  it('signs out when the browser was closed (cookie gone)', async () => {
    const a = await openTab()
    a.markBrowserSession()
    a.close()
    cookie = ''
    expect(await (await openTab()).appStayedOpen()).toBe(false)
  })
})
