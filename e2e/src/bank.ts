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
import type { Agent, AgentBook, AgentLine, AgentRulesRead, Answered, JudgeReply, SyntheticUser } from './lens.ts'
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
/** A listing's seller keeps 85% of its price (Lens's LENS_MARKET_TAKE_BPS=1500, Nicolai's decision of 5 Oct 2026). */
const SELLER_SHARE_BPS = 8_500

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
    await s.ready()
    return s
  }

  async close(): Promise<void> {
    await this.page.close()
  }

  /** The book is read: its totals, or (B28.271) with no agents yet, the card that creates the first. */
  private async ready(): Promise<void> {
    await this.page.getByTestId('agent-bank-totals').or(this.page.getByTestId('agent-first')).first().waitFor()
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
    await this.ready()
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

  /** B28.26 — sets how many requests a minute the agent may make on the Rules card, and saves its rules. */
  async setRate(agent: Agent, perMinute: number): Promise<string | undefined> {
    await this.fresh(agent)
    const box = this.page.getByLabel(`Requests per minute for ${agent.name}`)
    await box.waitFor()
    await box.fill(String(perMinute))
    const form = this.page.locator('form').filter({ has: box })
    await form.getByRole('button', { name: 'Save rules' }).click()
    return outcome(form.getByRole('status').filter({ hasText: /^Saved\./ }), form)
  }

  /**
   * B28.27 — marks, on the Rules card, the payees `agent` may pay and those it may not (each one of the
   * workspace's other agents), and saves its rules.
   */
  async setPayees(agent: Agent, payees: { allow: Agent[]; block: Agent[] }): Promise<string | undefined> {
    await this.fresh(agent)
    const save = this.page.getByRole('button', { name: 'Save rules' })
    await save.waitFor()
    for (const p of payees.allow) await this.page.getByRole('button', { name: `${agent.name} may pay ${p.name}`, exact: true }).click()
    for (const p of payees.block) await this.page.getByRole('button', { name: `${agent.name} may not pay ${p.name}`, exact: true }).click()
    const form = this.page.locator('form').filter({ has: save })
    await save.click()
    return outcome(form.getByRole('status').filter({ hasText: /^Saved\./ }), form)
  }

  /**
   * B28.28 — types, on the Rules card, what `agent` may pay each payee (one of the workspace's other agents) in a
   * day, and saves its rules.
   */
  async setPayeeDailyCaps(agent: Agent, caps: { payee: Agent; ulxc: number }[]): Promise<string | undefined> {
    await this.fresh(agent)
    const save = this.page.getByRole('button', { name: 'Save rules' })
    await save.waitFor()
    for (const c of caps) await this.page.getByLabel(`Daily limit on payments to ${c.payee.name} from ${agent.name}, in LXC`, { exact: true }).fill(lxcText(c.ulxc))
    const form = this.page.locator('form').filter({ has: save })
    await save.click()
    return outcome(form.getByRole('status').filter({ hasText: /^Saved\./ }), form)
  }

  /** B28.30 — asks Would it pass? whether `from`'s rules would let a payment of `ulxc` to `to` through; the card's answer. */
  async wouldPass(from: Agent, to: Agent, ulxc: number): Promise<string> {
    await this.fresh(from)
    const c = card(this.page, 'Would it pass?')
    await c.getByRole('group', { name: 'What to try' }).getByRole('button', { name: 'A payment', exact: true }).click()
    await c.getByLabel(`Who ${from.name} would pay`).selectOption(to.id)
    await c.getByLabel(`Amount in LXC to try for ${from.name}`).fill(lxcText(ulxc))
    await c.getByRole('button', { name: 'Would it pass?', exact: true }).click()
    const said = c.getByRole('status').or(c.getByRole('alert')).first()
    await said.waitFor({ timeout: ACTION_TIMEOUT_MS })
    return (await said.innerText()).trim()
  }

  /** B28.31 — rolls the agent's rules back to `version` on Rules history; undefined, or the refusal's words. */
  async rollBackRules(agent: Agent, version: number): Promise<string | undefined> {
    await this.fresh(agent)
    const c = card(this.page, 'Rules history')
    await c.getByRole('button', { name: `Roll ${agent.name}’s rules back to version ${version}`, exact: true }).click()
    return outcome(c.getByRole('status').filter({ hasText: `back as they were at version ${version}` }), c)
  }

  /**
   * B28.32 — raises one of the agent's limits on Limit boost to `ulxc` until `until` (epoch ms, a whole minute: the
   * Until field holds the browser's local time to the minute); undefined, or the refusal's words.
   */
  async boostLimit(agent: Agent, label: string, ulxc: number, until: number): Promise<string | undefined> {
    await this.fresh(agent)
    const c = card(this.page, 'Limit boost')
    await c.getByLabel(`Limit to raise for ${agent.name}`).selectOption({ label })
    await c.getByLabel(`Raise ${agent.name}’s limit to`).fill(lxcText(ulxc))
    const local = await this.page.evaluate((ms) => {
      const d = new Date(ms)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
    }, until)
    await c.getByLabel(`Raise ${agent.name}’s limit until`).fill(local)
    await c.getByRole('button', { name: 'Raise until then' }).click()
    return outcome(c.getByRole('status').filter({ hasText: 'again by itself' }), c)
  }

  /** B28.31 — what Rules history says of one version: how it came to be, by whom, and what it changed. */
  async rulesVersion(version: number): Promise<string> {
    const row = card(this.page, 'Rules history').getByTestId(`rules-version-${version}`)
    await row.waitFor({ timeout: ACTION_TIMEOUT_MS })
    return (await row.innerText()).replace(/\s+/g, ' ').trim()
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

  /**
   * B28.25 — gives each model its own daily cap on the Rules card: picked from the "Cap a model a day"
   * select (or found already capped), its amount typed, and the rules saved.
   */
  async setModelLimits(agent: Agent, caps: { model: string; name: string; ulxc: number }[]): Promise<string | undefined> {
    await this.fresh(agent)
    const picker = this.page.getByLabel(`Cap a model a day for ${agent.name}`)
    await picker.waitFor()
    for (const c of caps) {
      const box = this.page.getByLabel(`Daily limit on ${c.name} for ${agent.name}, in LXC`)
      if (!(await box.isVisible())) {
        await picker.locator(`option[value="${c.model}"]`).waitFor({ state: 'attached' })
        await picker.selectOption(c.model)
      }
      await box.fill(lxcText(c.ulxc))
    }
    const form = this.page.locator('form').filter({ has: picker })
    await form.getByRole('button', { name: 'Save rules' }).click()
    return outcome(form.getByRole('status').filter({ hasText: /^Saved\./ }), form)
  }

  /**
   * B28.305 — creates an agent from a rule template ("Support bot", "Researcher", "Coder") picked under
   * "Start from"; the screen opens it. The refusal, if Lens refused the agent or its template's rules.
   */
  async createFrom(name: string, template: string): Promise<string | undefined> {
    const form = this.page.locator('form').filter({ has: this.page.getByLabel('New agent name') })
    await form.getByRole('group', { name: 'Rules to start from' }).getByRole('button', { name: template, exact: true }).click()
    await this.page.getByLabel('New agent name').fill(name)
    await form.getByRole('button', { name: 'Create agent' }).click()
    const err = await outcome(this.page.getByTestId('agent-open').filter({ hasText: new RegExp(`^${esc(name)}$`) }), form)
    if (err !== undefined) return err
    const unsaved = form.getByRole('alert')
    return (await unsaved.isVisible()) ? (await unsaved.innerText()).trim() : undefined
  }

  /** B28.305 — fills the agent's Rules card from a template and saves its rules. */
  async applyTemplate(agent: Agent, template: string): Promise<string | undefined> {
    await this.fresh(agent)
    const group = this.page.getByRole('group', { name: `Rule templates for ${agent.name}` })
    await group.getByRole('button', { name: template, exact: true }).click()
    const form = this.page.locator('form').filter({ has: group })
    await form.getByRole('button', { name: 'Save rules' }).click()
    return outcome(form.getByRole('status').filter({ hasText: /^Saved\./ }), form)
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
    // B29.11 — the kind is picked by its icon, one toggle of the group named Kind.
    await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Prompt', exact: true }).click()
    // A label that wraps a select or a hint names its control with them too: matched by its start.
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

/** Creates an agent on the screen — from a rule template, when named — and finds it in Lens's book, owned by the person who made it. */
export async function openAgent(ctx: ScenarioCtx, bank: AgentBankScreen, name: string, template?: string): Promise<Agent | string> {
  const err = template === undefined ? await bank.create(name) : await bank.createFrom(name, template)
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
async function agentAsks(ctx: ScenarioCtx, key: string, prompt: string, note: string, modelID = ctx.env.judgeModel): Promise<Answered<JudgeReply>> {
  const { env, app } = ctx
  const model = env.catalog.find((m) => m.id === modelID)
  if (model === undefined) throw new Error(`the catalog has no model ${modelID}`)
  const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(prompt.length), AGENT_MAX_TOKENS))
  let r: Answered<JudgeReply>
  try {
    r = await env.lens.askAsAgent(key, env.judgeProvider, modelID, prompt, AGENT_MAX_TOKENS)
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

/**
 * B28.25 — the DONE line: an Opus hold over its daily cap writes nothing while a Haiku hold writes one
 * posting. Both caps are set on Agent Wallets' Rules card — a model picked, its amount typed — and Lens
 * judges them in its hold, before the provider, so the refused model is never called. Where the catalog
 * has no Opus beside the judge model, its dearest sibling from the same provider stands in.
 */
export function agentModelLimit(seed: number): Scenario {
  const r = seeded(seed * 41 + 13)
  return {
    id: 'agent-model-limit',
    title: 'a daily cap on one model, set on Agent Wallets, refuses a request to it with no posting while another model under its own cap writes one',
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env } = ctx
      const cheap = env.catalog.find((m) => m.id === env.judgeModel)
      const siblings = env.catalog.filter((m) => m.provider === env.judgeProvider && m.id !== env.judgeModel && !m.deprecated)
      const dear = siblings.find((m) => /opus/i.test(m.id)) ?? [...siblings].sort((x, y) => y.output_per_1m - x.output_per_1m)[0]
      if (cheap === undefined || dear === undefined) throw new CannotTest(`the catalog has no second ${env.judgeProvider} model to cap beside ${env.judgeModel}`)
      const a = await openAgent(ctx, bank, `Per model ${seed}`)
      if (typeof a === 'string') return fail(a)
      let err = await bank.move(a, 1e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setModelLimits(a, [
        { model: dear.id, name: dear.display_name, ulxc: 1 },
        { model: cheap.id, name: cheap.display_name, ulxc: 1e6 },
      ])
      if (err !== undefined) return fail(`the per-model daily limits were not saved: ${err}`)
      const stored = (await env.lens.agentRules(ctx.app.user, a.id)).model_daily_limits_ulxc ?? {}
      ctx.evidence.push({ note: `Lens stores ${a.name}'s per-model daily limits as ${JSON.stringify(stored)}` })
      const key = await bank.issueKey(a)
      const { q, want } = sum(r)
      const lines0 = await env.lens.agentLines(ctx.app.user, a.id)
      const spends0 = new Set((await spendRows(ctx)).map((x) => x.id))
      const refused = await agentAsks(ctx, key, q, `${dear.id}, past its daily limit of 0.000001 LXC`, dear.id)
      if (refused.ok) return fail(`${dear.id}'s daily limit of 0.000001 LXC let a request through: "${refused.value.text}"`)
      if (refused.status !== 403 || !/daily limit .* for the model/.test(refused.error)) {
        return fail(`${dear.id} was refused, but not by its daily limit: ${refused.status} ${refused.error}`)
      }
      const lines1 = await env.lens.agentLines(ctx.app.user, a.id)
      const early = lines1.filter((l) => !lines0.some((o) => o.entry_id === l.entry_id))
      const charged0 = (await spendRows(ctx)).filter((x) => !spends0.has(x.id))
      if (early.length > 0 || charged0.length > 0) {
        return fail(`${dear.id} was refused by its daily limit, yet it wrote ${early.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ') || 'nothing'} on ${a.name}'s account and ${charged0.length} spend row(s) on the ledger`)
      }
      const served = await agentAsks(ctx, key, q, `${cheap.id}, under its daily limit of 1 LXC`)
      if (!served.ok) return fail(`${cheap.id}, under its own daily limit, was refused: ${served.status} ${served.error}`)
      if (!statesNumber(served.value.text, want)) return fail(`answered wrong: expected ${want}, got "${served.value.text}"`)
      const late = (await env.lens.agentLines(ctx.app.user, a.id)).filter((l) => !lines1.some((o) => o.entry_id === l.entry_id))
      const posted = late.filter(requestLine)
      const charged = (await spendRows(ctx)).filter((x) => !spends0.has(x.id))
      if (posted.length !== 1 || charged.length !== 1) {
        return fail(`${cheap.id} under its daily limit: ${a.name}'s account has ${late.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ') || 'nothing'} new and the ledger ${charged.length} spend row(s); want one ${posted[0]?.kind ?? 'hold'} posting and one spend row`)
      }
      return { pass: true, detail: `${dear.id} over its daily limit: refused (403) with no posting and no charge; ${cheap.id} under its own: one ${posted[0].kind} posting (${posted[0].amount_ulxc} µLXC) and one spend row` }
    }),
  }
}

/** B28.26 — the cap the DONE line names, and how many of its requests are in flight at once. */
const PER_MINUTE = 60
const RATE_CONCURRENCY = 10

/**
 * B28.26 — the DONE line: the 61st request in a minute under a 60/min rule writes no hold. The rule is set
 * on Agent Wallets' Rules card; the first 60 requests, each a different sum, are sent ten at a time so they
 * all land well inside one minute, and each writes one posting. The 61st is refused by the rule (429, not
 * 403: it would go through once the minute has room) before the provider, with no posting and no charge.
 */
export function agentRequestRate(seed: number): Scenario {
  const r = seeded(seed * 43 + 17)
  return {
    id: 'agent-request-rate',
    title: `the ${PER_MINUTE + 1}st request in a minute under a ${PER_MINUTE}-a-minute rule set on Agent Wallets is refused with no hold; the ${PER_MINUTE} before it each write one`,
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env } = ctx
      const a = await openAgent(ctx, bank, `Rate ${seed}`)
      if (typeof a === 'string') return fail(a)
      let err = await bank.move(a, 1e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setRate(a, PER_MINUTE)
      if (err !== undefined) return fail(`the requests-per-minute rule was not saved: ${err}`)
      const stored = (await env.lens.agentRules(ctx.app.user, a.id)).requests_per_minute
      if (stored !== PER_MINUTE) return fail(`saved ${PER_MINUTE} requests a minute on the screen; Lens holds ${stored}`)
      const key = await bank.issueKey(a)
      // A different sum each: the same question twice could be answered from a cache rather than asked.
      const asks = Array.from({ length: PER_MINUTE + 1 }, (_, k) => {
        const x = 1000 + Math.floor(r() * 9000)
        return { q: `What is ${x} + ${100 + k}? ${NUMBER_ONLY}`, want: x + 100 + k }
      })
      const lines0 = await env.lens.agentLines(ctx.app.user, a.id)
      const started = Date.now()
      const refusedEarly: string[] = []
      let next = 0
      await Promise.all(Array.from({ length: RATE_CONCURRENCY }, async () => {
        while (next < PER_MINUTE) {
          const k = next++
          const got = await agentAsks(ctx, key, asks[k].q, `request ${k + 1} of ${PER_MINUTE}, under ${PER_MINUTE} a minute`)
          if (!got.ok) refusedEarly.push(`request ${k + 1}: ${got.status} ${got.error}`)
        }
      }))
      const took = Date.now() - started
      if (refusedEarly.length > 0) return fail(`under a rule of ${PER_MINUTE} a minute, ${refusedEarly.length} of the first ${PER_MINUTE} were refused: ${refusedEarly.slice(0, 3).join('; ')}`)
      const lines1 = await env.lens.agentLines(ctx.app.user, a.id)
      const served = lines1.filter((l) => !lines0.some((o) => o.entry_id === l.entry_id)).filter(requestLine)
      if (served.length !== PER_MINUTE) return fail(`${PER_MINUTE} requests were served and ${a.name}'s account has ${served.length} new request posting(s); want one each`)
      const spends1 = new Set((await spendRows(ctx)).map((x) => x.id))
      const last = await agentAsks(ctx, key, asks[PER_MINUTE].q, `request ${PER_MINUTE + 1}, past ${PER_MINUTE} a minute`)
      const at = Date.now() - started
      if (last.ok) return fail(`the ${PER_MINUTE + 1}st request, ${at} ms after the first, was served under a rule of ${PER_MINUTE} a minute: "${last.value.text}"`)
      if (last.status !== 429 || !/requests a minute/.test(last.error)) {
        return fail(`the ${PER_MINUTE + 1}st request was refused, but not by the requests-per-minute rule: ${last.status} ${last.error}`)
      }
      const wrote = (await env.lens.agentLines(ctx.app.user, a.id)).filter((l) => !lines1.some((o) => o.entry_id === l.entry_id))
      const charged = (await spendRows(ctx)).filter((x) => !spends1.has(x.id))
      if (wrote.length > 0 || charged.length > 0) {
        return fail(`the ${PER_MINUTE + 1}st request was refused (429), yet it wrote ${wrote.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ') || 'nothing'} on ${a.name}'s account and ${charged.length} spend row(s) on the ledger`)
      }
      return { pass: true, detail: `${PER_MINUTE} requests in ${took} ms: one ${served[0].kind} posting each; the ${PER_MINUTE + 1}st, at ${at} ms, refused (429) with no posting and no charge` }
    }),
  }
}

