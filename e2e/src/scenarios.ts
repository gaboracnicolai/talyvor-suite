// B17.3 — catalog v1. Every scenario has an ORACLE: a known answer, the judge comparing a served answer
// with a fresh one, the catalog's price, or the ledger read back. A scenario returns a verdict; a thrown
// CapReached makes it SKIP, anything else thrown makes it ERROR (run.ts).

import { type AppUser, type ChargeBook, type Turn, chargeULXC } from './app.ts'
import type { SpendCap } from './budget.ts'
import { CapReached, worstInputTokens } from './budget.ts'
import type { LensClient, SyntheticUser } from './lens.ts'
import {
  type CatalogModel,
  chatModels,
  expectedFigure,
  judgeVerdict,
  listPriceUSD,
  namesWord,
  seeded,
  statesNumber,
} from './oracles.ts'

export interface Evidence {
  note?: string
  question?: string
  answer?: string
  footer?: string
  error?: string
  ledger?: { type: string; amount_ulxc: number; created_at: string }[]
}

export interface Verdict {
  pass: boolean
  detail: string
}

export interface RunEnv {
  lens: LensClient
  cap: SpendCap
  catalog: CatalogModel[]
  usdPerLXC: number
  judgeProvider: string
  judgeModel: string
  book: ChargeBook
  /** Signs another synthetic user in, in its own browser context — for scenarios across accounts. */
  signInUser: (index: number) => Promise<AppUser>
  userCount: number
}

export interface ScenarioCtx {
  app: AppUser
  env: RunEnv
  evidence: Evidence[]
}

export interface Scenario {
  id: string
  title: string
  run: (ctx: ScenarioCtx) => Promise<Verdict>
}

const CAPITALS: [string, string][] = [
  ['France', 'Paris'], ['Japan', 'Tokyo'], ['Canada', 'Ottawa'], ['Australia', 'Canberra'], ['Kenya', 'Nairobi'],
  ['Norway', 'Oslo'], ['Peru', 'Lima'], ['Egypt', 'Cairo'], ['Poland', 'Warsaw'], ['Chile', 'Santiago'],
  ['Portugal', 'Lisbon'], ['Thailand', 'Bangkok'], ['Ireland', 'Dublin'], ['Greece', 'Athens'], ['Finland', 'Helsinki'],
  ['Hungary', 'Budapest'], ['Argentina', 'Buenos Aires'], ['Vietnam', 'Hanoi'], ['Morocco', 'Rabat'], ['Austria', 'Vienna'],
]

const NUMBER_ONLY = 'Reply with the number only.'

function record(ctx: ScenarioCtx, t: Turn, note?: string): Turn {
  ctx.evidence.push({ note, question: t.question, answer: t.answer.slice(0, 500), footer: t.footerText, error: t.error })
  return t
}

async function ask(ctx: ScenarioCtx, q: string, note?: string): Promise<Turn> {
  return record(ctx, await ctx.app.ask(q), note)
}

function servedNotAsked(t: Turn): boolean {
  return t.footer.kind === 'cache' || t.footer.kind === 'pool'
}

function describe(t: Turn): string {
  return t.error !== undefined ? `refused: ${t.error}` : `"${t.answer.slice(0, 120)}" [${t.footerText}]`
}

/** Asks the judge whether two answers to one question agree. Counted against the cap and the ledger. */
async function judgeAgrees(ctx: ScenarioCtx, question: string, a: string, b: string): Promise<boolean | undefined> {
  const { env, app } = ctx
  const model = env.catalog.find((m) => m.id === env.judgeModel)
  if (model === undefined) throw new Error(`the catalog has no judge model ${env.judgeModel}`)
  const prompt = `Question: ${question}\n\nAnswer A: ${a}\n\nAnswer B: ${b}\n\n` +
    'Do answers A and B give the same final answer to the question? Reply with YES or NO only.'
  const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(prompt.length), 5))
  let reply
  try {
    reply = await env.lens.judge(app.user, env.judgeProvider, env.judgeModel, prompt)
  } catch (e) {
    env.cap.settle(hold, undefined)
    throw e
  }
  // Synthetic workspaces pool among themselves, so the judge's own question can be a shared answer.
  const cost = reply.replayed ? 0
    : reply.pooledULXC !== undefined ? (reply.pooledULXC / 1e6) * env.usdPerLXC
      : listPriceUSD(model, reply.inputTokens, reply.outputTokens)
  env.cap.settle(hold, cost)
  if (!reply.replayed) {
    env.book.add(app.user.workspaceID, reply.pooledULXC ?? chargeULXC(cost, env.usdPerLXC))
  }
  const verdict = judgeVerdict(reply.text)
  ctx.evidence.push({ note: `judge (${env.judgeModel})`, question, answer: reply.text })
  return verdict
}

