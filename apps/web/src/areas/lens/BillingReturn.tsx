import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, CardHeader, MuNumeral, Row } from '@talyvor/ui'
import { api } from '../../lib/api'
import { Region, RegionScreen } from '../../components/Region'
import { formatUSD } from './format'
import { clearPendingTopUp, formatCents, readPendingTopUp } from './topupApi'
import { clearPendingPlan, planApi, readPendingPlan, type PlanOffer } from './planApi'
import { isSessionExpired } from '../../lib/productState'
import { SUBSCRIPTION_KEY } from './Plans'

// /billing/success and /billing/cancel — the URLs Lens ALREADY redirects Stripe
// back to. Its defaults are literally app.talyvor.com/billing/success?session_id=
// {CHECKOUT_SESSION_ID} and .../billing/cancel; the design assumed the suite
// owned these routes and nothing had been built at them.
//
// ── WHY THE SUCCESS PAGE POLLS AND NEVER ASSERTS ────────────────────────────
//
// Being redirected here means the PAYMENT succeeded at Stripe. It does NOT mean
// the LXC credit has landed. Those are two different events: Stripe redirects the
// browser immediately, while the credit is written when Stripe's webhook reaches
// Lens and its handler commits. The gap is normally seconds — and is unbounded if
// the webhook cannot reach this deployment at all.
//
// So a page that reads the balance once and shows it would, routinely, tell a
// paying customer their money vanished. This one instead compares against the
// balance recorded just before checkout (see topupApi.recordPendingTopUp) and
// polls until it rises, with a bounded timeout. Three consequences worth naming:
//
//   · The baseline MUST come from before the redirect. The webhook often commits
//     while the browser is still travelling, so a baseline captured on THIS page
//     would already include the credit and would never observe a change.
//   · A timeout is reported as a timeout — never as failure and never as success.
//     The money is at Stripe either way; the page says exactly that, names the
//     webhook as the thing that may not have arrived, and gives a next step.
//   · With no usable baseline the page says it cannot confirm. Showing a balance
//     and letting the customer infer would be a guess dressed as an answer.
//
// There is no way to do better from here: Lens exposes NO endpoint that resolves
// a Stripe session_id to a purchase, so the session id can be displayed as a
// support reference but cannot be looked up. The balance is the only signal.
//
// ── W1.1.4 — WHAT THIS REPLACED ─────────────────────────────────────────────
//
// The same single anonymous card /billing had, on the two addresses a customer reaches AFTER
// paying. The reader arriving here has exactly ONE question — did my money land? — and the answer
// was written in a 17px card header while the page carried no heading of its own at all. It is
// the page-scale claim now, which is what it always was; the five states and their wording are
// unchanged, because the argument for each of them is in the header above and none of it moved.
//
// ── B28.270 — THE PAGES STOP CONTRADICTING THEMSELVES ───────────────────────
//
// Opened with no session_id — typed, bookmarked, reached from history — the success page used to
// head itself "Your payment went through." and then say it could not confirm the payment. Lens
// sends every Stripe return here WITH session_id (its default, the Helm values and the manifests
// all carry ?session_id={CHECKOUT_SESSION_ID}), so its absence means no checkout is returning and
// the page says exactly that. A return this browser has no record of no longer claims the payment
// in its heading, and no longer sends a subscriber hunting for a purchase row that a plan never
// writes; it points at Top up and Plans, where each kind of payment shows. The expired-session body
// no longer promises the credit "is applied either way" — that is what this page could not see.

// Exported for billingTimingContract.test.ts. MEASURED 2026-08-28 (tab-k2w8,
// W4.41): both were module-private and every one of this file's 15 tests passes
// explicit `pollIntervalMs={5} timeoutMs={400}` props, so the values a customer
// actually gets after paying were exercised by nothing. Multiplying the poll by
// 1000, and cutting the timeout from 45s to 45ms, each left the whole suite
// green — 141 files, 2067 tests.
export const DEFAULT_POLL_MS = 2_000
export const DEFAULT_TIMEOUT_MS = 45_000

