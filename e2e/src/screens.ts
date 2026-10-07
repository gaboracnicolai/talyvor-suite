// B17.8 — the screens past Chat, driven the way a person uses them: the Features page's switches,
// choices and spending limit (apps/web/src/areas/lens/Features.tsx), and the two Try-it pages
// (TryIt.tsx). Every read is of what the screen shows, which is what Lens recorded. Each opens in a
// second tab (AppUser.tab), so the Chat tab keeps its conversation.

import { readFile } from 'node:fs/promises'
import type { Locator, Page } from 'playwright'
import type { AppUser, Attachment } from './app.ts'

const SAVE_TIMEOUT_MS = 15_000

export type LoggingPolicy = 'full' | 'metadata' | 'none'

export class FeaturesScreen {
  readonly page: Page

  private constructor(page: Page) {
    this.page = page
  }

  /** Features, in a tab of its own, once the workspace's settings have been read. */
  static async open(app: AppUser): Promise<FeaturesScreen> {
    const f = new FeaturesScreen(await app.tab('/features'))
    await f.settle()
    return f
  }

  /** Reloads the page: what shows afterwards is what Lens kept. */
  async reload(): Promise<void> {
    await this.page.reload()
    await this.settle()
  }

  async close(): Promise<void> {
    await this.page.close()
  }

  private async settle(): Promise<void> {
    await this.page.getByTestId('state-Tare').waitFor({ state: 'visible' })
    await this.page.waitForFunction(() => {
      const s = document.querySelector('[data-testid="state-Tare"]')?.textContent ?? ''
      return s !== '' && s !== 'Checking…'
    })
  }

  async state(name: string): Promise<string> {
    return (await this.page.getByTestId(`state-${name}`).innerText()).trim()
  }

  /** The row's "See it working" line, once its figures have been read. */
  async evidence(name: string): Promise<string> {
    const el = this.page.getByTestId(`evidence-${name}`)
    for (let i = 0; i < 50 && /Reading…/.test(await el.innerText()); i++) await this.page.waitForTimeout(100)
    return (await el.innerText()).replace(/^See it working:\s*/, '').trim()
  }

  /** Whether the row's switch is on; undefined when the row shows no switch. */
  async isOn(name: string): Promise<boolean | undefined> {
    const page = this.page
    if (await page.locator(`[aria-label="${name}: turn off"]`).isVisible()) return true
    if (await page.locator(`[aria-label="${name}: turn on"]`).isVisible()) return false
    return undefined
  }

  /**
   * Flips the row's switch to `on` and waits for the screen to show what Lens recorded. Answers
   * undefined when it did, or why not.
   */
  async set(name: string, on: boolean): Promise<string | undefined> {
    const page = this.page
    const now = await this.isOn(name)
    if (now === undefined) return `no switch (the row reads "${await this.state(name)}")`
    if (now === on) return undefined
    await page.locator(`[aria-label="${name}: turn ${on ? 'on' : 'off'}"]`).click()
    return this.settled(this.row(name), page.locator(`[aria-label="${name}: turn ${on ? 'off' : 'on'}"]`))
  }

  /** Chooses how much Lens keeps of each request. */
  async setLogging(policy: LoggingPolicy): Promise<string | undefined> {
    const select = this.page.locator('select[aria-label="Request logging"]')
    if (!(await select.isVisible())) return `no choice (the row reads "${await this.state('Request logging')}")`
    if ((await select.inputValue()) === policy) return undefined
    await select.selectOption(policy)
    return this.settled(this.row('Request logging'), this.page.locator(`select[aria-label="Request logging"]:not([disabled])`), async () =>
      (await select.inputValue()) === policy)
  }

  async logging(): Promise<LoggingPolicy | undefined> {
    const select = this.page.locator('select[aria-label="Request logging"]')
    return (await select.isVisible()) ? ((await select.inputValue()) as LoggingPolicy) : undefined
  }