/** A priced footer, or the reason there is none. */
function priced(t: Turn): string | undefined {
  if (t.error !== undefined) return `refused: ${t.error}`
  if (t.footer.kind === 'unpriced') return 'the answer carried no price'
  if (t.footer.kind === 'unreadable') return `unreadable footer "${t.footerText}"`
  return undefined
}

// ─── the catalog ─────────────────────────────────────────────────────────────

export function knownAnswer(seed: number): Scenario {
  const r = seeded(seed)
  const a = 100 + Math.floor(r() * 900)
  const b = 100 + Math.floor(r() * 900)
  return {
    id: 'known-answer',
    title: 'arithmetic with a known answer, and the price under it',
    run: async (ctx) => {
      const t = await ask(ctx, `What is ${a} + ${b}? ${NUMBER_ONLY}`)
      const noPrice = priced(t)
      if (noPrice !== undefined) return { pass: false, detail: noPrice }
      return statesNumber(t.answer, a + b)
        ? { pass: true, detail: `${a} + ${b} = ${a + b}` }
        : { pass: false, detail: `expected ${a + b}, got ${describe(t)}` }
    },
  }
}

export function capital(seed: number): Scenario {
  const [country, city] = CAPITALS[seed % CAPITALS.length]
  return {
    id: 'capital',
    title: 'a capital city with a known answer',
    run: async (ctx) => {
      const t = await ask(ctx, `What is the capital of ${country}? Reply with the city name only.`)
      const noPrice = priced(t)
      if (noPrice !== undefined) return { pass: false, detail: noPrice }
      return namesWord(t.answer, city)
        ? { pass: true, detail: `${country} → ${city}` }
        : { pass: false, detail: `expected ${city}, got ${describe(t)}` }
    },
  }
}

export function repeatInNewChat(seed: number): Scenario {
  const r = seeded(seed * 7 + 3)
  const a = 11 + Math.floor(r() * 80)
  const b = 11 + Math.floor(r() * 80)
  const q = `What is ${a} times ${b}? ${NUMBER_ONLY}`
  return {
    id: 'repeat-new-chat',
    title: 'an exact repeat in a new chat is the earlier answer at 0 LXC; Regenerate asks the model',
    run: async (ctx) => {
      const first = await ask(ctx, q, 'first time')
      if (!statesNumber(first.answer, a * b)) return { pass: false, detail: `first answer wrong: ${describe(first)}` }
      await ctx.app.newChat()
      const again = await ask(ctx, q, 'repeated in a new chat')
      if (again.footer.kind !== 'cache') {
        return { pass: false, detail: `the repeat was not served from the earlier answer: ${describe(again)}` }
      }
      if (again.answer !== first.answer) return { pass: false, detail: `the replay differs from the answer it replays: ${describe(again)}` }
      const fresh = record(ctx, await ctx.app.regenerate(q), 'Regenerate')
      if (fresh.footer.kind !== 'priced') return { pass: false, detail: `Regenerate did not ask the model: ${describe(fresh)}` }
      if (!statesNumber(fresh.answer, a * b)) return { pass: false, detail: `the regenerated answer is wrong: ${describe(fresh)}` }
      const agree = await judgeAgrees(ctx, q, again.answer, fresh.answer)
      return agree === true
        ? { pass: true, detail: 'replayed at 0 LXC; Regenerate priced and the judge agrees' }
        : { pass: false, detail: `the judge ${agree === false ? 'says the served and fresh answers differ' : 'gave no verdict'}` }
    },
  }
}

