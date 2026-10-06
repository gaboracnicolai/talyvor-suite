import { EventEmitter } from 'node:events'
import type { Browser } from 'playwright'
import { describe, expect, it } from 'vitest'
import { AppUser, ChargeBook, Pace, bookAnswer, noAnswer, readAnswered, whileUp } from '../src/app.ts'

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
    const context = { route: async () => undefined, newPage: async () => page, close: async () => { closed++ } }
    const fake = Object.assign(browser, { newContext: async () => context }) as unknown as Browser
    const user = { index: 7, workspaceID: 'ws_7', token: 'tok', expiresAt: '' }
    await expect(AppUser.signIn(fake, user, { appURL: 'http://app', syntheticKey: 'k', cap: {} as never, catalog: [], modelName: 'm', book: {} as never, usdPerLXC: 0.1 }))
      .rejects.toThrow('ERR_CONNECTION_REFUSED')
    expect(closed).toBe(1)
  })
})

describe("a tester's pace (B34.1)", () => {
  it('lets a burst through at once, then one request a tick', async () => {
    const pace = new Pace(20, 3)
    const t0 = Date.now()
    for (let i = 0; i < 3; i++) await pace.take()
    expect(Date.now() - t0).toBeLessThan(20)
    await pace.take()
    expect(Date.now() - t0).toBeGreaterThanOrEqual(40)
  })
})

describe('an answer is booked the moment its footer is read (B35.8)', () => {
  it('books the charge though what comes straight after it throws', async () => {
    const book = new ChargeBook()
    const catalog = [{ id: 'claude-haiku-4-5', provider: 'anthropic', display_name: 'Claude Haiku 4.5', input_per_1m: 1, output_per_1m: 5 }]
    const footer = async () => '≈ 0.0007 LXC · Claude Haiku 4.5 · 40 in / 6 out tokens '
    const timedOut = async (): Promise<string> => {
      throw new Error("locator.evaluate: Timeout 30000ms exceeded. waiting for locator('[data-testid=\"turn-assistant\"]').first()")
    }
    await expect(readAnswered(footer, timedOut, (text) => bookAnswer(book, 'ws_86', text, catalog, 0.1))).rejects.toThrow('Timeout 30000ms')
    // 40 in and 6 out at $1 and $5 a million is $0.00007, 700 µLXC at $0.10 an LXC.
    expect(book.of('ws_86')).toEqual({ count: 1, ulxc: 700, slack: 0, unseen: 0 })
  })
})
