// B32.71 — the seats gate, end to end. The owner of a synthetic workspace adds people on Members as a person
// does (apps/web/src/areas/lens/Members.tsx). The BFF adds them to the session's Track workspace (POST
// /api/members), and Track asks Lens, before each add, whether the plan of the Lens workspace the BFF names has
// a seat for one more (B32.70, B32.73). The oracles are what Track answered and its roster read back after,
// never the screen alone: a Free workspace's second member is refused in Lens's own words, which name
// LENS_PLAN_GATES, the free plan and the team plan, and the roster still lists the owner alone; on Team (a
// test-mode subscription) the fifth member is added and the sixth refused, naming the business plan.

import type { Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'
import { payCheckout } from './screens.ts'

/** Seats on each plan in LENS_PLAN_GATES' default (Nicolai's decision of 5 Oct 2026, B32.12). */
const TEAM_SEATS = 5
/** How long Stripe's webhook may take to reach Lens after the test card is taken. */
const WEBHOOK_WAIT_MS = 60_000

/** Track's memberView, as GET /api/members relays it. */
interface Member { id: string; email: string; role: string }

/** Track's answer to an add, as the BFF relays it: the member on 201, else {error, code, plan, limit, allows}. */
interface AddAnswer { email?: string; error?: string; code?: string; plan?: string; limit?: number; allows?: string }

interface Added { status: number; body: AddAnswer; shown: string; plansLink: boolean }

/** The roster, read back through the BFF as the Members screen reads it. */
async function roster(page: Page): Promise<Member[]> {
  const res = await page.request.get(new URL('/api/members', page.url()).toString())
  const text = await res.text()
  if (!res.ok()) throw new Error(`the roster could not be read: GET /api/members answered ${res.status()} ${text.slice(0, 200)}`)
  return (JSON.parse(text) as Member[] | null) ?? []
}

/** Adds `email` as a member on the Members screen: what Track answered, and what the screen says. */
async function addOnScreen(page: Page, email: string): Promise<Added> {
  await page.getByLabel('Email', { exact: true }).fill(email)
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/members', { timeout: ACTION_TIMEOUT_MS }),
    page.getByRole('button', { name: 'Add member', exact: true }).click(),
  ])
  const body = (await res.json().catch(() => ({}))) as AddAnswer
  const refusal = page.getByTestId('member-add-refusal')
  const said = res.ok() ? page.getByRole('status').filter({ hasText: email }) : refusal
  const shown = await said.first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => said.first().innerText(), () => '')
  const plansLink = !res.ok() && (await refusal.getByRole('link', { name: 'See plans' }).count()) > 0
  return { status: res.status(), body, shown: shown.trim(), plansLink }
}

/** Why Track's refusal of one member too many is not the plan's, in Lens's words naming both plans; undefined when it is. */
function notThePlansRefusal(add: Added, plan: string, allows: string, words: string[]): string | undefined {
  if (add.status === 201) return `the member was added (201)`
  if (add.status !== 402) return `Track answered ${add.status} ${add.body.code ?? ''} "${add.body.error ?? ''}", not the plan's refusal (402)`
  const missing = ['LENS_PLAN_GATES', ...words].filter((w) => !(add.body.error ?? '').includes(w))
  if (missing.length > 0) return `the refusal "${add.body.error}" does not name ${missing.join(', ')}`
  if (add.body.plan !== plan || add.body.allows !== allows) return `the refusal reads plan "${add.body.plan}" allowing "${add.body.allows}", not ${plan} allowing ${allows}`
  if (add.shown !== `${add.body.error} See plans` || !add.plansLink) return `Members shows "${add.shown}", not Lens's "${add.body.error}" with a link to /plans`
  return undefined
}

const newEmail = (seed: number, n: number): string => `seat-${seed}-${n}-${Date.now().toString(36)}@example.com`

/** Adds one member too many and checks the refusal and the roster after it; the verdict, or undefined when both hold. */
async function oneTooMany(page: Page, ctx: ScenarioCtx, email: string, before: Member[],
  plan: string, allows: string, words: string[]): Promise<Verdict | undefined> {
  const add = await addOnScreen(page, email)
  ctx.evidence.push({ note: `Add member ${email} with ${before.length} on the roster: ${add.status}; Members shows "${add.shown}"`, answer: JSON.stringify(add.body) })
  const wrong = notThePlansRefusal(add, plan, allows, words)
  if (wrong !== undefined) return fail(`on ${plan}, adding member ${before.length + 1}: ${wrong}`)
  const after = await roster(page)
  ctx.evidence.push({ note: `the roster after: ${after.map((m) => `${m.email} (${m.role})`).join(', ')}` })
  if (after.length !== before.length || after.some((m) => m.email === email)) {
    return fail(`refused, yet the roster lists ${after.length} where it listed ${before.length}${after.some((m) => m.email === email) ? `, ${email} among them` : ''}`)
  }
  return undefined
}