export function oneDigitTrap(seed: number): Scenario {
  // Unique to each user in a run: a number another user already asked about is rightly served from the
  // shared pool, and would read here as the trap springing.
  const x = 40 + seed
  const setup = `Let x = ${x}. Reply with OK.`
  return {
    id: 'one-digit-trap',
    title: "Nicolai's trap: after identical history, a one-digit change is never served from the cache",
    run: async (ctx) => {
      await ask(ctx, setup, 'chat A, turn 1')
      const a = await ask(ctx, `What is x + 2? ${NUMBER_ONLY}`, 'chat A, turn 2')
      if (!statesNumber(a.answer, x + 2)) return { pass: false, detail: `chat A answered wrong: ${describe(a)}` }
      await ctx.app.newChat()
      const replay = await ask(ctx, setup, 'chat B, turn 1 (identical)')
      const b = await ask(ctx, `What is x + 3? ${NUMBER_ONLY}`, 'chat B, turn 2 (one digit changed)')
      const history = replay.footer.kind === 'cache' ? 'identical history' : 'history not replayed, so maybe not identical'
      if (servedNotAsked(b)) return { pass: false, detail: `the one-digit change was SERVED, not asked (${history}): ${describe(b)}` }
      return statesNumber(b.answer, x + 3)
        ? { pass: true, detail: `asked the model and got ${x + 3} (${history})` }
        : { pass: false, detail: `expected ${x + 3}, got ${describe(b)}` }
    },
  }
}

export function rephraseSameAccount(seed: number): Scenario {
  const [country, city] = CAPITALS[(seed + 7) % CAPITALS.length]
  return {
    id: 'rephrase-same-account',
    title: 'a rephrasing in the same account is answered right, and a served one agrees with a fresh one',
    run: async (ctx) => {
      await ask(ctx, `What is the capital of ${country}? Reply with the city name only.`, 'original')
      await ctx.app.newChat()
      const q = `Which city is the capital of ${country}? Just the name, please.`
      const t = await ask(ctx, q, 'rephrased in a new chat')
      if (!namesWord(t.answer, city)) return { pass: false, detail: `expected ${city}, got ${describe(t)}` }
      if (!servedNotAsked(t)) return { pass: true, detail: `asked the model: ${city}` }
      const fresh = record(ctx, await ctx.app.regenerate(q), 'Regenerate')
      const agree = await judgeAgrees(ctx, q, t.answer, fresh.answer)
      return agree === true
        ? { pass: true, detail: `served (${t.footer.kind}) and the judge agrees with a fresh answer` }
        : { pass: false, detail: `served (${t.footer.kind}) but the judge ${agree === false ? 'disagrees' : 'gave no verdict'}` }
    },
  }
}

export function acrossAccounts(seed: number, partner: number): Scenario {
  const [country, city] = CAPITALS[(seed + 3) % CAPITALS.length]
  const q = `What is the capital of ${country}? Reply with the city name only.`
  return {
    id: 'across-accounts',
    title: "another account's question: never 'your earlier answer'; shared at 30% off when pooled",
    run: async (ctx) => {
      await ask(ctx, q, `user ${ctx.app.user.index} asks`)
      const other = await ctx.env.signInUser(partner)
      try {
        const t = record(ctx, await other.ask(q), `user ${partner} (another account) asks the same`)
        if (t.footer.kind === 'cache') {
          return { pass: false, detail: `another account was served "your earlier answer" — a cross-account replay: ${describe(t)}` }
        }
        if (!namesWord(t.answer, city)) return { pass: false, detail: `expected ${city}, got ${describe(t)}` }
        if (t.footer.kind === 'pool') {
          return t.footer.discountPct === 30
            ? { pass: true, detail: 'shared from the pool at 30% off (charged 70%)' }
            : { pass: false, detail: `shared at ${t.footer.discountPct}% off, not 30%: ${describe(t)}` }
        }
        return { pass: true, detail: 'answered by the model (not pooled this time)' }
      } finally {
        await other.close()
      }
    },
  }
}

