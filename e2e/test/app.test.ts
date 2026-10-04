import { EventEmitter } from 'node:events'
import type { Browser } from 'playwright'
import { describe, expect, it } from 'vitest'
import { AppUser, noAnswer, whileUp } from '../src/app.ts'

describe('noAnswer (B26.20)', () => {
  const q = 'What is the code word in the attached document?'

  it('says where the question stopped when no answer and no error came', () => {
    expect(noAnswer({ question: q, box: q, uploading: ['memo-2.html'], partial: undefined }, 120)).toBe(
      'no answer and no error after 120 s: the question was never sent — it is still in the message box, with memo-2.html still uploading')
    expect(noAnswer({ question: q, box: q, uploading: [], partial: undefined }, 120)).toBe(
      'no answer and no error after 120 s: the question was never sent — it is still in the message box')
    expect(noAnswer({ question: q, box: '', uploading: [], partial: undefined }, 120)).toBe(
      'no answer and no error after 120 s: the question left the message box but no answer was started')
    expect(noAnswer({ question: q, box: '', uploading: [], partial: 'The code' }, 120)).toBe(
      'no answer and no error after 120 s: the answer started but never finished ("The code")')
  })
})

// B27.16 — after the run's browser was killed, a newPage on it never settled and its user waited out the
// whole sign-in deadline; and a sign-in that failed after its context opened left the context open.
class FakeBrowser extends EventEmitter {
  up = true
  isConnected(): boolean {
    return this.up
  }
  kill(): void {
    this.up = false
    this.emit('disconnected')
  }
}

describe('a browser that goes away (B27.16)', () => {
  it('ends a newPage that would never settle, as soon as the browser goes', async () => {
    const browser = new FakeBrowser()
    const opening = whileUp(browser, 'opening a page', new Promise<never>(() => undefined))
    setTimeout(() => browser.kill(), 10)
    await expect(opening).rejects.toThrow('opening a page: the browser went away')
    expect(browser.listenerCount('disconnected')).toBe(0)
  })

  it('closes the context of a sign-in that fails after it opened', async () => {
    const browser = new FakeBrowser()
    let closed = 0
    const page = { goto: async () => { throw new Error('net::ERR_CONNECTION_REFUSED') } }
    const context = { newPage: async () => page, close: async () => { closed++ } }
    const fake = Object.assign(browser, { newContext: async () => context }) as unknown as Browser
    const user = { index: 7, workspaceID: 'ws_7', token: 'tok', expiresAt: '' }
    await expect(AppUser.signIn(fake, user, { appURL: 'http://app', syntheticKey: 'k', cap: {} as never, catalog: [], modelName: 'm', book: {} as never, usdPerLXC: 0.1 }))
      .rejects.toThrow('ERR_CONNECTION_REFUSED')
    expect(closed).toBe(1)
  })
})
