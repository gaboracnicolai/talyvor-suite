import { Button, ThemeToggle, focusRing } from '@talyvor/ui'
import { useDocumentTitle } from '../../documentTitle'
import { formatCents, formatLXC, lxcForCents } from '../lens/topupApi'
import { Figure, SectionLabel } from './Landing'
import {
  PRICING_PATH,
  formatPeg,
  usePricing,
  type Pricing as PricingData,
  type PricingState,
} from './pricingApi'

// /pricing (B5.2) — what anything costs, for a buyer who has not signed up. Public, OUTSIDE the
// AuthGate like /marketing, and built the same way: no router context, plain anchors, Landing's
// instrument language.
//
// ⚠ EVERY FIGURE IS SERVED. The peg and the top-up range come from GET /api/pricing (see
// pricingApi.ts), and the page prints that address so a buyer can check it. What is written here is
// only the RULES the figures obey — how a request is charged, what is not charged — each read from
// talyvor-lens:
//   request charge   internal/proxy/agent_allocator.go settleReservationBasis:
//                    ceil(delivered USD / peg × 1e6) µLXC — the model's catalog rate, rounded UP
//   no top-up fee    internal/billing/billing.go lxcForCents: usdCents × ulxcPerCent, exact
//   the floor/cap    internal/billing/billing.go minTopUpCents / maxTopUpCents and their reasons
//   no seats         internal/billing has no seat or per-member charge anywhere
// "No subscription REQUIRED", not "no subscription": a deployment may also sell a plan (B1.5), but
// nothing needs one — prepaid credits alone run every request.

/** An illustrative "any amount" top-up, shown beside the presets only when the served range
 *  admits it. It is an AMOUNT, not a price — what it buys is computed from the served peg. */
const ANY_AMOUNT_EXAMPLE_CENTS = 250_000

function RateCard({ state }: { state: PricingState }) {
  const peg = state.status === 'ok' ? state.pricing.usd_per_lxc : undefined
  return (
    <div className="overflow-hidden rounded-card border border-rule bg-surface">
      <div className="px-gutter py-6">
        <p className="font-figure text-eyebrow uppercase text-muted">One credit</p>
        <div className="mt-3" aria-live="polite">
          {typeof peg === 'number' && peg > 0 ? (
            <p className="flex flex-wrap items-baseline gap-x-3">
              <Figure value="1" unit="LXC" />
              <span className="font-figure text-figure text-faint">=</span>
              <Figure value={formatPeg(peg)} unit="USD" />
            </p>
          ) : state.status === 'loading' ? (
            <p className="text-body text-muted">Reading the rate from this deployment…</p>
          ) : (
            <p className="max-w-xl text-body text-muted">
              This deployment did not confirm its credit rate just now, so no rate is printed here —
              a price this page cannot back is not shown.
            </p>
          )}
        </div>
      </div>
      <p className="border-t border-rule px-gutter py-3 text-caption text-faint">
        Served live, not typed into this page. Check it yourself:{' '}
        <a href={PRICING_PATH} className={`font-mono underline ${focusRing}`}>
          GET {PRICING_PATH}
        </a>
      </p>
    </div>
  )
}