/**
 * The one page-scale claim each state is allowed to make. Written out together so they can be
 * read against each other: no two of them may be true at once, and NONE of them may claim the
 * credit landed unless the balance was observed to rise.
 *
 * ⚠ `WAITING` STILL SAYS "CONFIRMING" AND `TIMED_OUT` STILL SAYS "RECORDED AT STRIPE" — the two
 * phrases the existing cases key on. The heading moved up a level; it did not become a different
 * sentence, and a rebuild that quietly reworded the money states would be a rebuild nobody could
 * check against what shipped.
 */
const HEADING = {
  credited: 'Your credit has landed.',
  waiting: 'Confirming your top-up.',
  timedOut: 'Your payment is recorded at Stripe.',
  unconfirmable: 'Your payment went through.',
  unmatched: 'We can’t confirm this payment from this browser.',
} as const

/** The session id Stripe hands back — a reference for support, not a lookup key. */
function Reference({ sessionId }: { sessionId: string }) {
  return (
    <Row label="Payment reference" hint="Quote this if you need to contact support">
      <span className="font-mono text-caption text-muted">{sessionId}</span>
    </Row>
  )
}

function Actions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="primary">
        <Link to="/ledger">View the ledger</Link>
      </Button>
      <Button asChild>
        <Link to="/billing">Back to top up</Link>
      </Button>
    </div>
  )
}

/** Where each kind of payment shows: a top-up in the balance on Top up, a plan on Plans. */
function TopUpAndPlans({ topUp = 'Top up' }: { topUp?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="primary">
        <Link to="/billing">{topUp}</Link>
      </Button>
      <Button asChild>
        <Link to="/plans">See plans</Link>
      </Button>
    </div>
  )
}

interface ReturnTiming {
  pollIntervalMs?: number
  timeoutMs?: number
}

/**
 * B13.3 — the return from a PLAN checkout. Stripe sends a subscription to the same success URL as
 * a top-up, so the plan picked on /plans is remembered across the round trip and this waits for
 * Lens to grant the period (the webhook's work), exactly as the top-up waits for its credit.
 * B27.27 — BYOK grants no period, so its return waits for the subscription to read `byok` instead.
 */
function PlanSuccess({ plan, pollIntervalMs, timeoutMs }: { plan: PlanOffer } & Required<ReturnTiming>) {
  const [timedOut, setTimedOut] = useState(false)
  const byok = plan.id === 'byok'
  const read = useQuery({
    queryKey: ['plan-allowance'],
    queryFn: planApi.allowance,
    retry: false,
    enabled: !byok,
    refetchInterval: (q) => {
      const d = q.state.data
      if (timedOut || q.state.error || (d?.enabled && d.data.allowance)) return false
      return pollIntervalMs
    },
  })
  const sub = useQuery({
    queryKey: SUBSCRIPTION_KEY,
    queryFn: planApi.subscription,
    retry: false,
    enabled: byok,
    refetchInterval: (q) => {
      const d = q.state.data
      if (timedOut || q.state.error || (d?.enabled && d.data.byok)) return false
      return pollIntervalMs
    },
  })
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), timeoutMs)
    return () => clearTimeout(t)
  }, [timeoutMs])
  const active = byok ? !!(sub.data?.enabled && sub.data.data.byok) : !!(read.data?.enabled && read.data.data.allowance)
  const failed = byok ? sub.isError : read.isError
  useEffect(() => {
    if (active) clearPendingPlan()
  }, [active])

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Plans"
        heading={active ? `You’re on ${plan.name}.` : timedOut || failed ? 'Your payment is recorded at Stripe.' : `Confirming your ${plan.name} plan.`}
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-2xl"
      >
        <p className="text-body text-muted">
          {active
            ? byok
              ? 'Add your provider keys in Settings, and requests to those providers run on them with no token charge.'
              : 'This month’s included usage is ready, and chat draws it first.'
            : timedOut || failed
              ? 'The plan starts when a webhook from Stripe reaches Lens. It usually takes seconds; check Plans again in a few minutes.'
              : 'The payment succeeded at Stripe. Waiting for Lens to start your plan — this usually takes a few seconds.'}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {active && byok ? (
            <Button asChild variant="primary">
              <Link to="/settings">Add your provider keys</Link>
            </Button>
          ) : null}
          <Button asChild variant={active && byok ? undefined : 'primary'}>
            <Link to="/plans">See your plan</Link>
          </Button>
          <Button asChild>
            <Link to="/chat">Open chat</Link>
          </Button>
        </div>
      </Region>
    </RegionScreen>
  )
}

