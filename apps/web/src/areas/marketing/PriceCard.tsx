import type { ReactNode } from 'react'
import { Button } from '@talyvor/ui'
import { COMPANY_CONTACT } from '../../company'
import { formatULXC } from '../lens/agentBankApi'
import { formatCents } from '../lens/topupApi'
import { formatBPS, formatLimit, formatMinor, planName, type Fees, type PlanGate, type Pricing } from './pricingApi'

// B32.14 — the approved price card (Nicolai's decision of 5 Oct 2026), drawn on /pricing from GET /api/pricing.
//
// ⚠ EVERY FIGURE IS SERVED. Team's and Business's prices, BYOK's as Team's add-on and where Enterprise starts
// are Lens's public plans read; Plus, Pro and Max with their included usage the same read; what each company
// plan unlocks is Lens's plan gates (B32.12); every fee is Lens's GET /v1/public/fees (B32.8). A figure Lens did
// not state is not printed. The only figure written here is Free's: it is the plan with no price.
//
// Money features, and every fee on a money capability that is still RED or AMBER, carry "Preview — test money
// only". The public page cannot read which capability has a clearance, so the label stays until one can.

export const PREVIEW_LABEL = 'Preview — test money only'

export function PreviewLabel() {
  // The status hue is the dot, never the words (packages/ui invariant: text is never a hue).
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-rule-strong px-2 py-0.5 text-caption text-ink">
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-pill bg-held" />
      {PREVIEW_LABEL}
    </span>
  )
}

