// B28.280 — STRIPE'S WEBHOOKS CANNOT BE FORGED OR REPLAYED. Lens credits a top-up when Stripe tells it, at
// POST /v1/billing/webhook (live) and /v1/billing/webhook/test (test mode), so an event nobody signed, or one signed and sent
// again, must never be money. Two scenarios, each on a workspace of its own so nothing else moves its ledger while it counts:
//   webhook-unsigned — an event paying the workspace $10, sent to both webhooks with no signature and under one signed with
//     a secret the testers made up: each is refused, and the ledger takes nothing.
//   webhook-replayed — on the test-mode secret Lens boots with (LENS_STRIPE_TEST_WEBHOOK_SECRET; a SKIP without it): a
//     signed event delivered ten minutes ago and one past Lens's 1 MiB cap are refused with nothing taken; a signed event
//     sent three times at once and once more after, and its session again under a new event, are one credit of exactly
//     what $10 buys.

import { createHmac, randomBytes } from 'node:crypto'
import type { LedgerRow } from './lens.ts'
import { within } from './pricing.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'

const TEST_HOOK = '/v1/billing/webhook/test'
const LIVE_HOOK = '/v1/billing/webhook'
/** The smallest top-up Lens takes, in US cents (talyvor-lens internal/billing minTopUpCents): what every event here pays. */
const TOP_UP_CENTS = 1_000
/** talyvor-lens internal/billing maxWebhookBody: Lens reads no more of an event than this. */
const BODY_CAP = 1 << 20
/** Stripe's signatures are good for five minutes (stripe-go's DefaultTolerance); this one was made twice that long ago. */
const STALE_S = 600
/** How many copies of the signed event are sent at once, before one more after. */
const COPIES = 3
/** Lens credits before it answers; this long is given for a credit it wrote late to show up anyway. */
const GRACE_MS = 5_000
/** Stripe's API version on the events: Lens reads only fields every version has, and ignores a mismatch. */
const API_VERSION = '2024-06-20'

/** A Stripe event paying `cents` for the workspace's credits, as Stripe sends checkout.session.completed; padded when asked. */
function topUp(ws: string, ulxc: number, ids: { event: string; session: string }, type = 'checkout.session.completed', padding = ''): string {
  return JSON.stringify({
    id: ids.event, object: 'event', api_version: API_VERSION, created: Math.floor(Date.now() / 1000), livemode: false, type,
    pending_webhooks: 1, request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: ids.session, object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid',
        amount_total: TOP_UP_CENTS, currency: 'usd', payment_intent: null, metadata: { workspace_id: ws, lxc_amount: String(ulxc) },
      },
    },
    ...(padding === '' ? {} : { padding }),
  })
}

const fresh = (what: string) => ({ event: `evt_e2e_${what}_${randomBytes(8).toString('hex')}`, session: `cs_test_e2e_${what}_${randomBytes(8).toString('hex')}` })