  /** Sets the spending limit (dollars a month) with Set or Save; its enforcement is left as it is. */
  async setLimit(usd: number): Promise<string | undefined> {
    const page = this.page
    const row = this.row('Spending limit')
    const before = await this.state('Spending limit')
    await row.locator('input[aria-label^="Limit in dollars"]').fill(String(usd))
    await row.getByRole('button', { name: /^(Set|Save)$/ }).click()
    return this.settled(row, page.getByTestId('state-Spending limit'), async () => (await this.state('Spending limit')) !== before)
  }

  private row(name: string): Locator {
    const page = this.page
    return page.locator('li').filter({ has: page.getByRole('heading', { name, exact: true }) })
  }

  /** Waits until `done` shows, or the row says it was not saved. */
  private async settled(row: Locator, done: Locator, check?: () => Promise<boolean>): Promise<string | undefined> {
    const deadline = Date.now() + SAVE_TIMEOUT_MS
    while (Date.now() < deadline) {
      const saving = await row.getByText('Saving…').isVisible()
      if (!saving && (await done.first().isVisible()) && (check === undefined || (await check()))) return undefined
      const failed = row.getByText(/^Not saved/)
      if (await failed.isVisible()) return (await failed.innerText()).trim()
      await this.page.waitForTimeout(100)
    }
    return `the screen did not show the change within ${SAVE_TIMEOUT_MS / 1000} s`
  }
}

export interface TareResult {
  kind: 'reduced' | 'refused' | 'error'
  /** The sentence above the reduced text: "About X tokens become Y — Z fewer (estimated)." */
  summary: string
  reduced: string
  /** B27.37 — the page says the prose model did the shortening. */
  byProseModel?: boolean
}

/** Features → Try it on your own content: runs Tare on pasted content and reads what it would send. */
export async function tryTare(app: AppUser, content: string, kind: '' | 'json' | 'code' | 'log' | 'prose'): Promise<TareResult> {
  const page = await app.tab('/features/try/tare')
  try {
    return await runTare(page, content, kind)
  } finally {
    await page.close()
  }
}

async function runTare(page: Page, content: string, kind: string): Promise<TareResult> {
  await page.locator('#tare-content').fill(content)
  await page.getByLabel('What it is').selectOption(kind)
  await page.getByRole('button', { name: 'Run Tare' }).click()
  const reduced = page.getByTestId('tare-reduced')
  const refused = page.getByTestId('tare-refused')
  const alert = page.locator('p[role="alert"]')
  await reduced.or(refused).or(alert).first().waitFor({ state: 'visible', timeout: 60_000 })
  if (await reduced.isVisible()) {
    return {
      kind: 'reduced',
      summary: (await reduced.locator('p').first().innerText()).trim(),
      reduced: await reduced.locator('pre').innerText(),
      byProseModel: await page.getByTestId('tare-model-ran').isVisible(),
    }
  }
  if (await refused.isVisible()) return { kind: 'refused', summary: (await refused.innerText()).trim(), reduced: '' }
  return { kind: 'error', summary: (await alert.first().innerText()).trim(), reduced: '' }
}

export interface ConversionResult {
  kind: 'converted' | 'vision' | 'error'
  summary: string
  markdown: string
  /** What "Download as Markdown" saved, when it was pressed. */
  downloaded?: { name: string; text: string }
}

/** Features → Try it on a document: converts a file and, when it converted, downloads the Markdown. */
export async function tryConversion(app: AppUser, file: Attachment): Promise<ConversionResult> {
  const page = await app.tab('/features/try/conversion')
  try {
    return await runConversion(page, file)
  } finally {
    await page.close()
  }
}

async function runConversion(page: Page, file: Attachment): Promise<ConversionResult> {
  await page.locator('input[type="file"][aria-label="Document"]').setInputFiles(file)
  await page.getByRole('button', { name: 'Convert' }).click()
  const result = page.getByTestId('conversion-result')
  const vision = page.getByTestId('conversion-vision')
  const alert = page.locator('p[role="alert"]')
  await result.or(vision).or(alert).first().waitFor({ state: 'visible', timeout: 60_000 })
  if (await vision.isVisible()) return { kind: 'vision', summary: (await vision.innerText()).trim(), markdown: '' }
  if (!(await result.isVisible())) return { kind: 'error', summary: (await alert.first().innerText()).trim(), markdown: '' }
  const summary = (await result.locator('p').first().innerText()).trim()
  const markdown = await result.locator('pre').innerText()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    result.getByRole('button', { name: 'Download as Markdown' }).click(),
  ])
  const path = await download.path()
  return { kind: 'converted', summary, markdown, downloaded: { name: download.suggestedFilename(), text: await readFile(path, 'utf8') } }
}

