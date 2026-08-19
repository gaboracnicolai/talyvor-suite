import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, CardHeader, MuNumeral, Row } from '@talyvor/ui'
import { api } from '../../lib/api'
import { Region, RegionScreen } from '../../components/Region'
import { formatUSD } from './format'
import { clearPendingTopUp, formatCents, readPendingTopUp } from './topupApi'
import { isSessionExpired } from '../../lib/productState'

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

const DEFAULT_POLL_MS = 2_000
const DEFAULT_TIMEOUT_MS = 45_000

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
} as const

/** The session id Stripe hands back — a reference for support, not a lookup key. */
function Reference({ sessionId }: { sessionId: string | null }) {
  if (!sessionId) return null
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

export function BillingSuccess({
  pollIntervalMs = DEFAULT_POLL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  pollIntervalMs?: number
  timeoutMs?: number
} = {}) {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id')

  // Read the baseline ONCE, at mount. Re-reading would race the poll, and the
  // value is deliberately from before the redirect anyway.
  const pending = useMemo(() => readPendingTopUp(), [])
  const [timedOut, setTimedOut] = useState(false)

  const balance = useQuery({
    queryKey: ['lxc-balance'],
    queryFn: api.lxcBalance,
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
    : // A read that failed, an expired session and a missing baseline are three different
      // sentences but ONE page-scale claim: the payment went through, and this page cannot
      // confirm what happened after it. Each says which of the three it is in the body.
      isSessionExpired(balance.error) || balance.isError || !pending
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
        ) : isSessionExpired(balance.error) ? (
          <p className="text-body text-muted">
            Your session has since expired, so the balance can’t be read here until you sign in
            again — the credit is applied either way.
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
        ) : !pending ? (
          <div className="flex flex-col gap-2">
            <p className="text-body text-muted">
              We can’t confirm this payment from this browser: the record of what your balance
              was before checkout isn’t available here, so a balance on its own wouldn’t prove
              anything either way.
            </p>
            <p className="text-body text-muted">
              Open the ledger and look for a recent <span className="font-mono">purchase</span>{' '}
              entry — that is the credit landing.
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
      {balance.data ? (
        <Region index="01" label="What you have">
          <Card>
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
        {sessionId ? (
          <Card className="mb-gutter">
            <CardHeader>Reference</CardHeader>
            <Reference sessionId={sessionId} />
          </Card>
        ) : null}
        <Actions />
      </Region>
    </RegionScreen>
  )
}

export function BillingCancel() {
  // A checkout that was abandoned must not leave a baseline behind: a later
  // success page comparing against it could announce the wrong outcome.
  useEffect(() => {
    clearPendingTopUp()
  }, [])

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Top up"
        heading="Nothing was charged."
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-2xl"
      >
        <p className="text-body text-muted">
          You left the payment before it completed, so your balance is unchanged and no card was
          charged.
        </p>
      </Region>
      <Region index="01" label="Where to look next">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="primary">
            <Link to="/billing">Back to top up</Link>
          </Button>
        </div>
      </Region>
    </RegionScreen>
  )
}
