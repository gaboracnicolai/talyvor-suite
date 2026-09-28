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
  private readonly page: Page

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
}

/** Features → Try it on your own content: runs Tare on pasted content and reads what it would send. */
export async function tryTare(app: AppUser, content: string, kind: '' | 'json' | 'code' | 'log'): Promise<TareResult> {
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
    return { kind: 'reduced', summary: (await reduced.locator('p').first().innerText()).trim(), reduced: await reduced.locator('pre').innerText() }
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
