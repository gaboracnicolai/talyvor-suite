// B17.6 — catalog v3: the Agent Bank (B19) and the marketplace (B20), used the way a company uses them.
// A person works the screens — Agent Wallets (/agents), Publish, a listing's page, Your bill — and each
// agent acts with its own key, straight to Lens, as an agent does. Every oracle is read back from Lens:
// the agents' book, their postings, the approvals, the marketplace bill and the seller's earnings, and
// the workspace's own ledger.

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { type AppUser, chargeULXC } from './app.ts'
import { worstInputTokens } from './budget.ts'
import type { Agent, AgentBook, AgentLine, Answered, JudgeReply, SyntheticUser } from './lens.ts'
import { listPriceUSD, seeded, statesNumber } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'

export const ACTION_TIMEOUT_MS = 30_000
/** An agent's questions are one number long. */
const AGENT_MAX_TOKENS = 16
/** A listing's use: Lens runs it with the most output a chat answer may produce. */
const USE_MAX_TOKENS = 4096
const NUMBER_ONLY = 'Reply with the number only.'
/** µLXC per µUSD: LXC is pegged at $0.10 (talyvor-lens market.ulxcPerUSDMicro). */
const ULXC_PER_USD_MICRO = 10

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const lxcText = (ulxc: number): string => String(ulxc / 1e6)

/** B28.22 — what the wallet screens show beside an LXC amount, in dollars at the peg: "($1.25)" (apps/web money.tsx). */
export function usdShown(ulxc: number, usdPerLXC: number): string {
  const usd = (ulxc / 1e6) * usdPerLXC
  const fmt = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `(${usd > 0 && usd < 0.005 ? `<${fmt(0.01)}` : fmt(usd)})`
}

/** The card under an `h2` heading (packages/ui CardHeader). */
export function card(page: Page, heading: string): Locator {
  return page.getByRole('heading', { name: heading, exact: true }).locator('xpath=../..')
}

/** Waits for `done`, or for a refusal inside `scope`; answers undefined, or the refusal's words. */
async function outcome(done: Locator, scope: Locator): Promise<string | undefined> {
  const refused = scope.getByRole('alert')
  await done.or(refused).first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
  return (await done.first().isVisible()) ? undefined : (await refused.first().innerText()).trim()
}

/** Agent Wallets (apps/web/src/areas/lens/AgentBank.tsx), in a tab of its own. */
export class AgentBankScreen {
  readonly page: Page

  private constructor(page: Page) {
    this.page = page
  }

  static async open(app: AppUser): Promise<AgentBankScreen> {
    const s = new AgentBankScreen(await app.tab('/agents'))
    await s.page.getByTestId('agent-bank-totals').waitFor()
    return s
  }

  async close(): Promise<void> {
    await this.page.close()
  }

  async totals(): Promise<string> {
    return (await this.page.getByTestId('agent-bank-totals').innerText()).trim()
  }

  /** Creates an agent by name; the screen opens it. */
  async create(name: string): Promise<string | undefined> {
    const form = this.page.locator('form').filter({ has: this.page.getByLabel('New agent name') })
    await this.page.getByLabel('New agent name').fill(name)
    await form.getByRole('button', { name: 'Create agent' }).click()
    return outcome(this.page.getByTestId('agent-open').filter({ hasText: new RegExp(`^${esc(name)}$`) }), form)
  }

  /**
   * The screen as Lens has it now, with `agent` open. Every action starts here, so no note an earlier
   * action left on the screen can be read as this one's answer.
   */
  private async fresh(agent?: Agent): Promise<void> {
    await this.page.reload()
    await this.page.getByTestId('agent-bank-totals').waitFor()
    if (agent === undefined) return
    const open = this.page.getByTestId('agent-open').filter({ hasText: new RegExp(`^${esc(agent.name)}$`) })
    if (await open.isVisible()) return
    await this.page.getByTestId(`agent-balance-${agent.id}`).locator('xpath=..').getByRole('button', { name: /^(Manage|Open)$/ }).click()
    await open.waitFor()
  }

  /** Funds the agent from the workspace, or takes LXC back, as Money does. */
  async move(agent: Agent, ulxc: number, how: 'Fund' | 'Take back'): Promise<string | undefined> {
    await this.fresh(agent)
    const money = card(this.page, 'Money')
    await money.getByLabel(`Amount in LXC for ${agent.name}`).fill(lxcText(ulxc))
    await money.getByRole('button', { name: how, exact: true }).click()
    return outcome(money.getByRole('status').filter({ hasText: `${agent.name} now holds` }), money)
  }

  /** Sets one of the agent's limits (the label the Rules card gives it) and saves its rules. */
  async setLimit(agent: Agent, label: string, ulxc: number): Promise<string | undefined> {
    await this.fresh(agent)
    const box = this.page.getByLabel(`${label} for ${agent.name}, in LXC`)
    await box.waitFor()
    await box.fill(lxcText(ulxc))
    const form = this.page.locator('form').filter({ has: box })
    await form.getByRole('button', { name: 'Save rules' }).click()
    return outcome(form.getByRole('status').filter({ hasText: /^Saved\./ }), form)
  }

  /** Issues the agent a key and reads it off the card that shows it once. */
  async issueKey(agent: Agent): Promise<string> {
    await this.fresh(agent)
    await card(this.page, 'Key').getByRole('button', { name: 'Issue a key', exact: true }).click()
    const shown = card(this.page, `${agent.name}’s key — shown once`)
    await shown.waitFor({ timeout: ACTION_TIMEOUT_MS })
    const key = (await shown.locator('.select-all').innerText()).trim()
    await shown.getByRole('button', { name: 'Done — I stored it' }).click()
    return key
  }

  async pauseAll(reason: string): Promise<string | undefined> {
    await this.fresh()
    await this.page.getByLabel('Why every agent is paused').fill(reason)
    await this.page.getByRole('button', { name: 'Pause every agent' }).click()
    return outcome(this.page.getByTestId('agents-all-paused'), this.page.locator('body'))
  }

  async resumeAll(): Promise<string | undefined> {
    await this.fresh()
    await this.page.getByRole('button', { name: 'Start every agent again' }).click()
    return outcome(this.page.getByRole('button', { name: 'Pause every agent' }), this.page.locator('body'))
  }

  /** Pays `to` from `from` on Pay another agent; answers the line the card then shows. */
  async pay(from: Agent, to: Agent, ulxc: number, memo: string): Promise<string> {
    await this.fresh(from)
    const c = card(this.page, 'Pay another agent')
    await c.getByRole('group', { name: 'Pay to' }).getByRole('button', { name: to.name, exact: true }).click()
    await c.getByLabel(`Payment in LXC from ${from.name}`).fill(lxcText(ulxc))
    await c.getByLabel('What the payment is for').fill(memo)
    await c.getByRole('button', { name: 'Pay', exact: true }).click()
    const said = c.getByRole('status').or(c.getByRole('alert')).first()
    await said.waitFor({ timeout: ACTION_TIMEOUT_MS })
    return (await said.innerText()).trim()
  }

  /**
   * Approves `agent`'s payment to `payee` in Approvals; the row's words, then the line the screen shows. The
   * row reads "<agent> wants to pay <payee> <amount> — <memo>" (B23.10). Not after a reload: a payment this
   * screen sent is sent again on Approve only by the screen that sent it.
   */
  async approve(agent: Agent, payee: Agent): Promise<{ row: string; said: string }> {
    const waiting = card(this.page, 'Waiting for a person')
    const asks = `${agent.name} wants to pay ${payee.name} `
    const label = waiting.getByText(asks).first()
    try {
      await label.waitFor({ timeout: ACTION_TIMEOUT_MS })
    } catch {
      const shown = await waiting.innerText({ timeout: 1000 }).catch(() => 'nothing')
      return { row: `no row reads "${asks}…"; Waiting for a person shows: ${shown.trim()}`, said: '' }
    }
    const row = (await label.innerText()).trim()
    await waiting.locator('div').filter({ hasText: asks }).getByRole('button', { name: 'Approve', exact: true }).last().click()
    const said = this.page.getByRole('status').filter({ hasText: /^(Approved|Denied)/ })
    try {
      await said.waitFor({ timeout: ACTION_TIMEOUT_MS })
    } catch {
      const alerts = await this.page.getByRole('alert').allInnerTexts()
      return { row, said: `no approval was confirmed; the screen says: ${alerts.join(' | ') || 'nothing'}` }
    }
    return { row, said: (await said.innerText()).trim() }
  }

  /**
   * B26.28 — `agent`'s row waiting for a person, on a 390px phone: saved as a screenshot at `file`, and
   * what is wrong with it — undefined when Approve and Deny each sit full-width under the sentence.
   */
  async phoneRow(agent: Agent, payee: Agent, file: string): Promise<string | undefined> {
    const was = this.page.viewportSize()
    await this.page.setViewportSize({ width: 390, height: 844 })
    try {
      const label = card(this.page, 'Waiting for a person').getByText(`${agent.name} wants to pay ${payee.name} `).first()
      await label.waitFor({ timeout: ACTION_TIMEOUT_MS })
      const words = label.locator('xpath=../..') // the sentence and the line under it (packages/ui Row)
      const row = words.locator('xpath=..')
      await mkdir(join(file, '..'), { recursive: true })
      await row.screenshot({ path: file })
      const [r, w, approve, deny] = await Promise.all([
        row.boundingBox(),
        words.boundingBox(),
        row.getByRole('button', { name: /^Approve/ }).boundingBox(),
        row.getByRole('button', { name: 'Deny', exact: true }).boundingBox(),
      ])
      if (!r || !w || !approve || !deny) return 'the row, its sentence or a button is not on the screen'
      const box = (b: { x: number; y: number; width: number }) => `${Math.round(b.width)}px wide at y=${Math.round(b.y)}`
      const shown = `row ${Math.round(r.width)}px; sentence ${box(w)}, ${Math.round(w.height)}px tall; Approve ${box(approve)}; Deny ${box(deny)}`
      const full = 0.8 * r.width
      if (w.width < full) return `the sentence is squeezed beside the buttons: ${shown}`
      for (const [name, b] of [['Approve', approve], ['Deny', deny]] as const) {
        if (b.y < w.y + w.height - 1) return `${name} is not under the sentence: ${shown}`
        if (b.width < full) return `${name} is not full-width: ${shown}`
      }
      return undefined
    } finally {
      if (was) await this.page.setViewportSize(was)
    }
  }