export function followUpNotCached(seed: number): Scenario {
  const r = seeded(seed * 13 + 5)
  const [a, b, c, d] = [0, 0, 0, 0].map(() => 10 + Math.floor(r() * 89))
  const follow = `Multiply that by 2. ${NUMBER_ONLY}`
  return {
    id: 'follow-up-not-cached',
    title: 'a context-dependent follow-up is never served from the cache',
    run: async (ctx) => {
      await ask(ctx, `What is ${a} + ${b}? ${NUMBER_ONLY}`, 'chat A')
      const first = await ask(ctx, follow, 'chat A follow-up')
      if (!statesNumber(first.answer, 2 * (a + b))) return { pass: false, detail: `chat A follow-up wrong: ${describe(first)}` }
      await ctx.app.newChat()
      await ask(ctx, `What is ${c} + ${d}? ${NUMBER_ONLY}`, 'chat B, different context')
      const second = await ask(ctx, follow, 'chat B, the same follow-up words')
      if (servedNotAsked(second)) return { pass: false, detail: `the follow-up was SERVED in a different context: ${describe(second)}` }
      return statesNumber(second.answer, 2 * (c + d))
        ? { pass: true, detail: `asked the model: ${2 * (c + d)}` }
        : { pass: false, detail: `expected ${2 * (c + d)}, got ${describe(second)}` }
    },
  }
}

export function sidebarStaysHidden(): Scenario {
  return {
    id: 'sidebar-stays-hidden',
    title: 'the Chat sidebar hides and stays hidden after a reload',
    run: async (ctx) => {
      const page = ctx.app.page
      await page.getByRole('button', { name: 'Hide sidebar' }).click()
      await page.reload()
      await page.locator('#chat-message').waitFor({ state: 'visible' })
      const shown = await page.getByRole('button', { name: 'Show sidebar' }).isVisible()
      const listVisible = await page.getByRole('list', { name: 'Saved conversations' }).isVisible()
      ctx.evidence.push({ note: `after reload: "Show sidebar" visible=${shown}, saved conversations visible=${listVisible}` })
      if (shown) await page.getByRole('button', { name: 'Show sidebar' }).click()
      return shown && !listVisible
        ? { pass: true, detail: 'hidden after the reload' }
        : { pass: false, detail: `after the reload the sidebar was ${listVisible ? 'shown again' : 'in neither state'}` }
    },
  }
}

export function streamsProgressively(): Scenario {
  return {
    id: 'streaming',
    title: 'an answer appears progressively, not all at once',
    run: async (ctx) => {
      const lengths: number[] = []
      const t = await ctx.app.ask('List the whole numbers from 1 to 60, separated by spaces, and nothing else.', lengths)
      record(ctx, t)
      const distinct = new Set(lengths.filter((n) => n > 0)).size
      ctx.evidence.push({ note: `text lengths seen while answering: ${lengths.join(',')}` })
      if (priced(t) !== undefined) return { pass: false, detail: priced(t) as string }
      if (t.footer.kind !== 'priced') return { pass: true, detail: `served (${t.footer.kind}); cadence not measurable on a replay` }
      return distinct >= 3 && statesNumber(t.answer, 60)
        ? { pass: true, detail: `${distinct} partial states before the answer finished` }
        : { pass: false, detail: `only ${distinct} partial state(s) seen before the answer finished` }
    },
  }
}