function TopUps({ pricing }: { pricing: PricingData }) {
  const { min_usd_cents: min, max_usd_cents: max, usd_per_lxc: peg } = pricing
  const amounts = [...pricing.preset_usd_cents]
  if (ANY_AMOUNT_EXAMPLE_CENTS >= min && ANY_AMOUNT_EXAMPLE_CENTS <= max && !amounts.includes(ANY_AMOUNT_EXAMPLE_CENTS)) {
    amounts.push(ANY_AMOUNT_EXAMPLE_CENTS)
  }
  const rows = amounts.map((cents) => ({ cents, lxc: lxcForCents(cents, peg) }))
  return (
    <div>
      <p className="max-w-xl text-lede text-ink">
        Top up any amount from <span className="font-figure">{formatCents(min)}</span> to{' '}
        <span className="font-figure">{formatCents(max)}</span>.
      </p>
      <div className="mt-6 grid gap-px border border-rule bg-rule wide:grid-cols-4">
        {rows.map(({ cents, lxc }) => (
          <div key={cents} className="bg-surface px-5 py-4">
            <p className="font-figure text-figure text-ink">{formatCents(cents)}</p>
            <p className="mt-1 font-figure text-caption text-muted">
              {lxc === null ? 'credits at the served rate' : `buys ${formatLXC(lxc)}`}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-x-12 gap-y-4 wide:grid-cols-2">
        <p className="text-body text-muted">
          <span className="text-ink">
            Why <span className="font-figure">{formatCents(min)}</span> at the bottom.
          </span> Card payments carry
          a fixed fee per charge; below this it stops being a small part of what you paid.
        </p>
        <p className="text-body text-muted">
          <span className="text-ink">
            Why <span className="font-figure">{formatCents(max)}</span> at the top.
          </span> It is the most one
          stolen or disputed card can cost, since credit spent before a chargeback cannot be taken
          back. A team spending more tops up more than once.
        </p>
      </div>
    </div>
  )
}

const NOT_CHARGED: Array<{ title: string; body: string }> = [
  {
    title: 'No subscription required.',
    body: 'A prepaid balance runs every request. There is nothing you have to sign up to monthly before you can use it.',
  },
  {
    title: 'No seats.',
    body: 'Everyone in a workspace draws on the same balance. Adding a member costs nothing.',
  },
  {
    title: 'No monthly minimum.',
    body: 'Nothing recurs. After a top-up, nothing is due until you choose to top up again — a balance you are not using costs nothing.',
  },
  {
    title: 'No top-up fee.',
    body: 'The whole amount becomes credit — the card fee is not taken out of what you bought.',
  },
]

export function Pricing() {
  useDocumentTitle('Pricing')
  const state = usePricing()
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-10 border-b border-rule bg-canvas">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-y-2 px-gutter py-3">
          <a href="/marketing" className={`block ${focusRing}`}>
            <div className="text-head text-ink">Talyvor</div>
            <div className="text-caption font-normal text-faint">Suite</div>
          </a>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button asChild>
              <a href="/">Open the app</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section aria-labelledby="pricing-heading" className="border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter pb-16 pt-16 wide:pt-20">
            <SectionLabel index="00">Pricing</SectionLabel>
            <h1 id="pricing-heading" className="mt-7 max-w-3xl text-display-2 text-ink">
              Buy credits up front. Every request draws on them.
            </h1>
            <p className="mt-6 max-w-2xl text-lede text-muted">
              Prepaid, with no subscription required, no seats and no monthly minimum. A workspace
              holds a balance in LXC, and each AI request is paid from it at the price its model
              lists.
            </p>
            <div className="mt-10">
              <RateCard state={state} />
            </div>
          </div>
        </section>

        <section aria-labelledby="topup-heading" className="border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16">
            <SectionLabel index="01">Topping up</SectionLabel>
            <h2 id="topup-heading" className="mt-6 max-w-2xl text-display-3 text-ink">
              Any amount, paid by card.
            </h2>
            <div className="mt-8">
              {state.status === 'ok' ? (
                <TopUps pricing={state.pricing} />
              ) : state.status === 'loading' ? (
                <p className="text-body text-muted">Reading the top-up range…</p>
              ) : (
                <p className="max-w-xl text-body text-muted">
                  The top-up range could not be read from this deployment just now. Signed-in
                  workspaces see it on the billing screen.
                </p>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="request-heading" className="border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16">
            <SectionLabel index="02">What a request costs</SectionLabel>
            <h2 id="request-heading" className="mt-6 max-w-2xl text-display-3 text-ink">
              The model’s list price, converted to credits.
            </h2>
            <div className="mt-8 grid gap-x-12 gap-y-6 wide:grid-cols-2">
              <p className="text-body text-muted">
                A request is charged the tokens its provider reports, times that model’s catalog rate
                per million tokens, converted at the rate above — rounded up to the millionth of a
                credit, never down. Each model’s rate is shown beside it when you pick it in the app.
              </p>
              <p className="text-body text-muted">
                An answer served from the shared pool costs less than list, because nobody paid to
                generate it a second time.{' '}
                <a href="/marketing#economics" className={`text-ink underline ${focusRing}`}>
                  See one pooled answer, as the ledger recorded it
                </a>
                .
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="not-charged-heading" className="border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16">
            <SectionLabel index="03">What you are not charged for</SectionLabel>
            <h2 id="not-charged-heading" className="mt-6 max-w-2xl text-display-3 text-ink">
              The only charge is the requests you run.
            </h2>
            <div className="mt-10 grid gap-x-12 gap-y-8 wide:grid-cols-2">
              {NOT_CHARGED.map((n) => (
                <div key={n.title}>
                  <div className="h-0.5 w-8 bg-accent" aria-hidden="true" />
                  <p className="mt-4 text-head text-ink">{n.title}</p>
                  <p className="mt-2 text-body text-muted">{n.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="pricing-close-heading">
          <div className="mx-auto w-full max-w-5xl px-gutter py-20">
            <h2 id="pricing-close-heading" className="max-w-3xl text-display-3 text-ink">
              Start with the smallest top-up and read the ledger.
            </h2>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild variant="primary">
                <a href="/signup">Create your workspace</a>
              </Button>
              <Button asChild>
                <a href="/marketing">Back to the overview</a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-gutter py-6">
          <div className="font-figure text-eyebrow uppercase text-faint">
            Talyvor Ltd · self-hosted AI development
          </div>
          <div className="text-caption text-faint">
            <a href="/privacy" className="underline">
              Privacy
            </a>
            {' · '}
            <a href="/terms" className="underline">
              Terms
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