  /** B28.20 — the balance the agent's row shows, as Lens has it now. */
  async balanceShown(agent: Agent): Promise<string> {
    await this.fresh()
    return (await this.page.getByTestId(`agent-balance-${agent.id}`).innerText()).trim()
  }

  /**
   * B28.22 — allows `agent` only `model`, picked from the Rules card's model picker, and saves. Answers
   * what the control is (a SELECT, not a text box) and the save's outcome.
   */
  async allowOnlyModel(agent: Agent, model: string): Promise<{ tag: string; err?: string }> {
    await this.fresh(agent)
    const picker = this.page.getByLabel(`Allowed models for ${agent.name}`)
    await picker.waitFor()
    const tag = await picker.evaluate((el) => el.tagName)
    if (tag !== 'SELECT') return { tag }
    await picker.locator(`option[value="${model}"]`).waitFor({ state: 'attached' })
    await picker.selectOption(model)
    const form = this.page.locator('form').filter({ has: picker })
    await form.getByRole('button', { name: 'Save rules' }).click()
    return { tag, err: await outcome(form.getByRole('status').filter({ hasText: /^Saved\./ }), form) }
  }

  /** B28.22 — the Rules card's plain-English sentences for `agent`, as the screen shows them after a reload. */
  async rulesInWords(agent: Agent): Promise<string> {
    await this.fresh(agent)
    const words = this.page.getByTestId('rules-in-words')
    await words.waitFor()
    return (await words.innerText()).trim()
  }

  /** B28.21 — renames and describes the agent on Name and description; Lens's refusal, if it refused. */
  async describe(agent: Agent, name: string, description: string): Promise<string | undefined> {
    await this.fresh(agent)
    const c = card(this.page, 'Name and description')
    await c.getByLabel(`Name of ${agent.name}`).fill(name)
    await c.getByLabel(`What ${agent.name} is for`).fill(description)
    await c.getByRole('button', { name: 'Save', exact: true }).click()
    return outcome(this.page.getByTestId('agent-open').filter({ hasText: new RegExp(`^${esc(name)}$`) }), c)
  }

  /** B28.21 — archives the agent on Archive, confirming it; what the screen then says, or the refusal. */
  async archive(agent: Agent): Promise<{ said?: string; err?: string }> {
    await this.fresh(agent)
    const c = card(this.page, 'Archive')
    await c.getByRole('button', { name: `Archive ${agent.name}`, exact: true }).click()
    await c.getByRole('button', { name: `Yes, archive ${agent.name}`, exact: true }).click()
    const done = this.page.getByTestId('agent-archived')
    const err = await outcome(done, c)
    return err === undefined ? { said: (await done.innerText()).trim() } : { err }
  }

