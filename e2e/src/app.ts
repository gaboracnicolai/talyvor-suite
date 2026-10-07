// B17.3 — a synthetic user driving the real web app in a headless browser: sign in through the BFF's
// POST /auth/synthetic (B17.2), then use Chat the way a person does — type, press Enter, read the
// answer and the line under it. Every question reserves its worst case against the spend cap first.

import type { Browser, BrowserContext, Locator, Page, Request } from 'playwright'
import { type Hold, type SpendCap, worstInputTokens } from './budget.ts'
import type { Recorder, Tag } from './coverage.ts'
import type { SyntheticUser } from './lens.ts'
import { type CatalogModel, type Footer, listPriceUSD, networkDrop, parseFooter } from './oracles.ts'

/** The most output a chat answer may produce: the web app sends max_tokens 4096 (chatApi.ts). */
const CHAT_MAX_OUTPUT_TOKENS = 4096
const ANSWER_TIMEOUT_MS = 120_000

export interface Turn {
  question: string
  answer: string
  footerText: string
  footer: Footer
  /** What this answer cost at list price, from the tokens its footer states; undefined when not priced. */
  costUSD: number | undefined
  error?: string
}

export class SignInRefused extends Error {}

/** B35.8 — an answer refused because the testers' own network dropped ("Failed to fetch", net::ERR_…): the run's ERROR, never a FAIL. */
export class NetworkDropped extends Error {}

/** B34.1 — the most API requests a tester's browser sends a second, and in one burst: well under Lens's 1,000 a minute. */
const API_PER_SECOND = 13
const API_BURST = 100

/** A token bucket: `take` waits until the browser may send its next request. */
export class Pace {
  private readonly perSecond: number
  private readonly burst: number
  private tokens: number
  private last = Date.now()

  constructor(perSecond: number, burst: number) {
    this.perSecond = perSecond
    this.burst = burst
    this.tokens = burst
  }

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now()
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond)
      this.last = now
      if (this.tokens >= 1) {
        this.tokens--
        return
      }
      await new Promise((r) => setTimeout(r, ((1 - this.tokens) / this.perSecond) * 1000))
    }
  }
}

/** B27.16 — the longest a new context or page may take to open on a browser that is still up. */
const OPEN_MS = 60_000

/** What whileUp needs of a Browser. */
interface Goes {
  isConnected(): boolean
  once(event: 'disconnected', listener: () => void): unknown
  off(event: 'disconnected', listener: () => void): unknown
}

/**
 * B27.16 — `work` (a newContext or newPage), ended as soon as `browser` goes: Playwright leaves those
 * unsettled for ever on a browser that was killed. One that takes longer than OPEN_MS also fails.
 */
export function whileUp<T>(browser: Goes, what: string, work: Promise<T>, ms = OPEN_MS): Promise<T> {
  let end = (): void => undefined
  const gone = new Promise<never>((_, reject) => {
    const went = (): void => reject(new Error(`${what}: the browser went away`))
    const timer = setTimeout(() => reject(new Error(`${what}: nothing within ${ms / 1000} s`)), ms)
    browser.once('disconnected', went)
    end = () => {
      clearTimeout(timer)
      browser.off('disconnected', went)
    }
    if (!browser.isConnected()) went()
  })
  // What it opens after all, too late, is closed: nobody holds it.
  void work.then((x) => gone.catch(() => (x as { close?: () => Promise<void> }).close?.().catch(() => undefined)), () => undefined)
  return Promise.race([work, gone]).finally(() => end())
}

