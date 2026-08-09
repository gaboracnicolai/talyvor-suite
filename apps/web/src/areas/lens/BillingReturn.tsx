import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, CardHeader, MuNumeral, Row } from '@talyvor/ui'
import { api } from '../../lib/api'
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

const DEFAULT_POLL_MS = 2_000
const DEFAULT_TIMEOUT_MS = 45_000

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
    <div className="flex flex-wrap items-center gap-2 px-gutter py-3">
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-gutter">
      <Card>
        <CardHeader>
          {credited ? 'Top-up complete' : timedOut ? 'Payment received' : 'Confirming your top-up'}
        </CardHeader>

        {credited ? (
          <>
            <div className="px-gutter py-3">
              <p className="text-body text-muted">
                {pending && pending.usd_cents > 0
                  ? (
                      <>
                        Your <span className="font-figure">{formatCents(pending.usd_cents)}</span>{' '}
                        top-up has been added to your balance.
                      </>
                    )
                  : 'Your top-up has been added to your balance.'}
              </p>
            </div>
            <Row label="New balance">
              <div className="flex items-baseline gap-3">
                <MuNumeral micros={balance.data!.balance_ulxc} unit="lxc" />
                <span className="font-figure text-body text-muted">≈ {formatUSD(balance.data!.usd_value_uusd)}</span>
              </div>
            </Row>
          </>
        ) : isSessionExpired(balance.error) ? (
          <div className="flex flex-col gap-2 px-gutter py-3">
            <p className="text-body text-muted">
              Your payment went through. Your session has since expired, so the balance can’t be
              read here until you sign in again — the credit is applied either way.
            </p>
          </div>
        ) : balance.isError ? (
          <div className="flex flex-col gap-2 px-gutter py-3">
            <p className="text-body text-muted">
              Your payment went through, but we couldn’t read your balance just now, so we
              can’t show whether the credit has been applied.
            </p>
            <p className="text-body text-muted">
              This is a problem reaching Lens from this app — not a problem with the payment.
              Try the ledger in a moment.
            </p>
          </div>
        ) : !pending ? (
          <div className="flex flex-col gap-2 px-gutter py-3">
            <p className="text-body text-muted">
              Your payment went through. We can’t confirm this payment from this browser,
              though: the record of what your balance was before checkout isn’t available
              here, so a balance on its own wouldn’t prove anything either way.
            </p>
            <p className="text-body text-muted">
              Open the ledger and look for a recent <span className="font-mono">purchase</span>{' '}
              entry — that is the credit landing.
            </p>
            {balance.data ? (
              <p className="text-caption font-normal text-faint">
                Balance right now:{' '}
                <span className="font-figure">{formatUSD(balance.data.usd_value_uusd)}</span>.
              </p>
            ) : null}
          </div>
        ) : timedOut ? (
          <div className="flex flex-col gap-2 px-gutter py-3">
            <p className="text-body text-muted">
              Your payment went through, but the credit hasn’t appeared yet.
            </p>
            <p className="text-body text-muted">
              The credit is applied when a webhook from Stripe reaches Lens. That usually
              takes seconds, but it can lag — and it never arrives at all if Stripe can’t
              reach this deployment’s Lens.
            </p>
            <p className="text-body text-muted">
              Your payment is recorded at Stripe either way — nothing is lost. Check the
              ledger in a few minutes; if the credit still isn’t there, contact support with
              the reference below.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 px-gutter py-3">
            <p className="text-body text-muted">
              Your payment went through. Waiting for it to be applied to your balance — this
              usually takes a few seconds.
            </p>
          </div>
        )}

        <Reference sessionId={sessionId} />
        <Actions />
      </Card>
    </div>
  )
}

export function BillingCancel() {
  // A checkout that was abandoned must not leave a baseline behind: a later
  // success page comparing against it could announce the wrong outcome.
  useEffect(() => {
    clearPendingTopUp()
  }, [])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-gutter">
      <Card>
        <CardHeader>Top-up cancelled</CardHeader>
        <div className="px-gutter py-3">
          <p className="text-body text-muted">
            You left the payment before it completed, so nothing was charged and your balance
            is unchanged.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-gutter py-3">
          <Button asChild variant="primary">
            <Link to="/billing">Back to top up</Link>
          </Button>
        </div>
      </Card>
    </div>
  )
}