export function seatsFree(seed: number): Scenario {
  return {
    id: 'seats-free',
    title: "a Free workspace's owner adds a second member on Members: Track refuses it in Lens's words, naming LENS_PLAN_GATES, the free plan and the team plan, and the roster still lists one",
    feature: 'Members',
    run: async (ctx) => {
      const page = await ctx.app.tab('/members')
      try {
        const before = await roster(page)
        ctx.evidence.push({ note: `the roster before: ${before.map((m) => `${m.email} (${m.role})`).join(', ') || 'nobody'}` })
        if (before.length !== 1) throw new Error(`a new workspace's roster lists ${before.length} members; Track's bootstrap makes its owner the one`)
        const email = newEmail(seed, 2)
        const wrong = await oneTooMany(page, ctx, email, before, 'free', 'team', ['the free plan allows 1 seat', 'the team plan'])
        return wrong ?? { pass: true, detail: `a second member on Free was refused in Lens's words with a link to /plans, and the roster still lists its owner alone` }
      } finally {
        await page.close()
      }
    },
  }
}

/**
 * On Team, bought with the test card on a checkout Lens opens (Plans offers company plans no button yet), the
 * owner adds members until the roster holds five, each read back; the sixth is refused naming the business plan.
 */
export function seatsTeam(seed: number): Scenario {
  return {
    id: 'seats-team',
    title: "on Team (a test-mode subscription) the owner adds members on Members up to the fifth, each read back on the roster; the sixth is refused in Lens's words, naming the team plan and the business plan",
    feature: 'Members',
    run: async (ctx) => {
      const { env, app } = ctx
      const start = await env.lens.startSubscription(app.user, 'team')
      if (!start.ok || start.value.url === undefined) {
        throw new CannotTest(`Lens opens this test workspace no Team checkout: ${start.status} ${start.ok ? 'without a url' : start.error}`)
      }
      const paid = await payCheckout(app, start.value.url, `tester-${seed}@example.com`)
      ctx.evidence.push({ note: `Team, paid with the test card on ${paid.checkout}${paid.refused === undefined ? '' : `: ${paid.refused}`}` })
      if (paid.refused !== undefined) return fail(`paying for Team with the test card: ${paid.refused}`)
      const end = Date.now() + WEBHOOK_WAIT_MS
      let sub = await env.lens.subscription(app.user)
      while (!(sub.ok && sub.value.subscribed) && Date.now() < end) {
        await app.page.waitForTimeout(5000)
        sub = await env.lens.subscription(app.user)
      }
      if (!sub.ok || !sub.value.subscribed) return fail(`paid for Team with the test card, and Lens's subscription read says ${sub.ok ? 'not subscribed' : `${sub.status} ${sub.error}`}`)

      const page = await app.tab('/members')
      try {
        let members = await roster(page)
        ctx.evidence.push({ note: `on Team, the roster before: ${members.map((m) => `${m.email} (${m.role})`).join(', ')}` })
        if (members.length === 0 || members.length >= TEAM_SEATS) throw new Error(`the roster lists ${members.length} before any add on Team`)
        while (members.length < TEAM_SEATS) {
          const email = newEmail(seed, members.length + 1)
          const add = await addOnScreen(page, email)
          ctx.evidence.push({ note: `Add member ${email} with ${members.length} on the roster: ${add.status}; Members shows "${add.shown}"`, answer: JSON.stringify(add.body) })
          if (add.status !== 201) return fail(`on Team, member ${members.length + 1} of ${TEAM_SEATS} was refused: ${add.status} ${add.body.code ?? ''} "${add.body.error ?? ''}"`)
          const after = await roster(page)
          if (after.length !== members.length + 1 || !after.some((m) => m.email === email)) {
            return fail(`on Team, ${email} was added (201) and the roster lists ${after.length}: ${after.map((m) => m.email).join(', ')}`)
          }
          members = after
        }
        const wrong = await oneTooMany(page, ctx, newEmail(seed, TEAM_SEATS + 1), members, 'team', 'business', [`the team plan allows ${TEAM_SEATS} seats`, 'the business plan'])
        return wrong ?? { pass: true, detail: `on Team the roster took its fifth member; the sixth was refused in Lens's words with a link to /plans, and the roster still lists five` }
      } finally {
        await page.close()
      }
    },
  }
}