/** `work`, or an error saying `what` once `ms` pass. */
function timedOut<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} within ${ms / 1000} s`)), ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

/** B26.20 — what the Chat screen showed when neither an answer nor its failure line came. */
export interface Stalled {
  question: string
  /** What is still in the message box. */
  box: string
  /** Documents still shown as uploading. */
  uploading: string[]
  /** The answer's text so far, or undefined when no answer was started. */
  partial: string | undefined
}

/** B26.20 — why no answer came, in words: a bare timeout says nothing about where the question stopped. */
export function noAnswer(s: Stalled, seconds: number): string {
  const after = `no answer and no error after ${seconds} s`
  if (s.partial !== undefined) return `${after}: the answer started but never finished ("${s.partial.slice(0, 200)}")`
  if (s.box.trim() === s.question.trim()) {
    return `${after}: the question was never sent — it is still in the message box` +
      (s.uploading.length > 0 ? `, with ${s.uploading.join(', ')} still uploading` : '')
  }
  return `${after}: the question left the message box but no answer was started`
}

/** A file a person picks with Attach (Playwright's setInputFiles payload). */
export interface Attachment {
  name: string
  mimeType: string
  buffer: Buffer
}

export interface Charged {
  /** Answers charged for: the spend rows the ledger must hold. */
  count: number
  /** What they should have cost, in µLXC, from the tokens the screen showed at list price. */
  ulxc: number
  /** How far the total may honestly differ: a shared answer's charge is shown to two figures only. */
  slack: number
  /** B35.8 — answers lost to a network drop: each may or may not have reached Lens and been charged. */
  unseen: number
}

/** Dollars → µLXC as Lens debits a charge: rounded UP (talyvor-lens internal/proxy/shadow_lxc.go). */
export function chargeULXC(usd: number, usdPerLXC: number): number {
  return Math.ceil((usd / usdPerLXC) * 1e6)
}

/**
 * What each workspace was charged for, across every browser context signed in as it and every judge
 * call — what its ledger must show when the run is over.
 */
export class ChargeBook {
  private readonly charged = new Map<string, Charged>()

  /** `requests`: B28.349 — an answer that called a tool first is that many requests, each its own spend row. */
  add(workspaceID: string, ulxc: number, slack = 0, requests = 1): void {
    const c = this.of(workspaceID)
    this.charged.set(workspaceID, { ...c, count: c.count + requests, ulxc: c.ulxc + ulxc, slack: c.slack + slack })
  }

  /** B35.8 — an answer whose charge the harness never saw: its question left the browser and the network dropped. */
  lost(workspaceID: string): void {
    const c = this.of(workspaceID)
    this.charged.set(workspaceID, { ...c, unseen: c.unseen + 1 })
  }

  of(workspaceID: string): Charged {
    return this.charged.get(workspaceID) ?? { count: 0, ulxc: 0, slack: 0, unseen: 0 }
  }
}

/**
 * B35.8 — what an answer's footer says it cost, booked to `workspaceID`: a priced answer at the catalog's list price (one
 * by a model the catalog does not name, at any price), a shared one at the credits it states, a replay at nothing.
 */
export function bookAnswer(book: ChargeBook, workspaceID: string, footerText: string, catalog: readonly CatalogModel[],
  usdPerLXC: number): { footer: Footer; costUSD: number | undefined } {
  const footer = parseFooter(footerText)
  if (footer.kind === 'priced') {
    const m = catalog.find((c) => c.display_name === footer.model)
    const costUSD = m === undefined ? undefined : listPriceUSD(m, footer.inputTokens, footer.outputTokens)
    // B28.362 — what Lens said it charged is booked as it is.
    if (footer.chargedULXC !== undefined) book.add(workspaceID, footer.chargedULXC, 0, footer.requests)
    // A model the catalog does not name cannot be priced: its charge is anyone's guess.
    else book.add(workspaceID, costUSD === undefined ? 0 : chargeULXC(costUSD, usdPerLXC), costUSD === undefined ? Number.POSITIVE_INFINITY : 0, footer.requests)
    return { footer, costUSD }
  }
  if (footer.kind === 'cache') return { footer, costUSD: 0 }
  if (footer.kind === 'pool') {
    // Lens states a shared answer's charge in credits, shown to two significant figures.
    book.add(workspaceID, footer.figure * 1e6, footer.figure * 1e6 * 0.05 + 1)
    return { footer, costUSD: footer.figure * usdPerLXC }
  }
  return { footer, costUSD: undefined }
}

/**
 * B35.8 — an answered turn, read as the ledger needs it: its footer first, booked (`book`) the moment it is read, then
 * the answer's text. Whatever throws after the footer — the text's read timing out, the scenario's next step — the
 * read-back still expects the spend row this answer wrote.
 */
export async function readAnswered(footerText: () => Promise<string>, answerText: () => Promise<string>,
  book: (footerText: string) => { footer: Footer; costUSD: number | undefined }): Promise<{ footerText: string; footer: Footer; costUSD: number | undefined; answer: string }> {
  const text = (await footerText()).trim()
  const booked = book(text)
  return { footerText: text, ...booked, answer: await answerText() }
}

export class AppUser {
  readonly user: SyntheticUser
  readonly page: Page
  readonly context: BrowserContext
  private readonly appURL: string
  private readonly cap: SpendCap
  private readonly catalog: CatalogModel[]
  private readonly book: ChargeBook
  private readonly usdPerLXC: number
  private readonly recorder: Recorder | undefined
  /** B25.5 — whose outcome what this browser does now belongs to; run.ts sets it before each scenario. */
  tag: Tag
  private modelName: string
  /** Characters of the open conversation, for the worst-case input estimate. */
  private conversationChars = 0

  private constructor(user: SyntheticUser, context: BrowserContext, page: Page, appURL: string, cap: SpendCap,
    catalog: CatalogModel[], modelName: string, book: ChargeBook, usdPerLXC: number, recorder: Recorder | undefined, tag: Tag) {
    this.user = user
    this.context = context
    this.page = page
    this.appURL = appURL
    this.cap = cap
    this.catalog = catalog
    this.modelName = modelName
    this.book = book
    this.usdPerLXC = usdPerLXC
    this.recorder = recorder
    this.tag = tag
  }

  get modelNameInUse(): string {
    return this.modelName
  }

  /** A fresh browser context signed in as `user`, on the Chat screen with `modelName` chosen. */
  static async signIn(browser: Browser, user: SyntheticUser, opts: {
    appURL: string; syntheticKey: string; cap: SpendCap; catalog: CatalogModel[]; modelName: string; book: ChargeBook
    usdPerLXC: number; recorder?: Recorder; tag?: Tag
  }): Promise<AppUser> {
    const context = await whileUp(browser, 'opening a browser context', browser.newContext())
    // B27.16 — a sign-in that fails part-way closes what it opened.
    try {
      const tag = opts.tag ?? { scenario: 'sign-in', user: user.index }
      // Watching starts before the first page opens, so sign-in's own requests are recorded too.
      const holder: { app?: AppUser } = {}
      if (opts.recorder !== undefined) watch(context, opts.appURL, opts.recorder, () => holder.app?.tag ?? tag)
      // B34.1 — a person's pace: Lens holds a workspace to 1,000 requests a minute, and every tab reads Lens through the
      // BFF. A tester that reloads Agent Wallets before each click outruns that, so its browser waits its turn.
      const pace = new Pace(API_PER_SECOND, API_BURST)
      await context.route((u) => u.pathname.startsWith('/api/'), async (route) => {
        await pace.take()
        await route.continue()
      })
      const page = await whileUp(browser, 'opening a page', context.newPage())
      await page.goto(opts.appURL + '/')
      // From inside the page, so the request carries the app's own Origin and the cookie lands in
      // this context — exactly the session a person's browser holds.
      const status = await page.evaluate(async ({ u, key }) => {
        const res = await fetch('/auth/synthetic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Talyvor-Synthetic-Key': key },
          body: JSON.stringify({ workspace_id: u.workspaceID, token: u.token, expires_at: u.expiresAt }),
        })
        return res.status
      }, { u: user, key: opts.syntheticKey })
      if (status !== 200) throw new SignInRefused(`POST /auth/synthetic answered ${status} for ${user.workspaceID}`)
      const app = new AppUser(user, context, page, opts.appURL, opts.cap, opts.catalog, opts.modelName, opts.book, opts.usdPerLXC,
        opts.recorder, tag)
      holder.app = app
      await app.openChat()
      if (!(await app.chooseModel(opts.modelName))) throw new Error(`the model picker does not offer "${opts.modelName}"`)
      return app
    } catch (e) {
      await context.close().catch(() => undefined)
      throw e
    }
  }

  /** B26.18 — a context whose browser has already gone has nothing left to close, and that is not an error. */
  async close(): Promise<void> {
    await this.context.close().catch(() => undefined)
  }

  async openChat(): Promise<void> {
    await this.page.goto(this.appURL + '/chat')
    await this.page.locator('#chat-message').waitFor({ state: 'visible' })
  }

  /**
   * Opens another screen of the app in a second tab of the same browser, signed in as the same user.
   * The Chat tab stays where it is: going back to /chat reopens the latest conversation, which would
   * put the next question into it.
   */
  async tab(path: string): Promise<Page> {
    const browser = this.context.browser()
    const page = await (browser === null ? this.context.newPage() : whileUp(browser, 'opening a tab', this.context.newPage()))
    const t0 = Date.now()
    const res = await page.goto(this.appURL + path)
    this.screenTimed(path, res?.status() ?? 0, Date.now() - t0)
    return page
  }

  /** B25.5 — how long a screen took to open, for the report's timings. */
  screenTimed(path: string, status: number, ms: number): void {
    this.recorder?.hit(this.tag, { kind: 'screen', method: 'GET', path: path.split(/[?#]/)[0], status, ms })
  }

  /** Picks a model in the picker by the name it shows; false, with the picker closed, if it is not offered. */
  async chooseModel(displayName: string): Promise<boolean> {
    const trigger = this.page.locator('button[aria-label^="Model: "], button[aria-label="Choose a model"]').first()
    await trigger.waitFor({ state: 'visible' })
    if ((await trigger.getAttribute('aria-label')) !== `Model: ${displayName}`) {
      await trigger.click()
      await this.page.getByRole('combobox', { name: 'Search models' }).or(this.page.getByLabel('Search models')).first().fill(displayName)
      // An option is named by the model and then its price ("Claude Haiku 4.5 $1.00 / $5.00").
      const name = new RegExp(`^${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\(selected\\))? \\$`)
      const option = this.page.getByRole('option', { name }).first()
      try {
        await option.waitFor({ state: 'visible', timeout: 5_000 })
      } catch {
        await this.page.keyboard.press('Escape')
        return false
      }
      await option.click()
      await this.page.locator(`button[aria-label="Model: ${displayName}"]`).waitFor({ state: 'visible' })
    }
    this.modelName = displayName
    return true
  }

  async newChat(): Promise<void> {
    this.conversationChars = 0
    // The button is disabled on an empty conversation, which is already a new chat.
    if ((await this.page.locator('[data-testid="turn-user"]').count()) === 0) return
    await this.page.getByRole('button', { name: 'New chat' }).first().click()
    await this.page.locator('[data-testid="turn-user"]').first().waitFor({ state: 'detached' })
  }

  /**
   * Asks `question` in the open conversation and waits for the whole answer and its footer. With
   * `lengths`, each length the answer's visible text takes while it arrives; with `files`, they are
   * attached first, as Attach does.
   */
  async ask(question: string, lengths?: number[], files: Attachment[] = []): Promise<Turn> {
    // A document is read as input: its whole size counts toward the worst case.
    const hold = this.reserve(question.length + files.reduce((n, f) => n + f.buffer.length, 0))
    const before = await this.page.locator('[data-testid="turn-assistant"]').count()
    if (files.length > 0) {
      await this.page.locator('#chat-attach').setInputFiles(files)
      await this.page.getByRole('list', { name: 'Attached documents' }).waitFor({ state: 'visible' })
    }
    if (lengths !== undefined) await this.watchLengths(before)
    await this.page.locator('#chat-message').fill(question)
    await this.page.locator('#chat-message').press('Enter')
    const turn = this.page.locator('[data-testid="turn-assistant"]').nth(before)
    const t = await this.finish(question, turn, hold)
    if (lengths !== undefined) lengths.push(...await this.page.evaluate(() => (window as unknown as { e2eLengths?: number[] }).e2eLengths ?? []))
    return t
  }

  /**
   * B27.16 — records, inside the page, each length the `nth` answer's text takes until its footer appears.
   * Read from here every 40 ms instead, a loaded machine's round trips missed the 30 ms between pieces and
   * saw too few states of an answer that did stream.
   */
  private async watchLengths(nth: number): Promise<void> {
    await this.page.evaluate((n) => {
      const seen: number[] = []
      ;(window as unknown as { e2eLengths?: number[] }).e2eLengths = seen
      const observer = new MutationObserver(() => {
        const li = document.querySelectorAll('[data-testid="turn-assistant"]')[n]
        if (li === undefined) return
        if (li.querySelector('[data-testid="turn-cost"]') !== null) return observer.disconnect()
        const len = (li.textContent ?? '').length
        if (seen[seen.length - 1] !== len) seen.push(len)
      })
      observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    }, nth)
  }

  /**
   * B28.78 — asks `question` and presses Stop before any of the answer has arrived, which leaves an empty
   * answer in the conversation. The request is held inside this browser until Stop and never reaches
   * the app's server, so it costs nothing and Stop is never too late.
   */
  async stopBeforeAnswer(question: string): Promise<void> {
    const stream = '**/api/ai/stream/**'
    let release = (): void => undefined
    const held = new Promise<void>((r) => {
      release = r
    })
    await this.page.route(stream, async (route) => {
      await held
      // The page has already given the request up; nothing is left to refuse.
      await route.abort().catch(() => undefined)
    }, { times: 1 })
    try {
      await this.page.locator('#chat-message').fill(question)
      await this.page.locator('#chat-message').press('Enter')
      await this.page.getByRole('button', { name: 'Stop' }).click()
      await this.page.getByRole('button', { name: 'Send' }).waitFor({ state: 'visible' })
    } finally {
      release()
      await this.page.unroute(stream).catch(() => undefined)
    }
    // The question stays in the conversation and is sent again with the next one.
    this.conversationChars += question.length
  }

  /**
   * B28.81 — asks `question` and has its answer arrive as `sse`, a stream this browser makes up in the app
   * server's place: a blank answer, or one cut off at the length limit, which no real model sends on demand.
   * The request never leaves the browser, so it costs nothing. Returns the answer once it has ended.
   */
  async askAnswered(question: string, sse: string): Promise<Locator> {
    const stream = '**/api/ai/stream/**'
    // B35.8 — the newest answer once the made-up one is in: a conversation Chat reopened under the question would put
    // older answers at the index counted before it was sent.
    const turn = this.page.locator('[data-testid="turn-assistant"]').last()
    let answered = (): void => undefined
    const madeUp = new Promise<void>((r) => {
      answered = r
    })
    await this.page.route(stream, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse })
      answered()
    }, { times: 1 })
    try {
      await this.page.locator('#chat-message').fill(question)
      await this.page.locator('#chat-message').press('Enter')
      // B35.8 — the route stays until the made-up answer is in: a question sent after it went would be asked of the model
      // for real, charged, and never booked.
      await timedOut(madeUp, ANSWER_TIMEOUT_MS, `the question "${question}" was never sent for its made-up answer`)
      await turn.locator('[data-testid="turn-blank"], [data-testid="turn-cost"]').first().waitFor({ state: 'visible', timeout: ANSWER_TIMEOUT_MS })
    } finally {
      await this.page.unroute(stream).catch(() => undefined)
    }
    this.conversationChars += question.length + sse.length
    return turn
  }

  /**
   * B28.348 — asks `question` and has it refused with `status` and Lens's JSON `body`, made up in the app
   * server's place: a spending cap, a used-up budget, a chat at its limit, which no test workspace reaches
   * on demand. The request never leaves the browser, so it costs nothing. Returns the refusal line.
   */
  async askRefused(question: string, status: number, body: string): Promise<Locator> {
    const stream = '**/api/ai/stream/**'
    const alert = this.page.locator('ol ~ p[role="alert"]')
    await this.page.route(stream, (route) => route.fulfill({ status, contentType: 'application/json', body }), { times: 1 })
    try {
      await this.page.locator('#chat-message').fill(question)
      await this.page.locator('#chat-message').press('Enter')
      await alert.waitFor({ state: 'visible', timeout: ANSWER_TIMEOUT_MS })
    } finally {
      await this.page.unroute(stream).catch(() => undefined)
    }
    this.conversationChars += question.length
    return alert
  }

  /** B28.81 — presses Retry on a blank last answer — the model is asked afresh — and reads the new answer. */
  async retry(question: string): Promise<Turn> {
    const hold = this.reserve(0)
    const last = this.page.locator('[data-testid="turn-assistant"]').last()
    await last.getByRole('button', { name: 'Retry' }).click()
    return this.finish(question, last, hold)
  }

  /** Presses Regenerate on the last answer — the model is asked afresh — and reads the new answer. */
  async regenerate(question: string): Promise<Turn> {
    const hold = this.reserve(0)
    const last = this.page.locator('[data-testid="turn-assistant"]').last()
    await last.locator('[data-testid="turn-cost"]').evaluate((el) => el.setAttribute('data-e2e-old', '1'))
    await last.getByRole('button', { name: 'Regenerate' }).click()
    return this.finish(question, this.page.locator('[data-testid="turn-assistant"]').last(), hold)
  }

  /**
   * B28.364 — presses "Re-ask with <model>" under the last answer: the question is asked afresh of that model, which the
   * conversation then keeps. Reads the new answer.
   */
  async reaskWith(question: string, displayName: string): Promise<Turn> {
    this.modelName = displayName
    const hold = this.reserve(0)
    const last = this.page.locator('[data-testid="turn-assistant"]').last()
    await last.locator('[data-testid="turn-cost"]').evaluate((el) => el.setAttribute('data-e2e-old', '1'))
    await last.getByRole('button', { name: `Re-ask with ${displayName}` }).click()
    return this.finish(question, this.page.locator('[data-testid="turn-assistant"]').last(), hold)
  }

  private reserve(extraChars: number): Hold {
    const m = this.model()
    const worstIn = worstInputTokens(this.conversationChars + extraChars)
    return this.cap.reserve(listPriceUSD(m, worstIn, CHAT_MAX_OUTPUT_TOKENS))
  }

  private async finish(question: string, turn: Locator, hold: Hold): Promise<Turn> {
    const footer = turn.locator('[data-testid="turn-cost"]:not([data-e2e-old])')
    // The Chat screen's own failure line sits beside the turns (Chat.tsx); nothing else on the page.
    const alert = this.page.locator('ol ~ p[role="alert"]')
    try {
      await footer.or(alert).first().waitFor({ state: 'visible', timeout: ANSWER_TIMEOUT_MS })
    } catch (e) {
      this.cap.settle(hold, undefined)
      if (!(e instanceof Error && e.name === 'TimeoutError')) throw e
      const stalled: Stalled = {
        question,
        box: await this.page.locator('#chat-message').inputValue().catch(() => ''),
        uploading: (await this.page.locator('[data-testid="attachment-uploading"] span').allInnerTexts().catch(() => [])),
        partial: (await turn.count()) > 0 ? (await turn.innerText().catch(() => '')).trim() : undefined,
      }
      throw new Error(noAnswer(stalled, ANSWER_TIMEOUT_MS / 1000))
    }
    if (!(await footer.isVisible())) {
      const error = (await alert.first().innerText()).trim()
      // A refused request may still have reached the provider; count it at its worst.
      this.cap.settle(hold, undefined)
      // B35.8 — the testers' network, not the feature: an ERROR, and an answer the ledger may or may not hold.
      if (networkDrop(error) !== undefined) {
        this.book.lost(this.user.workspaceID)
        throw new NetworkDropped(`the answer to "${question.slice(0, 80)}" was refused for a network drop: ${error}`)
      }
      return { question, answer: '', footerText: '', footer: { kind: 'unreadable', text: error }, costUSD: undefined, error }
    }
    const read = await readAnswered(() => footer.innerText(), () => turn.evaluate((li) => {
      const root = li.firstElementChild
      if (root === null) return ''
      return Array.from(root.children)
        .filter((c) => !c.classList.contains('sr-only') && c.querySelector('[data-testid="turn-cost"]') === null)
        .map((c) => (c as HTMLElement).innerText)
        .join('\n')
        .trim()
    }), (text) => {
      const booked = bookAnswer(this.book, this.user.workspaceID, text, this.catalog, this.usdPerLXC)
      this.cap.settle(hold, booked.costUSD)
      return booked
    })
    this.conversationChars += question.length + read.answer.length
    return { question, answer: read.answer, footerText: read.footerText, footer: read.footer, costUSD: read.costUSD }
  }

  private model(): CatalogModel {
    // B28.363 — Auto may be served by any chat model: the spend cap holds the dearest.
    const m = this.modelName === 'Auto (cheapest good)'
      ? this.catalog.filter((c) => c.output_per_1m > 0).sort((x, y) => y.input_per_1m + y.output_per_1m - x.input_per_1m - x.output_per_1m)[0]
      : this.catalog.find((c) => c.display_name === this.modelName)
    if (m === undefined) throw new Error(`the catalog has no model named "${this.modelName}"`)
    return m
  }
}

/**
 * B25.5 — records what a browser context does for the coverage map: every screen its pages open (by
 * the address, client-side navigations included), every request to the BFF (/api, /auth, and each page
 * load) with its status, its time and the screen that made it, and every uncaught page error. Each is
 * filed under the tag current when it STARTED, so a slow answer is not credited to the next scenario.
 */
function watch(context: BrowserContext, appURL: string, rec: Recorder, tag: () => Tag): void {
  const origin = new URL(appURL).origin
  const started = new WeakMap<Request, { at: number; tag: Tag; from: string }>()
  const bff = (url: URL, req: Request) => url.origin === origin && (/^\/(api|auth)\//.test(url.pathname) || req.isNavigationRequest())
  context.on('request', (req) => {
    let from = ''
    try {
      from = new URL(req.frame().url()).pathname
    } catch {
      // a worker's request has no frame
    }
    started.set(req, { at: Date.now(), tag: { ...tag() }, from })
  })
  const done = (req: Request, status: number) => {
    const url = new URL(req.url())
    const s = started.get(req)
    if (s === undefined || !bff(url, req)) return
    started.delete(req)
    rec.hit(s.tag, { kind: 'bff', method: req.method(), path: url.pathname, status, ms: Date.now() - s.at,
      from: req.isNavigationRequest() ? url.pathname : s.from })
  }
  // B34.5 — at its answer, not once its body is read: a body the page never reads (a revoke's, a restore's) never
  // "finishes", so the request was never recorded and its route read "not covered" though a scenario reached it.
  context.on('response', (res) => done(res.request(), res.status()))
  context.on('requestfailed', (req) => done(req, 0))
  const page = (p: Page) => {
    p.on('framenavigated', (f) => {
      if (f !== p.mainFrame()) return
      const url = new URL(f.url())
      if (url.origin === origin) rec.hit(tag(), { kind: 'screen', method: 'GET', path: url.pathname, status: 200 })
    })
    p.on('pageerror', (e) => {
      let where = ''
      try {
        where = new URL(p.url()).pathname
      } catch {
        // a page closing as it errs
      }
      rec.pageError(tag(), where, e.message)
    })
  }
  context.on('page', page)
}