const AI_TIMEOUT_MS = 120_000

/** A card by its heading (packages/ui Card: the h2 sits in the header, the header in the card). */
function card(page: Page, heading: string): Locator {
  return page.getByRole('heading', { name: heading, exact: true }).locator('xpath=../..')
}

/**
 * Whether a Docs or Track AI card still shows its pending label. Docs Ask's is a bare "Asking…"
 * (AskAI.tsx): a pattern that wanted "Asking " plus a space read it as the answer, so a slow Ask was
 * recorded as "no answer" while it was still being asked (B17.39, user 215).
 */
export function stillAsking(text: string): boolean {
  return /Asking(?: Track| Docs)?…|Summarising…|Translating…|Suggesting…/.test(text)
}

/**
 * Presses a card's button and waits until the card has answered — no longer "Asking…" and no longer
 * what it said before — then reads it.
 */
async function answerOf(page: Page, heading: string, button: string): Promise<string> {
  const c = card(page, heading)
  const before = await c.innerText()
  await c.getByRole('button', { name: button, exact: true }).click()
  const deadline = Date.now() + AI_TIMEOUT_MS
  while (Date.now() < deadline) {
    const now = await c.innerText()
    if (now !== before && !stillAsking(now)) return now
    await page.waitForTimeout(250)
  }
  throw new Error(`"${heading}" gave no answer within ${AI_TIMEOUT_MS / 1000} s`)
}

/** The model-written text a Docs or Track card shows, or undefined. */
async function writtenIn(page: Page, heading: string): Promise<string | undefined> {
  const p = card(page, heading).locator('p.whitespace-pre-wrap')
  return (await p.count()) > 0 ? (await p.first().innerText()).trim() : undefined
}

/** A Docs page this user wrote through the app: a new space, a new page, the text typed and saved. */
export class DocsPage {
  readonly page: Page

  private constructor(page: Page) {
    this.page = page
  }

  static async write(app: AppUser, space: string, title: string, text: string): Promise<DocsPage> {
    const page = await app.tab('/docs')
    await page.getByLabel('Space name').fill(space)
    await page.getByRole('button', { name: 'Create space' }).click()
    await page.getByRole('link', { name: `Open space ${space}` }).click()
    await page.getByLabel('Page title').fill(title)
    await page.getByRole('button', { name: 'Create page' }).click()
    await page.getByRole('link', { name: title, exact: true }).first().click()
    await page.getByRole('textbox', { name: 'Content' }).click()
    await page.keyboard.type(text)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor()
    await page.getByRole('button', { name: 'Summarise this page' }).waitFor()
    return new DocsPage(page)
  }

  async summarise(): Promise<{ text?: string; shown: string }> {
    const shown = await answerOf(this.page, 'Summary', 'Summarise this page')
    return { text: await writtenIn(this.page, 'Summary'), shown }
  }

  async translate(language: string): Promise<{ text?: string; shown: string }> {
    await this.page.locator('#translate-language').fill(language)
    const shown = await answerOf(this.page, 'Translation', 'Translate this page')
    return { text: await writtenIn(this.page, 'Translation'), shown }
  }

  /**
   * Asks the documentation from this page's Ask card: the answer, and the titles it cites. The page is
   * reloaded first, so a second ask is read from an empty card rather than the first one's answer.
   */
  async ask(question: string): Promise<{ text?: string; sources: string[]; shown: string }> {
    await this.page.reload()
    const c = card(this.page, 'Ask the documentation')
    await c.getByLabel('Question').fill(question)
    const shown = await answerOf(this.page, 'Ask the documentation', 'Ask')
    const sources = /Sources/.test(shown) ? (await c.locator('ul li').allInnerTexts()).map((s) => s.trim()) : []
    return { text: await writtenIn(this.page, 'Ask the documentation'), sources, shown }
  }

