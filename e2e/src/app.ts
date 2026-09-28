// B17.3 — a synthetic user driving the real web app in a headless browser: sign in through the BFF's
// POST /auth/synthetic (B17.2), then use Chat the way a person does — type, press Enter, read the
// answer and the line under it. Every question reserves its worst case against the spend cap first.

import type { Browser, BrowserContext, Locator, Page } from 'playwright'
import { type Hold, type SpendCap, worstInputTokens } from './budget.ts'
import type { SyntheticUser } from './lens.ts'
import { type CatalogModel, type Footer, listPriceUSD, parseFooter } from './oracles.ts'

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

  add(workspaceID: string, ulxc: number, slack = 0): void {
    const c = this.of(workspaceID)
    this.charged.set(workspaceID, { count: c.count + 1, ulxc: c.ulxc + ulxc, slack: c.slack + slack })
  }

  of(workspaceID: string): Charged {
    return this.charged.get(workspaceID) ?? { count: 0, ulxc: 0, slack: 0 }
  }
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
  private modelName: string
  /** Characters of the open conversation, for the worst-case input estimate. */
  private conversationChars = 0

  private constructor(user: SyntheticUser, context: BrowserContext, page: Page, appURL: string, cap: SpendCap,
    catalog: CatalogModel[], modelName: string, book: ChargeBook, usdPerLXC: number) {
    this.user = user
    this.context = context
    this.page = page
    this.appURL = appURL
    this.cap = cap
    this.catalog = catalog
    this.modelName = modelName
    this.book = book
    this.usdPerLXC = usdPerLXC
  }

  get modelNameInUse(): string {
    return this.modelName
  }

  /** A fresh browser context signed in as `user`, on the Chat screen with `modelName` chosen. */
  static async signIn(browser: Browser, user: SyntheticUser, opts: {
    appURL: string; syntheticKey: string; cap: SpendCap; catalog: CatalogModel[]; modelName: string; book: ChargeBook
    usdPerLXC: number
  }): Promise<AppUser> {
    const context = await browser.newContext()
    const page = await context.newPage()
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
    if (status !== 200) {
      await context.close()
      throw new SignInRefused(`POST /auth/synthetic answered ${status} for ${user.workspaceID}`)
    }
    const app = new AppUser(user, context, page, opts.appURL, opts.cap, opts.catalog, opts.modelName, opts.book, opts.usdPerLXC)
    await app.openChat()
    if (!(await app.chooseModel(opts.modelName))) throw new Error(`the model picker does not offer "${opts.modelName}"`)
    return app
  }

  async close(): Promise<void> {
    await this.context.close()
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
    const page = await this.context.newPage()
    await page.goto(this.appURL + path)
    return page
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
   * `lengths`, the answer's visible length is sampled every 40 ms while it arrives; with `files`, they
   * are attached first, as Attach does.
   */
  async ask(question: string, lengths?: number[], files: Attachment[] = []): Promise<Turn> {
    // A document is read as input: its whole size counts toward the worst case.
    const hold = this.reserve(question.length + files.reduce((n, f) => n + f.buffer.length, 0))
    const before = await this.page.locator('[data-testid="turn-assistant"]').count()
    if (files.length > 0) {
      await this.page.locator('#chat-attach').setInputFiles(files)
      await this.page.getByRole('list', { name: 'Attached documents' }).waitFor({ state: 'visible' })
    }
    await this.page.locator('#chat-message').fill(question)
    await this.page.locator('#chat-message').press('Enter')
    const turn = this.page.locator('[data-testid="turn-assistant"]').nth(before)
    if (lengths !== undefined) void this.sample(turn, lengths)
    return this.finish(question, turn, hold)
  }

  /** Records the answer's text length until its footer appears. */
  private async sample(turn: Locator, lengths: number[]): Promise<void> {
    const deadline = Date.now() + ANSWER_TIMEOUT_MS
    while (Date.now() < deadline) {
      const state = await turn.evaluate((li) => ({
        len: (li.textContent ?? '').length,
        done: li.querySelector('[data-testid="turn-cost"]') !== null,
      })).catch(() => ({ len: 0, done: false }))
      if (state.done) return
      if (lengths[lengths.length - 1] !== state.len) lengths.push(state.len)
      await new Promise((r) => setTimeout(r, 40))
    }
  }

  /** Presses Regenerate on the last answer — the model is asked afresh — and reads the new answer. */
  async regenerate(question: string): Promise<Turn> {
    const hold = this.reserve(0)
    const last = this.page.locator('[data-testid="turn-assistant"]').last()
    await last.locator('[data-testid="turn-cost"]').evaluate((el) => el.setAttribute('data-e2e-old', '1'))
    await last.getByRole('button', { name: 'Regenerate' }).click()
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
      throw e
    }
    if (!(await footer.isVisible())) {
      const error = (await alert.first().innerText()).trim()
      // A refused request may still have reached the provider; count it at its worst.
      this.cap.settle(hold, undefined)
      return { question, answer: '', footerText: '', footer: { kind: 'unreadable', text: error }, costUSD: undefined, error }
    }
    const footerText = (await footer.innerText()).trim()
    const answer = await turn.evaluate((li) => {
      const root = li.firstElementChild
      if (root === null) return ''
      return Array.from(root.children)
        .filter((c) => !c.classList.contains('sr-only') && c.querySelector('[data-testid="turn-cost"]') === null)
        .map((c) => (c as HTMLElement).innerText)
        .join('\n')
        .trim()
    })
    const parsed = parseFooter(footerText)
    let costUSD: number | undefined
    if (parsed.kind === 'priced') {
      const m = this.catalog.find((c) => c.display_name === parsed.model)
      costUSD = m === undefined ? undefined : listPriceUSD(m, parsed.inputTokens, parsed.outputTokens)
      // A model the catalog does not name cannot be priced: its charge is anyone's guess.
      this.book.add(this.user.workspaceID, costUSD === undefined ? 0 : chargeULXC(costUSD, this.usdPerLXC),
        costUSD === undefined ? Number.POSITIVE_INFINITY : 0)
    } else if (parsed.kind === 'cache') {
      costUSD = 0
    } else if (parsed.kind === 'pool') {
      // Lens states a shared answer's charge in credits, shown to two significant figures.
      costUSD = parsed.figure * this.usdPerLXC
      this.book.add(this.user.workspaceID, parsed.figure * 1e6, parsed.figure * 1e6 * 0.05 + 1)
    }
    this.cap.settle(hold, costUSD)
    this.conversationChars += question.length + answer.length
    return { question, answer, footerText, footer: parsed, costUSD }
  }

  private model(): CatalogModel {
    const m = this.catalog.find((c) => c.display_name === this.modelName)
    if (m === undefined) throw new Error(`the catalog has no model named "${this.modelName}"`)
    return m
  }
}