export function BillingSuccess({ pollIntervalMs = DEFAULT_POLL_MS, timeoutMs = DEFAULT_TIMEOUT_MS }: ReturnTiming = {}) {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id')
  // Whichever checkout was started LAST is the one Stripe is returning from — a plan checkout
  // abandoned earlier must not answer for a top-up paid since, nor the other way round.
  const plan = useMemo(() => {
    const p = readPendingPlan()
    const t = readPendingTopUp()
    return p && (!t || p.at > t.at) ? p.plan : null
  }, [])
  // No session_id: nothing is returning from Stripe. The pending markers are left alone, so the
  // real return — in the tab Stripe opens — still confirms against them.
  if (!sessionId) return <NoPaymentHere />
  return plan ? (
    <PlanSuccess plan={plan} pollIntervalMs={pollIntervalMs} timeoutMs={timeoutMs} />
  ) : (
    <TopUpSuccess sessionId={sessionId} pollIntervalMs={pollIntervalMs} timeoutMs={timeoutMs} />
  )
}

/** B28.270 — /billing/success opened without coming back from a checkout. */
function NoPaymentHere() {
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Billing"
        heading="No payment to confirm here."
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-2xl"
      >
        <p className="text-body text-muted">
          This page confirms a payment when Stripe sends you back after checkout. You didn’t arrive
          from a checkout, so there is nothing here to confirm.
        </p>
      </Region>
      <Region index="01" label="Where to look next">
        <TopUpAndPlans />
      </Region>
    </RegionScreen>
  )
}