  /** B29.31 — presses Export as HTML beside Pin: the file Docs names after the page, and its text. */
  async exportHTML(): Promise<{ name: string; text: string }> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: SAVE_TIMEOUT_MS }),
      this.page.getByRole('button', { name: 'Export as HTML', exact: true }).click(),
    ])
    return { name: download.suggestedFilename(), text: await readFile(await download.path(), 'utf8') }
  }

  async close(): Promise<void> {
    await this.page.close()
  }
}

/** Track's issue list, in a tab: create issues, open one, and export what is listed. */
export class TrackScreen {
  readonly page: Page

  private constructor(page: Page) {
    this.page = page
  }

  static async open(app: AppUser): Promise<TrackScreen> {
    const page = await app.tab('/track')
    await page.locator('#new-issue-title').waitFor()
    return new TrackScreen(page)
  }

  async create(title: string): Promise<void> {
    await this.page.locator('#new-issue-title').fill(title)
    await this.page.getByRole('button', { name: 'Create issue' }).click()
    await this.page.getByRole('link', { name: title, exact: true }).waitFor()
  }

  /**
   * B28.444 — types a title key by key and presses Enter, never the button, as a person filing in a hurry
   * does. How many rows the list then shows under that title (0 when none came within the timeout), and
   * what the title field holds once one does.
   */
  async createWithEnter(title: string): Promise<{ listed: number; field: string }> {
    const field = this.page.locator('#new-issue-title')
    await field.pressSequentially(title)
    await field.press('Enter')
    const row = this.page.getByRole('link', { name: title, exact: true })
    const shown = await row.first().waitFor({ timeout: SAVE_TIMEOUT_MS }).then(() => true, () => false)
    if (shown) await this.page.waitForFunction(() => (document.getElementById('new-issue-title') as HTMLInputElement | null)?.value === '', undefined, { timeout: 2_000 }).catch(() => {})
    return { listed: shown ? await row.count() : 0, field: await field.inputValue() }
  }

  async openIssue(title: string): Promise<void> {
    await this.page.getByRole('link', { name: title, exact: true }).click()
    await this.page.locator('#new-comment').waitFor()
  }

  async comment(body: string): Promise<void> {
    await this.page.locator('#new-comment').fill(body)
    await this.page.getByRole('button', { name: 'Comment', exact: true }).click()
    await this.page.locator('li p').filter({ hasText: body }).first().waitFor()
  }

  async summarise(): Promise<{ text?: string; shown: string }> {
    const shown = await answerOf(this.page, 'AI summary', 'Summarise the thread')
    return { text: await writtenIn(this.page, 'AI summary'), shown }
  }

  /** The candidates "Look for duplicates" lists, each as its row reads; reloaded first, as ask is. */
  async duplicates(): Promise<{ rows: string[]; shown: string }> {
    await this.page.reload()
    await this.page.locator('#new-comment').waitFor()
    const shown = await answerOf(this.page, 'Possible duplicates', 'Look for duplicates')
    return { rows: (await card(this.page, 'Possible duplicates').locator('ul li').allInnerTexts()).map((s) => s.trim()), shown }
  }

  async triage(): Promise<{ priority?: string; shown: string }> {
    const shown = await answerOf(this.page, 'Triage suggestion', 'Ask for a triage suggestion')
    const dd = card(this.page, 'Triage suggestion').locator('dt:text-is("Suggested priority") + dd')
    return { priority: (await dd.count()) > 0 ? (await dd.innerText()).trim() : undefined, shown }
  }

  /** Presses an export button on the list and reads the file it saved, and the line it wrote. */
  async export(format: 'CSV' | 'JSON'): Promise<{ name: string; text: string; status: string }> {
    await this.page.goto(new URL('/track', this.page.url()).toString())
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.page.getByRole('button', { name: format, exact: true }).click(),
    ])
    const status = this.page.getByRole('status').filter({ hasText: /^Exported|^Couldn’t/ })
    await status.waitFor()
    return { name: download.suggestedFilename(), text: await readFile(await download.path(), 'utf8'), status: (await status.innerText()).trim() }
  }

  async close(): Promise<void> {
    await this.page.close()
  }
}

