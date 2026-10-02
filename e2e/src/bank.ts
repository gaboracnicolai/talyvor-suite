// B17.6 — catalog v3: the Agent Bank (B19) and the marketplace (B20), used the way a company uses them.
// A person works the screens — Agent Wallets (/agents), Publish, a listing's page, Your bill — and each
// agent acts with its own key, straight to Lens, as an agent does. Every oracle is read back from Lens:
// the agents' book, their postings, the approvals, the marketplace bill and the seller's earnings, and
// the workspace's own ledger.

import { readFile } from 'node:fs/promises'
import type { Locator, Page } from 'playwright'
import { type AppUser, chargeULXC } from './app.ts'
import { worstInputTokens } from './budget.ts'
import type { Agent, AgentBook, Answered, JudgeReply, SyntheticUser } from './lens.ts'
import { listPriceUSD, seeded, statesNumber } from './oracles.ts'
import type { Scenario, ScenarioCtx, Verdict } from './scenarios.ts'

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
    const [res] = await Promise.all([
      this.page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/pots/[^/]+/${dir}$`).test(new URL(r.url()).pathname), { timeout: ACTION_TIMEOUT_MS }),
      row.getByRole('button', { name: dir === 'in' ? 'Move in' : 'Move out' }).click(),
    ])
    if (res.ok()) return undefined
    const refused = row.getByRole('alert')
    await refused.waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
    return (await refused.count()) > 0 ? (await refused.first().innerText()).trim() : `the move answered ${res.status()}`
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
      const { row, said: approved } = await bank.approve(payer, payee)
      ctx.evidence.push({ note: `Waiting for a person: ${row}` }, { note: `Approve: ${approved}` })
      if (!row.endsWith(` 1 LXC — ${memo}`)) return fail(`the row waiting for a person does not say 1 LXC — ${memo}: "${row}"`)
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