export function everyModelAnswers(streamable: readonly string[]): Scenario {
  return {
    id: 'every-model',
    title: 'every model in the picker answers, and its price matches the catalog',
    run: async (ctx) => {
      const { app, env } = ctx
      const res = await app.page.request.get(new URL('/api/ai/providers', app.page.url()).toString())
      const unconfigured = res.ok() ? (((await res.json()) as { unconfigured?: string[] }).unconfigured ?? []) : []
      const models = chatModels(env.catalog).filter((m) => streamable.includes(m.provider) && !unconfigured.includes(m.provider))
      ctx.evidence.push({ note: `${models.length} models offered; providers without a key: ${unconfigured.join(', ') || 'none'}` })
      const failures: string[] = []
      const start = app.modelNameInUse
      for (const m of models) {
        // One model's failure is that model's FAIL; the rest are still checked.
        try {
          if (!(await app.chooseModel(m.display_name))) {
            failures.push(`${m.display_name}: not in the model picker`)
            continue
          }
          await app.newChat()
          const t = await ask(ctx, 'Reply with the single word: ok', m.display_name)
          if (t.footer.kind !== 'priced') {
            failures.push(`${m.display_name}: ${priced(t) ?? `not priced (${t.footer.kind})`}`)
            continue
          }
          if (t.answer.trim() === '') failures.push(`${m.display_name}: empty answer`)
          if (t.footer.model !== m.display_name) failures.push(`${m.display_name}: answered as "${t.footer.model}"`)
          const want = expectedFigure(listPriceUSD(m, t.footer.inputTokens, t.footer.outputTokens),
            t.footer.unit === 'LXC' ? env.usdPerLXC : undefined)
          if (!t.footerText.startsWith(want + ' · ')) failures.push(`${m.display_name}: shows "${t.footerText}", catalog says ${want}`)
        } catch (e) {
          if (e instanceof CapReached) throw e
          failures.push(`${m.display_name}: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`)
        }
      }
      await app.chooseModel(start)
      await app.newChat()
      return failures.length === 0
        ? { pass: true, detail: `${models.length} models answered at their catalog price` }
        : { pass: false, detail: failures.join('; ') }
    },
  }
}

/**
 * The money oracle, read back from the ledger once every journey is over. Each answer a workspace was
 * charged for — in any browser signed in as it, and each judge call — is exactly one spend row, a free
 * replay is none, and together the rows debit what the screen's token counts cost at list price.
 */
export async function checkLedger(env: RunEnv, user: SyntheticUser): Promise<Verdict & { evidence: Evidence[] }> {
  const rows = await env.lens.ledger(user)
  const spends = rows.filter((r) => r.type === 'spend')
  const want = env.book.of(user.workspaceID)
  const spentULXC = spends.reduce((s, r) => s - r.amount_ulxc, 0)
  const evidence: Evidence[] = [{
    note: `${spends.length} spend row(s) debiting ${spentULXC} µLXC; ${want.count} charged answer(s) that should cost ` +
      `${want.ulxc.toFixed(0)} µLXC (±${want.slack.toFixed(0)})`,
    ledger: rows.map((r) => ({ type: r.type, amount_ulxc: r.amount_ulxc, created_at: r.created_at })),
  }]
  if (spends.length !== want.count) {
    return { pass: false, detail: `${spends.length} spend rows for ${want.count} charged answers`, evidence }
  }
  // One µLXC per row of rounding, on top of the shared answers' two-figure display.
  if (Math.abs(spentULXC - want.ulxc) > want.slack + want.count) {
    return { pass: false, detail: `the ledger debited ${spentULXC} µLXC; the answers shown cost ${want.ulxc.toFixed(0)} µLXC at list price`, evidence }
  }
  return { pass: true, detail: `${spends.length} spend rows debiting ${spentULXC} µLXC, as the answers shown cost`, evidence }
}

/**
 * Which scenarios user `i` runs. Everyone runs the two known-answer questions; one in ten of the users
 * also runs each of the others, so 100 users cover the catalog ten times over; user 0 prices every
 * model. The ledger read-back runs for everyone after all journeys (checkLedger).
 */
export function journeyFor(i: number, users: number, streamable: readonly string[]): Scenario[] {
  const list: Scenario[] = [knownAnswer(i + 1), capital(i)]
  switch (i % 10) {
    case 0:
      if (i === 0) list.push(everyModelAnswers(streamable))
      break
    case 1: list.push(repeatInNewChat(i)); break
    case 2: list.push(oneDigitTrap(i)); break
    case 3: list.push(rephraseSameAccount(i)); break
    case 4: if (i + 5 < users) list.push(acrossAccounts(i, i + 5)); break
    case 5: list.push(followUpNotCached(i)); break
    case 6: list.push(sidebarStaysHidden()); break
    case 7: list.push(streamsProgressively()); break
  }
  return list
}