/** "a, b or c". */
function either(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}` : items.join('')
}

/** Pounds, euros, dollars, then any other currency Lens states. */
const CURRENCY_ORDER = ['GBP', 'EUR', 'USD']

function intlPaymentFees(fees: Fees): string {
  const codes = Object.keys(fees.intl_payment_fee_minor).sort((a, b) => {
    const i = CURRENCY_ORDER.indexOf(a)
    const j = CURRENCY_ORDER.indexOf(b)
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b)
  })
  return either(codes.map((c) => formatMinor(fees.intl_payment_fee_minor[c], c)))
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-rule py-2.5">
      <dt className="text-caption text-label">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-body text-ink">{children}</dd>
    </div>
  )
}

/** Contracted plans have no Stripe Price and agree their own fees. */
const CONTRACTED = 'enterprise'

function CompanyPrice({ id, pricing }: { id: string; pricing: Pricing }) {
  const listed = pricing.company_plans?.find((p) => p.id === id)
  const cents =
    id === CONTRACTED ? pricing.enterprise_from_usd_cents : listed ? listed.usd_cents : id === 'free' ? 0 : undefined
  if (cents === undefined) {
    return <p className="text-body text-muted">Price not stated by this deployment just now</p>
  }
  return (
    <p className="flex flex-wrap items-baseline gap-2">
      {id === CONTRACTED ? <span className="text-body text-muted">From</span> : null}
      <span data-testid={`price-${id}`} className="font-figure text-page text-ink">
        {formatCents(cents)}
      </span>
      <span className="text-body text-muted">a month</span>
    </p>
  )
}

function ownKeys(g: PlanGate, pricing: Pricing): ReactNode {
  if (g.own_provider_keys === 'included') return 'Included'
  if (g.own_provider_keys === 'none') return '—'
  return pricing.byok_add_on_usd_cents ? (
    <>
      <span className="font-figure">{formatCents(pricing.byok_add_on_usd_cents)}</span> add-on
    </>
  ) : (
    'Add-on'
  )
}

function included(on: boolean): string {
  return on ? 'Included' : '—'
}

/** One company plan: its price, what it unlocks and its fees. /plans passes its own action (a checkout, or
 *  "Your plan") and marks the workspace's plan; /pricing links each plan to where it is chosen. */
export function CompanyCard({
  id,
  gate,
  pricing,
  action,
  current = false,
}: {
  id: string
  gate: PlanGate
  pricing: Pricing
  action?: ReactNode
  current?: boolean
}) {
  const name = planName(id)
  const fees = pricing.fees
  const contracted = id === CONTRACTED
  const fx = fees?.fx_margin_bps[id]
  return (
    <div
      data-testid={`company-plan-${id}`}
      aria-current={current ? 'true' : undefined}
      className={`flex flex-col gap-3 rounded-card border bg-raised p-5 ${current ? 'border-accent' : 'border-rule'}`}
    >
      <p className="text-head text-ink">{name}</p>
      <CompanyPrice id={id} pricing={pricing} />
      <div>
        {action !== undefined ? (
          action
        ) : contracted ? (
          <Button asChild variant="primary" className="h-10 px-5">
            <a href={`mailto:${COMPANY_CONTACT}`}>Talk to us</a>
          </Button>
        ) : id === 'free' ? (
          <Button asChild variant="primary" className="h-10 px-5">
            <a href="/signup">Start free</a>
          </Button>
        ) : (
          <Button asChild variant="primary" className="h-10 px-5">
            <a href="/plans">Choose {name}</a>
          </Button>
        )}
      </div>
      <dl className="mt-1 flex flex-col">
        <Row label="Agents">
          <span className="font-figure">{formatLimit(gate.agents)}</span>
        </Row>
        <Row label="Seats">
          <span className="font-figure">{formatLimit(gate.seats)}</span>
        </Row>
        {fees ? (
          <Row label="Platform fee on AI spend">
            {contracted ? 'Agreed' : <span className="font-figure">{formatBPS(fees.platform_fee_bps[id] ?? 0)}</span>}
          </Row>
        ) : null}
        <Row label="Own provider keys">{ownKeys(gate, pricing)}</Row>
        <Row label="Money features">
          {gate.live_money ? 'Live as each is cleared' : null}
          <PreviewLabel />
        </Row>
        {fees ? (
          <Row label="FX margin over the reference rate">
            {contracted ? 'Agreed' : fx ? <span className="font-figure">{formatBPS(fx)}</span> : '—'}
            {!contracted && fx ? <PreviewLabel /> : null}
          </Row>
        ) : null}
        <Row label="Slack and Teams approvals">{included(gate.slack_teams_approvals)}</Row>
        <Row label="SSO and audit export">{included(gate.sso && gate.audit_export)}</Row>
        <Row label="Talyvor Edge">{included(gate.edge)}</Row>
      </dl>
    </div>
  )
}

/** For companies: each plan Lens gates, from the smallest up. */
export function CompanyPlans({ pricing }: { pricing: Pricing }) {
  const gates = pricing.plan_gates
  if (!gates) {
    return (
      <p className="max-w-xl text-body text-muted">
        What each plan includes could not be read from this deployment just now, so no plan is printed here.
      </p>
    )
  }
  return (
    <div className="grid gap-3 wide:grid-cols-4">
      {gates.order.map((id) => (
        <CompanyCard key={id} id={id} gate={gates.plans[id]} pricing={pricing} />
      ))}
    </div>
  )
}

/** The plan outlined in accent. Nothing measures which plan sells most, so the outline is the only mark. */
const OUTLINED_PLAN = 'pro'

/** For individuals: the chat plans, each with the usage it includes this month. */
export function IndividualPlans({ pricing }: { pricing: Pricing }) {
  const plans = pricing.plans
  if (!plans?.length) {
    return (
      <p className="max-w-xl text-body text-muted">
        This deployment did not state its plans for individuals just now, so none is printed here.
      </p>
    )
  }
  const base = plans[0]
  return (
    <div className="grid gap-3 wide:grid-cols-3">
      {plans.map((p) => {
        const name = planName(p.id)
        // A multiple is computed from the two figures Lens states, never written down.
        const times = p.id === base.id ? 0 : Math.floor(p.included_ulxc / base.included_ulxc)
        const outlined = p.id === OUTLINED_PLAN
        return (
          <div
            key={p.id}
            data-testid="pricing-plan"
            data-outlined={outlined ? 'true' : undefined}
            className={`flex flex-col gap-3 rounded-card border bg-raised p-6 ${outlined ? 'border-accent' : 'border-rule'}`}
          >
            <p className="text-head text-ink" data-testid="pricing-plan-name">
              {name}
            </p>
            <p className="flex items-baseline gap-2">
              <span data-testid="pricing-plan-price" className="font-figure text-page text-ink">
                {formatCents(p.usd_cents)}
              </span>
              <span className="text-body text-muted">a month</span>
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-muted">
              <li>Every model from every provider</li>
              <li>
                <span className="font-figure text-ink" data-testid={`pricing-included-${p.id}`}>
                  {formatULXC(p.included_ulxc)}
                </span>{' '}
                of usage included this month
              </li>
              {times > 0 ? (
                <li>
                  <span className="font-figure">{times}×</span> the included usage of {planName(base.id)}
                </li>
              ) : null}
            </ul>
            <div className="mt-auto pt-3">
              <Button asChild variant="primary" className="h-10 px-5">
                <a href="/plans">Choose {name}</a>
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** The fees on any plan, each as Lens states it. */
export function FeesOnAnyPlan({ fees }: { fees: Fees | undefined }) {
  if (!fees) {
    return (
      <p className="max-w-xl text-body text-muted">
        The fees could not be read from this deployment just now, so none is printed here.
      </p>
    )
  }
  const take = fees.market_take_bps
  return (
    <dl data-testid="fees-any-plan" className="grid gap-x-12 wide:grid-cols-2">
      <Row label="Selling on the Marketplace">
        <span>
          Sellers earn <span className="font-figure">{formatBPS(10_000 - take)}</span>; Talyvor keeps{' '}
          <span className="font-figure">{formatBPS(take)}</span>
        </span>
      </Row>
      {fees.services_take_bps === fees.compute_take_bps ? (
        <Row label="Services and compute">
          <span className="font-figure">{formatBPS(fees.services_take_bps)}</span>
        </Row>
      ) : (
        <>
          <Row label="Services">
            <span className="font-figure">{formatBPS(fees.services_take_bps)}</span>
          </Row>
          <Row label="Compute">
            <span className="font-figure">{formatBPS(fees.compute_take_bps)}</span>
          </Row>
        </>
      )}
      <Row label="Loans arranged">
        <span className="font-figure">{formatBPS(fees.lending_fee_bps)}</span>
        <PreviewLabel />
      </Row>
      <Row label="International payments">
        <span>
          <span className="font-figure">{intlPaymentFees(fees)}</span> plus the partner’s cost
        </span>
        <PreviewLabel />
      </Row>
      <Row label="Agent cards">
        Free to issue
        <PreviewLabel />
      </Row>
      <Row label="Accepting payments">
        <span>
          <span className="font-figure">{formatBPS(fees.merchant_fee_bps)}</span> plus card processing, or{' '}
          <span className="font-figure">{formatBPS(fees.merchant_a2a_fee_bps)}</span> from an account
        </span>
        <PreviewLabel />
      </Row>
    </dl>
  )
}

export const TAX_LINE =
  'Prices are in US dollars. Where Talyvor must charge VAT or sales tax, it is added at checkout and shown before you pay.'