function TopUpSuccess({ sessionId, pollIntervalMs, timeoutMs }: { sessionId: string } & Required<ReturnTiming>) {
  // Read the baseline ONCE, at mount. Re-reading would race the poll, and the
  // value is deliberately from before the redirect anyway.
  const pending = useMemo(() => readPendingTopUp(), [])
  const [timedOut, setTimedOut] = useState(false)

  const balance = useQuery({
    queryKey: ['lxc-balance'],
    queryFn: api.lxcBalance,
    // Without a baseline the balance answers nothing about this payment, so it is not read.
    enabled: !!pending,
    // Poll only while there is something to wait for. Once the credit is seen,
    // the balance can't be read, or the window closes, the interval stops — a
    // confirmation screen must not sit there hammering the BFF forever.
    refetchInterval: (q) => {
      if (!pending || timedOut || q.state.error) return false
      const data = q.state.data
      return data && data.balance_ulxc > pending.balance_ulxc ? false : pollIntervalMs
    },
  })

  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => setTimedOut(true), timeoutMs)
    return () => clearTimeout(t)
  }, [pending, timeoutMs])

  const credited = !!pending && !!balance.data && balance.data.balance_ulxc > pending.balance_ulxc

  // Once the credit is observed the round trip is over: drop the marker so a
  // later visit can't compare a new payment against this one's baseline.
  useEffect(() => {
    if (credited) clearPendingTopUp()
  }, [credited])

  // ⚠ ONE ORDERED DECISION, MADE ONCE. The five states used to be a chain of ternaries in the
  // JSX and the card header repeated the same precedence in a shorter chain of its own — two
  // copies of one decision, which is how a heading comes to describe a state the body is not in.
  // The heading and the body now read the same variable.
  const state: keyof typeof HEADING = credited
    ? 'credited'
    : // No baseline: this browser has no record of the checkout Stripe is returning from, so the
      // page cannot even say what kind of payment it was — and does not claim it went through.
      !pending
      ? 'unmatched'
      : // A read that failed and an expired session are two different sentences but ONE
        // page-scale claim: the payment went through, and this page cannot confirm what
        // happened after it. Each says which of the two it is in the body.
        isSessionExpired(balance.error) || balance.isError
        ? 'unconfirmable'
        : timedOut
          ? 'timedOut'
          : 'waiting'

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Top up"
        heading={HEADING[state]}
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-2xl"
      >
        {/* ⚠ THE BODIES NO LONGER OPEN WITH THE SENTENCE THE HEADING NOW CARRIES. Three of the
            five used to begin "Your payment went through" and a fourth ended on "your payment is
            recorded at Stripe" — the claim the heading above makes at page scale. Repeating it
            was harmless as a card header and is a stutter as a heading, and it is the same
            duplication this repo has already paid for in copy that then drifted apart. Each body
            now says which of the states it is, and only that. */}
        {credited ? (
          <p className="text-body text-muted">
            {pending && pending.usd_cents > 0 ? (
              <>
                Your <span className="font-figure">{formatCents(pending.usd_cents)}</span> top-up
                has been added to your balance.
              </>
            ) : (
              'Your top-up has been added to your balance.'
            )}
          </p>
        ) : !pending ? (
          <div className="flex flex-col gap-2">
            <p className="text-body text-muted">
              Stripe sent you back with a payment reference, but this browser has no record of the
              checkout it belongs to, so there is nothing to compare your balance against.
            </p>
            <p className="text-body text-muted">
              A top-up shows in your balance on Top up, and a plan shows on Plans.
            </p>
          </div>
        ) : isSessionExpired(balance.error) ? (
          <p className="text-body text-muted">
            Your session has since expired, so this page can’t read your balance to confirm the
            credit. Sign in again and check your balance on Top up.
          </p>
        ) : balance.isError ? (
          <div className="flex flex-col gap-2">
            <p className="text-body text-muted">
              We couldn’t read your balance just now, so we can’t show whether the credit has
              been applied.
            </p>
            <p className="text-body text-muted">
              This is a problem reaching Lens from this app — not a problem with the payment.
              Try the ledger in a moment.
            </p>
          </div>
        ) : timedOut ? (
          <div className="flex flex-col gap-2">
            <p className="text-body text-muted">The credit hasn’t appeared yet.</p>
            <p className="text-body text-muted">
              It is applied when a webhook from Stripe reaches Lens. That usually takes seconds,
              but it can lag — and it never arrives at all if Stripe can’t reach this
              deployment’s Lens.
            </p>
            <p className="text-body text-muted">
              Check the ledger in a few minutes; if the credit still isn’t there, contact support
              with the reference below.
            </p>
          </div>
        ) : (
          <p className="text-body text-muted">
            The payment succeeded at Stripe. Waiting for it to be applied to your balance — this
            usually takes a few seconds.
          </p>
        )}
      </Region>

      {/* ⚠ THE BALANCE IS ITS OWN REGION AND IT IS DRAWN ONLY WHEN IT WAS READ. A figure here is
          the answer to the reader's question in the credited state and merely context in the
          others, so its LABEL carries which one it is — "New balance" is a claim that it moved,
          and it is made only where that was observed. When the read failed there is no figure to
          draw and the region is not drawn: an empty card under a heading saying the payment went
          through reads as a balance of nothing. */}
      {pending && balance.data ? (
        <Region index="01" label="What you have">
          <Card raised>
            <CardHeader>{credited ? 'New balance' : 'LXC balance'}</CardHeader>
            <Row
              label={credited ? 'New balance' : 'Balance right now'}
              hint={
                credited
                  ? 'Read after the credit was observed to land'
                  : 'Read just now — on its own it says nothing about this payment'
              }
            >
              <div className="flex items-baseline gap-3">
                <MuNumeral micros={balance.data.balance_ulxc} unit="lxc" />
                <span className="font-figure text-body text-muted">
                  ≈ {formatUSD(balance.data.usd_value_uusd)}
                </span>
              </div>
            </Row>
          </Card>
        </Region>
      ) : null}

      <Region index="02" label="Where to look next">
        <Card raised className="mb-gutter">
          <CardHeader>Reference</CardHeader>
          <Reference sessionId={sessionId} />
        </Card>
        {/* The ledger is where a top-up's credit lands; a return with no record could be a plan. */}
        {pending ? <Actions /> : <TopUpAndPlans />}
      </Region>
    </RegionScreen>
  )
}

export function BillingCancel() {
  // A checkout that was abandoned must not leave a marker behind: a later success page reading
  // it could announce the wrong outcome. Stripe cancels a plan checkout to this page too.
  useEffect(() => {
    clearPendingTopUp()
    clearPendingPlan()
  }, [])

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Billing"
        heading="No payment was taken."
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-2xl"
      >
        <p className="text-body text-muted">
          You left Stripe’s checkout before paying, so nothing was charged — your balance and your
          plan are as they were.
        </p>
      </Region>
      <Region index="01" label="Where to look next">
        <TopUpAndPlans topUp="Back to top up" />
      </Region>
    </RegionScreen>
  )
}