  /** Downloads "Statement for every agent" for this month as JSON; the file's name and text. */
  async statementThisMonth(): Promise<{ name: string; text: string }> {
    await this.fresh()
    const c = card(this.page, 'Statement for every agent')
    await c.getByRole('button', { name: 'This month', exact: true }).click()
    await c.getByLabel('File type of every agent’s statement').selectOption('json')
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: ACTION_TIMEOUT_MS }),
      c.getByRole('button', { name: 'Download', exact: true }).click(),
    ])
    return { name: download.suggestedFilename(), text: await readFile(await download.path(), 'utf8') }
  }

  // ─── B25.4: money between owners, on the same screen ───

  /** Send or request → Send: `ulxc` from `agent` to the wallet `to`; the line the card then shows. */
  async send(agent: Agent, to: string, ulxc: number, memo: string): Promise<string> {
    await this.fresh(agent)
    const c = card(this.page, 'Send or request')
    await c.getByRole('group', { name: 'Send or request' }).getByRole('button', { name: 'Send', exact: true }).click()
    await c.getByLabel('Send to (wallet ID or @handle)').fill(to)
    await c.getByLabel('Amount in LXC to send').fill(lxcText(ulxc))
    await c.getByLabel('What it is for').fill(memo)
    await c.getByRole('button', { name: 'Send credits' }).click()
    return said(c)
  }

  /** Between owners → Requests: accepts what the agent at wallet `from` asks `agent` for; the row's pill, or the refusal. */
  async acceptRequest(agent: Agent, from: string): Promise<string> {
    await this.fresh()
    const c = card(this.page, 'Requests')
    const row = c.getByText(`${from} asks ${agent.name}`, { exact: true }).first().locator('xpath=../..')
    await row.getByRole('button', { name: 'Accept', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
    const done = row.getByText('Accepted', { exact: true })
    return (await outcome(done, c)) ?? 'Accepted'
  }

  /** B28.23 — Transfers: gives back what the agent at wallet `from` sent `agent` with `memo`, asked twice; the note, or the refusal. */
  async giveBack(agent: Agent, from: string, memo: string): Promise<string> {
    await this.fresh(agent)
    const c = card(this.page, 'Transfers')
    const row = c.getByText(`Received from ${from} — ${memo}`, { exact: true }).first().locator('xpath=../..')
    await row.getByRole('button', { name: 'Give back', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
    await row.getByRole('button', { name: 'Yes, give it back', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
    return said(c)
  }

  /** Offer a loan: `principal` to the wallet `to`, at `pct`% over `n` instalments every `every`. */
  async offerLoan(agent: Agent, l: { to: string; principal: number; pct: number; n: number; every: 'day' | 'week' | 'month'; memo: string }): Promise<string> {
    await this.fresh(agent)
    const c = card(this.page, 'Offer a loan')
    await c.getByLabel('Lend to (wallet ID or @handle)').fill(l.to)
    await c.getByLabel('Loan amount in LXC').fill(lxcText(l.principal))
    await c.getByLabel('Interest over the whole loan, in percent').fill(String(l.pct))
    await c.getByLabel('Number of instalments').fill(String(l.n))
    await c.getByRole('group', { name: 'Instalments every' }).getByRole('button', { name: `Every ${l.every}`, exact: true }).click()
    await c.getByLabel('What the loan is for').fill(l.memo)
    await c.getByRole('button', { name: 'Offer', exact: true }).click()
    return said(c)
  }

  /** Pay into escrow: `ulxc` for the wallet `to`, released on `releaseOn` (YYYY-MM-DD) unless disputed. */
  async payIntoEscrow(agent: Agent, to: string, ulxc: number, releaseOn: string, memo: string): Promise<string> {
    await this.fresh(agent)
    const c = card(this.page, 'Pay into escrow')
    await c.getByLabel('Hold for (wallet ID or @handle)').fill(to)
    await c.getByLabel('Amount in LXC to hold').fill(lxcText(ulxc))
    await c.getByLabel('Release on').fill(releaseOn)
    await c.getByLabel('What the escrow is for').fill(memo)
    await c.getByRole('button', { name: 'Pay into escrow', exact: true }).click()
    return said(c)
  }

  /** Held and cashed out → Escrow: confirms the escrow `memo` names delivered, or disputes it; its pill, or the refusal. */
  async settleEscrow(memo: string, how: { confirm: true } | { dispute: string }): Promise<string> {
    await this.fresh()
    const c = card(this.page, 'Escrow')
    const row = c.getByTestId('escrow').filter({ hasText: memo })
    if ('confirm' in how) {
      await row.getByRole('button', { name: 'Confirm delivered' }).click({ timeout: ACTION_TIMEOUT_MS })
    } else {
      await row.getByLabel('Why you dispute it').fill(how.dispute)
      await row.getByRole('button', { name: 'Dispute', exact: true }).click()
    }
    const done = row.getByText('confirm' in how ? 'Released' : 'Disputed', { exact: true })
    return (await outcome(done, row)) ?? ('confirm' in how ? 'Released' : 'Disputed')
  }

  /** Pots → Create pot: a goal of `targetULXC`. */
  async createPot(agent: Agent, name: string, targetULXC: number): Promise<string | undefined> {
    await this.fresh(agent)
    const c = card(this.page, 'Pots')
    await c.getByLabel('New pot’s name').fill(name)
    await c.getByLabel('Target in LXC (optional)').fill(lxcText(targetULXC))
    await c.getByRole('button', { name: 'Create pot' }).click()
    return outcome(c.getByTestId('pot').filter({ hasText: name }), c)
  }

  /** Moves `ulxc` into or out of the pot `name`; Lens's refusal, if the move was refused. */
  async movePot(agent: Agent, name: string, ulxc: number, dir: 'in' | 'out'): Promise<string | undefined> {
    await this.fresh(agent)
    const row = card(this.page, 'Pots').getByTestId('pot').filter({ hasText: name })
    await row.getByLabel(`Amount in LXC to move for ${name}`).fill(lxcText(ulxc))
    // B17.33 — the card sends a move again under its key while the app or Lens restarts (a 5xx), so the
    // move's answer is the first one that is not a 5xx — or, when every send met the restart, the alert.
    const refused = row.getByRole('alert')
    const answered = this.page
      .waitForResponse((r) => r.request().method() === 'POST' && r.status() < 500 && new RegExp(`/pots/[^/]+/${dir}$`).test(new URL(r.url()).pathname), { timeout: ACTION_TIMEOUT_MS })
      .catch(() => undefined)
    await row.getByRole('button', { name: dir === 'in' ? 'Move in' : 'Move out' }).click()
    const res = await Promise.race([answered, refused.waitFor({ timeout: ACTION_TIMEOUT_MS }).then(() => undefined, () => undefined)])
    if (res?.ok()) return undefined
    await refused.waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
    return (await refused.count()) > 0 ? (await refused.first().innerText()).trim() : `the move answered ${res?.status() ?? 'nothing'}`
  }

  /** Recurring transfer: `ulxc` to the wallet `to` every `every`, from now. */
  async startRecurring(agent: Agent, to: string, ulxc: number, every: 'day' | 'week' | 'month', memo: string): Promise<string> {
    await this.fresh(agent)
    const c = card(this.page, 'Recurring transfer')
    await c.getByLabel('Pay every period to (wallet ID or @handle)').fill(to)
    await c.getByLabel('Recurring amount in LXC').fill(lxcText(ulxc))
    await c.getByRole('group', { name: 'How often' }).getByRole('button', { name: `Every ${every}`, exact: true }).click()
    await c.getByLabel('What the recurring transfer is for').fill(memo)
    await c.getByRole('button', { name: 'Start', exact: true }).click()
    return said(c)
  }

  /** Cash out: `ulxc` of the agent's credits, paid to `destination`. */
  async cashOut(agent: Agent, ulxc: number, destination: string): Promise<string> {
    await this.fresh(agent)
    const c = card(this.page, 'Cash out')
    await c.getByLabel('Amount in LXC to cash out').fill(lxcText(ulxc))
    await c.getByLabel('Pay to (a name for the account)').fill(destination)
    await c.getByRole('button', { name: 'Ask to cash out' }).click()
    return said(c)
  }

  /** Card → Issue a test card, to the cardholder `holder`; Lens's refusal, if it was refused. */
  async issueCard(agent: Agent, holder: { first: string; last: string; line1: string; city: string; postcode: string }): Promise<string | undefined> {
    await this.fresh(agent)
    const c = card(this.page, 'Card')
    for (const [label, v] of [['First name', holder.first], ['Last name', holder.last], ['Address', holder.line1], ['Town or city', holder.city], ['Postcode', holder.postcode]]) {
      await c.getByLabel(label, { exact: true }).fill(v)
    }
    await c.getByRole('button', { name: 'Issue a test card' }).click()
    return outcome(c.getByTestId('agent-card'), c)
  }

  /** B25.8 — Card → the purchases on the agent's card, one line each, as the screen lists them. */
  async purchases(agent: Agent): Promise<string[]> {
    await this.fresh(agent)
    const rows = card(this.page, 'Card').getByTestId('agent-card-purchases').locator('tbody tr')
    await rows.first().waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
    return (await rows.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  }
}

/** The note a card shows once its form was sent: what was done, or "Refused …"/"Not …" and why. */
async function said(scope: Locator): Promise<string> {
  const note = scope.getByRole('status').or(scope.getByRole('alert')).first()
  await note.waitFor({ timeout: ACTION_TIMEOUT_MS })
  return (await note.innerText()).trim()
}

/** Marketplace → Publish: a prompt listing; answers its id, or Lens's refusal. */
export async function publishPrompt(app: AppUser, l: { title: string; template: string; priceULXC: number; model: string }): Promise<{ id?: string; error?: string }> {
  const page = await app.tab('/marketplace/publish')
  try {
    // A label that wraps a select or a hint names its control with them too: matched by its start.
    await page.getByLabel(/^Kind/).selectOption('prompt')
    await page.getByLabel('Price per use, in LXC').fill(lxcText(l.priceULXC))
    await page.getByLabel('Title', { exact: true }).fill(l.title)
    await page.getByRole('textbox', { name: /^Template/ }).fill(l.template)
    const model = page.getByRole('combobox', { name: /^Model/ })
    await model.locator('option', { hasText: l.model }).first().waitFor({ state: 'attached' })
    await model.selectOption({ label: l.model })
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    const refused = page.locator('form').getByRole('alert')
    await page.waitForURL(/\/marketplace\/listings\/[^/]+$/, { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
    const m = /\/marketplace\/listings\/([^/?#]+)$/.exec(page.url())
    if (m !== null) return { id: decodeURIComponent(m[1]) }
    return { error: (await refused.count()) > 0 ? (await refused.first().innerText()).trim() : `still on ${page.url()}` }
  } finally {
    await page.close()
  }
}

/** A listing's page: fills its variables and presses Use it; what it answered, or the refusal. */
export async function runListing(app: AppUser, id: string, variables: Record<string, string>): Promise<{ shown?: string; error?: string }> {
  const page = await app.tab(`/marketplace/listings/${encodeURIComponent(id)}`)
  try {
    const use = page.getByRole('button', { name: /^Use it/ })
    await use.waitFor({ timeout: ACTION_TIMEOUT_MS })
    for (const [name, value] of Object.entries(variables)) await page.getByLabel(name, { exact: true }).fill(value)
    await use.click()
    const result = page.getByTestId('market-use-result')
    const refused = page.locator('form').getByRole('alert')
    await result.or(refused).first().waitFor({ timeout: 120_000 })
    return (await result.isVisible()) ? { shown: (await result.innerText()).trim() } : { error: (await refused.first().innerText()).trim() }
  } finally {
    await page.close()
  }
}

/** Marketplace → Your bill, as the screen shows it. */
async function billShown(app: AppUser): Promise<string> {
  const page = await app.tab('/marketplace/bill')
  try {
    await page.getByTestId('market-bill-total').waitFor({ timeout: ACTION_TIMEOUT_MS })
    return (await page.locator('body').innerText()).trim()
  } finally {
    await page.close()
  }
}

// ─── what the scenarios share ────────────────────────────────────────────────

export const fail = (detail: string): Verdict => ({ pass: false, detail })

export async function withBank(ctx: ScenarioCtx, body: (bank: AgentBankScreen) => Promise<Verdict>): Promise<Verdict> {
  const bank = await AgentBankScreen.open(ctx.app)
  try {
    return await body(bank)
  } finally {
    await bank.close()
  }
}

export async function bookOf(ctx: ScenarioCtx, user: SyntheticUser = ctx.app.user): Promise<AgentBook> {
  const b = await ctx.env.lens.agentBook(user)
  ctx.evidence.push({ note: `book: workspace ${b.workspace_balance_ulxc} µLXC = ${b.allocated_ulxc} with agents + ${b.unallocated_ulxc} free; ` +
    b.agents.map((a) => `${a.name} ${a.balance_ulxc}`).join(', ') })
  return b
}

export const agentIn = (b: AgentBook, id: string): Agent | undefined => b.agents.find((a) => a.id === id)

/** Creates an agent on the screen and finds it in Lens's book, owned by the person who made it. */
export async function openAgent(ctx: ScenarioCtx, bank: AgentBankScreen, name: string): Promise<Agent | string> {
  const err = await bank.create(name)
  if (err !== undefined) return `creating ${name} was refused: ${err}`
  const a = (await ctx.env.lens.agentBook(ctx.app.user)).agents.find((x) => x.name === name)
  if (a === undefined) return `${name} shows on the screen but Lens has no such agent`
  if (a.owner_user_id === '') return `${name} was created with no owner`
  return a
}

export async function spendRows(ctx: ScenarioCtx): Promise<{ id: string; amount_ulxc: number }[]> {
  return (await ctx.env.lens.ledger(ctx.app.user)).filter((r) => r.type === 'spend')
}

/**
 * An agent asks one question with its own key. Its worst case is held against the cap first; a served
 * answer is booked, as every charged answer is, for the ledger read-back.
 */
async function agentAsks(ctx: ScenarioCtx, key: string, prompt: string, note: string): Promise<Answered<JudgeReply>> {
  const { env, app } = ctx
  const model = env.catalog.find((m) => m.id === env.judgeModel)
  if (model === undefined) throw new Error(`the catalog has no model ${env.judgeModel}`)
  const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(prompt.length), AGENT_MAX_TOKENS))
  let r: Answered<JudgeReply>
  try {
    r = await env.lens.askAsAgent(key, env.judgeProvider, env.judgeModel, prompt, AGENT_MAX_TOKENS)
  } catch (e) {
    env.cap.settle(hold, undefined)
    throw e
  }
  if (!r.ok) {
    // A refusal may still have reached the provider; count it at its worst.
    env.cap.settle(hold, undefined)
    ctx.evidence.push({ note: `${note}: Lens answered ${r.status}`, question: prompt, error: r.error })
    return r
  }
  const reply = r.value
  const cost = reply.replayed ? 0
    : reply.pooledULXC !== undefined ? (reply.pooledULXC / 1e6) * env.usdPerLXC
      : listPriceUSD(model, reply.inputTokens, reply.outputTokens)
  env.cap.settle(hold, cost)
  if (!reply.replayed) env.book.add(app.user.workspaceID, reply.pooledULXC ?? chargeULXC(cost, env.usdPerLXC))
  ctx.evidence.push({ note, question: prompt, answer: reply.text })
  return r
}

function sum(r: () => number): { q: string; want: number } {
  const a = 1000 + Math.floor(r() * 9000)
  const b = 1000 + Math.floor(r() * 9000)
  return { q: `What is ${a} + ${b}? ${NUMBER_ONLY}`, want: a + b }
}

// ─── the catalog ─────────────────────────────────────────────────────────────

export function agentOpenFund(seed: number): Scenario {
  const amount = (2 + (seed % 5)) * 1e6
  return {
    id: 'agent-open-fund',
    title: 'a person opens an agent account on Agent Wallets and funds it: the agent holds exactly that, out of the workspace',
    run: (ctx) => withBank(ctx, async (bank) => {
      const before = await bookOf(ctx)
      const a = await openAgent(ctx, bank, `Researcher ${seed}`)
      if (typeof a === 'string') return fail(a)
      const err = await bank.move(a, amount, 'Fund')
      if (err !== undefined) return fail(`funding ${lxcText(amount)} LXC was refused: ${err}`)
      const after = await bookOf(ctx)
      ctx.evidence.push({ note: `the screen says: ${await bank.totals()}` })
      const got = agentIn(after, a.id)?.balance_ulxc
      if (got !== amount) return fail(`funded ${amount} µLXC; Lens says ${a.name} holds ${got}`)
      if (after.allocated_ulxc !== before.allocated_ulxc + amount) {
        return fail(`the workspace's agents held ${before.allocated_ulxc} µLXC and hold ${after.allocated_ulxc} after a ${amount} µLXC funding`)
      }
      if (after.workspace_balance_ulxc !== before.workspace_balance_ulxc) {
        return fail(`funding an agent changed the workspace's balance: ${before.workspace_balance_ulxc} → ${after.workspace_balance_ulxc} µLXC`)
      }
      if (after.unallocated_ulxc !== after.workspace_balance_ulxc - after.allocated_ulxc) {
        return fail(`the book does not add up: ${after.workspace_balance_ulxc} ≠ ${after.allocated_ulxc} + ${after.unallocated_ulxc}`)
      }
      return { pass: true, detail: `${a.name} holds ${lxcText(amount)} LXC, out of the workspace's free LXC; workspace = with agents + free` }
    }),
  }
}

export function agentLimit(seed: number): Scenario {
  const r = seeded(seed * 29 + 5)
  return {
    id: 'agent-limit',
    title: 'an agent limit refuses an over-limit request before the provider is called; raised, the same request is served',
    run: (ctx) => withBank(ctx, async (bank) => {
      const a = await openAgent(ctx, bank, `Limited ${seed}`)
      if (typeof a === 'string') return fail(a)
      let err = await bank.move(a, 1e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setLimit(a, 'Limit per request', 1)
      if (err !== undefined) return fail(`the limit was not saved: ${err}`)
      const key = await bank.issueKey(a)
      const { q, want } = sum(r)
      const spends0 = new Set((await spendRows(ctx)).map((x) => x.id))
      const refused = await agentAsks(ctx, key, q, 'past a limit per request of 0.000001 LXC')
      if (refused.ok) return fail(`the limit per request of 0.000001 LXC let a request through: "${refused.value.text}"`)
      if (refused.status !== 403 || !/limit per request/.test(refused.error)) {
        return fail(`refused, but not by the limit per request: ${refused.status} ${refused.error}`)
      }
      const held = agentIn(await bookOf(ctx), a.id)?.balance_ulxc
      const early = (await spendRows(ctx)).filter((x) => !spends0.has(x.id))
      if (held !== 1e6 || early.length > 0) {
        return fail(`refused, yet something was charged: ${a.name} holds ${held} µLXC of 1000000 and the ledger has ${early.length} new spend row(s)`)
      }
      err = await bank.setLimit(a, 'Limit per request', 1e6)
      if (err !== undefined) return fail(`the limit could not be raised: ${err}`)
      const served = await agentAsks(ctx, key, q, 'the same request, limit raised to 1 LXC')
      if (!served.ok) return fail(`with the limit raised it was still refused: ${served.status} ${served.error}`)
      if (!statesNumber(served.value.text, want)) return fail(`answered wrong: expected ${want}, got "${served.value.text}"`)
      const after = agentIn(await bookOf(ctx), a.id)?.balance_ulxc ?? NaN
      const fresh = (await spendRows(ctx)).filter((x) => !spends0.has(x.id))
      const charged = fresh.reduce((s, x) => s - x.amount_ulxc, 0)
      if (fresh.length !== 1 || 1e6 - after !== charged) {
        return fail(`served: ${a.name}'s balance fell by ${1e6 - after} µLXC; the ledger has ${fresh.length} new spend row(s) for ${charged} µLXC`)
      }
      return { pass: true, detail: `refused (403, the limit per request) with nothing charged; raised, served once from ${a.name}'s own balance (${charged} µLXC)` }
    }),
  }
}

/** The line a served request leaves on the agent's own account: Lens's hold, the stub's spend. */
const requestLine = (l: AgentLine) => l.kind === 'hold' || l.kind === 'spend'

/**
 * B28.24 — the DONE line: a hold over the hourly cap writes zero postings; under it, one. The cap is set
 * on Agent Wallets' Rules card, as a person sets it, and checked in Lens's hold, before the provider.
 */
export function agentHourlyLimit(seed: number): Scenario {
  const r = seeded(seed * 37 + 11)
  return {
    id: 'agent-hourly-limit',
    title: 'an hourly cap set on Agent Wallets refuses a request over it with no posting; raised, the same request writes one',
    run: (ctx) => withBank(ctx, async (bank) => {
      const a = await openAgent(ctx, bank, `Hourly ${seed}`)
      if (typeof a === 'string') return fail(a)
      let err = await bank.move(a, 1e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setLimit(a, 'Hourly limit', 1)
      if (err !== undefined) return fail(`the hourly limit was not saved: ${err}`)
      const key = await bank.issueKey(a)
      const { q, want } = sum(r)
      const lines0 = await ctx.env.lens.agentLines(ctx.app.user, a.id)
      const spends0 = new Set((await spendRows(ctx)).map((x) => x.id))
      const refused = await agentAsks(ctx, key, q, 'past an hourly limit of 0.000001 LXC')
      if (refused.ok) return fail(`the hourly limit of 0.000001 LXC let a request through: "${refused.value.text}"`)
      if (refused.status !== 403 || !/hourly limit/.test(refused.error)) {
        return fail(`refused, but not by the hourly limit: ${refused.status} ${refused.error}`)
      }
      const lines1 = await ctx.env.lens.agentLines(ctx.app.user, a.id)
      const early = lines1.filter((l) => !lines0.some((o) => o.entry_id === l.entry_id))
      const charged0 = (await spendRows(ctx)).filter((x) => !spends0.has(x.id))
      if (early.length > 0 || charged0.length > 0) {
        return fail(`refused by the hourly limit, yet it wrote ${early.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ') || 'nothing'} on ${a.name}'s account and ${charged0.length} spend row(s) on the ledger`)
      }
      err = await bank.setLimit(a, 'Hourly limit', 1e6)
      if (err !== undefined) return fail(`the hourly limit could not be raised: ${err}`)
      const served = await agentAsks(ctx, key, q, 'the same request, hourly limit raised to 1 LXC')
      if (!served.ok) return fail(`with the hourly limit raised it was still refused: ${served.status} ${served.error}`)
      if (!statesNumber(served.value.text, want)) return fail(`answered wrong: expected ${want}, got "${served.value.text}"`)
      const late = (await ctx.env.lens.agentLines(ctx.app.user, a.id)).filter((l) => !lines1.some((o) => o.entry_id === l.entry_id))
      const posted = late.filter(requestLine)
      const charged = (await spendRows(ctx)).filter((x) => !spends0.has(x.id))
      if (posted.length !== 1 || charged.length !== 1) {
        return fail(`under the hourly limit: ${a.name}'s account has ${late.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ') || 'nothing'} new and the ledger ${charged.length} spend row(s); want one ${posted[0]?.kind ?? 'hold'} posting and one spend row`)
      }
      return { pass: true, detail: `over the hourly limit: refused (403) with no posting and no charge; under it: one ${posted[0].kind} posting (${posted[0].amount_ulxc} µLXC) and one spend row` }
    }),
  }
}

export function agentPauseAll(seed: number): Scenario {
  const r = seeded(seed * 31 + 9)
  return {
    id: 'agent-pause-all',
    title: 'Pause every agent stops every agent before the provider; started again, they are served',
    run: (ctx) => withBank(ctx, async (bank) => {
      const agents: { a: Agent; key: string }[] = []
      for (const name of [`Alpha ${seed}`, `Beta ${seed}`]) {
        const a = await openAgent(ctx, bank, name)
        if (typeof a === 'string') return fail(a)
        const err = await bank.move(a, 500_000, 'Fund')
        if (err !== undefined) return fail(`funding ${name} was refused: ${err}`)
        agents.push({ a, key: await bank.issueKey(a) })
      }
      const err = await bank.pauseAll(`nightly check ${seed}`)
      if (err !== undefined) return fail(`Pause every agent was refused: ${err}`)
      const spends0 = new Set((await spendRows(ctx)).map((x) => x.id))
      for (const { a, key } of agents) {
        const t = await agentAsks(ctx, key, sum(r).q, `${a.name}, every agent paused`)
        if (t.ok) return fail(`with every agent paused, ${a.name} was served: "${t.value.text}"`)
        if (t.status !== 403 || !/every agent in this workspace is paused/.test(t.error)) {
          return fail(`${a.name} was refused, but not by the pause: ${t.status} ${t.error}`)
        }
      }
      const paused = await bookOf(ctx)
      const moved = agents.filter(({ a }) => agentIn(paused, a.id)?.balance_ulxc !== 500_000)
      if (moved.length > 0 || (await spendRows(ctx)).some((x) => !spends0.has(x.id))) {
        return fail(`paused, yet something was charged: ${moved.map(({ a }) => a.name).join(', ') || 'the ledger'} moved`)
      }
      const again = await bank.resumeAll()
      if (again !== undefined) return fail(`Start every agent again was refused: ${again}`)
      const { q, want } = sum(r)
      const t = await agentAsks(ctx, agents[0].key, q, `${agents[0].a.name}, started again`)
      if (!t.ok) return fail(`started again, ${agents[0].a.name} is still refused: ${t.status} ${t.error}`)
      if (!statesNumber(t.value.text, want)) return fail(`answered wrong: expected ${want}, got "${t.value.text}"`)
      return { pass: true, detail: 'both agents refused (403, every agent paused) with nothing charged; started again, served' }
    }),
  }
}

export function agentApproval(seed: number): Scenario {
  return {
    id: 'agent-approval',
    title: 'a payment above the approval amount waits for a person; approved on Agent Wallets, it is paid once',
    run: (ctx) => withBank(ctx, async (bank) => {
      const payer = await openAgent(ctx, bank, `Payer ${seed}`)
      if (typeof payer === 'string') return fail(payer)
      const payee = await openAgent(ctx, bank, `Payee ${seed}`)
      if (typeof payee === 'string') return fail(payee)
      let err = await bank.move(payer, 2e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setLimit(payer, 'Ask a person above', 500_000)
      if (err !== undefined) return fail(`the approval amount was not saved: ${err}`)
      const memo = `nightly check ${seed}`
      const said = await bank.pay(payer, payee, 1e6, memo)
      ctx.evidence.push({ note: `Pay 1 LXC: ${said}` })
      if (!/^Refused\./.test(said) || !/waiting in Approvals/.test(said)) return fail(`a payment above the approval amount was not held for a person: "${said}"`)
      const filed = (await ctx.env.lens.agentApprovals(ctx.app.user)).filter((x) => x.agent_id === payer.id)
      if (filed.length !== 1 || filed[0].status !== 'pending' || filed[0].amount_ulxc !== 1e6) {
        return fail(`Lens has ${filed.length} approval(s) for ${payer.name}: ${JSON.stringify(filed)}`)
      }
      // B23.5: the approval names who it pays and why — what the person approving reads on the row.
      if (filed[0].payee?.id !== payee.id || filed[0].payee.name !== payee.name || filed[0].memo !== memo) {
        return fail(`Lens's approval does not name ${payee.name} and "${memo}": ${JSON.stringify(filed[0])}`)
      }
      const held = await bookOf(ctx)
      if (agentIn(held, payer.id)?.balance_ulxc !== 2e6 || agentIn(held, payee.id)?.balance_ulxc !== 0) {
        return fail('money moved before anyone approved it')
      }
      const shot = join(ctx.env.outDir, `agent-approval-390px-user${ctx.app.user.index}.png`)
      const phone = await bank.phoneRow(payer, payee, shot)
      ctx.evidence.push({ note: `on a 390px phone (${shot}): ${phone ?? 'Approve and Deny each sit full-width under the sentence'}` })
      if (phone !== undefined) return fail(`on a 390px phone, ${phone}`)
      const { row, said: approved } = await bank.approve(payer, payee)
      ctx.evidence.push({ note: `Waiting for a person: ${row}` }, { note: `Approve: ${approved}` })
      const asked = `1 LXC ${usdShown(1e6, ctx.env.usdPerLXC)} — ${memo}`
      if (!row.endsWith(` ${asked}`)) return fail(`the row waiting for a person does not say ${asked}: "${row}"`)
      if (!/^Approved and paid/.test(approved)) return fail(`approving did not pay: "${approved}"`)
      const after = await bookOf(ctx)
      const [from, to] = [agentIn(after, payer.id)?.balance_ulxc, agentIn(after, payee.id)?.balance_ulxc]
      if (from !== 1e6 || to !== 1e6) return fail(`after one approved 1 LXC payment ${payer.name} holds ${from} and ${payee.name} ${to} µLXC`)
      const state = (await ctx.env.lens.agentApprovals(ctx.app.user)).find((x) => x.id === filed[0].id)?.status
      if (state !== 'used') return fail(`the approval is ${state ?? 'gone'}, not used`)
      const pays = (await ctx.env.lens.agentLines(ctx.app.user, payer.id)).filter((l) => l.kind === 'pay')
      if (pays.length !== 1 || pays[0].amount_ulxc !== -1e6) return fail(`${payer.name}'s account has ${pays.length} payment line(s): ${JSON.stringify(pays)}`)
      return { pass: true, detail: `held for a person ("${row}"), approved on the screen, paid once (one pay line, the approval used)` }
    }),
  }
}

/**
 * B28.6 — the first screen after sign-in is the wallet home. An agent spends once, asks again above its
 * approval amount (Lens files the approval), and is given a monthly budget of four times what it spent;
 * Home must then show it 25% through its budget and the approvals Lens has waiting. Every figure the
 * screen is held to is read back from Lens: the agent's spend from the book, the pending approvals from
 * Lens's list. The budget is set after the approval is filed, so no limit can refuse the held request first.
 */
export function walletHome(seed: number): Scenario {
  const r = seeded(seed * 37 + 11)
  return {
    id: 'wallet-home',
    title: 'the first screen after sign-in is Home: each agent’s budget used and the approvals waiting, as Lens has them',
    run: (ctx) => withBank(ctx, async (bank) => {
      const a = await openAgent(ctx, bank, `Home ${seed}`)
      if (typeof a === 'string') return fail(a)
      let err = await bank.move(a, 1e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      const key = await bank.issueKey(a)
      const served = await agentAsks(ctx, key, sum(r).q, 'one request, so the month has a spend')
      if (!served.ok) return fail(`${a.name}'s first request was refused: ${served.status} ${served.error}`)
      const spent = agentIn(await bookOf(ctx), a.id)?.spent_ulxc ?? 0
      if (spent <= 0) return fail(`served, yet Lens says ${a.name} has spent ${spent} µLXC`)
      err = await bank.setLimit(a, 'Ask a person above', 1)
      if (err !== undefined) return fail(`the approval amount was not saved: ${err}`)
      const held = await agentAsks(ctx, key, sum(r).q, 'above the approval amount, so held for a person')
      if (held.ok) return fail(`a request above an approval amount of 0.000001 LXC was served: "${held.value.text}"`)
      err = await bank.setLimit(a, 'Monthly limit', spent * 4)
      if (err !== undefined) return fail(`the monthly limit was not saved: ${err}`)
      const pending = (await ctx.env.lens.agentApprovals(ctx.app.user)).filter((x) => x.status === 'pending')
      if (!pending.some((x) => x.agent_id === a.id)) return fail(`Lens filed no pending approval for ${a.name}: ${held.status} ${held.error}`)
      const page = await ctx.app.tab('/')
      try {
        await page.getByRole('heading', { level: 2, name: 'Your agents’ wallets, at a glance.' }).waitFor({ timeout: ACTION_TIMEOUT_MS })
        const used = (await page.getByTestId(`home-budget-used-${a.id}`).innerText({ timeout: ACTION_TIMEOUT_MS })).trim()
        const waiting = (await page.getByTestId('home-approvals-waiting').innerText({ timeout: ACTION_TIMEOUT_MS })).trim()
        ctx.evidence.push({ note: `Home: ${a.name} ${used} through its budget, ${waiting} approval(s) waiting; Lens: spent ${spent} of ${spent * 4} µLXC, ${pending.length} pending` })
        if (used !== '25%') return fail(`${a.name} spent ${spent} µLXC of a ${spent * 4} µLXC monthly budget; Home shows ${used} used, not 25%`)
        if (waiting !== String(pending.length)) return fail(`Lens has ${pending.length} approval(s) pending; Home shows ${waiting} waiting`)
        return { pass: true, detail: `Home shows ${a.name} 25% through its monthly budget and ${waiting} approval(s) waiting, as Lens has them` }
      } finally {
        await page.close()
      }
    }),
  }
}

/**
 * B28.8 — a brand-new workspace's first agent, from Home's three steps, with no full-screen consent page:
 * created with a monthly budget and an approval amount, funded, given a key — and its first request, sent
 * with that key, shown on Home as it lands on its statement. Sharing is one line on Home to untick. Every
 * figure is read back from Lens: the agent's owner and rules, its balance and the workspace's, and the
 * fund and request lines on its statement.
 */
export function walletOnboarding(seed: number): Scenario {
  const r = seeded(seed * 41 + 3)
  const budget = 5e6
  const approval = 1e6
  const amount = 2e6
  return {
    id: 'wallet-onboarding',
    title: 'a new workspace creates, funds and keys its first agent in Home’s three steps and sees its first request land, with no consent page',
    run: async (ctx) => {
      const before = await bookOf(ctx)
      if (before.agents.length > 0) throw new CannotTest(`the workspace already has ${before.agents.length} agent(s), so Home opens no onboarding`)
      const page = await ctx.app.tab('/')
      try {
        await page.getByRole('heading', { level: 2, name: 'Give every agent a wallet.' }).waitFor({ timeout: ACTION_TIMEOUT_MS })
        if ((await page.getByText(/Share your answers, and earn from them/).count()) > 0) return fail('the full-screen sharing-consent page is still shown')
        if ((await page.getByRole('checkbox', { name: /Share answers with other companies/ }).count()) !== 1) return fail('Home has no one-line sharing notice')
        const steps = page.getByTestId('wallet-onboarding')
        const name = `First ${seed}`
        await page.getByLabel('Agent name').fill(name)
        await page.getByLabel('Monthly budget, in LXC').fill(lxcText(budget))
        await page.getByLabel('Ask a person above, in LXC').fill(lxcText(approval))
        await page.getByRole('button', { name: 'Create agent' }).click()
        const fundField = page.getByLabel(`Amount to fund ${name}, in LXC`)
        let err = await outcome(fundField, steps)
        if (err !== undefined) return fail(`step 1, creating ${name}, was refused: ${err}`)
        await fundField.fill(lxcText(amount))
        await page.getByRole('button', { name: `Fund ${name}` }).click()
        err = await outcome(page.getByRole('button', { name: 'Issue its key' }), steps)
        if (err !== undefined) return fail(`step 2, funding ${lxcText(amount)} LXC, was refused: ${err}`)
        await page.getByRole('button', { name: 'Issue its key' }).click()
        err = await outcome(page.getByTestId('onboarding-key'), steps)
        if (err !== undefined) return fail(`step 3, issuing the key, was refused: ${err}`)
        const key = (await page.getByTestId('onboarding-key').innerText()).trim()

        const book = await bookOf(ctx)
        const a = book.agents.find((x) => x.name === name)
        if (a === undefined) return fail(`Home's three steps finished, but Lens has no agent named ${name}`)
        if (a.owner_user_id === '') return fail(`${name} was created with no owner`)
        if (a.balance_ulxc !== amount) return fail(`funded ${amount} µLXC on Home; Lens says ${name} holds ${a.balance_ulxc}`)
        if (book.allocated_ulxc !== before.allocated_ulxc + amount || book.workspace_balance_ulxc !== before.workspace_balance_ulxc) {
          return fail(`the funding did not come out of the workspace: allocated ${before.allocated_ulxc} → ${book.allocated_ulxc}, workspace ${before.workspace_balance_ulxc} → ${book.workspace_balance_ulxc} µLXC`)
        }
        const rules = await ctx.env.lens.agentRules(ctx.app.user, a.id)
        if (rules.monthly_limit_ulxc !== budget || rules.approval_above_ulxc !== approval) {
          return fail(`typed a ${budget} µLXC budget and a ${approval} µLXC approval amount; Lens stored ${rules.monthly_limit_ulxc} and ${rules.approval_above_ulxc}`)
        }

        const served = await agentAsks(ctx, key, sum(r).q, 'the first request, with the key Home issued')
        if (!served.ok) return fail(`${name}'s first request, with the key Home issued, was refused: ${served.status} ${served.error}`)
        const shown = (await page.getByTestId('onboarding-first-request').innerText({ timeout: 60_000 })).trim()
        const lines = await ctx.env.lens.agentLines(ctx.app.user, a.id)
        ctx.evidence.push({ note: `Home: "${shown}"; ${name}'s statement: ${lines.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ')}` })
        const funded = lines.filter((l) => l.kind === 'fund')
        if (funded.length !== 1 || funded[0].amount_ulxc !== amount) return fail(`${name}'s statement should hold one fund line of ${amount} µLXC: ${JSON.stringify(funded)}`)
        const request = [...lines].reverse().find((l) => ['spend', 'hold', 'settle', 'release'].includes(l.kind))
        if (request === undefined) return fail(`served, yet ${name}'s statement has no line for the request`)
        if (!shown.includes(lxcText(Math.abs(request.amount_ulxc)))) {
          return fail(`Lens put ${request.kind} ${request.amount_ulxc} µLXC on ${name}'s statement; Home says "${shown}"`)
        }
        return { pass: true, detail: `${name} created with its budget and approval amount, funded ${lxcText(amount)} LXC and keyed on Home; its first request (${request.kind} ${request.amount_ulxc} µLXC) shown as it landed; no consent page` }
      } finally {
        await page.close()
      }
    },
  }
}

/**
 * B28.7 — the navigation is wallet-first. With every group open, the sidebar reads top to bottom: Home,
 * Approvals, Agent Wallets, Statements, Chat, then Marketplace, Work (Track, Docs), Developers (Connect an
 * agent, API keys, Spend & routing, Gateway features), Billing and Settings. The Approvals badge is held to
 * Lens's own pending count, and every link the sidebar offers opens a page rather than the catch-all.
 */
export const WALLET_FIRST_NAV = [
  'Home', 'Approvals', 'Agent Wallets', 'Statements', 'Chat', 'Marketplace', 'Work', 'Track', 'Docs',
  'Developers', 'Connect an agent', 'API keys', 'Spend & routing', 'Gateway features', 'Billing', 'Settings',
] as const

export function walletFirstNav(): Scenario {
  return {
    id: 'wallet-first-nav',
    title: 'the sidebar leads with the wallet, its Approvals badge is Lens’s pending count, and every link opens a page',
    run: async (ctx) => {
      const page = await ctx.app.tab('/')
      try {
        const nav = page.getByRole('navigation', { name: 'Sections' })
        await nav.getByRole('link', { name: 'Statements' }).waitFor({ timeout: ACTION_TIMEOUT_MS })
        const fold = nav.getByRole('button', { name: 'Fold all' })
        if ((await fold.count()) > 0) await fold.click()
        await nav.getByRole('button', { name: 'Open all' }).click()
        const rows = await nav
          .locator('a[href], button[aria-expanded]')
          .evaluateAll((els) => els.map((e) => ({ text: (e.textContent ?? '').trim(), href: e.getAttribute('href') })))
        const waiting = /(\d+) waiting$/.exec(rows.find((r) => r.href === '/approvals')?.text ?? '')
        const badge = waiting ? Number(waiting[1]) : 0
        const named = rows.map((r) => r.text.replace(/\d+ waiting$/, '').trim())
        // A group and its one same-named link (Settings, then Settings) read as one entry.
        const order = named.filter((l, i) => (WALLET_FIRST_NAV as readonly string[]).includes(l) && l !== named[i - 1])
        const pending = (await ctx.env.lens.agentApprovals(ctx.app.user)).filter((x) => x.status === 'pending').length
        ctx.evidence.push({ note: `sidebar: ${order.join(' · ')}; Approvals badge ${badge}, Lens pending ${pending}` })
        if (order.join('|') !== WALLET_FIRST_NAV.join('|')) return fail(`the sidebar reads ${order.join(', ')}, not ${WALLET_FIRST_NAV.join(', ')}`)
        if (badge !== pending) return fail(`Lens has ${pending} approval(s) pending; the sidebar's Approvals badge says ${badge}`)
        const hrefs = [...new Set(rows.map((r) => r.href).filter((h): h is string => h !== null && h.startsWith('/')))]
        for (const href of hrefs) {
          await page.goto(new URL(href, page.url()).toString())
          const h1 = (await page.locator('h1').first().innerText({ timeout: ACTION_TIMEOUT_MS })).trim()
          if (h1 === 'Not found' || (await page.getByText('Nothing at this address').count()) > 0) return fail(`the sidebar's link to ${href} opens no page`)
        }
        return { pass: true, detail: `the sidebar leads with the wallet, its badge is Lens's ${pending} pending, and all ${hrefs.length} links open a page` }
      } finally {
        await page.close()
      }
    },
  }
}

export function companyPayment(seed: number, partner: number): Scenario {
  const amount = 700_000
  return {
    id: 'company-payment',
    title: "an agent pays another company's agent: one line on the payer's marketplace bill; the payee's share waits for that bill, then the holdback",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const payeeCo = env.userAt(partner)
      const supplier = await env.lens.createAgent(payeeCo, `Supplier ${seed}`)
      const buyer = await openAgent(ctx, bank, `Buyer ${seed}`)
      if (typeof buyer === 'string') return fail(buyer)
      const key = await bank.issueKey(buyer)
      const bill0 = await env.lens.marketBill(app.user)
      const earned0 = await env.lens.marketEarnings(payeeCo)
      const paid = await env.lens.payAsAgent(key, app.user.workspaceID, buyer.id, supplier.id, amount, `nightly check ${seed}`)
      ctx.evidence.push({ note: `${buyer.name} pays ${supplier.name} of another company 0.7 LXC with its own key`, answer: JSON.stringify(paid) })
      if (!paid.ok) return fail(`the payment was refused: ${paid.status} ${paid.error}`)
      if (paid.value.via !== 'marketplace' || paid.value.to_workspace_id !== payeeCo.workspaceID) {
        return fail(`the payment did not go through the marketplace to the other company: ${JSON.stringify(paid.value)}`)
      }
      const seen = new Set((bill0.lines ?? []).map((l) => l.use_id))
      const fresh = ((await env.lens.marketBill(app.user)).lines ?? []).filter((l) => !seen.has(l.use_id))
      ctx.evidence.push({ note: `new lines on the payer's bill: ${JSON.stringify(fresh)}` })
      if (fresh.length !== 1 || fresh[0].price_ulxc !== amount || fresh[0].payee_agent_id !== supplier.id) {
        return fail(`the payer's bill gained ${fresh.length} line(s) for one ${amount} µLXC payment`)
      }
      if (fresh[0].cleared_at !== undefined) return fail('the payment reads as paid before any bill was')
      const earned = await env.lens.marketEarnings(payeeCo)
      ctx.evidence.push({ note: `payee earnings before ${JSON.stringify(earned0)}, after ${JSON.stringify(earned)}` })
      const share = amount / ULXC_PER_USD_MICRO
      if (earned.pending_uses !== earned0.pending_uses + 1 || earned.pending_usd_micros !== earned0.pending_usd_micros + share) {
        return fail(`the payee's pending went ${earned0.pending_uses} → ${earned.pending_uses} uses, ${earned0.pending_usd_micros} → ${earned.pending_usd_micros} µUSD; one payment of ${share} µUSD`)
      }
      if (earned.available_usd_micros !== earned0.available_usd_micros || earned.payable_usd_micros !== earned0.payable_usd_micros) {
        return fail('the payee could take the money before the payer\'s bill was paid and the holdback passed')
      }
      if (agentIn(await bookOf(ctx), buyer.id)?.balance_ulxc !== 0) return fail(`${buyer.name}'s balance moved: the company's bill carries this payment`)
      const shown = await billShown(app)
      if (!shown.includes(`Payment to ${supplier.name}`)) return fail(`Your bill does not show "Payment to ${supplier.name}"`)
      return { pass: true, detail: `one ${lxcText(amount)} LXC line on the payer's bill (not yet paid, shown on Your bill); the payee's pending rose by exactly $${(share / 1e6).toFixed(2)}, payable only once that bill is paid and after the 14-day holdback` }
    }),
  }
}

export function marketplaceSale(seed: number, partner: number): Scenario {
  const r = seeded(seed * 37 + 13)
  const a = 100 + Math.floor(r() * 900)
  const b = 100 + Math.floor(r() * 900)
  const price = 500_000
  const template = `What is {{a}} + {{b}}? ${NUMBER_ONLY}`
  return {
    id: 'marketplace-sale',
    title: 'a seller publishes, a buyer uses the listing and is billed once, and the seller\'s pending earnings rise by exactly their share',
    run: async (ctx) => {
      const { env, app } = ctx
      const seller = await env.signInUser(partner)
      let published
      try {
        published = await publishPrompt(seller, { title: `Adder ${seed}-${a}`, template, priceULXC: price, model: app.modelNameInUse })
      } finally {
        await seller.close()
      }
      ctx.evidence.push({ note: `the seller publishes "Adder ${seed}-${a}" at 0.5 LXC a use: ${published.id ?? published.error}` })
      if (published.id === undefined) return fail(`publishing was refused: ${published.error}`)
      const earned0 = await env.lens.marketEarnings(seller.user)
      const bill0 = await env.lens.marketBill(app.user)
      const rows0 = new Set((await spendRows(ctx)).map((x) => x.id))
      const model = env.catalog.find((m) => m.display_name === app.modelNameInUse)
      if (model === undefined) throw new Error(`the catalog has no model named "${app.modelNameInUse}"`)
      const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(template.length + 8), USE_MAX_TOKENS))
      let used
      try {
        used = await runListing(app, published.id, { a: String(a), b: String(b) })
      } catch (e) {
        env.cap.settle(hold, undefined)
        throw e
      }
      // The model the listing called is billed to the buyer as usual: its spend rows are its cost.
      const charged = (await spendRows(ctx)).filter((x) => !rows0.has(x.id))
      const cost = charged.reduce((s, x) => s - x.amount_ulxc, 0)
      env.cap.settle(hold, used.error === undefined ? (cost / 1e6) * env.usdPerLXC : undefined)
      for (const x of charged) env.book.add(app.user.workspaceID, -x.amount_ulxc)
      ctx.evidence.push({ note: 'the buyer uses it', question: template.replace('{{a}}', String(a)).replace('{{b}}', String(b)), answer: used.shown, error: used.error })
      if (used.error !== undefined) return fail(`the use was refused: ${used.error}`)
      if (!statesNumber(used.shown ?? '', a + b)) return fail(`the listing answered wrong: expected ${a + b}, got "${used.shown}"`)
      if (charged.length !== 1) return fail(`the model the listing called made ${charged.length} spend row(s) on the buyer's ledger`)
      const seen = new Set((bill0.lines ?? []).map((l) => l.use_id))
      const fresh = ((await env.lens.marketBill(app.user)).lines ?? []).filter((l) => !seen.has(l.use_id))
      ctx.evidence.push({ note: `new lines on the buyer's bill: ${JSON.stringify(fresh)}` })
      if (fresh.length !== 1 || fresh[0].listing_id !== published.id || fresh[0].price_ulxc !== price) {
        return fail(`one use of a ${price} µLXC listing put ${fresh.length} line(s) on the buyer's bill`)
      }
      const earned = await env.lens.marketEarnings(seller.user)
      ctx.evidence.push({ note: `seller earnings before ${JSON.stringify(earned0)}, after ${JSON.stringify(earned)}` })
      const share = price / ULXC_PER_USD_MICRO
      if (earned.pending_uses !== earned0.pending_uses + 1 || earned.pending_usd_micros !== earned0.pending_usd_micros + share) {
        return fail(`the seller's pending went ${earned0.pending_uses} → ${earned.pending_uses} uses, ${earned0.pending_usd_micros} → ${earned.pending_usd_micros} µUSD; their share of one use is ${share} µUSD`)
      }
      return { pass: true, detail: `answered ${a + b}; billed once (${lxcText(price)} LXC on the buyer's bill, the model's cost on their credits); the seller's pending rose by exactly $${(share / 1e6).toFixed(2)}` }
    },
  }
}

interface StatementJSON {
  accounts: { account: string; opening_ulxc: number; in_ulxc: number; out_ulxc: number; closing_ulxc: number }[] | null
  lines: { entry_id: string; account: string; kind: string; amount_ulxc: number }[] | null
}

export function statementReconciles(seed: number): Scenario {
  const r = seeded(seed * 41 + 17)
  return {
    id: 'statement-reconciles',
    title: 'the statement downloaded from Agent Wallets adds up, balances every entry, and agrees with the agents and the ledger',
    run: (ctx) => withBank(ctx, async (bank) => {
      const north = await openAgent(ctx, bank, `North ${seed}`)
      if (typeof north === 'string') return fail(north)
      const south = await openAgent(ctx, bank, `South ${seed}`)
      if (typeof south === 'string') return fail(south)
      for (const [x, n] of [[north, 3e6], [south, 1e6]] as const) {
        const err = await bank.move(x, n, 'Fund')
        if (err !== undefined) return fail(`funding ${x.name} was refused: ${err}`)
      }
      const said = await bank.pay(north, south, 500_000, `nightly check ${seed}`)
      if (!/^Paid/.test(said)) return fail(`paying 0.5 LXC was refused: "${said}"`)
      const back = await bank.move(south, 250_000, 'Take back')
      if (back !== undefined) return fail(`taking 0.25 LXC back was refused: ${back}`)
      const key = await bank.issueKey(north)
      const spends0 = new Set((await spendRows(ctx)).map((x) => x.id))
      const { q, want } = sum(r)
      const t = await agentAsks(ctx, key, q, `${north.name} asks with its own key`)
      if (!t.ok) return fail(`${north.name}'s request was refused: ${t.status} ${t.error}`)
      if (!statesNumber(t.value.text, want)) return fail(`answered wrong: expected ${want}, got "${t.value.text}"`)
      const ledgerSpent = (await spendRows(ctx)).filter((x) => !spends0.has(x.id)).reduce((s, x) => s - x.amount_ulxc, 0)
      const file = await bank.statementThisMonth()
      const st = JSON.parse(file.text) as StatementJSON
      const accounts = st.accounts ?? []
      const lines = st.lines ?? []
      ctx.evidence.push({ note: `${file.name}: ${lines.length} line(s); ` + accounts.map((x) =>
        `${x.account} ${x.opening_ulxc} + ${x.in_ulxc} − ${x.out_ulxc} = ${x.closing_ulxc}`).join('; ') })
      const off = accounts.filter((x) => x.opening_ulxc + x.in_ulxc - x.out_ulxc !== x.closing_ulxc)
      if (accounts.length === 0 || off.length > 0) return fail(`opening + in − out ≠ closing for ${off.map((x) => x.account).join(', ') || 'no account at all'}`)
      const entries = new Map<string, number>()
      for (const l of lines) entries.set(l.entry_id, (entries.get(l.entry_id) ?? 0) + l.amount_ulxc)
      const lopsided = [...entries].filter(([, n]) => n !== 0)
      if (lopsided.length > 0) return fail(`${lopsided.length} entr(ies) do not sum to zero: ${lopsided.map(([id, n]) => `${id} ${n}`).join(', ')}`)
      const b = await bookOf(ctx)
      const closing = (account: string) => accounts.find((x) => x.account === account)?.closing_ulxc ?? 0
      for (const x of [north, south]) {
        const held = agentIn(b, x.id)?.balance_ulxc
        if (closing(`agent:${x.id}`) !== held) return fail(`the statement closes ${x.name} at ${closing(`agent:${x.id}`)} µLXC; Lens's book says ${held}`)
      }
      if (closing('spend') !== ledgerSpent || b.spent_ulxc !== ledgerSpent) {
        return fail(`the statement's spend is ${closing('spend')} µLXC, the book's ${b.spent_ulxc}, the ledger's spend row for the request ${ledgerSpent}`)
      }
      return { pass: true, detail: `${lines.length} lines over ${entries.size} balanced entries; each account adds up, closes at the agent's balance, and spend = the ledger's ${ledgerSpent} µLXC` }
    }),
  }
}

/** B28.20 — fundings sent at once, through Lens as the owner; its per-workspace limit (100 a second) is waited out. */
const MANY_FUNDINGS = 100
const FUNDING_WORKERS = 5
const RATE_LIMITED_RETRIES = 30

/** The balance the Agent Wallets row shows for `ulxc` (apps/web agentBankApi.ts formatULXC). */
const shownLXC = (ulxc: number): string => `${(ulxc / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 })} LXC`

/** Funds `agent` once for each amount, FUNDING_WORKERS at a time; the first refusal, if any. */
async function fundAtOnce(ctx: ScenarioCtx, agent: Agent, amounts: number[]): Promise<string | undefined> {
  const queue = [...amounts]
  const refused: string[] = []
  await Promise.all(Array.from({ length: FUNDING_WORKERS }, async () => {
    for (let n = queue.pop(); n !== undefined && refused.length === 0; n = queue.pop()) {
      for (let tries = 0; ; tries++) {
        try {
          await ctx.env.lens.fundAgent(ctx.app.user, agent.id, n)
          break
        } catch (e) {
          // A 429 is refused before the handler runs, so asking again cannot fund twice.
          if (/answered 429/.test(String(e)) && tries < RATE_LIMITED_RETRIES) {
            await new Promise((r) => setTimeout(r, 1_000))
            continue
          }
          refused.push(`funding ${n} µLXC: ${String(e)}`)
          break
        }
      }
    }
  }))
  return refused[0]
}

export function agentBalanceStored(seed: number): Scenario {
  // Each funding a different amount, so a posting lost or counted twice moves the total by one no other does.
  const amounts = Array.from({ length: MANY_FUNDINGS }, (_, k) => 1_000 + k)
  const total = amounts.reduce((s, n) => s + n, 0)
  return {
    id: 'agent-balance-stored',
    title: `an agent funded ${MANY_FUNDINGS} times at once holds exactly their sum: the balance Lens stores, the postings on the statement and the screen all agree`,
    run: (ctx) => withBank(ctx, async (bank) => {
      const before = await bookOf(ctx)
      const a = await openAgent(ctx, bank, `Tally ${seed}`)
      if (typeof a === 'string') return fail(a)
      const refused = await fundAtOnce(ctx, a, amounts)
      if (refused !== undefined) return fail(refused)
      const after = await bookOf(ctx)
      const held = agentIn(after, a.id)?.balance_ulxc
      const file = await bank.statementThisMonth()
      const st = JSON.parse(file.text) as StatementJSON
      const account = `agent:${a.id}`
      const closing = (st.accounts ?? []).find((x) => x.account === account)?.closing_ulxc
      const lines = st.lines ?? []
      const posted = lines.filter((l) => l.account === account)
      const summed = posted.reduce((s, l) => s + l.amount_ulxc, 0)
      ctx.evidence.push({ note: `${file.name}: ${account} has ${posted.length} posting(s) summing to ${summed} µLXC and closes at ${closing}; Lens's stored balance is ${held}` })
      if (posted.length !== MANY_FUNDINGS) return fail(`${MANY_FUNDINGS} fundings wrote ${posted.length} postings to ${a.name}`)
      if (summed !== total || closing !== total) return fail(`${MANY_FUNDINGS} fundings of ${total} µLXC in all: ${a.name}'s postings sum to ${summed} and its statement closes at ${closing}`)
      if (held !== summed) return fail(`Lens's stored balance for ${a.name} is ${held} µLXC; its ${posted.length} postings sum to ${summed}`)
      const entries = new Set(posted.map((l) => l.entry_id))
      const lopsided = [...entries].filter((id) => lines.filter((l) => l.entry_id === id).reduce((s, l) => s + l.amount_ulxc, 0) !== 0)
      if (lopsided.length > 0) return fail(`${lopsided.length} of ${a.name}'s fundings do not sum to zero: ${lopsided.slice(0, 3).join(', ')}`)
      if (after.allocated_ulxc !== before.allocated_ulxc + total) {
        return fail(`the workspace's agents held ${before.allocated_ulxc} µLXC and hold ${after.allocated_ulxc} after ${total} µLXC of fundings`)
      }
      if (after.unallocated_ulxc !== after.workspace_balance_ulxc - after.allocated_ulxc) {
        return fail(`the book does not add up: ${after.workspace_balance_ulxc} ≠ ${after.allocated_ulxc} + ${after.unallocated_ulxc}`)
      }
      const shown = await bank.balanceShown(a)
      const want = `${shownLXC(total)} ${usdShown(total, ctx.env.usdPerLXC)}`
      if (shown !== want) return fail(`Agent Wallets shows ${a.name} holding "${shown}"; its postings sum to ${want}`)
      return { pass: true, detail: `${MANY_FUNDINGS} fundings at once, ${lxcText(total)} LXC: ${a.name}'s stored balance = its ${posted.length} postings = the screen's ${shown}, and the workspace's agents hold that much more` }
    }),
  }
}

/**
 * B28.22 — an agent funded 12.5 LXC on Agent Wallets shows "12.5 LXC ($1.25)" — its dollar value at the
 * peg beside it — and its allowed models are picked from the catalog, not typed: the Rules card's model
 * field is a select, the model picked is the one Lens stores, and the card says so in a sentence.
 */
export function walletCurrency(seed: number): Scenario {
  const amount = 12_500_000
  return {
    id: 'wallet-currency',
    title: 'an agent funded 12.5 LXC shows its dollar value beside it, and its allowed model is picked, not typed: Lens stores exactly the model picked',
    run: (ctx) => withBank(ctx, async (bank) => {
      const a = await openAgent(ctx, bank, `Priced ${seed}`)
      if (typeof a === 'string') return fail(a)
      const err = await bank.move(a, amount, 'Fund')
      if (err !== undefined) return fail(`funding 12.5 LXC was refused: ${err}`)
      const held = agentIn(await bookOf(ctx), a.id)?.balance_ulxc
      if (held !== amount) return fail(`funded ${amount} µLXC; Lens's book has ${a.name} holding ${held}`)
      const shown = await bank.balanceShown(a)
      const want = `12.5 LXC ${usdShown(amount, ctx.env.usdPerLXC)}`
      ctx.evidence.push({ note: `Agent Wallets shows ${a.name} holding "${shown}"` })
      if (shown !== want) return fail(`Agent Wallets shows ${a.name} holding "${shown}"; at $${ctx.env.usdPerLXC} per LXC it should read "${want}"`)
      const model = ctx.env.judgeModel
      const picked = await bank.allowOnlyModel(a, model)
      if (picked.tag !== 'SELECT') return fail(`the Allowed models field for ${a.name} is a ${picked.tag}, not a picker`)
      if (picked.err !== undefined) return fail(`saving ${model} as the only allowed model was refused: ${picked.err}`)
      const stored = (await ctx.env.lens.agentRules(ctx.app.user, a.id)).allowed_models ?? []
      ctx.evidence.push({ note: `Lens stores ${a.name}'s allowed models as ${JSON.stringify(stored)}` })
      if (stored.length !== 1 || stored[0] !== model) return fail(`picked ${model}; Lens stores ${JSON.stringify(stored)}`)
      const words = await bank.rulesInWords(a)
      const name = ctx.env.catalog.find((m) => m.id === model)?.display_name ?? model
      ctx.evidence.push({ note: `the Rules card says: ${words}` })
      if (!words.includes(`It may use only ${name}.`)) return fail(`the Rules card does not say "It may use only ${name}.": ${words}`)
      return { pass: true, detail: `${a.name} reads "${shown}"; ${name} picked from the model picker, stored by Lens as the one allowed model, and stated as a sentence` }
    }),
  }
}

/**
 * B28.21 — an agent renamed and described on Agent Wallets carries both in Lens's book; archived there, Lens
 * writes ONE withdraw posting for its whole balance back to the workspace, and its key then writes no hold:
 * its next request is refused with nothing new on its account or the workspace's ledger.
 */
export function agentArchive(seed: number): Scenario {
  const r = seeded(seed * 43 + 11)
  const amount = 750_000
  return {
    id: 'agent-archive',
    title: 'an agent renamed, described and archived on Agent Wallets: one withdraw posting sweeps its whole balance back to the workspace, and its key then writes no hold',
    run: (ctx) => withBank(ctx, async (bank) => {
      const first = await openAgent(ctx, bank, `Retiring ${seed}`)
      if (typeof first === 'string') return fail(first)
      let err = await bank.move(first, amount, 'Fund')
      if (err !== undefined) return fail(`funding ${lxcText(amount)} LXC was refused: ${err}`)
      const key = await bank.issueKey(first)
      const a = { ...first, name: `Retired ${seed}` }
      const description = `Reads the overnight reports, run ${seed}`
      err = await bank.describe(first, a.name, description)
      if (err !== undefined) return fail(`renaming ${first.name} was refused: ${err}`)
      const before = await bookOf(ctx)
      const named = agentIn(before, a.id)
      if (named?.name !== a.name || named.description !== description) {
        return fail(`renamed "${a.name}" and described "${description}" on the screen; Lens has "${named?.name}" and "${named?.description}"`)
      }
      if (named.balance_ulxc !== amount) return fail(`funded ${amount} µLXC; Lens has ${a.name} holding ${named.balance_ulxc}`)
      const lines0 = await ctx.env.lens.agentLines(ctx.app.user, a.id)
      const done = await bank.archive(a)
      if (done.err !== undefined) return fail(`archiving ${a.name} was refused: ${done.err}`)
      ctx.evidence.push({ note: `Agent Wallets says: ${done.said}` })
      const after = await bookOf(ctx)
      const gone = agentIn(after, a.id)
      if (gone === undefined || !gone.archived_at) return fail(`archived on the screen; Lens's book has ${a.name} ${gone === undefined ? 'gone' : 'not archived'}`)
      const lines1 = await ctx.env.lens.agentLines(ctx.app.user, a.id)
      const swept = lines1.filter((l) => !lines0.some((o) => o.entry_id === l.entry_id))
      ctx.evidence.push({ note: `archiving wrote ${swept.length} line(s) on ${a.name}'s account: ${swept.map((l) => `${l.kind} ${l.amount_ulxc} → ${l.balance_after_ulxc}`).join(', ') || 'none'}` })
      if (swept.length !== 1 || swept[0].kind !== 'withdraw' || swept[0].amount_ulxc !== -amount || swept[0].balance_after_ulxc !== 0) {
        return fail(`archiving ${a.name}, which held ${amount} µLXC, should write one withdraw of -${amount} leaving 0; it wrote ${swept.map((l) => `${l.kind} ${l.amount_ulxc} → ${l.balance_after_ulxc}`).join(', ') || 'nothing'}`)
      }
      if (gone.balance_ulxc !== 0 || after.allocated_ulxc !== before.allocated_ulxc - amount || after.workspace_balance_ulxc !== before.workspace_balance_ulxc) {
        return fail(`archived: ${a.name} holds ${gone.balance_ulxc} µLXC; the agents held ${before.allocated_ulxc} and hold ${after.allocated_ulxc}; the workspace ${before.workspace_balance_ulxc} → ${after.workspace_balance_ulxc}`)
      }
      const spends0 = new Set((await spendRows(ctx)).map((x) => x.id))
      const t = await agentAsks(ctx, key, sum(r).q, `${a.name}'s key, after it was archived`)
      if (t.ok) return fail(`archived, ${a.name}'s key was still served: "${t.value.text}"`)
      const late = (await ctx.env.lens.agentLines(ctx.app.user, a.id)).filter((l) => !lines1.some((o) => o.entry_id === l.entry_id))
      const charged = (await spendRows(ctx)).filter((x) => !spends0.has(x.id))
      if (late.length > 0 || charged.length > 0) {
        return fail(`archived, ${a.name}'s key was refused (${t.status}) yet wrote ${late.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ') || 'nothing'} on its account and ${charged.length} spend row(s) on the ledger`)
      }
      return { pass: true, detail: `${a.name} renamed and described; archived: one withdraw of ${lxcText(amount)} LXC back to the workspace, balance 0, and its key refused (${t.status}) with no hold and no charge` }
    }),
  }
}