/** Stripe's Stripe-Signature header for `body` at `t` (seconds), under `secret`. */
function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`
}

/** The µLXC $10 buys at the price of an LXC Lens states (the oracle credits-top-up judges by). */
const bought = (ctx: ScenarioCtx): number => Math.round(0.01 / ctx.env.usdPerLXC * 1e6) * TOP_UP_CENTS

const refused = (status: number): boolean => status >= 400 && status < 500

async function ledgerSince(ctx: ScenarioCtx, before: Set<string>): Promise<LedgerRow[]> {
  return (await ctx.env.lens.ledger(ctx.app.user)).filter((r) => !before.has(r.id))
}

const rowsText = (rs: LedgerRow[]): string => rs.map((r) => `${r.type} ${r.amount_ulxc > 0 ? '+' : ''}${r.amount_ulxc} µLXC`).join(', ')

/** Sends one event and says what Lens answered; `want` judges the status. */
async function deliver(ctx: ScenarioCtx, path: string, body: string, signature: string, what: string, want: (s: number) => boolean, wrong: string[]): Promise<void> {
  const r = await ctx.env.lens.webhook(path, body, signature)
  const answer = `${r.status}${r.text.trim() === '' ? '' : ` ${r.text.trim().slice(0, 120)}`}`
  ctx.evidence.push({ note: `${what} → ${answer}` })
  if (!want(r.status)) wrong.push(`${what} answered ${answer}`)
}

const verdictOf = (wrong: string[], right: string): Verdict => (wrong.length === 0 ? { pass: true, detail: right } : { pass: false, detail: wrong.join('; ') })

export function webhookUnsigned(): Scenario {
  return {
    id: 'webhook-unsigned',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Billing',
    title: "an event paying the workspace $10, sent to Stripe's live and test-mode webhooks with no signature and under a signature from a secret " +
      'nobody gave Stripe, is refused every time, and the ledger takes nothing',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const before = new Set((await lens.ledger(user)).map((r) => r.id))
      const balance0 = await lens.lxcBalance(user)
      const ulxc = bought(ctx)
      const madeUp = `whsec_${randomBytes(24).toString('base64url')}`
      const wrong: string[] = []
      for (const path of [TEST_HOOK, LIVE_HOOK]) {
        const unsigned = topUp(user.workspaceID, ulxc, fresh('unsigned'))
        await deliver(ctx, path, unsigned, '', `an unsigned $${TOP_UP_CENTS / 100} top-up to ${path}`, refused, wrong)
        const forged = topUp(user.workspaceID, ulxc, fresh('forged'))
        await deliver(ctx, path, forged, sign(madeUp, forged), `a $${TOP_UP_CENTS / 100} top-up signed with a made-up secret to ${path}`, refused, wrong)
      }
      await new Promise((r) => setTimeout(r, GRACE_MS))
      const rows = await ledgerSince(ctx, before)
      const balance1 = await lens.lxcBalance(user)
      ctx.evidence.push({ note: `the ledger after: ${rows.length === 0 ? 'nothing new' : rowsText(rows)}; balance ${balance0} → ${balance1} µLXC`,
        ledger: rows.map((r) => ({ type: r.type, amount_ulxc: r.amount_ulxc, created_at: r.created_at })) })
      if (rows.length > 0) wrong.push(`the ledger took ${rowsText(rows)} from events nobody signed`)
      if (balance1 !== balance0) wrong.push(`the balance went from ${balance0} to ${balance1} µLXC on events nobody signed`)
      return verdictOf(wrong, `unsigned and forged $${TOP_UP_CENTS / 100} top-ups to both webhooks refused; the ledger took nothing and the balance stayed ${balance0} µLXC`)
    },
  }
}

export function webhookReplayed(): Scenario {
  return {
    id: 'webhook-replayed',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Billing',
    title: "on Stripe's test-mode webhook, a signed $10 top-up delivered ten minutes ago and one past Lens's 1 MiB cap are refused with nothing taken; " +
      `one signed now and sent ${COPIES} times at once and once more after, and its session again under a new event, are one credit of exactly what $10 buys`,
    run: async (ctx) => {
      const secret = ctx.env.webhookSecret
      if (secret === '') throw new CannotTest("LENS_STRIPE_TEST_WEBHOOK_SECRET is not set: the testers cannot sign an event as Stripe does")
      const { lens } = ctx.env
      const user = ctx.app.user
      const before = new Set((await lens.ledger(user)).map((r) => r.id))
      const balance0 = await lens.lxcBalance(user)
      const ulxc = bought(ctx)
      const wrong: string[] = []

      // A delivery captured and sent again once its signature has expired, and one too big for Lens to read whole: each
      // pays for a session of its own, so only refusing it keeps it off the ledger.
      const stale = topUp(user.workspaceID, ulxc, fresh('stale'))
      await deliver(ctx, TEST_HOOK, stale, sign(secret, stale, Math.floor(Date.now() / 1000) - STALE_S), `a top-up signed ${STALE_S / 60} minutes ago`, refused, wrong)
      const big = topUp(user.workspaceID, ulxc, fresh('oversized'), 'checkout.session.completed', 'x'.repeat(BODY_CAP + BODY_CAP / 4))
      // Lens may hang up once it has read its cap (status 0): that is a refusal too, and the ledger says whether it was.
      await deliver(ctx, TEST_HOOK, big, sign(secret, big), `a signed top-up of ${(big.length / BODY_CAP).toFixed(2)} MiB`, (s) => s === 0 || refused(s), wrong)
      await new Promise((r) => setTimeout(r, GRACE_MS))
      const early = await ledgerSince(ctx, before)
      if (early.length > 0) wrong.push(`the ledger took ${rowsText(early)} from an expired or oversized event`)
      // The replays are judged on what the ledger takes from here on.
      const since = new Set([...before, ...early.map((r) => r.id)])
      const balanceMid = await lens.lxcBalance(user)

      // One event, signed now: Stripe delivers it, and someone sends the same delivery again — at once, and later.
      const ids = fresh('replayed')
      const once = topUp(user.workspaceID, ulxc, ids)
      const header = sign(secret, once)
      await Promise.all(Array.from({ length: COPIES }, (_, k) =>
        deliver(ctx, TEST_HOOK, once, header, `the signed top-up, copy ${k + 1} of ${COPIES} at once`, (s) => s >= 200 && s < 300, wrong)))
      await deliver(ctx, TEST_HOOK, once, header, 'the signed top-up, sent again after', (s) => s >= 200 && s < 300, wrong)
      // Its session again, as Stripe's async_payment_succeeded names it, under a new event: the session is paid once.
      const again = topUp(user.workspaceID, ulxc, { event: fresh('again').event, session: ids.session }, 'checkout.session.async_payment_succeeded')
      await deliver(ctx, TEST_HOOK, again, sign(secret, again), 'the same session under a new event', (s) => s >= 200 && s < 300, wrong)

      const rows = await within(() => ledgerSince(ctx, since), (rs) => rs.some((r) => r.amount_ulxc > 0), GRACE_MS)
      await new Promise((r) => setTimeout(r, GRACE_MS))
      const all = await ledgerSince(ctx, since)
      const balance1 = await lens.lxcBalance(user)
      ctx.evidence.push({ note: `the ledger after the replays: ${all.length === 0 ? 'nothing new' : rowsText(all)}; balance ${balance0} → ${balanceMid} → ${balance1} µLXC`,
        ledger: all.map((r) => ({ type: r.type, amount_ulxc: r.amount_ulxc, created_at: r.created_at })) })
      if (all.length !== 1 || all[0].amount_ulxc !== ulxc) {
        wrong.push(`one $${TOP_UP_CENTS / 100} top-up delivered ${COPIES + 1} times and its session once more left ${all.length === 0 ? 'nothing' : rowsText(all)} on the ledger, not one credit of ${ulxc} µLXC` +
          (rows.length === 0 ? ` within ${GRACE_MS / 1000} s` : ''))
      }
      if (balance1 - balanceMid !== ulxc) wrong.push(`the replays took the balance from ${balanceMid} to ${balance1} µLXC, not up by the ${ulxc} one top-up buys`)
      return verdictOf(wrong, `an expired and an oversized signed top-up refused with nothing taken; one delivered ${COPIES} times at once, once after and its ` +
        `session under a new event is one credit of ${ulxc} µLXC`)
    },
  }
}