// ─── B17.10 — Plans, paid on Stripe's own checkout with a test card ─────────────────────────────────

const CHECKOUT_TIMEOUT_MS = 60_000
/** Stripe's test card that always succeeds; any future expiry and any CVC go with it. */
const TEST_CARD = '4242 4242 4242 4242'

export interface Subscribed {
  /** Why Plans never sent the browser to Stripe, or why it never came back: the screen's words. */
  refused?: string
  /** Where the checkout was: Stripe's host (checkout.stripe.com), or the stub's in the self-test. */
  checkout?: string
  /** What the app says once Stripe sends the browser back. */
  heading?: string
}

/**
 * On Plans (apps/web/src/areas/lens/Plans.tsx), chooses `plan` as a person does, pays on Stripe's hosted
 * checkout with test card 4242, and follows Stripe back to the app. The app then shows the plan once
 * Stripe's webhook has reached Lens (BillingReturn.tsx).
 */
export async function subscribeWithTestCard(app: AppUser, plan: string, email: string): Promise<Subscribed> {
  const page = await app.tab('/plans')
  try {
    const appOrigin = new URL(page.url()).origin
    const choose = page.getByRole('button', { name: `Choose ${plan}`, exact: true })
    const notForSale = page.getByText('Plans aren’t on sale on this deployment yet.')
    await choose.or(notForSale).first().waitFor({ state: 'visible', timeout: SAVE_TIMEOUT_MS })
    if (await notForSale.isVisible()) return { refused: (await notForSale.innerText()).trim() }

    await choose.click()
    const failure = page.locator('p[role="status"]')
    const went = await Promise.race([
      page.waitForURL((u) => u.origin !== appOrigin, { timeout: CHECKOUT_TIMEOUT_MS }).then(() => 'stripe' as const),
      failure.first().waitFor({ state: 'visible', timeout: CHECKOUT_TIMEOUT_MS }).then(() => 'refused' as const),
    ].map((p) => p.catch(() => 'nothing' as const)))
    if (went === 'refused') return { refused: (await failure.first().innerText()).trim() }
    if (went === 'nothing') return { refused: `Choose ${plan} neither left for Stripe nor said why within ${CHECKOUT_TIMEOUT_MS / 1000} s` }

    const checkout = new URL(page.url()).host
    await payWithTestCard(page, email)
    const back = await page.waitForURL((u) => u.origin === appOrigin, { timeout: CHECKOUT_TIMEOUT_MS }).then(() => true, () => false)
    if (!back) return { checkout, refused: `paid on ${checkout} and Stripe never sent the browser back: ${(await page.locator('body').innerText()).slice(0, 200)}` }
    const on = page.getByRole('heading', { name: `You’re on ${plan}.` })
    await on.waitFor({ state: 'visible', timeout: CHECKOUT_TIMEOUT_MS }).catch(() => undefined)
    // The screen's first region heading (Region.tsx): the plan, or why it is not confirmed yet.
    return { checkout, heading: (await page.getByRole('heading', { level: 2 }).first().innerText()).trim() }
  } finally {
    await page.close()
  }
}

/**
 * B32.71 — pays a checkout Lens opened itself (POST …/billing/subscribe) with test card 4242 and follows Stripe
 * back to the app, for a plan Plans offers no button for yet.
 */
export async function payCheckout(app: AppUser, url: string, email: string): Promise<Subscribed> {
  const page = await app.tab('/billing')
  try {
    const appOrigin = new URL(page.url()).origin
    await page.goto(url)
    const checkout = new URL(page.url()).host
    await payWithTestCard(page, email)
    const back = await page.waitForURL((u) => u.origin === appOrigin, { timeout: CHECKOUT_TIMEOUT_MS }).then(() => true, () => false)
    if (!back) return { checkout, refused: `paid on ${checkout} and Stripe never sent the browser back: ${(await page.locator('body').innerText()).slice(0, 200)}` }
    return { checkout }
  } finally {
    await page.close()
  }
}

// ─── B26.17 — cancelling and resuming the plan on Billing ──────────────────────────────────────────

