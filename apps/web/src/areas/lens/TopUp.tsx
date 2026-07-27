import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, Card, CardHeader, MuNumeral, Row } from '@talyvor/ui'
import { api } from '../../lib/api'
import { CapabilityOff } from './Capability'
import { InlineFailure } from '../../components/SessionExpiredBar'
import { formatUSD } from './format'
import {
  CheckoutError,
  formatCents,
  recordPendingTopUp,
  topupApi,
  type CheckoutFailureKind,
} from './topupApi'

// /billing — buying LXC. Until this screen there was no way for a customer to do
// it at all: the Lens half (checkout, a signature-verified webhook, exactly-once
// crediting) has been complete for a while, but nothing in the suite ever called
// it, and Lens's success redirect already pointed at routes that did not exist.
//
// The flow, and where the money actually is at each step:
//   1. Click an amount → POST /api/lxc/checkout. NOTHING is charged yet.
//   2. The browser goes to Stripe. The payment happens THERE, not here.
//   3. Stripe redirects to /billing/success — see BillingReturn.tsx. The LXC
//      credit lands separately, when Stripe's webhook reaches Lens.
//
// TWO THINGS THIS SCREEN REFUSES TO DO:
//
//   · Hardcode a price. The amounts are an allow-list enforced server-side; a
//     price written here would become a button that always fails the moment the
//     lists disagree. They are fetched, and only what the server returns is drawn.
//
//   · Fail silently. Every way this can break — billing switched off on the
//     deployment, an expired session, a rejected origin, an unreachable Lens,
//     an allow-list mismatch — arrives as its own sentence with its own next
//     step. A top-up page about to ask for money that just greys out is worse
//     than no page at all.
//
// One thing it deliberately does NOT do: pre-flight whether billing is enabled.
// Lens only reveals that by 404-ing the checkout route, and the only way to ask
// is to POST — which, with a valid amount, would create a real Stripe session as
// a side effect. So the buttons are shown, and a first click on a deployment
// without billing explains itself immediately and exactly.

/** Turn a checkout failure into what the customer should read and do. */
function failureText(kind: CheckoutFailureKind, detail: string): string {
  switch (kind) {
    case 'billing_disabled':
      // ONE sentence, UI-owned: the customer needs the state, the operator needs
      // the flag. Echoing the BFF's wording as well would just say it twice.
      return (
        'Top-up is turned off on this deployment — LXC can’t be bought here until Lens ' +
        'is run with billing enabled (LENS_BILLING_ENABLED). Nothing was charged.'
      )
    case 'signed_out':
      return 'Your session has expired. Sign in again, then choose an amount — nothing was charged.'
    case 'origin_refused':
      return (
        'The request origin was rejected, so no payment was started. Reach this app at ' +
        'its configured address and try again.'
      )
    case 'amount_refused':
      return detail || 'That amount isn’t on offer. Pick one of the amounts above.'
    case 'upstream':
      // The BFF's own words: it distinguishes an unreachable Lens from an
      // allow-list drift, and both sentences already end with the fact that
      // matters most — nothing was charged.
      return detail || 'Couldn’t start the payment — nothing was charged. Please try again.'
  }
}

export function TopUp({
  /** Injected so tests can observe the navigation; production sends the browser to Stripe. */
  redirect = (url: string) => window.location.assign(url),
}: {
  redirect?: (url: string) => void
} = {}) {
  const balance = useQuery({ queryKey: ['lxc-balance'], queryFn: api.lxcBalance })
  const options = useQuery({ queryKey: ['topup-options'], queryFn: topupApi.options })

  const start = useMutation({
    mutationFn: async (usdCents: number) => {
      const session = await topupApi.checkout(usdCents)
      // Record the balance BEFORE leaving, so the return page can tell whether
      // the webhook's credit landed. Written only once the session exists — a
      // failed checkout must not leave a pending marker behind. If the balance
      // hasn't loaded we skip it rather than record a wrong baseline; the return
      // page then says it cannot confirm, which is true.
      if (balance.data) {
        recordPendingTopUp({
          balance_ulxc: balance.data.balance_ulxc,
          usd_cents: usdCents,
          at: Date.now(),
        })
      }
      return session
    },
    onSuccess: (session) => {
      if (session.url) redirect(session.url)
    },
  })

  const amounts = options.data?.allowed_usd_cents ?? []
  // Only a loaded, explicit false hides the buttons — never a loading or failed
  // read, which would wrongly tell a paying customer they cannot buy.
  const billingOff = options.data?.billing_enabled === false
  const failure = start.error instanceof CheckoutError ? start.error : null

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-gutter">
      <Card>
        <CardHeader>Top up LXC</CardHeader>

        <Row label="Current balance" hint="LXC is the usage credit inference is billed against">
          {balance.isLoading ? (
            <span className="text-body text-muted">Loading…</span>
          ) : balance.isError || !balance.data ? (
            <InlineFailure error={balance.error} />
          ) : (
            <div className="flex items-baseline gap-3">
              <MuNumeral micros={balance.data.balance_ulxc} unit="lxc" />
              <span className="text-body text-muted">≈ {formatUSD(balance.data.usd_value_uusd)}</span>
            </div>
          )}
        </Row>

        {/* A deployment that cannot sell says so INSTEAD of drawing buttons.
            Billing is off by default, so without this the common case is a full
            row of buy buttons that cannot work, discoverable only by clicking. */}
        {billingOff ? (
          <>
            <CapabilityOff
              name="Top up"
              note="Top-up isn’t available on this deployment — no payment can be started here."
            />
            <div className="px-gutter py-3">
              <p className="text-caption font-normal text-faint">
                LXC can still be spent and its balance read; only buying more is unavailable.
                It becomes available when Lens is run with billing enabled
                (LENS_BILLING_ENABLED, plus its Stripe keys).
              </p>
            </div>
          </>
        ) : (
        <Row label="Add credit" hint="Paid by card at Stripe; the credit is applied to this workspace">
          {options.isLoading ? (
            <span className="text-body text-muted">Loading…</span>
          ) : options.isError ? (
            <InlineFailure error={options.error} failed="Couldn’t load the top-up amounts." />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {amounts.map((cents) => (
                <Button
                  key={cents}
                  variant="primary"
                  disabled={start.isPending}
                  onClick={() => start.mutate(cents)}
                >
                  {start.isPending && start.variables === cents ? 'Starting…' : formatCents(cents)}
                </Button>
              ))}
            </div>
          )}
        </Row>
        )}

        {failure ? (
          <div className="px-gutter py-3">
            <p className="text-body text-muted">{failureText(failure.kind, failure.detail)}</p>
          </div>
        ) : null}

        {billingOff ? null : (
          <div className="px-gutter py-3">
            <p className="text-caption font-normal text-faint">
              You’ll be sent to Stripe to pay, then returned here. The credit is applied by
              Stripe notifying Lens, which usually takes a few seconds — the confirmation page
              waits for it rather than assuming it.
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}
