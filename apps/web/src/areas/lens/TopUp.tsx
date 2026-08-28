import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, MuNumeral, Row } from '@talyvor/ui'
import { api } from '../../lib/api'
import { CapabilityOff } from './Capability'
import { InlineFailure } from '../../components/SessionExpiredBar'
import { Region, RegionScreen } from '../../components/Region'
import { formatUSD } from './format'
import {
  CheckoutError,
  formatCents,
  formatLXC,
  lxcForCents,
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
//
// ── W1.1.4 — WHAT THIS REPLACED ─────────────────────────────────────────────
//
// ONE card in a `max-w-3xl` stack, holding four different ideas: what you have, what you can buy,
// what went wrong, and what happens after you pay. No heading of the screen's own — the sticky
// banner wrote "Billing" and everything under it was one anonymous panel — and no marking between
// the four. A reader moving by region got exactly one stop on the page where this product takes
// money.
//
// The language is the public site's, in the console's type scale, via components/Region.tsx: a
// 2px accent tick, a mono index, one uppercase eyebrow per region, ONE page-scale heading, and air
// between regions rather than a gutter between cards. Same shape W1.1.1 put on Overview and
// W1.1.2 on Setup — this screen is the fourth to get it, not a fourth version of it.

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

// The three headlines. Written out here rather than inline so this screen's one page-scale claim
// is readable in one place, and so the empty-state wording cannot drift from the predicate below.
//
// ⚠ EACH MUST BE TRUE IN EVERY STATE IT IS DRAWN IN, which is the rule areas/lens/unpaidNotice.ts
// records for copy this app cannot re-read from the deployment. The default one is an INSTRUCTION
// about this page rather than a promise about the deployment, for the reason the file header
// gives: whether billing is on is only knowable by POSTing, so this screen is optimistic by
// construction and lets the first click say otherwise.
// ⚠ THE FOURTH ONE IS THE STATE THAT ACTUALLY SHIPS, and it exists because the first draft had
// only three: a deployment with billing off drew HEADLINE_CANNOT_SELL and the "you have none"
// half was lost. Billing is OFF by default and a new workspace holds nothing, so billingOff AND
// empty is the state a self-hosted trial STARTS in — the two facts are one sentence, not a
// precedence between two.
const HEADLINE = 'Add the credit your inference is billed against.'
const HEADLINE_EMPTY = 'This workspace has no LXC.'
const HEADLINE_CANNOT_SELL = 'Credit can’t be bought on this deployment.'
const HEADLINE_EMPTY_CANNOT_SELL = 'This workspace has no LXC, and none can be bought here.'

/**
 * ⚠ THE EMPTY STATE IS A MEASUREMENT, NOT A DEFAULT, and the direction that matters is the one
 * this returns FALSE for: it is claimed only when the balance read ANSWERED and the answer was
 * zero. A read that FAILED is not a workspace with nothing in it, and this project has already
 * paid twice for that conflation (a Track fault drawn identically to an empty tracker; a held
 * balance of 0 rendered beside a ledger of 822). Told wrongly HERE it announces to a paying
 * customer, on the money screen, that their credit is gone.
 *
 * ⚠ IT READS ONE FIELD, AND THE OMISSION IS DELIBERATE. Overview's first run also requires
 * `lifetime_minted_ulxc === 0`, which would separate "never had any" from "spent it all". This
 * screen does not make that distinction, for two reasons: the NEXT ACTION is identical either
 * way, and the field's meaning — whether a card purchase counts as minting — is defined in
 * talyvor-lens, which was held by another session and which I did not read. So the copy is
 * written to be true of both ("has no LXC", not "has never had any") rather than resting on a
 * semantics nobody here measured.
 */
function hasNoCredit(balance: { balance_ulxc: number } | undefined): boolean {
  if (!balance) return false
  return balance.balance_ulxc === 0
}

/**
 * The ways an LXC balance arrives, for a workspace that has none.
 *
 * ⚠ WHAT IT MAY NOT SAY. `areas/lens/format.ts` records the LXC movement types this product has
 * seen — `admin_grant`, `purchase`, `convert_to_lxc` — so those three are the honest list. What
 * nothing in this repository states is what happens to a REQUEST when the balance is zero, so no
 * sentence here claims one is refused: that is an upstream behaviour and this screen has never
 * read it.
 *
 * ⚠ AND THE SECOND STEP IS CONDITIONAL BECAUSE THE CAPABILITY IS. Converting needs LENS this
 * workspace has EARNED (`ConvertLens` renders a nothing-to-spend branch otherwise), so the step
 * names the destination and lets the Overview state its own capability — the same rule W1.1.1
 * took when Overview's first run stopped promising that billing was available here.
 */
interface Step {
  index: string
  title: string
  body: string
  /** An in-app destination, or null where the action is on this page or not ours to offer. */
  to: string | null
  cta: string | null
}

function WaysToGetCredit({ canBuy }: { canBuy: boolean }) {
  const steps: Step[] = canBuy
    ? [
        {
          index: '01',
          title: 'Buy it with a card.',
          body:
            'Pick an amount below. You pay at Stripe and come back here; the credit is applied ' +
            'when Stripe notifies Lens, which usually takes a few seconds.',
          to: null,
          cta: null,
        },
      ]
    : [
        {
          index: '01',
          title: 'Ask your operator to turn billing on.',
          // ⚠ IT DOES NOT NAME THE FLAG, AND THAT IS THE POINT. `LENS_BILLING_ENABLED` is stated
          // once on this screen, in the capability panel that owns the state; naming it twice is
          // the same fact drifting in two places, which is the failure the five docs cost
          // sentences already record. This step is the ACTION, not the setting.
          body:
            'Lens is running here with billing switched off, so no payment can be started at ' +
            'all. Turning it on is a change to this deployment, not something this workspace ' +
            'can do for itself.',
          to: null,
          cta: null,
        },
      ]
  steps.push({
    index: '02',
    title: 'Convert LENS this workspace has earned.',
    body:
      'Traffic served to another company earns LENS, and LENS converts to LXC one way. The ' +
      'Overview carries the balance, the rate this deployment is running, and the conversion.',
    to: '/',
    cta: 'Open Overview',
  })
  return (
    <ol className="mt-8 grid gap-px border border-rule bg-rule wide:grid-cols-2">
      {steps.map((s) => (
        <li key={s.index} className="flex flex-col items-start bg-surface px-gutter py-5">
          <span className="font-figure text-eyebrow uppercase text-faint">Step {s.index}</span>
          <p className="mt-3 text-body text-ink">{s.title}</p>
          <p className="mt-1 text-caption font-normal text-muted">{s.body}</p>
          {s.to ? (
            <Button asChild variant="primary" className="mt-5">
              <Link to={s.to}>{s.cta}</Link>
            </Button>
          ) : null}
        </li>
      ))}
    </ol>
  )
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
  const empty = hasNoCredit(balance.data)

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Billing"
        heading={
          billingOff
            ? empty
              ? HEADLINE_EMPTY_CANNOT_SELL
              : HEADLINE_CANNOT_SELL
            : empty
              ? HEADLINE_EMPTY
              : HEADLINE
        }
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-2xl"
      >
        <p className="text-body text-muted">
          LXC is the usage credit every request through Lens is billed against.{' '}
          {billingOff
            ? 'This deployment runs Lens without billing switched on, so nothing can be bought here — the balance is still live, and it can still be spent.'
            : 'You pay by card at Stripe and the credit is applied to this workspace.'}
        </p>
        {/* ⚠ THE OPENING REGION CARRIES THE STEPS ONLY WHEN THERE IS NOTHING IN THE WORKSPACE,
            and the branch is a RENDER rather than a `hidden` class: copy about a workspace with
            no credit must not sit in the DOM of one that has some. The state a new signup
            actually meets is both of these at once — Overview's first run sends people here,
            and billing is off by default. */}
        {empty ? <WaysToGetCredit canBuy={!billingOff} /> : null}
      </Region>

      <Region index="01" label="What you have">
        <Card>
          <CardHeader>LXC balance</CardHeader>
          <Row label="Current balance" hint="LXC is the usage credit inference is billed against">
            {balance.isLoading ? (
              <span className="text-body text-muted">Loading…</span>
            ) : balance.isError || !balance.data ? (
              <InlineFailure error={balance.error} />
            ) : (
              <div className="flex items-baseline gap-3">
                <MuNumeral micros={balance.data.balance_ulxc} unit="lxc" />
                <span className="font-figure text-body text-muted">
                  ≈ {formatUSD(balance.data.usd_value_uusd)}
                </span>
              </div>
            )}
          </Row>
        </Card>
      </Region>

      <Region index="02" label={billingOff ? 'What this deployment can sell' : 'Add credit'}>
        <Card>
          <CardHeader>{billingOff ? 'Top up' : 'Amounts on offer'}</CardHeader>
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
            <Row
              label="Add credit"
              hint="Paid by card at Stripe; the credit is applied to this workspace"
            >
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
                      {/* The price you are about to pay. It is the one numeral on this screen a
                          stranger reads before spending money, and it was in the sans. */}
                      {start.isPending && start.variables === cents ? (
                        'Starting…'
                      ) : (
                        <span className="font-figure">
                          {formatCents(cents)}
                          {/* ⚠ THE CONVERSION IS COMPUTED HERE, INSIDE THE FIGURE FACE, AND NOT
                              HOISTED TO A const ABOVE THE Button. It was hoisted first, and
                              figureFace.test.ts red: `lxcForCents` carries a money NAME SEGMENT
                              (`Cents`), so the call-site scan reads it as a money render and the
                              nearest face was the plain flex div. The rule is deliberately broad —
                              this file says narrowing a detector until its false positives vanish
                              is how it stops finding the real ones — so the call moved to where the
                              value is actually rendered rather than the rule moving. */}
                          {(() => {
                            // What this amount BUYS, at the peg the DEPLOYMENT confirmed. null when
                            // Lens would not supply one: the button then shows the price alone,
                            // which is still true, rather than a conversion nothing backs.
                            const lxc = lxcForCents(cents, options.data?.usd_per_lxc)
                            return lxc === null ? null : ` · ${formatLXC(lxc)}`
                          })()}
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
              )}
            </Row>
          )}

          {/* ⚠ GATED ON `isError`, NOT ON THE ERROR'S CLASS. This block used to render only when
              the error was a `CheckoutError`, which is every answer the BFF gives — but NOT the
              case where there is no answer: offline, DNS failure, a reset connection all reject
              `fetch` with a TypeError, and the click then added ZERO characters to the page (see
              checkoutRefusalSurface.test.tsx for the measurement). Every other error surface in
              the app already has this shape — Keys.tsx, ConvertLens.tsx and IssueList.tsx all gate
              on `isError` and use `instanceof` INSIDE to pick better words.

              ⚠ IT STAYS INSIDE THIS CARD, BESIDE THE BUTTONS. A failure sentence in a region of
              its own would be a region that exists only sometimes, and the reader's eye is on the
              amount they just clicked. */}
          {start.isError ? (
            <div className="px-gutter py-3">
              {/* No new sentence: an error we cannot classify is exactly what `upstream` already
                  says, and "nothing was charged" is true by construction — this call only asks
                  for a Stripe session, and the payment happens after the redirect. */}
              <p className="text-body text-muted">
                {failure ? failureText(failure.kind, failure.detail) : failureText('upstream', '')}
              </p>
            </div>
          ) : null}
        </Card>
      </Region>

      {/* The round trip, as its own idea. It is what the reader needs BEFORE clicking and it was
          a caption under the buttons; on a deployment that cannot sell there is no round trip to
          describe, so the region is not drawn at all rather than drawn empty. */}
      {billingOff ? null : (
        <Region index="03" label="What happens when you pay">
          <p className="text-body text-muted">
            You’ll be sent to Stripe to pay, then returned here. The credit is applied by Stripe
            notifying Lens, which usually takes a few seconds — the confirmation page waits for it
            rather than assuming it.
          </p>
        </Region>
      )}
    </RegionScreen>
  )
}