const CANCEL = 'Cancel at the end of this period'
const RESUME = 'Resume my plan'

/**
 * Billing's plan card (apps/web/src/areas/lens/Plan.tsx, PlanRenewal), in one tab as a person keeps it
 * open: the card answers each press with Stripe's state at once, while a fresh read of Lens's catches up
 * only when Stripe's webhook arrives.
 */
export class BillingPlanCard {
  private readonly page: Page

  private constructor(page: Page) {
    this.page = page
  }

  static async open(app: AppUser): Promise<BillingPlanCard> {
    return new BillingPlanCard(await app.tab('/billing'))
  }

  /** The card's sentence: whether the plan renews or ends, and when — or undefined when it draws none. */
  async sentence(): Promise<string | undefined> {
    const renewal = this.page.getByTestId('plan-renewal')
    return (await renewal.waitFor({ state: 'visible', timeout: SAVE_TIMEOUT_MS }).then(() => true, () => false))
      ? (await renewal.innerText()).trim()
      : undefined
  }

  /** Presses Cancel or Resume and waits for the other to take its place: the sentence after, or why not. */
  async press(button: 'cancel' | 'resume'): Promise<{ after?: string; refused?: string }> {
    const [press, next] = button === 'cancel' ? [CANCEL, RESUME] : [RESUME, CANCEL]
    const pressable = this.page.getByRole('button', { name: press, exact: true })
    const opposite = this.page.getByRole('button', { name: next, exact: true })
    const shown = await pressable.or(opposite).first().waitFor({ state: 'visible', timeout: SAVE_TIMEOUT_MS }).then(() => true, () => false)
    if (!shown) return { refused: `Billing shows neither "${CANCEL}" nor "${RESUME}"` }
    if (!(await pressable.isVisible())) return { refused: `Billing offers "${next}", not "${press}": "${await this.sentence()}"` }
    await pressable.click()
    const turned = await opposite.waitFor({ state: 'visible', timeout: SAVE_TIMEOUT_MS }).then(() => true, () => false)
    if (turned) return { after: await this.sentence() }
    const alert = this.page.getByRole('alert')
    return { refused: (await alert.isVisible()) ? (await alert.innerText()).trim() : `"${press}" never turned into "${next}"` }
  }

  async reload(): Promise<void> {
    await this.page.reload()
  }

  async close(): Promise<void> {
    await this.page.close()
  }
}

/** Fills Stripe's hosted checkout (checkout.stripe.com) with the test card and submits it. */
async function payWithTestCard(page: Page, email: string): Promise<void> {
  const card = page.locator('#cardNumber')
  const cardChoice = page.locator('[data-testid="card-accordion-item-button"]')
  // B34.8 — a one-off payment lists its methods as rows, and the row's button is a hidden overlay over "Card": the row
  // is what shows, and a click on it lands on the overlay.
  const cardRow = page.locator('#payment-method-label-card')
  await card.or(cardChoice).or(cardRow).first().waitFor({ state: 'visible', timeout: CHECKOUT_TIMEOUT_MS })
  if (!(await card.isVisible())) await ((await cardChoice.isVisible()) ? cardChoice.click() : cardRow.click({ force: true }))
  const fillIfShown = async (l: Locator, v: string) => {
    if ((await l.isVisible()) && (await l.isEditable()) && (await l.inputValue()) === '') await l.fill(v)
  }
  await fillIfShown(page.locator('#email'), email)
  await card.fill(TEST_CARD)
  await page.locator('#cardExpiry').fill('12 / 34')
  await page.locator('#cardCvc').fill('123')
  await fillIfShown(page.locator('#billingName'), 'Talyvor Tester')
  const country = page.locator('#billingCountry')
  if (await country.isVisible()) await country.selectOption('US')
  await fillIfShown(page.locator('#billingPostalCode'), '10001')
  // Link would ask for a phone number: it stays off.
  const link = page.locator('#enableStripePass')
  if ((await link.isVisible()) && (await link.isChecked())) await link.uncheck()
  await page.locator('[data-testid="hosted-payment-submit-button"]').click()
}