/**
 * B28.27 — the DONE line: no pay posting to a blocked payee; one to an allowed payee. On Agent Wallets'
 * Rules card the payer blocks one of the workspace's agents and allows another, and Lens holds exactly
 * those lists. A payment to the blocked one, from Pay another agent, is refused by the payee rule and
 * writes no pay posting on either account; one to the allowed one writes exactly its pair.
 */
export function agentPayeeLists(seed: number): Scenario {
  return {
    id: 'agent-payee-lists',
    title: 'a payment to a payee the agent\'s rules block posts nothing; one to a payee they allow posts its pair',
    run: (ctx) => withBank(ctx, async (bank) => {
      const opened: Agent[] = []
      for (const name of [`Payer ${seed}`, `Blocked ${seed}`, `Allowed ${seed}`]) {
        const a = await openAgent(ctx, bank, name)
        if (typeof a === 'string') return fail(a)
        opened.push(a)
      }
      const [payer, blocked, allowed] = opened
      let err = await bank.move(payer, 2e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setPayees(payer, { allow: [allowed], block: [blocked] })
      if (err !== undefined) return fail(`the payee lists were not saved: ${err}`)
      const stored = await ctx.env.lens.agentRules(ctx.app.user, payer.id)
      if (JSON.stringify(stored.allowed_payees) !== JSON.stringify([allowed.id]) || JSON.stringify(stored.blocked_payees) !== JSON.stringify([blocked.id])) {
        return fail(`allowed ${allowed.name} and blocked ${blocked.name} on the screen; Lens holds allowed ${JSON.stringify(stored.allowed_payees)}, blocked ${JSON.stringify(stored.blocked_payees)}`)
      }
      const pays = async (a: Agent) => (await ctx.env.lens.agentLines(ctx.app.user, a.id)).filter((l) => l.kind === 'pay')

      const refused = await bank.pay(payer, blocked, 500_000, `to a blocked payee ${seed}`)
      ctx.evidence.push({ note: `Pay ${blocked.name} 0.5 LXC: ${refused}` })
      if (!/^Refused\./.test(refused) || !/may not pay/.test(refused)) return fail(`a payment to the blocked ${blocked.name} was not refused by the payee rule: "${refused}"`)
      const [fromBlocked, toBlocked] = [await pays(payer), await pays(blocked)]
      if (fromBlocked.length > 0 || toBlocked.length > 0) {
        return fail(`the payment to the blocked ${blocked.name} was refused, yet it posted ${fromBlocked.length} pay line(s) on ${payer.name} and ${toBlocked.length} on ${blocked.name}`)
      }

      const paid = await bank.pay(payer, allowed, 500_000, `to an allowed payee ${seed}`)
      ctx.evidence.push({ note: `Pay ${allowed.name} 0.5 LXC: ${paid}` })
      if (!/^Paid /.test(paid)) return fail(`a payment to the allowed ${allowed.name} was not paid: "${paid}"`)
      const [from, to] = [await pays(payer), await pays(allowed)]
      if (from.length !== 1 || from[0].amount_ulxc !== -500_000 || to.length !== 1 || to[0].amount_ulxc !== 500_000) {
        return fail(`after one 0.5 LXC payment to the allowed ${allowed.name}, ${payer.name} has pay line(s) ${JSON.stringify(from)} and ${allowed.name} ${JSON.stringify(to)}`)
      }
      if ((await pays(blocked)).length > 0) return fail(`${blocked.name} has a pay line, though nothing was paid to it`)
      return { pass: true, detail: `${blocked.name} blocked and ${allowed.name} allowed on the screen; the payment to ${blocked.name} refused ("${refused}") with no pay posting; the one to ${allowed.name} posted -0.5 / +0.5 LXC` }
    }),
  }
}

/**
 * B28.28 — the DONE line: exactly one pay posting for the pair after a second payment over the cap is refused. On
 * Agent Wallets' Rules card the payer caps what it may pay one of the workspace's agents in a day at 0.5 LXC, and
 * Lens holds exactly that cap. A first 0.5 LXC payment to it, from Pay another agent, posts its pair; a second
 * would take the day past the cap, is refused by the payee's daily limit, and leaves exactly that one pair.
 */
export function agentPayeeDailyCap(seed: number): Scenario {
  return {
    id: 'agent-payee-daily-cap',
    title: 'a second payment to one payee past its daily cap is refused and leaves exactly the first pay posting',
    run: (ctx) => withBank(ctx, async (bank) => {
      const opened: Agent[] = []
      for (const name of [`Capped payer ${seed}`, `Capped payee ${seed}`]) {
        const a = await openAgent(ctx, bank, name)
        if (typeof a === 'string') return fail(a)
        opened.push(a)
      }
      const [payer, payee] = opened
      let err = await bank.move(payer, 2e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setPayeeDailyCaps(payer, [{ payee, ulxc: 500_000 }])
      if (err !== undefined) return fail(`the payee's daily cap was not saved: ${err}`)
      const stored = await ctx.env.lens.agentRules(ctx.app.user, payer.id)
      if (JSON.stringify(stored.payee_daily_limits_ulxc) !== JSON.stringify({ [payee.id]: 500_000 })) {
        return fail(`capped ${payee.name} at 0.5 LXC a day on the screen; Lens holds ${JSON.stringify(stored.payee_daily_limits_ulxc)}`)
      }
      const pays = async (a: Agent) => (await ctx.env.lens.agentLines(ctx.app.user, a.id)).filter((l) => l.kind === 'pay')

      const first = await bank.pay(payer, payee, 500_000, `under the payee's cap ${seed}`)
      ctx.evidence.push({ note: `Pay ${payee.name} 0.5 LXC: ${first}` })
      if (!/^Paid /.test(first)) return fail(`a first 0.5 LXC payment, at the cap, was not paid: "${first}"`)

      const second = await bank.pay(payer, payee, 500_000, `over the payee's cap ${seed}`)
      ctx.evidence.push({ note: `Pay ${payee.name} 0.5 LXC again: ${second}` })
      if (!/^Refused\./.test(second) || !/daily limit/.test(second)) return fail(`a second payment past ${payee.name}'s daily cap was not refused by it: "${second}"`)
      const [from, to] = [await pays(payer), await pays(payee)]
      if (from.length !== 1 || from[0].amount_ulxc !== -500_000 || to.length !== 1 || to[0].amount_ulxc !== 500_000) {
        return fail(`after one paid and one refused 0.5 LXC payment to ${payee.name}, ${payer.name} has pay line(s) ${JSON.stringify(from)} and ${payee.name} ${JSON.stringify(to)}`)
      }
      return { pass: true, detail: `${payee.name} capped at 0.5 LXC a day on the screen; the first 0.5 LXC payment posted -0.5 / +0.5 LXC, the second was refused ("${second}") and left exactly that pair` }
    }),
  }
}

/**
 * B28.30 — the DONE line: the simulator says refused for an over-cap request and the postings count is unchanged.
 * An agent funded 2 LXC with a daily limit of 1 LXC asks Would it pass? of a 1.5 LXC payment to another of the
 * workspace's agents: Lens answers Refused, by the daily limit. Asked of 0.5 LXC it answers Allowed. Neither
 * question adds a line to either agent's account, and the payer still holds its 2 LXC.
 */
export function agentRuleSimulator(seed: number): Scenario {
  return {
    id: 'agent-rule-simulator',
    title: 'Would it pass? refuses a payment over the daily limit and allows one under it, and neither posts anything',
    run: (ctx) => withBank(ctx, async (bank) => {
      const opened: Agent[] = []
      for (const name of [`Simulating payer ${seed}`, `Simulated payee ${seed}`]) {
        const a = await openAgent(ctx, bank, name)
        if (typeof a === 'string') return fail(a)
        opened.push(a)
      }
      const [payer, payee] = opened
      let err = await bank.move(payer, 2e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setLimit(payer, 'Daily limit', 1e6)
      if (err !== undefined) return fail(`the daily limit was not saved: ${err}`)
      const postings = async () => ({
        [payer.name]: (await ctx.env.lens.agentLines(ctx.app.user, payer.id)).length,
        [payee.name]: (await ctx.env.lens.agentLines(ctx.app.user, payee.id)).length,
      })
      const before = await postings()

      const refused = await bank.wouldPass(payer, payee, 1_500_000)
      ctx.evidence.push({ note: `Would it pass? 1.5 LXC to ${payee.name}: ${refused}` })
      if (!/^Refused\./.test(refused) || !/daily limit/.test(refused)) return fail(`1.5 LXC over a 1 LXC daily limit was not refused by it: "${refused}"`)
      const allowed = await bank.wouldPass(payer, payee, 500_000)
      ctx.evidence.push({ note: `Would it pass? 0.5 LXC to ${payee.name}: ${allowed}` })
      if (!/^Allowed\./.test(allowed)) return fail(`0.5 LXC under a 1 LXC daily limit was not allowed: "${allowed}"`)

      const after = await postings()
      const held = agentIn(await bookOf(ctx), payer.id)?.balance_ulxc
      if (JSON.stringify(after) !== JSON.stringify(before) || held !== 2e6) {
        return fail(`two simulations moved something: postings ${JSON.stringify(before)} → ${JSON.stringify(after)}; ${payer.name} holds ${held} µLXC of 2000000`)
      }
      return { pass: true, detail: `1.5 LXC refused ("${refused}") and 0.5 LXC allowed; postings unchanged at ${JSON.stringify(after)} and ${payer.name} still holds 2 LXC` }
    }),
  }
}

/**
 * B28.349 — B28.83's DONE line: with 1.23 LXC of seeded agent spend, the answer says 1.23 and links the statement row.
 * An agent funded 2 LXC pays another of the workspace's agents 1.23 LXC on Agent Wallets — the pay line Lens posts is
 * the seeded spend. Asked in Chat what that agent spent today, the model answers through Lens's wallet tool: its own
 * words say 1.23, and under them is a link to exactly that pay line on the agent's statement, which opens Agent Wallets
 * with the row marked. Asking moves nothing: the agent's account has the same lines after. Until Lens offers Chat
 * wallet_agents_spend (talyvor-lens B28.83) there is no tool to answer with, and this is a SKIP.
 */
export function agentSpendQuestion(seed: number): Scenario {
  return {
    id: 'agent-spend-question',
    title: 'Asked what an agent spent, Chat answers 1.23 LXC through Lens’s wallet tool and links the statement line',
    run: async (ctx) => {
      const page = ctx.app.page
      const offered = await page.evaluate(async () => {
        const r = await fetch('/api/chat/tools', { credentials: 'same-origin' })
        return r.ok ? ((await r.json()) as { tools?: { name: string }[] }).tools?.map((t) => t.name) ?? [] : []
      })
      if (!offered.includes('wallet_agents_spend')) throw new CannotTest('Lens offers Chat no wallet_agents_spend tool yet (talyvor-lens B28.83)')
      return withBank(ctx, async (bank) => {
        const opened: Agent[] = []
        for (const name of [`Spending payer ${seed}`, `Spending payee ${seed}`]) {
          const a = await openAgent(ctx, bank, name)
          if (typeof a === 'string') return fail(a)
          opened.push(a)
        }
        const [payer, payee] = opened
        const err = await bank.move(payer, 2e6, 'Fund')
        if (err !== undefined) return fail(`funding was refused: ${err}`)
        ctx.evidence.push({ note: `paid: ${await bank.pay(payer, payee, 1_230_000, 'research')}` })
        const before = await ctx.env.lens.agentLines(ctx.app.user, payer.id)
        const seeded = before.find((l) => l.kind === 'pay' && l.amount_ulxc === -1_230_000)
        if (seeded === undefined) return fail(`${payer.name}'s account on Lens has no pay line of -1230000 µLXC: ${JSON.stringify(before)}`)

        const t = await ctx.app.ask(`What did ${payer.name} spend today?`)
        const turn = page.locator('[data-testid="turn-assistant"]').last()
        const lines = turn.getByTestId('turn-statement-lines')
        const listed = (await lines.count()) > 0 ? (await lines.innerText()).trim() : ''
        const said = t.answer.replace(listed, '').trim()
        const hrefs = (await lines.count()) > 0 ? await lines.getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? '')) : []
        ctx.evidence.push({ question: t.question, answer: said, footer: t.footerText, error: t.error, note: `statement links: ${hrefs.join(' ')}` })
        if (t.error !== undefined) return fail(`the question was refused: ${t.error}`)
        if (!/(^|[^\d.])1\.23(?![\d])/.test(said)) return fail(`the answer does not say 1.23: "${said}"`)
        const want = `/agents?agent=${encodeURIComponent(payer.id)}&entry=${encodeURIComponent(seeded.entry_id)}`
        if (!hrefs.includes(want)) return fail(`no link to the pay line ${seeded.entry_id} under the answer (want ${want}): ${JSON.stringify(hrefs)}`)

        const opens = await ctx.app.tab(want)
        try {
          const row = opens.getByTestId('statement-line-linked')
          await row.waitFor({ timeout: ACTION_TIMEOUT_MS })
          const rowText = (await row.innerText()).trim()
          if ((await row.getAttribute('aria-current')) !== 'true' || !/1\.23 LXC/.test(rowText)) return fail(`the link opened a row that is not the pay line marked: "${rowText}"`)
        } finally {
          await opens.close()
        }
        const after = await ctx.env.lens.agentLines(ctx.app.user, payer.id)
        if (after.length !== before.length) return fail(`asking moved money: ${payer.name}'s account went from ${before.length} lines to ${after.length}`)
        return { pass: true, detail: `"${said}" — linked to ${seeded.entry_id}, the -1230000 µLXC pay line on ${payer.name}'s account, which opened marked; the account still has ${after.length} lines` }
      })
    },
  }
}

/**
 * B28.31 — the DONE line: rolling back restores the earlier agent_rules exactly and records who changed it. An agent's
 * rules are saved with a daily limit of 1 LXC (version 1), then changed twice on Agent Wallets — a 3 LXC daily limit, then
 * a 0.5 LXC approval amount. Rolled back to version 1 on Rules history, Lens's rules read is byte for byte what it was at
 * version 1, and Lens's newest version is "rollback to 1" by the same credential that saved version 1 — the session's.
 */
export function agentRulesRollback(seed: number): Scenario {
  return {
    id: 'agent-rules-rollback',
    title: 'Rolling an agent’s rules back on Rules history restores the earlier rules exactly and records who did it',
    run: (ctx) => withBank(ctx, async (bank) => {
      const a = await openAgent(ctx, bank, `Rolled back ${seed}`)
      if (typeof a === 'string') return fail(a)
      let err = await bank.setLimit(a, 'Daily limit', 1e6)
      if (err !== undefined) return fail(`the 1 LXC daily limit was not saved: ${err}`)
      const first = (await ctx.env.lens.agentRulesHistory(ctx.app.user, a.id))[0]
      if (first?.version !== 1 || first.change !== 'set') return fail(`saving the first rules made no version 1 "set": ${JSON.stringify(first)}`)
      const was = JSON.stringify(await ctx.env.lens.agentRules(ctx.app.user, a.id))
      err = await bank.setLimit(a, 'Daily limit', 3e6)
      if (err !== undefined) return fail(`the 3 LXC daily limit was not saved: ${err}`)
      err = await bank.setLimit(a, 'Ask a person above', 500_000)
      if (err !== undefined) return fail(`the 0.5 LXC approval amount was not saved: ${err}`)
      const changed = JSON.stringify(await ctx.env.lens.agentRules(ctx.app.user, a.id))
      if (changed === was) return fail(`two saves left Lens's rules as they were: ${changed}`)

      err = await bank.rollBackRules(a, 1)
      if (err !== undefined) return fail(`rolling back to version 1 was refused: ${err}`)
      const now = JSON.stringify(await ctx.env.lens.agentRules(ctx.app.user, a.id))
      ctx.evidence.push({ note: `Lens's rules at version 1: ${was}; after the rollback: ${now}` })
      if (now !== was) return fail(`the rollback did not restore version 1 exactly: Lens holds ${now}, version 1 was ${was}`)
      const versions = await ctx.env.lens.agentRulesHistory(ctx.app.user, a.id)
      const newest = versions[0]
      ctx.evidence.push({ note: `Lens's versions: ${versions.map((v) => `${v.version} ${v.change} by ${v.changed_by || '(nobody)'}`).join('; ')}` })
      if (versions.length !== 4 || newest.change !== 'rollback to 1' || newest.changed_by === '' || newest.changed_by !== first.changed_by) {
        return fail(`the rollback was not recorded as version 4, "rollback to 1", by ${first.changed_by || '(nobody)'}: ${versions.map((v) => `${v.version} ${v.change} by ${v.changed_by || '(nobody)'}`).join('; ')}`)
      }
      const row = await bank.rulesVersion(4)
      if (!row.includes('Rolled back to version 1 by you')) return fail(`Rules history does not say who rolled back: "${row}"`)
      return { pass: true, detail: `rolled back to version 1: Lens's rules are byte for byte version 1's (${now}); version 4 "rollback to 1" by ${newest.changed_by}, and Rules history reads "${row}"` }
    }),
  }
}

/**
 * B28.32 — the DONE line: after expiry a hold at the boosted size writes nothing. An agent funded 1 LXC with a daily
 * limit of 0.000001 LXC has it raised on Limit boost to 1 LXC until a whole minute one to two minutes away. Before that
 * time its question is served — one hold posting and one spend row. From that time on Lens lists no boost, its rules
 * read still says 0.000001 LXC, and the same question is refused by that daily limit with nothing on the agent's
 * account and no spend row on the ledger.
 */
export function agentLimitBoost(seed: number): Scenario {
  const r = seeded(seed * 43 + 17)
  return {
    id: 'agent-limit-boost',
    title: 'a daily limit raised on Limit boost lets a request through until its time; after it the same request is refused and writes nothing',
    run: (ctx) => withBank(ctx, async (bank) => {
      const a = await openAgent(ctx, bank, `Boosted ${seed}`)
      if (typeof a === 'string') return fail(a)
      let err = await bank.move(a, 1e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setLimit(a, 'Daily limit', 1)
      if (err !== undefined) return fail(`the daily limit was not saved: ${err}`)
      const key = await bank.issueKey(a)
      const { q, want } = sum(r)
      const until = Math.ceil((Date.now() + 60_000) / 60_000) * 60_000
      err = await bank.boostLimit(a, 'Daily limit', 1e6, until)
      if (err !== undefined) return fail(`the boost was refused: ${err}`)
      const boost = (await ctx.env.lens.agentBoosts(ctx.app.user, a.id)).find((b) => b.rule === 'daily_limit_ulxc')
      if (boost?.value !== 1e6 || boost.raised_from !== 1 || Date.parse(boost.until) !== until) {
        return fail(`Lens does not hold the daily limit raised from 1 to 1,000,000 µLXC until ${new Date(until).toISOString()}: ${JSON.stringify(boost)}`)
      }

      const lines0 = await ctx.env.lens.agentLines(ctx.app.user, a.id)
      const spends0 = new Set((await spendRows(ctx)).map((x) => x.id))
      const served = await agentAsks(ctx, key, q, 'under the daily limit raised to 1 LXC')
      if (!served.ok) return fail(`with the daily limit raised to 1 LXC the request was refused: ${served.status} ${served.error}`)
      if (Date.now() >= until) return fail(`the request under the boost finished only after its time (${new Date(until).toISOString()}), so it proves nothing`)
      if (!statesNumber(served.value.text, want)) return fail(`answered wrong: expected ${want}, got "${served.value.text}"`)
      const lines1 = await ctx.env.lens.agentLines(ctx.app.user, a.id)
      const spends1 = await spendRows(ctx)
      const posted = lines1.filter((l) => !lines0.some((o) => o.entry_id === l.entry_id)).filter(requestLine)
      const charged = spends1.filter((x) => !spends0.has(x.id))
      if (posted.length !== 1 || charged.length !== 1) {
        return fail(`under the boost: ${posted.length} hold or spend posting(s) on ${a.name}'s account and ${charged.length} spend row(s); want one of each`)
      }

      // From until on Lens reads the rules without the boost. Wait for its own clock to agree before asking again.
      await new Promise((ok) => setTimeout(ok, Math.max(0, until - Date.now()) + 2_000))
      let left = await ctx.env.lens.agentBoosts(ctx.app.user, a.id)
      for (let i = 0; i < 15 && left.length > 0; i++) {
        await new Promise((ok) => setTimeout(ok, 2_000))
        left = await ctx.env.lens.agentBoosts(ctx.app.user, a.id)
      }
      if (left.length > 0) return fail(`30 seconds after its time Lens still lists the boost: ${JSON.stringify(left)}`)
      const rules = await ctx.env.lens.agentRules(ctx.app.user, a.id)
      if (rules.daily_limit_ulxc !== 1) return fail(`the rules' daily limit is ${rules.daily_limit_ulxc} µLXC after the boost, not the 1 µLXC it was raised from`)

      const refused = await agentAsks(ctx, key, q, 'the same request after the boost ended')
      if (refused.ok) return fail(`after the boost ended the request was served: "${refused.value.text}"`)
      if (refused.status !== 403 || !/daily limit of 0\.000001 LXC/.test(refused.error)) {
        return fail(`refused, but not by the 0.000001 LXC daily limit: ${refused.status} ${refused.error}`)
      }
      const late = (await ctx.env.lens.agentLines(ctx.app.user, a.id)).filter((l) => !lines1.some((o) => o.entry_id === l.entry_id))
      const chargedLate = (await spendRows(ctx)).filter((x) => !spends0.has(x.id) && !charged.some((c) => c.id === x.id))
      ctx.evidence.push({ note: `boost until ${new Date(until).toISOString()}; under it: ${posted[0].kind} ${posted[0].amount_ulxc} µLXC; after it: ${late.length} posting(s), ${chargedLate.length} spend row(s), refused "${refused.error}"` })
      if (late.length > 0 || chargedLate.length > 0) {
        return fail(`after the boost ended the refused request wrote ${late.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ') || 'nothing'} on ${a.name}'s account and ${chargedLate.length} spend row(s) on the ledger`)
      }
      return { pass: true, detail: `under the boost: one ${posted[0].kind} posting (${posted[0].amount_ulxc} µLXC) and one spend row; after ${new Date(until).toISOString()}: no boost listed, the rules still 0.000001 LXC a day, and the same request refused (403) with no posting and no spend row` }
    }),
  }
}

/**
 * B28.305 — the rule templates on Agent Wallets, written here from what each template sets (apps/web
 * ruleTemplates.ts), not imported, like every oracle here: every rule Lens holds, in µLXC.
 */
const TEMPLATE_RULES: Record<'Support bot' | 'Researcher', AgentRulesRead> = (() => {
  const open = { hourly_limit_ulxc: 0, weekly_limit_ulxc: 0, model_daily_limits_ulxc: {}, requests_per_minute: 0, allowed_models: [], allowed_providers: [],
    allowed_listings: [], allowed_payees: [], blocked_payees: [], payee_daily_limits_ulxc: {}, active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false }
  return {
    'Support bot': { ...open, max_per_request_ulxc: 500_000, hourly_limit_ulxc: 20e6, daily_limit_ulxc: 200e6, monthly_limit_ulxc: 4000e6,
      approval_above_ulxc: 5e6, pause_on_unusual_spend: true },
    Researcher: { ...open, max_per_request_ulxc: 10e6, daily_limit_ulxc: 300e6, weekly_limit_ulxc: 1000e6, monthly_limit_ulxc: 3000e6,
      approval_above_ulxc: 20e6 },
  }
})()

/** Each rule where Lens's read-back differs from the template, as "rule: Lens has x, the template y". */
function rulesDiffer(got: AgentRulesRead, want: AgentRulesRead): string[] {
  const norm = (r: AgentRulesRead) => ({ ...r, hourly_limit_ulxc: r.hourly_limit_ulxc ?? 0, weekly_limit_ulxc: r.weekly_limit_ulxc ?? 0,
    model_daily_limits_ulxc: r.model_daily_limits_ulxc ?? {}, requests_per_minute: r.requests_per_minute ?? 0, allowed_models: r.allowed_models ?? [], allowed_providers: r.allowed_providers ?? [],
    allowed_listings: r.allowed_listings ?? [], allowed_payees: r.allowed_payees ?? [], blocked_payees: r.blocked_payees ?? [],
    payee_daily_limits_ulxc: r.payee_daily_limits_ulxc ?? {},
    pause_on_unusual_spend: r.pause_on_unusual_spend ?? false })
  const g = norm(got) as Record<string, unknown>
  const w = norm(want) as Record<string, unknown>
  return Object.keys(w).filter((k) => JSON.stringify(g[k]) !== JSON.stringify(w[k]))
    .map((k) => `${k}: Lens has ${JSON.stringify(g[k])}, the template ${JSON.stringify(w[k])}`)
}

/**
 * B28.29's DONE line, from talyvor-suite: applying a template writes agent_rules equal to the template. A
 * new agent is created from Support bot on Agent Wallets, in one click, and Lens's rules for it are read
 * back; then its Rules card is filled from Researcher and saved, and Lens holds Researcher's rules — the
 * Support bot's hourly cap and pause gone with it, not merged in.
 */
export function agentRuleTemplate(seed: number): Scenario {
  return {
    id: 'agent-rule-template',
    title: 'an agent created from a rule template on Agent Wallets has exactly the template as its rules in Lens; another template applied replaces them whole',
    run: (ctx) => withBank(ctx, async (bank) => {
      const a = await openAgent(ctx, bank, `Template ${seed}`, 'Support bot')
      if (typeof a === 'string') return fail(a)
      const first = await ctx.env.lens.agentRules(ctx.app.user, a.id)
      ctx.evidence.push({ note: `Lens holds ${a.name}'s rules, created from Support bot, as ${JSON.stringify(first)}` })
      let off = rulesDiffer(first, TEMPLATE_RULES['Support bot'])
      if (off.length > 0) return fail(`${a.name}, created from Support bot, does not hold its rules: ${off.join('; ')}`)
      const err = await bank.applyTemplate(a, 'Researcher')
      if (err !== undefined) return fail(`Researcher's rules were not saved for ${a.name}: ${err}`)
      const second = await ctx.env.lens.agentRules(ctx.app.user, a.id)
      ctx.evidence.push({ note: `Lens holds ${a.name}'s rules, filled from Researcher, as ${JSON.stringify(second)}` })
      off = rulesDiffer(second, TEMPLATE_RULES.Researcher)
      if (off.length > 0) return fail(`${a.name}, filled from Researcher and saved, does not hold its rules: ${off.join('; ')}`)
      return { pass: true, detail: `created from Support bot, Lens holds its ${Object.keys(TEMPLATE_RULES['Support bot']).length} rules exactly; filled from Researcher and saved, Lens holds Researcher's exactly` }
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

/** What the app's service worker (apps/web/public/sw.js) declares, as a scenario reaches it. */
interface ApprovalWorker {
  registration: ServiceWorkerRegistration
  decideFromNotification: (n: Notification, action: 'approve' | 'deny') => Promise<void>
}

/**
 * B28.38 — Approve and Deny in the push notification. A payment above the approval amount is held; the
 * push Lens sends for it is delivered to the app's service worker, which must show it with Approve and
 * Deny, and (B29.14) with the app icon as its icon and badge. Approve, run in the service worker on that
 * notification, must move Lens's approval row to approved with no page opened or moved and no money moved;
 * the payment sent again is then paid once.
 */
export function agentApprovalPush(seed: number): Scenario {
  return {
    id: 'agent-approval-push',
    title: 'Approve on the approval push decides it from the service worker: Lens’s row is approved without opening the app',
    run: (ctx) => withBank(ctx, async (bank) => {
      const payer = await openAgent(ctx, bank, `Push payer ${seed}`)
      if (typeof payer === 'string') return fail(payer)
      const payee = await openAgent(ctx, bank, `Push payee ${seed}`)
      if (typeof payee === 'string') return fail(payee)
      let err = await bank.move(payer, 2e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setLimit(payer, 'Ask a person above', 500_000)
      if (err !== undefined) return fail(`the approval amount was not saved: ${err}`)
      const memo = `push check ${seed}`
      const said = await bank.pay(payer, payee, 1e6, memo)
      if (!/waiting in Approvals/.test(said)) return fail(`a payment above the approval amount was not held for a person: "${said}"`)
      const filed = (await ctx.env.lens.agentApprovals(ctx.app.user)).filter((x) => x.agent_id === payer.id)
      if (filed.length !== 1 || filed[0].status !== 'pending') return fail(`Lens has ${filed.length} approval(s) for ${payer.name}: ${JSON.stringify(filed)}`)
      const id = filed[0].id

      // This device takes pushes: the service worker "Notify this device" registers, with notifications allowed.
      const { page } = bank
      const origin = new URL(page.url()).origin
      await ctx.app.context.grantPermissions(['notifications'], { origin })
      const cdp = await ctx.app.context.newCDPSession(page)
      const registered = new Promise<string>((ok) => cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
        const r = registrations.find((x) => x.scopeURL === `${origin}/` && !x.isDeleted)
        if (r !== undefined) ok(r.registrationId)
      }))
      await cdp.send('ServiceWorker.enable')
      await page.evaluate(async () => {
        await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready
      })
      const registrationId = await registered
      const sw = ctx.app.context.serviceWorkers().find((w) => new URL(w.url()).pathname === '/sw.js')
      if (sw === undefined) return fail('/sw.js registered, but no service worker runs it')

      // The push Lens sends for a waiting approval (talyvor-lens economy/agent_approval_auth.go), delivered as a push.
      const push = { type: 'agent_approval', approval_id: id, agent_name: payer.name, amount_ulxc: 1e6, amount_lxc: '1', reason: memo }
      await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(push) })
      const shown = await sw.evaluate(async ({ tag, ms }) => {
        const w = globalThis as unknown as ApprovalWorker
        for (let waited = 0; waited < ms; waited += 100) {
          const [n] = await w.registration.getNotifications({ tag })
          if (n !== undefined) return { title: n.title, icon: n.icon, badge: n.badge, actions: (n as Notification & { actions: { action: string }[] }).actions.map((a) => a.action) }
          await new Promise((ok) => setTimeout(ok, 100))
        }
        return { permission: Notification.permission, shown: (await w.registration.getNotifications()).map((n) => n.tag) }
      }, { tag: id, ms: ACTION_TIMEOUT_MS })
      if (shown.actions === undefined) return fail(`the push for approval ${id} showed no notification (notifications ${shown.permission}; showing ${JSON.stringify(shown.shown)})`)
      ctx.evidence.push({ note: `the push: "${shown.title}" with ${shown.actions.join(', ') || 'no actions'}` })
      if (shown.actions.join() !== 'approve,deny') return fail(`the push for approval ${id} does not carry Approve and Deny: ${JSON.stringify(shown)}`)
      // B29.14: the push carries the Talyvor app icon, as its picture and its badge.
      if (shown.icon !== `${origin}/icon-192.png` || shown.badge !== `${origin}/icon-192.png`) return fail(`the push for approval ${id} does not carry the app icon as icon and badge: ${JSON.stringify(shown)}`)

      // Approve, on the notification — run where the notification's click runs, in the service worker.
      const [pages, at] = [ctx.app.context.pages().length, page.url()]
      await sw.evaluate(async (tag) => {
        const w = globalThis as unknown as ApprovalWorker
        const [n] = await w.registration.getNotifications({ tag })
        await w.decideFromNotification(n, 'approve')
      }, id)
      const state = (await ctx.env.lens.agentApprovals(ctx.app.user)).find((x) => x.id === id)?.status
      ctx.evidence.push({ note: `after Approve on the push, Lens's approval ${id} is ${state ?? 'gone'}` })
      if (state !== 'approved') return fail(`Approve on the push left the approval ${state ?? 'gone'}, not approved`)
      if (ctx.app.context.pages().length !== pages || page.url() !== at) return fail(`Approve on the push opened the app: ${ctx.app.context.pages().map((p) => p.url()).join(', ')}`)
      if ((await ctx.env.lens.agentLines(ctx.app.user, payer.id)).some((l) => l.kind === 'pay')) return fail('money moved on the approval alone, before the payment was sent again')

      // The payment, sent again: paid once against the approval the push decided.
      const again = await bank.pay(payer, payee, 1e6, memo)
      ctx.evidence.push({ note: `Pay again: ${again}` })
      const pays = (await ctx.env.lens.agentLines(ctx.app.user, payer.id)).filter((l) => l.kind === 'pay')
      if (pays.length !== 1 || pays[0].amount_ulxc !== -1e6) return fail(`${payer.name}'s account has ${pays.length} payment line(s): ${JSON.stringify(pays)}`)
      const used = (await ctx.env.lens.agentApprovals(ctx.app.user)).find((x) => x.id === id)?.status
      if (used !== 'used') return fail(`the payment was sent again and the approval is ${used ?? 'gone'}, not used`)
      return { pass: true, detail: `the push showed Approve and Deny and the app icon; Approve in the service worker approved ${id} with no page opened; sent again, paid once (one pay line, the approval used)` }
    }),
  }
}

/**
 * B28.84 — the DONE line: approving the card settles the payment as one posting on the statement. An agent pays another
 * with its own key, above its approval amount, so Lens holds the payment and files an approval. This device makes a
 * passkey on Agent Wallets (a virtual authenticator that verifies the user stands in for Face ID). In Chat the approval
 * is a card naming the payee, the amount and the memo; Approve with Face ID signs Lens's challenge for it. Then Lens's
 * approval is used, each agent's account holds exactly one pay line of 1 LXC, and the card links the payer's.
 */
export function chatApprovalFaceID(seed: number): Scenario {
  return {
    id: 'chat-approval-face-id',
    title: 'an agent’s payment waiting for a person is a card in Chat; approved with Face ID, it is one pay line on the statement',
    run: (ctx) => withBank(ctx, async (bank) => {
      const payer = await openAgent(ctx, bank, `Chat payer ${seed}`)
      if (typeof payer === 'string') return fail(payer)
      const payee = await openAgent(ctx, bank, `Chat payee ${seed}`)
      if (typeof payee === 'string') return fail(payee)
      let err = await bank.move(payer, 2e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setLimit(payer, 'Ask a person above', 500_000)
      if (err !== undefined) return fail(`the approval amount was not saved: ${err}`)
      const key = await bank.issueKey(payer)
      const memo = `chat approval ${seed}`
      const held = await ctx.env.lens.payAsAgent(key, ctx.app.user.workspaceID, payer.id, payee.id, 1e6, memo)
      if (held.ok) return fail(`a payment above the approval amount was paid with no person asked: ${JSON.stringify(held.value)}`)
      const filed = (await ctx.env.lens.agentApprovals(ctx.app.user)).filter((x) => x.agent_id === payer.id && x.status === 'pending')
      if (filed.length !== 1 || filed[0].payee?.id !== payee.id || filed[0].amount_ulxc !== 1e6 || filed[0].memo !== memo) {
        return fail(`Lens filed no single pending approval for the 1 LXC payment (${held.status} ${held.error}): ${JSON.stringify(filed)}`)
      }

      // Face ID on this device: a platform authenticator that verifies the user, kept for this page's whole life.
      const { page } = bank
      const cdp = await ctx.app.context.newCDPSession(page)
      await cdp.send('WebAuthn.enable', { enableUI: false })
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
      })
      const device = card(page, 'Face ID and notifications')
      await device.getByRole('button', { name: /^(Approve with Face ID from now on|Add this device)$/ }).click()
      const made = await outcome(device.getByRole('status').filter({ hasText: /^This device now signs approvals/ }), device)
      if (made !== undefined) return fail(`this device's passkey was not registered: ${made}`)

      await page.goto(new URL('/chat', page.url()).toString())
      const asks = `${payer.name} wants to pay ${payee.name} `
      const approval = page.getByTestId('chat-approval').filter({ hasText: asks })
      try {
        await approval.waitFor({ timeout: ACTION_TIMEOUT_MS })
      } catch {
        return fail(`no card in Chat reads "${asks}…"; it shows: ${(await page.getByTestId('chat-approval').allInnerTexts()).join(' | ') || 'no approval card'}`)
      }
      const row = (await approval.getByTestId('chat-approval-asks').innerText()).trim()
      const wanted = `${asks}1 LXC ${usdShown(1e6, ctx.env.usdPerLXC)} — ${memo}`
      if (row !== wanted) return fail(`the card reads "${row}", not "${wanted}"`)
      await mkdir(ctx.env.outDir, { recursive: true })
      for (const [width, height] of [[1440, 900], [390, 844]] as const) {
        await page.setViewportSize({ width, height })
        await approval.scrollIntoViewIfNeeded()
        const shot = join(ctx.env.outDir, `chat-approval-${width}px-user${ctx.app.user.index}.png`)
        await page.screenshot({ path: shot })
        ctx.evidence.push({ note: `the card at ${width}px: ${shot}` })
      }

      await approval.getByRole('button', { name: 'Approve with Face ID', exact: true }).click()
      const refused = await outcome(approval.getByRole('status').filter({ hasText: /^Approved and paid/ }), approval)
      if (refused !== undefined) return fail(`approving the card did not pay: ${refused}`)
      const said = approval.getByRole('status')
      const href = await said.getByRole('link').getAttribute('href')
      ctx.evidence.push({ note: `Chat: "${row}"; after Approve with Face ID: "${(await said.innerText()).trim()}" → ${href}` })

      const state = (await ctx.env.lens.agentApprovals(ctx.app.user)).find((x) => x.id === filed[0].id)?.status
      if (state !== 'used') return fail(`the approval is ${state ?? 'gone'}, not used`)
      const paid = (await ctx.env.lens.agentLines(ctx.app.user, payer.id)).filter((l) => l.kind === 'pay')
      const got = (await ctx.env.lens.agentLines(ctx.app.user, payee.id)).filter((l) => l.kind === 'pay')
      if (paid.length !== 1 || paid[0].amount_ulxc !== -1e6) return fail(`${payer.name}'s account has ${paid.length} pay line(s): ${JSON.stringify(paid)}`)
      if (got.length !== 1 || got[0].amount_ulxc !== 1e6) return fail(`${payee.name}'s account has ${got.length} pay line(s): ${JSON.stringify(got)}`)
      const line = `/agents?agent=${encodeURIComponent(payer.id)}&entry=${encodeURIComponent(paid[0].entry_id)}`
      if (href !== line) return fail(`the card links ${href}, not the pay line ${line}`)
      return { pass: true, detail: `"${row}" in Chat, approved with a passkey: the approval used, one -1000000 µLXC pay line on ${payer.name} (${paid[0].entry_id}, linked from the card) and one +1000000 on ${payee.name}` }
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
        await page.getByText('Your agents’ wallets, at a glance.', { exact: true }).waitFor({ timeout: ACTION_TIMEOUT_MS })
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

/** B28.271 — what Agent Wallets may not show a workspace with no agents: none of these has anything to act on yet. */
const EMPTY_HIDDEN = [
  { what: 'the pause-all switch', find: (p: Page) => p.getByRole('button', { name: 'Pause every agent' }) },
  { what: 'the month-end forecast', find: (p: Page) => p.getByTestId('agents-forecast') },
  { what: 'the Approvals region', find: (p: Page) => p.getByRole('region', { name: 'Approvals' }) },
  { what: 'the Spending region', find: (p: Page) => p.getByRole('region', { name: 'Spending' }) },
  { what: 'the Between owners region', find: (p: Page) => p.getByRole('region', { name: 'Between owners' }) },
  { what: 'the Held and cashed out region', find: (p: Page) => p.getByRole('region', { name: 'Held and cashed out' }) },
] as const

/**
 * B28.271 — Agent Wallets opened by a workspace with no agents is one card, "Create your first agent", with the
 * create form inside it; the pause-all switch, the forecast, approvals, "between owners" and "held" are not on the
 * screen. Run while the workspace is empty (before Home's onboarding creates one); creates nothing, spends nothing.
 */
export function agentWalletsEmpty(): Scenario {
  return {
    id: 'agent-wallets-empty',
    title: 'Agent Wallets with no agents shows only the "Create your first agent" card — no pause-all, forecast or approvals',
    run: async (ctx) => {
      const book = await bookOf(ctx)
      if (book.agents.length > 0) throw new CannotTest(`the workspace already has ${book.agents.length} agent(s)`)
      const page = await ctx.app.tab('/agents')
      try {
        const card = page.getByTestId('agent-first')
        const shown = await card.waitFor({ timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        if (!shown) return fail('Agent Wallets with no agents shows no "Create your first agent" card')
        if ((await card.getByText('Create your first agent', { exact: true }).count()) !== 1) return fail('the first-agent card is not headed "Create your first agent"')
        if ((await card.getByLabel('New agent name').count()) !== 1) return fail('the first-agent card holds no form to name the agent')
        const still: string[] = []
        for (const { what, find } of EMPTY_HIDDEN) if ((await find(page).count()) > 0) still.push(what)
        if (still.length > 0) return fail(`with no agents the screen still shows ${still.join(', ')}`)
        ctx.evidence.push({ note: `with no agents: the "Create your first agent" card, and none of ${EMPTY_HIDDEN.map((h) => h.what).join(', ')}` })
        return { pass: true, detail: 'a workspace with no agents sees only the "Create your first agent" card' }
      } finally {
        await page.close()
      }
    },
  }
}

/**
 * B28.351 — B28.86's DONE line, from talyvor-suite: a new debit appears on the live statement beside Chat within 5s
 * without a reload. An agent is made and funded on Agent Wallets; Chat opens in a tab of its own with its statement
 * panel following that agent; the agent then pays another agent from Agent Wallets, in the other tab, so nothing on the
 * Chat page is touched. The pay line on Lens's ledger is what the panel must show — the same entry, the same amount and
 * balance, marked new and linked to its row — within 5s of Lens answering the payment, on the same document. At 390 the
 * panel opens from Chat's Statement button.
 */
export function chatLiveStatement(seed: number): Scenario {
  const funded = 2e6
  const amount = 1_000_000 + (seed % 9) * 10_000
  return {
    id: 'chat-live-statement',
    title: 'a debit an agent makes appears on the live statement beside Chat within 5 seconds, without a reload',
    run: async (ctx) =>
      withBank(ctx, async (bank) => {
        const opened: Agent[] = []
        for (const name of [`Live payer ${seed}`, `Live payee ${seed}`]) {
          const a = await openAgent(ctx, bank, name)
          if (typeof a === 'string') return fail(a)
          opened.push(a)
        }
        const [payer, payee] = opened
        const err = await bank.move(payer, funded, 'Fund')
        if (err !== undefined) return fail(`funding ${payer.name} was refused: ${err}`)
        const fund = (await ctx.env.lens.agentLines(ctx.app.user, payer.id)).find((l) => l.kind === 'fund')
        if (fund === undefined) return fail(`${payer.name} was funded on the screen, but its statement on Lens has no fund line`)

        const chat = await ctx.app.tab('/chat')
        try {
          await chat.setViewportSize({ width: 1440, height: 900 })
          const panel = chat.getByTestId('chat-live-statement')
          const row = (entry: string) => panel.locator(`[data-testid="live-statement-line"][data-entry="${entry}"]`)
          await panel.getByLabel('Agent').selectOption(payer.id, { timeout: ACTION_TIMEOUT_MS })
          try {
            await row(fund.entry_id).waitFor({ timeout: ACTION_TIMEOUT_MS })
          } catch {
            return fail(`the statement beside Chat never showed ${payer.name}'s fund line ${fund.entry_id}: "${(await panel.innerText()).trim()}"`)
          }
          // Marks this document: a reload would drop it.
          await chat.evaluate(() => Object.assign(window, { liveStatementDocument: true }))

          const paid = await bank.pay(payer, payee, amount, `live ${seed}`)
          const answered = Date.now()
          const lines = await ctx.env.lens.agentLines(ctx.app.user, payer.id)
          const debit = lines.find((l) => l.kind === 'pay' && l.amount_ulxc === -amount)
          if (debit === undefined) return fail(`paying ${payee.name} said "${paid}", but ${payer.name}'s statement on Lens has no pay line of -${amount} µLXC: ${JSON.stringify(lines)}`)
          const line = row(debit.entry_id)
          try {
            await line.waitFor({ timeout: Math.max(0, 5_000 - (Date.now() - answered)) })
          } catch {
            return fail(`${payer.name}'s debit ${debit.entry_id} was on Lens, but not on the statement beside Chat within 5s: "${(await panel.innerText()).trim()}"`)
          }
          const within = Date.now() - answered
          if ((await chat.evaluate(() => (window as { liveStatementDocument?: boolean }).liveStatementDocument)) !== true) return fail('Chat was reloaded before the debit showed')
          const shown = (await line.innerText()).trim()
          const href = await line.getAttribute('href')
          const marked = await line.getAttribute('data-new')

          await mkdir(ctx.env.outDir, { recursive: true })
          const wide = join(ctx.env.outDir, `chat-live-statement-1440px-user${ctx.app.user.index}.png`)
          await chat.screenshot({ path: wide })
          ctx.evidence.push({ note: `the statement beside Chat at 1440px: ${wide}` })
          await chat.setViewportSize({ width: 390, height: 844 })
          await chat.getByRole('button', { name: 'Statement', exact: true }).click()
          const narrow = join(ctx.env.outDir, `chat-live-statement-390px-user${ctx.app.user.index}.png`)
          await panel.waitFor({ timeout: ACTION_TIMEOUT_MS })
          await chat.screenshot({ path: narrow })
          ctx.evidence.push({ note: `the statement from Chat's Statement button at 390px: ${narrow}` })

          // The ledger, not the panel: one pay line each way, and the payer's balance that statement's last balance.
          const book = await bookOf(ctx)
          const payerLines = await ctx.env.lens.agentLines(ctx.app.user, payer.id)
          const payeeLines = await ctx.env.lens.agentLines(ctx.app.user, payee.id)
          ctx.evidence.push({ note: `shown ${within}ms after Lens answered: "${shown}" → ${href}; ${payer.name}: ${payerLines.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ')}` })
          const out = payerLines.filter((l) => l.kind === 'pay')
          const into = payeeLines.filter((l) => l.kind === 'pay')
          if (out.length !== 1 || out[0].amount_ulxc !== -amount || into.length !== 1 || into[0].amount_ulxc !== amount) {
            return fail(`one payment of ${amount} µLXC should be one pay line each way: ${payer.name} ${JSON.stringify(out)}, ${payee.name} ${JSON.stringify(into)}`)
          }
          const held = agentIn(book, payer.id)?.balance_ulxc
          if (held !== funded - amount || held !== payerLines[0].balance_after_ulxc) {
            return fail(`${payer.name} was funded ${funded} and paid ${amount} µLXC; Lens's book says it holds ${held}, its statement ends at ${payerLines[0].balance_after_ulxc}`)
          }
          if (!shown.includes(lxcText(amount)) || !shown.includes(`Balance ${lxcText(debit.balance_after_ulxc)}`)) {
            return fail(`Lens put pay ${debit.amount_ulxc} µLXC (balance ${debit.balance_after_ulxc}) on ${payer.name}'s statement; the panel shows "${shown}"`)
          }
          if (marked !== 'true') return fail(`the debit showed on the panel, but not marked new: "${shown}"`)
          const want = `/agents?agent=${encodeURIComponent(payer.id)}&entry=${encodeURIComponent(debit.entry_id)}`
          if (href !== want) return fail(`the panel links ${href}, not ${payer.name}'s debit ${want}`)
          return { pass: true, detail: `${payer.name} paid ${payee.name} ${amount} µLXC; the pay line ${debit.entry_id} showed on the statement beside Chat ${within}ms after Lens answered, without a reload, marked new and linked; one pay line each way on Lens, ${held} µLXC left` }
        } finally {
          await chat.close()
        }
      }),
  }
}

/** The statement kinds a call to a model writes, each under the request's ref. */
const CALL_KINDS = ['spend', 'hold', 'settle', 'release', 'platform_fee']

/**
 * B28.356 — B28.93's DONE line, from talyvor-suite: an agent makes 21 calls with its own key; Recent calls beside Chat
 * shows 20 rows, and they are its statement on Lens — its 20 newest requests, newest first, each row's cost what that
 * request's lines took from its wallet, linked to the line that opened it. The wallet moved by exactly what the 21
 * calls took. Where Lens names a call's model or source on its lines (B28.93), the row shows the same words.
 */
export function chatRecentCalls(seed: number): Scenario {
  const r = seeded(seed * 61 + 11)
  const funded = 2e6
  const made = 21
  const shown = 20
  return {
    id: 'chat-recent-calls',
    title: "an agent's newest 20 calls under Recent calls beside Chat are its statement on Lens: each request's cost, newest first, linked to its row",
    run: async (ctx) =>
      withBank(ctx, async (bank) => {
        const a = await openAgent(ctx, bank, `Caller ${seed}`)
        if (typeof a === 'string') return fail(a)
        const err = await bank.move(a, funded, 'Fund')
        if (err !== undefined) return fail(`funding ${a.name} was refused: ${err}`)
        const key = await bank.issueKey(a)
        for (let i = 1; i <= made; i++) {
          const served = await agentAsks(ctx, key, sum(r).q, `${a.name}'s call ${i} of ${made}`)
          if (!served.ok) return fail(`${a.name}'s call ${i} of ${made} was refused: ${served.status} ${served.error}`)
        }

        const chat = await ctx.app.tab('/chat')
        try {
          await chat.setViewportSize({ width: 1440, height: 900 })
          const panel = chat.getByTestId('chat-live-statement')
          await panel.getByLabel('Agent').selectOption(a.id, { timeout: ACTION_TIMEOUT_MS })
          await panel.getByRole('button', { name: 'Recent calls', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
          const rows = panel.getByTestId('recent-call')
          // Each amount carries the person's currency after it, "(…)"; the LXC figure is what is compared.
          const plain = (t: string) => t.replace(/ \([^()]*\)/g, '').trim()
          type Row = { ref: string; entry: string; href: string; cost: string; model: string; source: string }
          const readRows = async (): Promise<Row[]> =>
            Promise.all(
              (await rows.all()).map(async (row) => ({
                ref: (await row.getAttribute('data-ref')) ?? '',
                entry: (await row.getAttribute('data-entry')) ?? '',
                href: (await row.getAttribute('href')) ?? '',
                cost: plain(await row.getByTestId('recent-call-cost').innerText()),
                model: (await row.getByTestId('recent-call-model').innerText()).trim(),
                source: (await row.getByTestId('recent-call-source').count()) > 0 ? (await row.getByTestId('recent-call-source').innerText()).trim() : '',
              })),
            )
          // The ledger, not the panel: Lens's statement, newest first, its call lines grouped by the request they share.
          const fromStatement = (lines: AgentLine[]): Row[] => {
            const calls = new Map<string, { entry: string; took: number; at: string; model: string; source: string }>()
            for (const l of lines) {
              if (!CALL_KINDS.includes(l.kind)) continue
              const ref = l.ref || l.entry_id
              const c = calls.get(ref) ?? { entry: l.entry_id, took: 0, at: l.at, model: '', source: '' }
              calls.set(ref, { entry: l.entry_id, took: c.took - l.amount_ulxc, at: l.at, model: c.model || l.model || '', source: c.source || l.source || '' })
            }
            return [...calls.entries()]
              .sort(([, x], [, y]) => Date.parse(y.at) - Date.parse(x.at))
              .slice(0, shown)
              .map(([ref, c]) => ({
                ref,
                entry: c.entry,
                href: `/agents?agent=${encodeURIComponent(a.id)}&entry=${encodeURIComponent(c.entry)}`,
                cost: `${c.took > 0 ? '−' : c.took < 0 ? '+' : ''}${lxcText(Math.abs(c.took))} LXC`,
                model: c.model || 'Model call',
                source: c.source,
              }))
          }
          // The panel reads the statement every 2 s: the two agree within a few reads, or the last of each is the failure.
          let [got, want, lines]: [Row[], Row[], AgentLine[]] = [[], [], []]
          const end = Date.now() + 20_000
          for (;;) {
            lines = await ctx.env.lens.agentLines(ctx.app.user, a.id)
            want = fromStatement(lines)
            got = await readRows()
            if (JSON.stringify(got) === JSON.stringify(want) || Date.now() > end) break
            await chat.waitForTimeout(1_000)
          }
          ctx.evidence.push({ note: `Recent calls beside Chat: ${JSON.stringify(got)}; ${a.name}'s statement on Lens: ${lines.map((l) => `${l.kind} ${l.amount_ulxc} ${l.ref ?? ''}`).join(', ')}` })

          await mkdir(ctx.env.outDir, { recursive: true })
          const wide = join(ctx.env.outDir, `chat-recent-calls-1440px-user${ctx.app.user.index}.png`)
          await chat.screenshot({ path: wide })
          ctx.evidence.push({ note: `Recent calls beside Chat at 1440px: ${wide}` })
          await chat.setViewportSize({ width: 390, height: 844 })
          await chat.getByRole('button', { name: 'Statement', exact: true }).click()
          await panel.getByRole('button', { name: 'Recent calls', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
          await rows.first().waitFor({ timeout: ACTION_TIMEOUT_MS })
          const narrow = join(ctx.env.outDir, `chat-recent-calls-390px-user${ctx.app.user.index}.png`)
          await chat.screenshot({ path: narrow })
          ctx.evidence.push({ note: `Recent calls from Chat's Statement button at 390px: ${narrow}` })

          const requests = new Set(lines.filter((l) => CALL_KINDS.includes(l.kind)).map((l) => l.ref || l.entry_id))
          if (requests.size !== made) return fail(`${a.name} made ${made} calls; its statement on Lens has lines for ${requests.size} requests`)
          if (got.length !== shown) return fail(`${a.name} made ${made} calls; Recent calls shows ${got.length} rows, want ${shown}: ${JSON.stringify(got)}`)
          const off = got.findIndex((g, i) => JSON.stringify(g) !== JSON.stringify(want[i]))
          if (off >= 0) return fail(`row ${off + 1} of Recent calls is ${JSON.stringify(got[off])}; ${a.name}'s statement on Lens says ${JSON.stringify(want[off])}`)
          const took = lines.filter((l) => CALL_KINDS.includes(l.kind)).reduce((t, l) => t - l.amount_ulxc, 0)
          const held = agentIn(await bookOf(ctx), a.id)?.balance_ulxc
          if (took <= 0 || held !== funded - took || held !== lines[0].balance_after_ulxc) {
            return fail(`${a.name} was funded ${funded} µLXC and its ${made} calls took ${took}; Lens's book says it holds ${held}, its statement ends at ${lines[0].balance_after_ulxc}`)
          }
          const named = want.filter((w) => w.model !== 'Model call').length
          return {
            pass: true,
            detail: `${a.name} made ${made} calls for ${took} µLXC out of its wallet; Recent calls beside Chat shows its ${shown} newest exactly as its statement on Lens has them — newest first, each request's cost, each linked to its opening line; ${named} of ${shown} name their model on Lens's lines`,
          }
        } finally {
          await chat.close()
        }
      }),
  }
}

/**
 * B28.87 — the wallet buttons beside Chat: fund, withdraw, pause and pause all, each asked once more before anything is
 * sent. An agent is made on Agent Wallets and given a key; everything after is done from Chat's statement panel. Each
 * button only asks, and Lens's book has not moved until Yes. Fund then puts one fund line on its statement on Lens and
 * Withdraw one withdraw line, its balance in the book their sum; Pause and Resume set and clear its pause on Lens. Then
 * Pause all, and its next call with its own key is refused before the provider — 403, every agent paused — with nothing
 * charged. Started again from Chat (at 390, from the Statement button), the same agent is served.
 */
export function chatWalletButtons(seed: number): Scenario {
  const r = seeded(seed * 37 + 11)
  const funded = 1e6
  const back = 250_000 + (seed % 9) * 10_000
  return {
    id: 'chat-wallet-buttons',
    title: 'fund, withdraw, pause and pause all from Chat, each confirmed first; after Pause all the agent’s next call is refused',
    run: async (ctx) =>
      withBank(ctx, async (bank) => {
        const a = await openAgent(ctx, bank, `Chat wallet ${seed}`)
        if (typeof a === 'string') return fail(a)
        const key = await bank.issueKey(a)
        const agentNow = async () => agentIn(await bookOf(ctx), a.id)
        const chat = await ctx.app.tab('/chat')
        let pausedAll = false
        try {
          await chat.setViewportSize({ width: 1440, height: 900 })
          const panel = chat.getByTestId('chat-live-statement')
          await panel.getByLabel('Agent').selectOption(a.id, { timeout: ACTION_TIMEOUT_MS })
          const buttons = panel.getByTestId('chat-wallet-buttons')
          const confirm = buttons.getByRole('group', { name: 'Confirm' })
          /** Clicks a button, which only asks; answers what it asked. */
          const ask = async (name: string): Promise<string> => {
            await buttons.getByRole('button', { name, exact: true }).click()
            await confirm.waitFor({ timeout: ACTION_TIMEOUT_MS })
            return (await confirm.innerText()).replace(/\s+/g, ' ').trim()
          }

          // Fund, then Withdraw: each asked first; one line each on Lens once it is answered Yes.
          const moves: { how: string; ulxc: number; kind: string; want: number }[] = [
            { how: 'Fund', ulxc: funded, kind: 'fund', want: funded },
            { how: 'Withdraw', ulxc: back, kind: 'withdraw', want: funded - back },
          ]
          for (const m of moves) {
            await buttons.getByLabel(`Amount in LXC for ${a.name}`).fill(lxcText(m.ulxc))
            const asked = await ask(m.how)
            ctx.evidence.push({ note: `${m.how} ${lxcText(m.ulxc)} LXC asked: "${asked}"` })
            const before = (await agentNow())?.balance_ulxc
            if (before !== m.want + (m.kind === 'fund' ? -m.ulxc : m.ulxc)) return fail(`${m.how} only asked "${asked}", yet Lens's book has ${a.name} holding ${before} µLXC`)
            await confirm.getByRole('button', { name: `Yes, ${m.how.toLowerCase()}`, exact: true }).click()
            const err = await outcome(buttons.getByRole('status').filter({ hasText: `${a.name} now holds ${lxcText(m.want)} LXC` }), buttons)
            if (err !== undefined) return fail(`${m.how} ${lxcText(m.ulxc)} LXC from Chat was refused: ${err}`)
            const lines = (await ctx.env.lens.agentLines(ctx.app.user, a.id)).filter((l) => l.kind === m.kind)
            const held = (await agentNow())?.balance_ulxc
            if (lines.length !== 1 || lines[0].amount_ulxc !== (m.kind === 'fund' ? m.ulxc : -m.ulxc) || held !== m.want || lines[0].balance_after_ulxc !== m.want) {
              return fail(`${m.how} ${m.ulxc} µLXC from Chat should be one ${m.kind} line on Lens leaving ${m.want}: ${JSON.stringify(lines)}, the book says ${held}`)
            }
          }

          // Pause, then Resume: asked first; Lens's book has the agent paused, then not.
          for (const [how, paused] of [[`Pause ${a.name}`, true], [`Resume ${a.name}`, false]] as const) {
            const asked = await ask(how)
            if (((await agentNow())?.paused_at !== undefined) === paused) return fail(`${how} only asked "${asked}", yet Lens already has it ${paused ? 'paused' : 'resumed'}`)
            await confirm.getByRole('button', { name: `Yes, ${how.charAt(0).toLowerCase()}${how.slice(1)}`, exact: true }).click()
            await buttons.getByRole('button', { name: paused ? `Resume ${a.name}` : `Pause ${a.name}`, exact: true }).waitFor({ timeout: ACTION_TIMEOUT_MS })
            if (((await agentNow())?.paused_at !== undefined) !== paused) return fail(`${how} was answered Yes in Chat, but Lens's book has ${a.name} ${paused ? 'not paused' : 'still paused'}`)
          }

          // Pause all: asked first; then the agent's next call is refused before the provider, and nothing is charged.
          const asked = await ask('Pause all')
          if ((await bookOf(ctx)).all_paused_at !== undefined) return fail(`Pause all only asked "${asked}", yet Lens has every agent paused`)
          await mkdir(ctx.env.outDir, { recursive: true })
          const wide = join(ctx.env.outDir, `chat-wallet-buttons-1440px-user${ctx.app.user.index}.png`)
          await chat.screenshot({ path: wide })
          ctx.evidence.push({ note: `Pause all asked in Chat at 1440px: "${asked}" — ${wide}` })
          await confirm.getByRole('button', { name: 'Yes, pause all', exact: true }).click()
          pausedAll = true
          await buttons.getByTestId('chat-all-paused').waitFor({ timeout: ACTION_TIMEOUT_MS })
          if ((await bookOf(ctx)).all_paused_at === undefined) return fail('Pause all was answered Yes in Chat, but Lens does not have every agent paused')
          const spends0 = new Set((await spendRows(ctx)).map((x) => x.id))
          const refused = await agentAsks(ctx, key, sum(r).q, `${a.name}, after Pause all in Chat`)
          if (refused.ok) return fail(`after Pause all in Chat, ${a.name}'s next call was served: "${refused.value.text}"`)
          if (refused.status !== 403 || !/every agent in this workspace is paused/.test(refused.error)) {
            return fail(`after Pause all in Chat, ${a.name} was refused, but not by the pause: ${refused.status} ${refused.error}`)
          }
          if ((await agentNow())?.balance_ulxc !== funded - back || (await spendRows(ctx)).some((x) => !spends0.has(x.id))) {
            return fail(`every agent paused, yet something was charged: Lens's book has ${a.name} holding ${(await agentNow())?.balance_ulxc} µLXC`)
          }

          // Started again from Chat on a phone, from the Statement button: served.
          await chat.setViewportSize({ width: 390, height: 844 })
          await chat.getByRole('button', { name: 'Statement', exact: true }).click()
          await buttons.waitFor({ timeout: ACTION_TIMEOUT_MS })
          const again = await ask('Start all again')
          const narrow = join(ctx.env.outDir, `chat-wallet-buttons-390px-user${ctx.app.user.index}.png`)
          await chat.screenshot({ path: narrow })
          ctx.evidence.push({ note: `Start all again asked from Chat's Statement button at 390px: "${again}" — ${narrow}` })
          await confirm.getByRole('button', { name: 'Yes, start all again', exact: true }).click()
          await buttons.getByRole('button', { name: 'Pause all', exact: true }).waitFor({ timeout: ACTION_TIMEOUT_MS })
          if ((await bookOf(ctx)).all_paused_at !== undefined) return fail('Start all again was answered Yes in Chat, but Lens still has every agent paused')
          pausedAll = false
          const { q, want } = sum(r)
          const served = await agentAsks(ctx, key, q, `${a.name}, started again from Chat`)
          if (!served.ok) return fail(`started again from Chat, ${a.name} is still refused: ${served.status} ${served.error}`)
          if (!statesNumber(served.value.text, want)) return fail(`answered wrong: expected ${want}, got "${served.value.text}"`)
          return {
            pass: true,
            detail: `from Chat, each confirmed first: funded ${funded} and withdrew ${back} µLXC (one fund and one withdraw line on Lens, ${funded - back} left), paused and resumed ${a.name}, then Pause all — its next call refused 403 with nothing charged; started again, served`,
          }
        } finally {
          if (pausedAll) await bank.resumeAll()
          await chat.close()
        }
      }),
  }
}

/**
 * B28.350 — B28.85's DONE line, from Chat: `/agent …` typed in the composer goes to no model; it opens a card with the
 * name, budget and rules read from the command, and Launch makes the agent. Lens's /api/agents then has it holding its
 * budget, moved out of the workspace, with its rules as typed. Its first call with the key the card showed is debited
 * from its wallet — a request line on its statement, its balance in the book that statement's last balance — and the
 * card shows that line and links it.
 */
export function chatLaunchAgent(seed: number): Scenario {
  const r = seeded(seed * 53 + 7)
  const budget = 2e6
  const daily = 1e6
  const approval = 500_000
  return {
    id: 'chat-launch-agent',
    title: 'an agent launched from Chat with /agent is in Lens’s book with its budget and rules, and its first call is debited from its wallet',
    run: async (ctx) => {
      const name = `Launched ${seed}`
      const before = await bookOf(ctx)
      if (before.unallocated_ulxc < budget) throw new CannotTest(`the workspace has ${before.unallocated_ulxc} µLXC free, under the ${budget} µLXC budget`)
      const page = await ctx.app.tab('/chat')
      try {
        const command = `/agent ${name} budget ${lxcText(budget)} LXC, ${lxcText(daily)} a day, ask me above ${lxcText(approval)}`
        await page.locator('#chat-message').fill(command)
        await page.locator('#chat-message').press('Enter')
        const launch = page.getByTestId('chat-launch').filter({ hasText: command })
        try {
          await launch.waitFor({ timeout: ACTION_TIMEOUT_MS })
        } catch {
          return fail(`"${command}" opened no launch card in Chat`)
        }
        if ((await page.getByTestId('turn-user').filter({ hasText: command }).count()) > 0) return fail('the /agent command was sent to the model as a question')
        const read = [
          await launch.getByLabel('Agent name').inputValue(),
          await launch.getByLabel('Budget, in LXC').inputValue(),
          await launch.getByLabel('At most a day, in LXC').inputValue(),
          await launch.getByLabel('Ask a person above, in LXC').inputValue(),
        ]
        const meant = [name, lxcText(budget), lxcText(daily), lxcText(approval)]
        if (read.join('|') !== meant.join('|')) return fail(`the card read "${command}" as ${JSON.stringify(read)}, not ${JSON.stringify(meant)}`)

        await launch.getByRole('button', { name: `Launch ${name}`, exact: true }).click()
        const refused = await outcome(launch.getByTestId('chat-launch-key'), launch)
        if (refused !== undefined) return fail(`launching ${name} was refused: ${refused}`)
        const key = (await launch.getByTestId('chat-launch-key').innerText()).trim()

        const book = await bookOf(ctx)
        const a = book.agents.find((x) => x.name === name)
        if (a === undefined) return fail(`the card says ${name} is launched, but Lens's /api/agents has no agent named ${name}`)
        if (a.owner_user_id === '') return fail(`${name} was launched with no owner`)
        if (a.balance_ulxc !== budget) return fail(`launched with a ${budget} µLXC budget; Lens's book says ${name} holds ${a.balance_ulxc}`)
        if (book.allocated_ulxc !== before.allocated_ulxc + budget || book.workspace_balance_ulxc !== before.workspace_balance_ulxc) {
          return fail(`the budget did not come out of the workspace: allocated ${before.allocated_ulxc} → ${book.allocated_ulxc}, workspace ${before.workspace_balance_ulxc} → ${book.workspace_balance_ulxc} µLXC`)
        }
        const rules = await ctx.env.lens.agentRules(ctx.app.user, a.id)
        if (rules.monthly_limit_ulxc !== budget || rules.daily_limit_ulxc !== daily || rules.approval_above_ulxc !== approval) {
          return fail(`typed a ${budget} budget, ${daily} a day and ${approval} to ask above (µLXC); Lens stored ${rules.monthly_limit_ulxc}, ${rules.daily_limit_ulxc} and ${rules.approval_above_ulxc}`)
        }

        const served = await agentAsks(ctx, key, sum(r).q, `${name}'s first call, with the key Chat showed`)
        if (!served.ok) return fail(`${name}'s first call, with the key Chat showed, was refused: ${served.status} ${served.error}`)
        const shown = launch.getByTestId('chat-launch-first-call')
        try {
          await shown.waitFor({ timeout: 60_000 })
        } catch {
          return fail(`${name}'s call was served, but the card never showed it: "${(await launch.innerText()).trim()}"`)
        }
        const said = (await shown.innerText()).trim()
        const href = await shown.getByRole('link').getAttribute('href')
        await mkdir(ctx.env.outDir, { recursive: true })
        for (const [width, height] of [[1440, 900], [390, 844]] as const) {
          await page.setViewportSize({ width, height })
          await launch.scrollIntoViewIfNeeded()
          const shot = join(ctx.env.outDir, `chat-launch-${width}px-user${ctx.app.user.index}.png`)
          // The key is masked: it spends this agent's wallet, and the picture outlives the run.
          await page.screenshot({ path: shot, mask: [launch.getByTestId('chat-launch-key')] })
          ctx.evidence.push({ note: `the card at ${width}px: ${shot}` })
        }

        // The ledger, not the card: Lens lists the statement newest first.
        const lines = await ctx.env.lens.agentLines(ctx.app.user, a.id)
        const held = agentIn(await bookOf(ctx), a.id)?.balance_ulxc
        ctx.evidence.push({ note: `Chat: "${said}" → ${href}; ${name}'s statement: ${lines.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ')}; it holds ${held} µLXC` })
        const funded = lines.filter((l) => l.kind === 'fund')
        if (funded.length !== 1 || funded[0].amount_ulxc !== budget) return fail(`${name}'s statement should hold one fund line of ${budget} µLXC: ${JSON.stringify(funded)}`)
        const debit = [...lines].reverse().find((l) => ['spend', 'hold', 'settle', 'release'].includes(l.kind))
        if (debit === undefined || debit.amount_ulxc >= 0) return fail(`served, yet ${name}'s statement has no debit for the call: ${JSON.stringify(lines)}`)
        const net = lines.reduce((t, l) => t + l.amount_ulxc, 0)
        if (held === undefined || held >= budget || held !== net || held !== lines[0].balance_after_ulxc) {
          return fail(`${name}'s first call was not debited from its wallet: it holds ${held} µLXC of its ${budget} budget; its statement sums to ${net} and ends at ${lines[0].balance_after_ulxc}`)
        }
        if (!said.includes(lxcText(Math.abs(debit.amount_ulxc)))) return fail(`Lens put ${debit.kind} ${debit.amount_ulxc} µLXC on ${name}'s statement; the card says "${said}"`)
        const want = `/agents?agent=${encodeURIComponent(a.id)}&entry=${encodeURIComponent(debit.entry_id)}`
        if (href !== want) return fail(`the card links ${href}, not ${name}'s first call ${want}`)
        return { pass: true, detail: `"${command}" launched ${name} from Chat: Lens's book has it holding its ${budget} µLXC budget out of the workspace, its rules as typed; its first call was debited (${debit.kind} ${debit.amount_ulxc} µLXC, ${held} left), shown and linked on the card` }
      } finally {
        await page.close()
      }
    },
  }
}

/**
 * B28.352 — B28.88's DONE line, from Chat: "Cap agent <name> at 0.000001 LXC a day on Opus" typed in the composer goes
 * to no model; it opens a card with the agent, the amount, a day and the newest Opus read from the sentence, and Save puts
 * the rule on Lens. Lens's rules then hold that cap on the model, every other rule as it was, and the agent's next call
 * to that model is refused before the provider — no posting on its statement and no spend row on the ledger. Where the
 * catalog has no Opus beside the judge model, its dearest sibling from the same provider stands in, named in full.
 */
export function chatPlainRule(seed: number): Scenario {
  const r = seeded(seed * 59 + 5)
  const cap = 1 // µLXC: the agent's first call to the model passes it
  return {
    id: 'chat-plain-rule',
    title: 'a rule typed in plain words in Chat is saved on Lens, and the agent’s next call over it is refused with nothing posted or charged',
    run: (ctx) =>
      withBank(ctx, async (bank) => {
        const { env } = ctx
        const siblings = env.catalog.filter((m) => m.provider === env.judgeProvider && m.id !== env.judgeModel && !m.deprecated && m.output_per_1m > 0)
        const opus = siblings.some((m) => /opus/i.test(m.id))
        const dear = siblings.find((m) => /opus/i.test(m.id)) ?? [...siblings].sort((x, y) => y.output_per_1m - x.output_per_1m)[0]
        if (dear === undefined) throw new CannotTest(`the catalog has no second ${env.judgeProvider} model to cap beside ${env.judgeModel}`)
        const a = await openAgent(ctx, bank, `Plain rule ${seed}`)
        if (typeof a === 'string') return fail(a)
        const err = await bank.move(a, 1e6, 'Fund')
        if (err !== undefined) return fail(`funding was refused: ${err}`)
        const key = await bank.issueKey(a)
        const before = await env.lens.agentRules(ctx.app.user, a.id)
        const page = await ctx.app.tab('/chat')
        try {
          await page.setViewportSize({ width: 1440, height: 900 })
          const sentence = `Cap agent ${a.name} at ${lxcText(cap)} LXC a day on ${opus ? 'Opus' : dear.display_name}`
          await page.locator('#chat-message').fill(sentence)
          await page.locator('#chat-message').press('Enter')
          const rule = page.getByTestId('chat-rule').filter({ hasText: sentence })
          try {
            await rule.waitFor({ timeout: ACTION_TIMEOUT_MS })
          } catch {
            return fail(`"${sentence}" opened no rule card in Chat`)
          }
          if ((await page.getByTestId('turn-user').filter({ hasText: sentence }).count()) > 0) return fail('the rule was sent to the model as a question')
          await rule.getByTestId('chat-rule-change').waitFor({ timeout: ACTION_TIMEOUT_MS })
          let model = await rule.getByLabel('On which model').inputValue()
          const read = [await rule.getByLabel('Agent').inputValue(), await rule.getByLabel('At most, in LXC').inputValue(), await rule.getByLabel('How often').inputValue()]
          if (read.join('|') !== [a.id, lxcText(cap), 'day'].join('|')) return fail(`the card read "${sentence}" as ${JSON.stringify(read)}, not ${a.id}, ${lxcText(cap)} LXC, a day`)
          if (opus ? !/opus/i.test(model) : model !== dear.id) return fail(`"${sentence}" named ${opus ? 'Opus' : dear.id}; the card chose ${JSON.stringify(model)}`)
          if (env.catalog.find((m) => m.id === model)?.provider !== env.judgeProvider) {
            // The newest Opus is another provider's; this run can call only the judge's, so its Opus is chosen on the card.
            ctx.evidence.push({ note: `"Opus" read as ${model}; ${dear.id} chosen on the card, as the run calls ${env.judgeProvider} only` })
            await rule.getByLabel('On which model').selectOption(dear.id)
            model = dear.id
          }
          const asked = (await rule.getByTestId('chat-rule-change').innerText()).trim()
          await rule.getByRole('button', { name: 'Save the rule', exact: true }).click()
          const refusedSave = await outcome(rule.getByTestId('chat-rule-saved'), rule)
          if (refusedSave !== undefined) return fail(`saving "${sentence}" was refused: ${refusedSave}`)
          const said = (await rule.getByTestId('chat-rule-saved').innerText()).trim()

          // The rule as Lens holds it: the cap on that model, by the name Lens reads it back by, and nothing else moved.
          const after = await env.lens.agentRules(ctx.app.user, a.id)
          const capKey = (m: string) => m.trim().toLowerCase().replace(/-(\d{8}|\d{4}-\d{2}-\d{2}|latest)$/, '')
          const stored = Object.entries(after.model_daily_limits_ulxc ?? {}).find(([m]) => capKey(m) === capKey(model))?.[1]
          ctx.evidence.push({ note: `Chat: "${asked}" → "${said}"; Lens holds ${a.name}'s per-model daily limits as ${JSON.stringify(after.model_daily_limits_ulxc ?? {})}` })
          if (stored !== cap) return fail(`saved ${cap} µLXC a day on ${model} from Chat; Lens holds ${JSON.stringify(after.model_daily_limits_ulxc ?? {})}`)
          const kept = (['max_per_request_ulxc', 'daily_limit_ulxc', 'monthly_limit_ulxc', 'approval_above_ulxc'] as const).filter((f) => after[f] !== before[f])
          if (kept.length > 0) return fail(`setting one model's cap from Chat changed ${kept.map((f) => `${f} ${before[f]} → ${after[f]}`).join(', ')}`)

          await mkdir(env.outDir, { recursive: true })
          for (const [width, height] of [[1440, 900], [390, 844]] as const) {
            await page.setViewportSize({ width, height })
            await rule.scrollIntoViewIfNeeded()
            const shot = join(env.outDir, `chat-plain-rule-${width}px-user${ctx.app.user.index}.png`)
            await page.screenshot({ path: shot })
            ctx.evidence.push({ note: `the saved rule at ${width}px: ${shot}` })
          }

          // Over the rule: refused before the provider, with nothing on the agent's statement and nothing on the ledger.
          const lines0 = await env.lens.agentLines(ctx.app.user, a.id)
          const spends0 = new Set((await spendRows(ctx)).map((x) => x.id))
          const refused = await agentAsks(ctx, key, sum(r).q, `${model}, past the ${lxcText(cap)} LXC a day set from Chat`, model)
          if (refused.ok) return fail(`${model}'s daily limit of ${lxcText(cap)} LXC, set from Chat, let a request through: "${refused.value.text}"`)
          if (refused.status !== 403 || !/daily limit .* for the model/.test(refused.error)) return fail(`${model} was refused, but not by its daily limit: ${refused.status} ${refused.error}`)
          const late = (await env.lens.agentLines(ctx.app.user, a.id)).filter((l) => !lines0.some((o) => o.entry_id === l.entry_id))
          const charged = (await spendRows(ctx)).filter((x) => !spends0.has(x.id))
          if (late.length > 0 || charged.length > 0) {
            return fail(`refused by the rule set from Chat, yet it wrote ${late.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ') || 'nothing'} on ${a.name}'s statement and ${charged.length} spend row(s) on the ledger`)
          }
          return { pass: true, detail: `"${sentence}" in Chat saved ${cap} µLXC a day on ${model} on Lens, every other rule as it was; ${a.name}'s next call to it was refused 403 with no posting and no spend row` }
        } finally {
          await page.close()
        }
      }),
  }
}

/**
 * B28.353 (for B28.89) — "Ask me above 2 LXC for <agent>" typed in Chat opens a card read as typed; after Save, Lens's
 * rules hold an approval amount of 2 LXC and every other limit as it was. Then a 1.9 LXC payment is paid at once — one
 * pay line on the payer's statement, the payee's balance up by it — and a 2.1 LXC one is held for a person: a pending
 * approval for 2.1 LXC on Lens, no pay line written and no balance moved.
 */
export function chatAskAbove(seed: number): Scenario {
  const ask = 2e6
  const [under, over] = [1_900_000, 2_100_000]
  return {
    id: 'chat-ask-above',
    title: '"Ask me above 2 LXC" typed in Chat sets the agent’s approval amount on Lens: 2.1 LXC then waits for a person and 1.9 LXC is paid',
    run: (ctx) =>
      withBank(ctx, async (bank) => {
        const { env } = ctx
        const payer = await openAgent(ctx, bank, `Ask payer ${seed}`)
        if (typeof payer === 'string') return fail(payer)
        const payee = await openAgent(ctx, bank, `Ask payee ${seed}`)
        if (typeof payee === 'string') return fail(payee)
        const err = await bank.move(payer, 5e6, 'Fund')
        if (err !== undefined) return fail(`funding was refused: ${err}`)
        const before = await env.lens.agentRules(ctx.app.user, payer.id)
        const page = await ctx.app.tab('/chat')
        try {
          await page.setViewportSize({ width: 1440, height: 900 })
          const sentence = `Ask me above ${lxcText(ask)} LXC for ${payer.name}`
          await page.locator('#chat-message').fill(sentence)
          await page.locator('#chat-message').press('Enter')
          const card = page.getByTestId('chat-ask-above').filter({ hasText: sentence })
          try {
            await card.waitFor({ timeout: ACTION_TIMEOUT_MS })
          } catch {
            return fail(`"${sentence}" opened no approval card in Chat`)
          }
          if ((await page.getByTestId('turn-user').filter({ hasText: sentence }).count()) > 0) return fail('the approval amount was sent to the model as a question')
          await card.getByTestId('chat-ask-above-change').waitFor({ timeout: ACTION_TIMEOUT_MS })
          const read = [await card.getByLabel('Agent').inputValue(), await card.getByLabel('Ask above, in LXC').inputValue()]
          if (read.join('|') !== [payer.id, lxcText(ask)].join('|')) return fail(`the card read "${sentence}" as ${JSON.stringify(read)}, not ${payer.id}, ${lxcText(ask)} LXC`)
          const asked = (await card.getByTestId('chat-ask-above-change').innerText()).trim()
          await card.getByRole('button', { name: 'Save the rule', exact: true }).click()
          const refusedSave = await outcome(card.getByTestId('chat-ask-above-saved'), card)
          if (refusedSave !== undefined) return fail(`saving "${sentence}" was refused: ${refusedSave}`)
          const said = (await card.getByTestId('chat-ask-above-saved').innerText()).trim()

          // The rule as Lens holds it: the approval amount, and nothing else moved.
          const after = await env.lens.agentRules(ctx.app.user, payer.id)
          ctx.evidence.push({ note: `Chat: "${asked}" → "${said}"; Lens holds ${payer.name}'s approval amount as ${after.approval_above_ulxc} µLXC` })
          if (after.approval_above_ulxc !== ask) return fail(`saved ${ask} µLXC as the approval amount from Chat; Lens holds ${after.approval_above_ulxc}`)
          const kept = (['max_per_request_ulxc', 'daily_limit_ulxc', 'monthly_limit_ulxc'] as const).filter((f) => after[f] !== before[f])
          if (kept.length > 0) return fail(`setting the approval amount from Chat changed ${kept.map((f) => `${f} ${before[f]} → ${after[f]}`).join(', ')}`)

          await mkdir(env.outDir, { recursive: true })
          for (const [width, height] of [[1440, 900], [390, 844]] as const) {
            await page.setViewportSize({ width, height })
            await card.scrollIntoViewIfNeeded()
            const shot = join(env.outDir, `chat-ask-above-${width}px-user${ctx.app.user.index}.png`)
            await page.screenshot({ path: shot })
            ctx.evidence.push({ note: `the saved approval amount at ${width}px: ${shot}` })
          }
        } finally {
          await page.close()
        }

        const pays = async () => (await env.lens.agentLines(ctx.app.user, payer.id)).filter((l) => l.kind === 'pay')
        // Under it: paid at once, one pay line on the payer's statement and the payee's balance up by it.
        const paid = await bank.pay(payer, payee, under, `under the approval amount ${seed}`)
        ctx.evidence.push({ note: `Pay ${lxcText(under)} LXC: ${paid}` })
        if (!/^Paid /.test(paid)) return fail(`a ${lxcText(under)} LXC payment, under the ${lxcText(ask)} LXC approval amount, was not paid: "${paid}"`)
        const lines1 = await pays()
        if (lines1.length !== 1 || lines1[0].amount_ulxc !== -under) return fail(`after one ${lxcText(under)} LXC payment ${payer.name}'s account has pay line(s) ${JSON.stringify(lines1)}`)
        const book1 = await bookOf(ctx)
        if (agentIn(book1, payee.id)?.balance_ulxc !== under) return fail(`${payee.name} holds ${agentIn(book1, payee.id)?.balance_ulxc} µLXC after being paid ${under}`)

        // Over it: held for a person — a pending approval for the amount, no pay line and no balance moved.
        const held = await bank.pay(payer, payee, over, `over the approval amount ${seed}`)
        ctx.evidence.push({ note: `Pay ${lxcText(over)} LXC: ${held}` })
        if (!/^Refused\./.test(held) || !/waiting in Approvals/.test(held)) return fail(`a ${lxcText(over)} LXC payment, over the ${lxcText(ask)} LXC approval amount set from Chat, was not held for a person: "${held}"`)
        const filed = (await env.lens.agentApprovals(ctx.app.user)).filter((x) => x.agent_id === payer.id)
        if (filed.length !== 1 || filed[0].status !== 'pending' || filed[0].amount_ulxc !== over) return fail(`Lens has ${filed.length} approval(s) for ${payer.name}: ${JSON.stringify(filed)}`)
        const lines2 = await pays()
        const book2 = await bookOf(ctx)
        const [from, to] = [agentIn(book2, payer.id)?.balance_ulxc, agentIn(book2, payee.id)?.balance_ulxc]
        if (lines2.length !== 1 || from !== 5e6 - under || to !== under) {
          return fail(`a payment held for a person moved money: ${lines2.length} pay line(s), ${payer.name} holds ${from} and ${payee.name} ${to} µLXC`)
        }
        return {
          pass: true,
          detail: `"Ask me above ${lxcText(ask)} LXC for ${payer.name}" in Chat saved ${ask} µLXC as its approval amount on Lens; ${lxcText(under)} LXC was paid (one pay line), ${lxcText(over)} LXC waits for a person (approval pending, nothing paid)`,
        }
      }),
  }
}

/**
 * B28.357 (for B28.94) — "Will <agent> run out this month?" asked in Chat is answered from Lens's forecast. The agent is
 * funded 5 LXC and pays 4.999 LXC of it to another agent, so at its pace so far it runs out within minutes: the pay line
 * and the 0.001 LXC left are read from its statement on Lens, Chat answers yes without asking the model, and the day it
 * states is the day in Lens's own /forecast output for that agent, read just before and just after Chat answered.
 */
export function chatForecastAnswer(seed: number): Scenario {
  const [funded, paid] = [5e6, 4_999_000]
  return {
    id: 'chat-forecast-answer',
    title: '"Will <agent> run out this month?" in Chat is answered from the forecast: the day it states is the runs_out_at Lens’s /forecast gives',
    run: (ctx) =>
      withBank(ctx, async (bank) => {
        const { env } = ctx
        const spender = await openAgent(ctx, bank, `Forecast spender ${seed}`)
        if (typeof spender === 'string') return fail(spender)
        const payee = await openAgent(ctx, bank, `Forecast payee ${seed}`)
        if (typeof payee === 'string') return fail(payee)
        const err = await bank.move(spender, funded, 'Fund')
        if (err !== undefined) return fail(`funding ${spender.name} was refused: ${err}`)
        const out = await bank.pay(spender, payee, paid, `run it down ${seed}`)
        if (!/^Paid /.test(out)) return fail(`${spender.name} paying ${lxcText(paid)} LXC was not paid: "${out}"`)
        // The ledger, not the screen: one pay line for what it paid, and what is left.
        const lines = await env.lens.agentLines(ctx.app.user, spender.id)
        const pays = lines.filter((l) => l.kind === 'pay')
        if (pays.length !== 1 || pays[0].amount_ulxc !== -paid || lines[0]?.balance_after_ulxc !== funded - paid) {
          return fail(`after paying ${paid} µLXC of ${funded}, ${spender.name}'s statement has pay line(s) ${JSON.stringify(pays)} and ends at ${lines[0]?.balance_after_ulxc}`)
        }

        const page = await ctx.app.tab('/chat')
        try {
          await page.setViewportSize({ width: 1440, height: 900 })
          const question = `Will ${spender.name} run out this month?`
          const before = await env.lens.agentForecast(ctx.app.user)
          await page.locator('#chat-message').fill(question)
          await page.locator('#chat-message').press('Enter')
          const card = page.getByTestId('chat-forecast').filter({ hasText: question })
          try {
            await card.getByTestId('chat-forecast-answer').waitFor({ timeout: ACTION_TIMEOUT_MS })
          } catch {
            return fail(`"${question}" opened no forecast answer in Chat`)
          }
          if ((await page.getByTestId('turn-user').filter({ hasText: question }).count()) > 0) return fail('the run-out question was sent to the model')
          const said = (await card.getByTestId('chat-forecast-answer').innerText()).trim()
          const shown = await card.getByTestId('chat-forecast-date').getAttribute('datetime', { timeout: 2_000 }).catch(() => null)
          const after = await env.lens.agentForecast(ctx.app.user)
          const [was, now] = [before, after].map((f) => (f.agents ?? []).find((a) => a.agent_id === spender.id))
          ctx.evidence.push({ note: `Chat: "${question}" → "${said}" (${shown ?? 'no date'}); Lens's /forecast for ${spender.name}: ${JSON.stringify(was)} then ${JSON.stringify(now)}` })
          if (now === undefined) return fail(`Lens's /forecast does not list ${spender.name}`)
          if (now.runs_out_at === undefined) {
            return fail(`Lens's /forecast gives no runs_out_at for ${spender.name}, so Chat cannot state the day it runs out (B28.94); Chat said "${said}"`)
          }
          if (now.runs_out_at === null || Date.parse(now.runs_out_at) >= Date.parse(after.month_end)) {
            return fail(`${spender.name} holds ${lxcText(funded - paid)} LXC after paying ${lxcText(paid)} LXC this month, yet Lens's /forecast says it runs out ${now.runs_out_at ?? 'never'}, not this month`)
          }
          const days = [was?.runs_out_at, now.runs_out_at].flatMap((t) => (typeof t === 'string' ? [t.slice(0, 10)] : []))
          if (shown === null || !days.includes(shown)) return fail(`Chat states the day ${spender.name} runs out as ${shown ?? 'nothing'}; Lens's /forecast says ${days.join(' then ')}`)
          if (!/^Yes\./.test(said)) return fail(`Lens's /forecast has ${spender.name} running out this month, yet Chat answered "${said}"`)

          await mkdir(env.outDir, { recursive: true })
          for (const [width, height] of [[1440, 900], [390, 844]] as const) {
            await page.setViewportSize({ width, height })
            await card.scrollIntoViewIfNeeded()
            const shot = join(env.outDir, `chat-forecast-answer-${width}px-user${ctx.app.user.index}.png`)
            await page.screenshot({ path: shot })
            ctx.evidence.push({ note: `the forecast answer at ${width}px: ${shot}` })
          }
          return { pass: true, detail: `"${question}" in Chat: "${said}" — the day ${shown} is Lens's /forecast runs_out_at ${now.runs_out_at} for ${spender.name}, which holds ${funded - paid} µLXC after one ${paid} µLXC pay line` }
        } finally {
          await page.close()
        }
      }),
  }
}

/**
 * B28.354 (for B28.90) — an agent chosen in Chat's "Paid by" pays for the conversation. One question is asked in Chat
 * with the agent chosen: the answer says the agent paid, the request's charge is on the agent's statement and comes out
 * of its balance, and the workspace's own money — what no agent holds, and its plan's allowance — does not move.
 */
export function chatPaidBy(seed: number): Scenario {
  const funded = 2e6
  return {
    id: 'chat-paid-by',
    title: 'an agent chosen in Chat’s Paid by pays for the conversation: the charge lands on its statement and the workspace balance does not move',
    run: (ctx) =>
      withBank(ctx, async (bank) => {
        const { env, app } = ctx
        const payer = await openAgent(ctx, bank, `Chat payer ${seed}`)
        if (typeof payer === 'string') return fail(payer)
        const err = await bank.move(payer, funded, 'Fund')
        if (err !== undefined) return fail(`funding ${payer.name} was refused: ${err}`)
        const lines0 = await env.lens.agentLines(app.user, payer.id)
        const book0 = await bookOf(ctx)
        const plan0 = await env.lens.allowance(app.user)

        const page = app.page
        const viewport = page.viewportSize()
        await app.newChat()
        let said: string
        try {
          try {
            await page.locator('#chat-paid-by').selectOption(payer.id, { timeout: ACTION_TIMEOUT_MS })
          } catch {
            return fail(`Chat's Paid by offers no ${payer.name}`)
          }
          // A question nobody has asked, so the model answers it and nothing is replayed.
          const r = seeded(seed * 7919 + Date.now())
          const t = await app.ask(sum(r).q)
          ctx.evidence.push({ note: `asked in Chat with ${payer.name} chosen to pay`, question: t.question, answer: t.answer, footer: t.footerText, error: t.error })
          if (t.error !== undefined) return fail(`asked with ${payer.name} chosen to pay, Chat answered: ${t.error}`)
          if (t.footer.kind !== 'priced') return fail(`the answer was not written by the model just now (${t.footer.kind}), so nobody was charged for it`)
          const line = page.getByTestId('turn-assistant').last().getByTestId('turn-paid-by')
          said = (await line.innerText().catch(() => '')).trim()
          await mkdir(env.outDir, { recursive: true })
          for (const [width, height] of [[1440, 900], [390, 844]] as const) {
            await page.setViewportSize({ width, height })
            const shot = join(env.outDir, `chat-paid-by-${width}px-user${app.user.index}.png`)
            await page.screenshot({ path: shot })
            ctx.evidence.push({ note: `the answer ${payer.name} paid for, at ${width}px: ${shot}` })
          }
        } finally {
          if (viewport !== null) await page.setViewportSize(viewport)
          // The next question on this page is the workspace's again.
          await app.newChat()
        }

        // The ledger, not the screen: a debit for the request on the agent's statement, out of its balance.
        const lines1 = await env.lens.agentLines(app.user, payer.id)
        const book1 = await bookOf(ctx)
        const plan1 = await env.lens.allowance(app.user)
        const added = lines1.filter((l) => !lines0.some((o) => o.entry_id === l.entry_id && o.kind === l.kind))
        const net = added.reduce((t, l) => t + l.amount_ulxc, 0)
        const held = agentIn(book1, payer.id)?.balance_ulxc
        ctx.evidence.push({ note: `Chat said "${said}"; ${payer.name}'s new lines: ${added.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ') || 'none'}; it holds ${held} µLXC` })
        if (!added.some((l) => ['spend', 'hold', 'settle'].includes(l.kind)) || net >= 0) {
          return fail(`Chat answered with ${payer.name} chosen to pay, but Lens put no charge on ${payer.name}'s statement (new lines: ${JSON.stringify(added)}) — Lens bills the agent a Chat request names in X-Talyvor-Paid-By (B28.90)`)
        }
        if (held !== funded + net || held !== lines1[0].balance_after_ulxc) {
          return fail(`${payer.name} was funded ${funded} and charged ${-net} µLXC; Lens's book says it holds ${held}, its statement ends at ${lines1[0].balance_after_ulxc}`)
        }
        if (book1.unallocated_ulxc !== book0.unallocated_ulxc) {
          return fail(`${payer.name} paid for the answer, yet the workspace's own balance moved: ${book0.unallocated_ulxc} → ${book1.unallocated_ulxc} µLXC`)
        }
        if (plan0.ok && plan1.ok && plan0.value !== null && plan1.value !== null && plan1.value.consumed_ulxc !== plan0.value.consumed_ulxc) {
          return fail(`${payer.name} paid for the answer, yet the workspace's plan allowance was drawn: ${plan0.value.consumed_ulxc} → ${plan1.value.consumed_ulxc} µLXC used`)
        }
        if (said !== `Paid by ${payer.name}’s wallet`) return fail(`Lens charged ${payer.name}, but the answer in Chat says "${said}"`)
        return {
          pass: true,
          detail: `with ${payer.name} chosen in Paid by, Chat's answer cost ${payer.name} ${-net} µLXC on its statement (it holds ${held}); the workspace's own ${book1.unallocated_ulxc} µLXC did not move`,
        }
      }),
  }
}

/**
 * B28.91 — a wallet alert raised while Chat is open shows in Chat within ten seconds. An agent with a 1 LXC monthly
 * limit is funded 1 LXC and pays all of it to another agent, with Chat open in its own tab: the payment is read back
 * from the ledger (one pay line, nothing left), and within ten seconds of it Chat says the agent has run out and has
 * reached its monthly limit — without a reload.
 */
export function chatWalletAlerts(seed: number): Scenario {
  const funded = 1e6
  const withinMs = 10_000
  return {
    id: 'chat-wallet-alerts',
    title: 'an agent that runs out and reaches its monthly limit while Chat is open is shown in Chat within ten seconds',
    run: (ctx) =>
      withBank(ctx, async (bank) => {
        const { env } = ctx
        const payer = await openAgent(ctx, bank, `Alert payer ${seed}`)
        if (typeof payer === 'string') return fail(payer)
        const payee = await openAgent(ctx, bank, `Alert payee ${seed}`)
        if (typeof payee === 'string') return fail(payee)
        let err = await bank.move(payer, funded, 'Fund')
        if (err !== undefined) return fail(`funding ${payer.name} was refused: ${err}`)
        err = await bank.setLimit(payer, 'Monthly limit', funded)
        if (err !== undefined) return fail(`setting ${payer.name}'s monthly limit was refused: ${err}`)

        const page = await ctx.app.tab('/chat')
        try {
          await page.setViewportSize({ width: 1440, height: 900 })
          await page.locator('#chat-message').waitFor({ timeout: ACTION_TIMEOUT_MS })
          const notice = (kind: string) => page.locator(`[data-testid="chat-alert"][data-agent="${payer.id}"][data-kind="${kind}"]`)
          if ((await notice('low').count()) + (await notice('limit').count()) > 0) return fail(`Chat warned about ${payer.name} before it had spent anything`)

          const paid = await bank.pay(payer, payee, funded, `all of it ${seed}`)
          const t0 = Date.now()
          ctx.evidence.push({ note: `Pay ${lxcText(funded)} LXC: ${paid}` })
          if (!/^Paid /.test(paid)) return fail(`${payer.name}'s ${lxcText(funded)} LXC payment, within its ${lxcText(funded)} LXC monthly limit, was not paid: "${paid}"`)
          // The clock starts at the payment; the ledger is read while Chat's next read is on its way.
          const seen = Promise.all([notice('low').waitFor({ timeout: withinMs }), notice('limit').waitFor({ timeout: withinMs })]).then(
            () => Date.now() - t0,
            () => undefined,
          )

          // The ledger, not the screen: one pay line for all it held, and nothing left.
          const lines = (await env.lens.agentLines(ctx.app.user, payer.id)).filter((l) => l.kind === 'pay')
          const held = agentIn(await bookOf(ctx), payer.id)?.balance_ulxc
          if (lines.length !== 1 || lines[0].amount_ulxc !== -funded || held !== 0) {
            return fail(`after paying all ${funded} µLXC, ${payer.name} has pay line(s) ${JSON.stringify(lines)} and holds ${held} µLXC`)
          }

          const took = await seen
          const shown = await page.getByTestId('chat-alert').filter({ hasText: payer.name }).allInnerTexts()
          ctx.evidence.push({ note: `Chat's notices for ${payer.name}, ${took ?? 'over ' + withinMs} ms after the payment: ${JSON.stringify(shown)}` })
          if (took === undefined) return fail(`${withinMs / 1000}s after ${payer.name} spent all it held and reached its monthly limit, Chat showed ${JSON.stringify(shown)}`)
          const low = (await notice('low').getByTestId('chat-alert-text').innerText()).trim()
          const limit = (await notice('limit').getByTestId('chat-alert-text').innerText()).trim()
          if (low !== `${payer.name} has run out: it holds nothing, so Lens refuses its next request or payment until it is funded.`) {
            return fail(`Chat's low-balance notice reads "${low}"`)
          }
          if (!limit.startsWith(`${payer.name} has reached its 1 LXC`)) return fail(`Chat's limit notice reads "${limit}"`)

          await mkdir(env.outDir, { recursive: true })
          for (const [width, height] of [[1440, 900], [390, 844]] as const) {
            await page.setViewportSize({ width, height })
            await notice('low').scrollIntoViewIfNeeded()
            const shot = join(env.outDir, `chat-wallet-alerts-${width}px-user${ctx.app.user.index}.png`)
            await page.screenshot({ path: shot })
            ctx.evidence.push({ note: `the notices at ${width}px: ${shot}` })
          }
          // Put away, so this person's next conversation is not about a test agent.
          for (const kind of ['low', 'limit']) await notice(kind).getByRole('button', { name: /^Dismiss/ }).click()
          return {
            pass: true,
            detail: `${payer.name} paid all ${lxcText(funded)} LXC (one pay line, 0 left); ${took} ms later Chat said "${low}" and "${limit}"`,
          }
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
        await page.getByText('Give every agent a wallet.', { exact: true }).waitFor({ timeout: ACTION_TIMEOUT_MS })
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

/** The number on the sidebar's Approvals link once it reads `want`, or the last it read within `ms`. */
async function badgeReaches(page: Page, want: number, ms: number): Promise<number> {
  const link = page.getByRole('navigation', { name: 'Sections' }).locator('a[href="/approvals"]')
  let seen = -1
  for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(250)) {
    seen = Number(/(\d+) waiting$/.exec(((await link.textContent()) ?? '').trim())?.[1] ?? 0)
    if (seen === want) break
  }
  return seen
}

/** Approve on the row waiting for a person whose words carry `memo`; the line the screen then shows. */
async function approveRow(page: Page, memo: string): Promise<string> {
  const waiting = card(page, 'Waiting for a person')
  const approve = page.getByRole('button', { name: 'Approve', exact: true })
  const row = waiting.locator('div').filter({ hasText: memo }).filter({ has: approve }).last()
  await row.waitFor({ timeout: ACTION_TIMEOUT_MS })
  await row.getByRole('button', { name: 'Approve', exact: true }).click()
  const said = page.getByRole('status').filter({ hasText: /^(Approved|Denied)/ }).or(page.getByRole('alert')).first()
  await said.waitFor({ timeout: ACTION_TIMEOUT_MS })
  return (await said.innerText()).trim()
}

/**
 * B28.45 — the sidebar's Approvals badge is live. Three payments are held for a person; the badge must
 * read Lens's pending count. Approving one on Approvals — opened from the badge, with no reload — takes
 * the badge down by one. Approving another in a second tab (a person on another device) takes this tab's
 * badge down again on its own. Approving moves no money: the payer's balance and pay lines are read back.
 */
export function approvalsBadge(seed: number): Scenario {
  return {
    id: 'approvals-badge',
    title: 'the Approvals badge is live: approving one takes it down by one without a reload, and so does a decision made in another tab',
    run: (ctx) => withBank(ctx, async (bank) => {
      const payer = await openAgent(ctx, bank, `Badge payer ${seed}`)
      if (typeof payer === 'string') return fail(payer)
      const payee = await openAgent(ctx, bank, `Badge payee ${seed}`)
      if (typeof payee === 'string') return fail(payee)
      let err = await bank.move(payer, 3e6, 'Fund')
      if (err !== undefined) return fail(`funding was refused: ${err}`)
      err = await bank.setLimit(payer, 'Ask a person above', 500_000)
      if (err !== undefined) return fail(`the approval amount was not saved: ${err}`)
      const memos = ['first', 'second', 'third'].map((w) => `badge ${seed} ${w}`)
      for (const memo of memos) {
        const said = await bank.pay(payer, payee, 1e6, memo)
        if (!/waiting in Approvals/.test(said)) return fail(`a payment above the approval amount was not held for a person: "${said}"`)
      }
      const filed = (await ctx.env.lens.agentApprovals(ctx.app.user)).filter((x) => x.agent_id === payer.id && x.status === 'pending')
      const idOf = (memo: string) => filed.find((x) => x.memo === memo)?.id
      if (filed.length !== 3 || memos.some((m) => idOf(m) === undefined)) return fail(`Lens has ${filed.length} pending approval(s) for ${payer.name}: ${JSON.stringify(filed)}`)
      const pendingNow = async () => (await ctx.env.lens.agentApprovals(ctx.app.user)).filter((x) => x.status === 'pending').length

      const { page } = bank
      await page.reload()
      const n = await pendingNow()
      const before = await badgeReaches(page, n, ACTION_TIMEOUT_MS)
      ctx.evidence.push({ note: `held three: Lens has ${n} pending; the badge reads ${before}` })
      if (before !== n) return fail(`Lens has ${n} approval(s) pending; the sidebar's Approvals badge says ${before}`)
      // A reload would drop this mark; it is read again after each decision.
      await page.evaluate(() => { (window as unknown as { b2845?: number }).b2845 = 1 })
      const reloaded = async () => !(await page.evaluate(() => (window as unknown as { b2845?: number }).b2845 === 1))

      await page.getByRole('navigation', { name: 'Sections' }).locator('a[href="/approvals"]').click()
      await page.getByRole('heading', { level: 1, name: 'Approvals' }).waitFor({ timeout: ACTION_TIMEOUT_MS })
      const said = await approveRow(page, memos[0])
      ctx.evidence.push({ note: `Approve on Approvals: ${said}` })
      if (!/^Approved/.test(said)) return fail(`approving "${memos[0]}" was not confirmed: "${said}"`)
      const one = await badgeReaches(page, n - 1, ACTION_TIMEOUT_MS)
      ctx.evidence.push({ note: `after approving one, the badge reads ${one}` })
      if (await reloaded()) return fail('the page reloaded to show the decision')
      if (one !== n - 1) return fail(`approving one took the badge from ${n} to ${one}, not ${n - 1}`)
      const first = (await ctx.env.lens.agentApprovals(ctx.app.user)).find((x) => x.id === idOf(memos[0]))?.status
      if (first !== 'approved') return fail(`the approval for "${memos[0]}" is ${first ?? 'gone'} in Lens, not approved`)

      // Another device: a second tab approves the second, and this tab's badge follows with no click here.
      const other = await ctx.app.tab('/approvals')
      try {
        const there = await approveRow(other, memos[1])
        ctx.evidence.push({ note: `Approve in a second tab: ${there}` })
        if (!/^Approved/.test(there)) return fail(`approving "${memos[1]}" in a second tab was not confirmed: "${there}"`)
      } finally {
        await other.close()
      }
      const two = await badgeReaches(page, n - 2, ACTION_TIMEOUT_MS)
      ctx.evidence.push({ note: `after the second tab approved one, this tab's badge reads ${two}` })
      if (await reloaded()) return fail('the page reloaded to show the other tab’s decision')
      if (two !== n - 2) return fail(`a decision in another tab left this tab's badge at ${two}, not ${n - 2}, after ${ACTION_TIMEOUT_MS / 1000}s`)

      // Approving moves no money: the payment waits to be sent again.
      const pays = (await ctx.env.lens.agentLines(ctx.app.user, payer.id)).filter((l) => l.kind === 'pay')
      if (pays.length !== 0) return fail(`approving moved money: ${payer.name} has ${pays.length} pay line(s): ${JSON.stringify(pays)}`)
      const held = agentIn(await bookOf(ctx), payer.id)?.balance_ulxc
      if (held !== 3e6) return fail(`${payer.name} holds ${held} µLXC after two approvals, not the 3000000 it was funded`)
      return { pass: true, detail: `the badge read Lens's ${n}; approving one took it to ${n - 1} with no reload, and a second tab's approval took it to ${n - 2} on its own; no money moved` }
    }),
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
    title: 'a seller publishes, a buyer uses the listing and is billed once, and the seller\'s pending earnings rise by exactly 85% of its price',
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
      // B32.9: the seller earns 85% of the price, rounded down to the µUSD; Talyvor keeps 15% (B32.8).
      const gross = price / ULXC_PER_USD_MICRO
      const share = Math.floor((gross * SELLER_SHARE_BPS) / 10_000)
      if (earned.pending_uses !== earned0.pending_uses + 1 || earned.pending_usd_micros !== earned0.pending_usd_micros + share) {
        return fail(`the seller's pending went ${earned0.pending_uses} → ${earned.pending_uses} uses, ${earned0.pending_usd_micros} → ${earned.pending_usd_micros} µUSD; their 85% of one ${gross} µUSD use is ${share} µUSD`)
      }
      return { pass: true, detail: `answered ${a + b}; billed once (${lxcText(price)} LXC on the buyer's bill, the model's cost on their credits); the seller's pending rose by exactly 85% of the price, $${(share / 1e6).toFixed(4)}` }
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

/** A figure as the Ledger shows it (apps/web Ledger.tsx): "+0.001234", "9,998.766000" — whole LXC, six decimals. */
const LEDGER_FIGURE = /^[+-]?\d{1,3}(,\d{3})*\.\d{6}$/
const ledgerULXC = (shown: string): number => Math.round(Number(shown.replace(/,/g, '')) * 1e6)

/**
 * B28.268 — the Ledger reads correctly. Run after statementReconciles, whose request leaves a hold, then
 * its release and its charge written in one transaction with one timestamp. On the Ledger's first page
 * every amount and balance is in LXC to six decimals with no µ, each balance is the row below plus that
 * row's amount, and every row shown is a row of Lens's own ledger, amount and balance alike.
 */
export function ledgerReadsCorrectly(): Scenario {
  return {
    id: 'ledger-reads-correctly',
    title: 'the Ledger shows every amount and balance in LXC, and each balance is the row below plus that row’s amount',
    run: async (ctx) => {
      const page = await ctx.app.tab('/ledger')
      let shown: { amount: string; balance: string; text: string }[]
      try {
        await page.getByTestId('ledger-balance').first().waitFor({ timeout: ACTION_TIMEOUT_MS })
        shown = await page.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).map((tr) => ({
          amount: tr.querySelector('[data-testid="ledger-amount"]')?.firstElementChild?.textContent ?? '',
          balance: tr.querySelector('[data-testid="ledger-balance"]')?.firstElementChild?.textContent ?? '',
          text: tr.textContent ?? '',
        })))
      } finally {
        await page.close()
      }
      const rows = await ctx.env.lens.ledger(ctx.app.user)
      ctx.evidence.push({
        note: `the Ledger's first page: ${shown.map((s) => `${s.amount} → ${s.balance}`).join('; ')}`,
        ledger: rows.slice(0, shown.length).map((r) => ({ type: r.type, amount_ulxc: r.amount_ulxc, created_at: r.created_at })),
      })
      if (shown.length < 2) return fail(`the Ledger shows ${shown.length} row(s) after a request; it needs two to add up`)
      const odd = shown.filter((s) => !LEDGER_FIGURE.test(s.amount) || !LEDGER_FIGURE.test(s.balance) || s.text.includes('µ'))
      if (odd.length > 0) return fail(`not every figure is in LXC to six decimals: ${odd.map((s) => `"${s.amount}" / "${s.balance}"`).join(', ')}`)
      const amounts = shown.map((s) => ledgerULXC(s.amount))
      const balances = shown.map((s) => ledgerULXC(s.balance))
      for (let i = 0; i + 1 < shown.length; i++) {
        if (balances[i] !== balances[i + 1] + amounts[i]) {
          return fail(`row ${i + 1} reads ${shown[i].balance} after ${shown[i].amount}, but the row below ends on ${shown[i + 1].balance}`)
        }
      }
      const fromLens = new Set(rows.map((r) => `${r.amount_ulxc} ${r.balance_after_ulxc}`))
      const notLens = shown.filter((_, i) => !fromLens.has(`${amounts[i]} ${balances[i]}`))
      if (notLens.length > 0) return fail(`${notLens.length} row(s) on screen are no row of Lens's ledger: ${notLens.map((s) => `${s.amount} → ${s.balance}`).join(', ')}`)
      return { pass: true, detail: `${shown.length} rows in LXC; each balance is the row below plus its amount, from ${shown[shown.length - 1].balance} to ${shown[0].balance}, every row Lens's own` }
    },
  }
}

/** B28.269 — words Overview and Spend & routing must no longer show. */
const SPEND_JARGON = [/float upstream/i, /dresses as derived/i, /in no row of this split/i, /provenance/i]
const MONTH_ROW = 'This month, in US dollars'
const MONTH_HINT = 'roughly what your AI calls have cost since the 1st'
/** The note under the per-model split, when there is one: one sentence ending at the Ledger. */
const UNSPLIT_NOTE = /of the total above is not broken down by model, because those charges did not record which model they were for; each one is listed in the Ledger\./

/**
 * B28.269 — Overview and Spend & routing in plain words: the month row says what it is, no
 * jargon is left on either screen, and any "not broken down by model" note is a complete
 * sentence whose Ledger link opens /ledger.
 */
export function spendPlainWords(): Scenario {
  return {
    id: 'spend-plain-words',
    title: 'Overview and Spend & routing say "This month, in US dollars" in plain words, and any not-broken-down note is one sentence pointing to the Ledger',
    run: async (ctx) => {
      const seen: string[] = []
      for (const path of ['/overview', '/spend']) {
        const page = await ctx.app.tab(path)
        try {
          await page.getByText(MONTH_ROW, { exact: true }).first().waitFor({ timeout: ACTION_TIMEOUT_MS })
          const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
          if (!text.includes(MONTH_HINT)) return fail(`${path} shows "${MONTH_ROW}" without "${MONTH_HINT}"`)
          const jargon = SPEND_JARGON.filter((w) => w.test(text))
          if (jargon.length > 0) return fail(`${path} still says ${jargon.map(String).join(', ')}`)
          const note = page.getByTestId('lxc-unsplit')
          if ((await note.count()) > 0) {
            const said = (await note.first().innerText()).replace(/\s+/g, ' ').trim()
            if (said.includes('broken down by model') && !UNSPLIT_NOTE.test(said)) return fail(`${path}'s split note reads "${said}"`)
            const href = await note.first().getByRole('link', { name: 'Ledger' }).first().getAttribute('href')
            if (href !== '/ledger') return fail(`${path}'s split note links its Ledger to ${href}`)
            seen.push(`${path}: "${said}"`)
          } else {
            seen.push(`${path}: no split note (every charge names its model)`)
          }
        } finally {
          await page.close()
        }
      }
      ctx.evidence.push({ note: seen.join('; ') })
      return { pass: true, detail: `both screens say "${MONTH_ROW}" — ${MONTH_HINT}, with none of the old jargon; ${seen.join('; ')}` }
    },
  }
}

/** A figure as WindowFigure shows it: "300,000 µLXC" under one LXC, "10.300000 LXC" from one up. */
function shownULXC(shown: string): number | undefined {
  const m = /(-?[\d,]+)(?:\.(\d{6}))?\s*(µ?)LXC/i.exec(shown.replace(/\s+/g, ' '))
  if (m === null) return undefined
  const whole = Number(m[1].replace(/,/g, ''))
  if (m[3] !== '') return whole
  return Math.sign(whole || 1) * (Math.abs(whole) * 1e6 + Number(m[2] ?? '0'))
}

/**
 * B32.69 — the platform fee on AI spend (B32.11) is its own line on Overview and Spend & routing. Run after
 * statementReconciles, whose agent request is charged on credits: Lens's ledger holds its platform_fee row,
 * and each screen shows every fee line in the window with Lens's own words and exactly the µLXC Lens's rows
 * add up to, and counts it in the window's total — the spend rows plus the fee rows, to the µLXC.
 */
export function spendPlatformFee(): Scenario {
  return {
    id: 'spend-platform-fee',
    title: 'Overview and Spend & routing show each platform fee as its own line in Lens’s words, and count it in the total spent',
    run: async (ctx) => {
      const rows = await ctx.env.lens.ledger(ctx.app.user)
      const seen: string[] = []
      for (const { path, days } of [{ path: '/spend', days: 7 }, { path: '/overview', days: 30 }]) {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
        const inWindow = rows.filter((r) => Date.parse(r.created_at) >= cutoff)
        const want = new Map<string, number>()
        for (const r of inWindow.filter((x) => x.type === 'platform_fee')) want.set(r.description, (want.get(r.description) ?? 0) - r.amount_ulxc)
        const spent = inWindow.filter((r) => r.type === 'spend').reduce((n, r) => n - r.amount_ulxc, 0)
        const fees = [...want.values()].reduce((n, x) => n + x, 0)
        ctx.evidence.push({ note: `${path}: Lens's ledger over ${days} days — spend ${spent} µLXC, fees ${[...want].map(([l, n]) => `"${l}" ${n}`).join(', ') || 'none'}` })
        if (spent === 0) throw new CannotTest(`nothing was charged on credits over ${days} days, so there is no fee to show`)
        if (want.size === 0) return fail(`Lens charged ${spent} µLXC on credits over ${days} days and wrote no platform_fee row`)
        const page = await ctx.app.tab(path)
        try {
          await page.getByTestId('lxc-platform-fees').waitFor({ timeout: ACTION_TIMEOUT_MS })
          const lines = await page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll('[data-testid="platform-fee-label"]')).map((e) => e.textContent ?? '')
            const amounts = Array.from(document.querySelectorAll('[data-testid="platform-fee-amount"]')).map((e) => (e as HTMLElement).innerText)
            return labels.map((label, i) => ({ label, amount: amounts[i] ?? '' }))
          })
          const total = await page.getByTestId('lxc-debit-total').innerText()
          seen.push(`${path}: ${lines.map((l) => `"${l.label}" ${l.amount}`).join(', ')}; total ${total}`)
          if (lines.length !== want.size) return fail(`${path} shows ${lines.length} fee line(s); Lens wrote ${want.size}: ${seen.at(-1)}`)
          for (const l of lines) {
            if (!want.has(l.label)) return fail(`${path} shows a fee line "${l.label}" that no platform_fee row of Lens's says`)
            if (shownULXC(l.amount) !== want.get(l.label)) return fail(`${path} shows "${l.label}" as ${l.amount}; Lens's rows add up to ${want.get(l.label)} µLXC`)
          }
          if (!/at least/.test(total) && shownULXC(total) !== spent + fees) {
            return fail(`${path}'s total reads ${total}; Lens's spend and fee rows add up to ${spent + fees} µLXC`)
          }
        } finally {
          await page.close()
        }
      }
      ctx.evidence.push({ note: seen.join('; ') })
      return { pass: true, detail: `each fee line in Lens's words and amount, counted in the total — ${seen.join('; ')}` }
    },
  }
}

/** B28.270 — what the two pages Stripe returns to say when no checkout is coming back, and what neither may say. */
const RETURN_PAGES = [
  { path: '/billing/success', heading: 'No payment to confirm here.' },
  { path: '/billing/cancel', heading: 'No payment was taken.' },
] as const
const RETURN_CONTRADICTIONS = [/payment went through/i, /applied either way/i, /purchase entry/i]

/**
 * B28.270 — /billing/success opened without a checkout (no session_id) says there is no payment to
 * confirm, and /billing/cancel says no payment was taken; neither claims a payment went through,
 * that a credit is "applied either way", or sends anyone to look for a purchase entry. Neither spends.
 */
export function billingReturnPages(): Scenario {
  return {
    id: 'billing-return-pages',
    title: '/billing/success with no checkout says "No payment to confirm here." and /billing/cancel says "No payment was taken."',
    run: async (ctx) => {
      const seen: string[] = []
      for (const { path, heading } of RETURN_PAGES) {
        const page = await ctx.app.tab(path)
        try {
          const shown = await page.getByRole('heading', { level: 2, name: heading, exact: true })
            .waitFor({ timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
          if (!shown) {
            const said = (await page.locator('main h2').first().innerText({ timeout: 1_000 }).catch(() => '')).trim()
            return fail(`${path} does not head itself "${heading}"${said !== '' ? ` (it says "${said}")` : ''}`)
          }
          const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
          const wrong = RETURN_CONTRADICTIONS.filter((w) => w.test(text))
          if (wrong.length > 0) return fail(`${path} still says ${wrong.map(String).join(', ')}`)
          seen.push(`${path}: "${heading}"`)
        } finally {
          await page.close()
        }
      }
      ctx.evidence.push({ note: seen.join('; ') })
      return { pass: true, detail: `neither return page claims a payment it did not see — ${seen.join('; ')}` }
    },
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
