import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, Row, formatDay, inlineLink } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { api } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { InlineFailure } from '../../components/SessionExpiredBar'
import { useAuthMeReader } from '../../lib/authMe'
import {
  BYOK,
  BYOK_PROVIDERS,
  COMPANY_PLANS,
  PLANS,
  planApi,
  planForFee,
  recordPendingPlan,
  subscribe,
  SubscribeError,
  SubscriptionChangeError,
  usedPercent,
  type PlanId,
  type PlanOffer,
  type PlanSummary,
} from './planApi'
import { formatCents } from './topupApi'
import { formatULXC } from './agentBankApi'
import { usePricing, type Pricing } from '../marketing/pricingApi'
import { CompanyCard, TAX_LINE } from '../marketing/PriceCard'
import { COMPANY_CONTACT } from '../../company'

// /plans (B13.3) — the three plans side by side, and for a subscriber: how much of this period's
// included usage is used, and what their answers earned back.
//
// Every figure about THIS workspace is Lens's: the plan is the period's fee (GET
// /api/billing/allowance), the meter is consumed ÷ granted from the same read, the earnings are
// its earned_back (capped at the fee by Lens), and the pooled answers are /api/usage's
// cache_hit_pooled. The three prices are the Stripe TEST prices of talyvor-lens #548.
//
// B18.20 — a subscriber switches plan from the other plans' cards (Lens B18.14, prorated by Stripe), and
// the earnings card counts the people their answers helped (/api/earnings' helped_workspaces).
//
// B27.27 — BYOK (Lens B27.26), on its own card: it sells no usage, so it grants no allowance and a BYOK
// subscriber is read from the subscription's `byok`.
//
// B28.5 — each card's included usage is the figure Lens states for that plan this month (GET /api/pricing's
// plans, from Lens's public plans read): what a new subscriber to it is granted. Never typed in here.
//
// B32.14 — the company plans too, from the same read as /pricing: Team and Business each with a checkout,
// Enterprise with "Talk to us", and BYOK as Team's add-on (Lens B32.10), added to or removed from a live Team
// subscription. Every price on this screen is GET /api/pricing's; a price Lens did not state is not printed.

const SUBSCRIBE_FAILURE: Record<SubscribeError['kind'], string> = {
  not_for_sale: 'Plans aren’t on sale on this deployment yet. Nothing was charged.',
  already_subscribed: 'This workspace already has a plan. Nothing was charged.',
  signed_out: 'Your session has expired — sign in again to choose a plan. Nothing was charged.',
  upstream: 'Lens couldn’t start the checkout just now. Nothing was charged — try again in a moment.',
}

/** A subscriber's move to another plan (B18.20): asked for, confirmed with what Stripe will charge, sent. */
interface PlanSwitch {
  /** The plan the workspace is on now, or null when its fee matches none of the three. */
  from: PlanOffer | null
  confirming: boolean
  busy: boolean
  onAsk: () => void
  onConfirm: () => void
  onKeep: () => void
}

function SwitchPlan({ plan, sw }: { plan: PlanOffer; sw: PlanSwitch }) {
  if (!sw.confirming) {
    return <Button onClick={sw.onAsk}>{`Switch to ${plan.name}`}</Button>
  }
  const from = sw.from ? sw.from.name : 'your current plan'
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink">
        Move to {plan.name} now? Stripe credits the unused part of this month on {from} and charges the rest of it
        at {plan.name}’s price, on your next invoice.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={sw.busy} onClick={sw.onConfirm}>
          {sw.busy ? 'Moving…' : `Move to ${plan.name}`}
        </Button>
        <Button disabled={sw.busy} onClick={sw.onKeep}>
          {sw.from ? `Keep ${sw.from.name}` : 'Not now'}
        </Button>
      </div>
    </div>
  )
}

function PlanCard({
  plan,
  usdCents,
  includedULXC,
  current,
  canChoose,
  busy,
  onChoose,
  switching,
}: {
  plan: PlanOffer
  /** The price Lens states for the plan; undefined until — or unless — Lens states it. */
  usdCents: number | undefined
  /** The µLXC Lens says the plan includes this month; undefined until — or unless — Lens states it. */
  includedULXC: number | undefined
  current: boolean
  canChoose: boolean
  busy: boolean
  onChoose: (id: PlanId) => void
  /** Set for a subscriber's other plans: the card offers a move to it instead of a checkout. */
  switching?: PlanSwitch
}) {
  return (
    <li
      className={`flex flex-col rounded-card border bg-raised ${current ? 'border-accent' : 'border-rule'}`}
      aria-current={current ? 'true' : undefined}
    >
      <div className="flex flex-1 flex-col gap-3 px-gutter py-5">
        <p className="font-figure text-eyebrow uppercase text-label">{plan.name}</p>
        <MonthlyPrice usdCents={usdCents} testId={`plan-price-${plan.id}`} />
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-muted">
          <li>Every model from every provider</li>
          {includedULXC !== undefined ? (
            <li>
              <span className="font-figure text-ink" data-testid={`plan-included-${plan.id}`}>
                {formatULXC(includedULXC)}
              </span>{' '}
              of usage included this month
            </li>
          ) : null}
          <li>Past it, chat continues on prepaid credits — never an overage</li>
        </ul>
      </div>
      {current || canChoose || switching ? (
        <div className="border-t border-rule px-gutter py-3">
          {current ? (
            <p className="text-body text-ink">Your plan</p>
          ) : switching ? (
            <SwitchPlan plan={plan} sw={switching} />
          ) : (
            <Button disabled={busy} onClick={() => onChoose(plan.id)}>
              {busy ? 'Opening checkout…' : `Choose ${plan.name}`}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  )
}

/** A price Lens stated, a month; or, when it stated none, a sentence saying so instead of a figure. */
function MonthlyPrice({ usdCents, testId }: { usdCents: number | undefined; testId: string }) {
  if (usdCents === undefined) {
    return <p className="text-body text-muted">Price not stated by this deployment just now</p>
  }
  return (
    <p className="flex items-baseline gap-2">
      <span className="font-figure text-page text-ink" data-testid={testId}>
        {formatCents(usdCents)}
      </span>
      <span className="text-body text-muted">a month</span>
    </p>
  )
}

/** "Anthropic, Google, Groq, Mistral and OpenAI" — the providers a BYOK key can be added for. */
function providerList(): string {
  const names = Object.values(BYOK_PROVIDERS)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('')
}

/**
 * B32.14 — BYOK, Team's add-on (Lens B32.10): added to or removed from a live Team subscription, prorated by Stripe.
 * Business includes it. A workspace that bought BYOK alone before then keeps it, and this card says so.
 */
function ByokAddonCard({
  usdCents,
  plan,
  byok,
  busy,
  onSet,
}: {
  usdCents: number | undefined
  /** The plan the workspace is on, as the subscription names it; undefined when it has none. */
  plan: string | undefined
  byok: boolean
  busy: boolean
  onSet: (on: boolean) => void
}) {
  const current = plan === 'byok' || (plan === 'team' && byok)
  return (
    <section
      aria-labelledby="plan-byok"
      aria-current={current ? 'true' : undefined}
      className={`mt-gutter flex flex-col rounded-card border bg-raised ${current ? 'border-accent' : 'border-rule'}`}
    >
      <div className="flex flex-col gap-3 px-gutter py-5 wide:flex-row wide:gap-gutter">
        <div className="flex flex-col gap-3 wide:w-64 wide:shrink-0">
          <p id="plan-byok" className="font-figure text-eyebrow uppercase text-label">
            {BYOK.name} — Team’s add-on
          </p>
          <MonthlyPrice usdCents={usdCents} testId="plan-price-byok" />
        </div>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-muted">
          <li>Your own API keys for {providerList()}, added in Settings</li>
          <li>No Talyvor token charge on a request sent on your key — your provider bills you directly</li>
          <li>Included in Business</li>
        </ul>
      </div>
      <div className="border-t border-rule px-gutter py-3">
        {plan === 'byok' ? (
          <p className="text-body text-ink">
            Your plan.{' '}
            <Link to="/settings" className={inlineLink}>
              Add your provider keys in Settings
            </Link>
            .
          </p>
        ) : plan === 'business' ? (
          <p className="text-body text-ink">Included in your Business plan.</p>
        ) : plan === 'team' && byok ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-body text-ink">On your Team plan.</p>
            <Button disabled={busy} onClick={() => onSet(false)}>
              {busy ? 'Removing…' : `Remove ${BYOK.name}`}
            </Button>
          </div>
        ) : plan === 'team' ? (
          <Button disabled={busy} onClick={() => onSet(true)}>
            {busy ? 'Adding…' : `Add ${BYOK.name} to Team`}
          </Button>
        ) : (
          <p className="text-body text-muted">Add it once your workspace is on Team. Business includes it.</p>
        )}
      </div>
    </section>
  )
}

function UsageMeter({ summary }: { summary: PlanSummary }) {
  const a = summary.allowance!
  const pct = usedPercent(a)
  return (
    <Card raised>
      <CardHeader>Included usage</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-4">
        <p className="text-body text-ink">
          <span className="font-figure">{pct}%</span> of this month’s included usage
        </p>
        <div
          className="relative h-2 overflow-hidden rounded-pill bg-rule-strong"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Included usage used this month"
        >
          {/* width is a runtime value → inline style, not a Tailwind arbitrary class. */}
          <div className="absolute inset-y-0 left-0 rounded-pill bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-caption text-muted">
          Renews {formatDay(a.period_end)}.{' '}
          {pct >= 100
            ? 'It is used up, so chat is drawing your LXC balance until then.'
            : 'When it runs out, chat draws your LXC balance — the plan never bills an overage.'}
        </p>
      </div>
    </Card>
  )
}

function EarningsCard({
  summary,
  sharing,
  pooled,
  helped,
}: {
  summary: PlanSummary
  sharing: boolean | undefined
  pooled: number | undefined
  /** Lens's earnings summary counts (B18.14), absent until it answers. */
  helped: { reuses: number; helped_workspaces: number } | undefined
}) {
  const fee = summary.allowance!.fee_usd_cents
  const back = summary.earned_back_usd_cents
  return (
    <Card raised>
      <CardHeader>What you earned</CardHeader>
      <div className="flex flex-col gap-2 border-b border-rule px-gutter py-4">
        {sharing === false ? (
          <p className="text-body text-ink">
            Answer sharing is off, so new answers earn nothing.{' '}
            <Link to="/features" className={inlineLink}>
              Turn it on in Features
            </Link>
            .
          </p>
        ) : fee > 0 ? (
          <p className="text-body text-ink">
            Your answers earned you <span className="font-figure">{formatCents(back)}</span> this month —{' '}
            <span className="font-figure">{formatCents(back)}</span> of your{' '}
            <span className="font-figure">{formatCents(fee)}</span> plan back.
          </p>
        ) : (
          <p className="text-body text-ink">
            Your answers earned you <span className="font-figure">{formatCents(summary.earned_usd_cents)}</span> this
            month. Your plan’s price couldn’t be read from Stripe, so nothing is counted against it yet.
          </p>
        )}
        {summary.earned_held_ulens > 0 ? (
          <p className="text-caption text-muted">
            Some of it is still inside its holdback, so it can yet be revoked.
          </p>
        ) : null}
      </div>
      {pooled !== undefined ? (
        <Row
          label="Answered from the shared pool"
          hint="Last 30 days. Each drew 70% of its usual price from your included usage, so it went further"
        >
          <span className="font-figure text-body text-ink">{pooled.toLocaleString('en-US')}</span>
        </Row>
      ) : null}
      {helped ? (
        <Row
          label="People your answers helped"
          hint={`Every other workspace that reused one of your answers or converted documents — ${helped.reuses.toLocaleString('en-US')} ${helped.reuses === 1 ? 'reuse' : 'reuses'} in all, so far. A count, never who`}
        >
          <span className="font-figure text-body text-ink" data-testid="plans-helped">
            {helped.helped_workspaces.toLocaleString('en-US')}
          </span>
        </Row>
      ) : null}
    </Card>
  )
}

export const SUBSCRIPTION_KEY = ['plan-subscription']

function changeFailure(err: unknown): string {
  if (isSessionExpired(err)) return 'Nothing changed — sign in again.'
  if (err instanceof SubscriptionChangeError && err.sentence) {
    const s = err.sentence.replace(/^billing: /, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return 'Nothing changed. You can try again.'
}

/**
 * B18.61 — whether the plan renews or ends, and when; cancelling it at the end of the period already
 * paid for, or resuming it before then (Lens B1.5). Lens answers Stripe's state after a change and
 * that is shown at once: Lens's own read catches up when Stripe's webhook arrives.
 * B26.17 — /billing's plan card draws it too, so a subscriber cancels or resumes where they top up.
 */
export function PlanRenewal({ className = 'mt-3' }: { className?: string } = {}) {
  const qc = useQueryClient()
  const sub = useQuery({ queryKey: SUBSCRIPTION_KEY, queryFn: planApi.subscription, retry: false })
  const change = useMutation({
    mutationFn: (action: 'cancel' | 'resume') => (action === 'cancel' ? planApi.cancel() : planApi.resume()),
    onSuccess: (st) => qc.setQueryData(SUBSCRIPTION_KEY, { enabled: true, data: st }),
  })
  if (sub.isError) {
    return <p className={`${className} max-w-2xl text-body text-muted`}>Whether your plan renews could not be read just now.</p>
  }
  const st = sub.data?.enabled ? sub.data.data : null
  if (!st?.subscribed) return null
  const end = st.current_period_end ? (
    <span className="font-figure">{formatDay(st.current_period_end)}</span>
  ) : null
  return (
    <div className={`${className} flex max-w-2xl flex-col gap-2`}>
      <p className="text-body text-ink" data-testid="plan-renewal">
        {st.cancel_at_period_end ? (
          end ? (
            <>Your plan is cancelled. It ends on {end}, and you keep everything it includes until then.</>
          ) : (
            'Your plan is cancelled. It ends at the end of this period, and you keep everything it includes until then.'
          )
        ) : end ? (
          <>Your plan renews on {end}.</>
        ) : (
          'Your plan renews each month.'
        )}
      </p>
      <div>
        {st.cancel_at_period_end ? (
          <Button variant="primary" disabled={change.isPending} onClick={() => change.mutate('resume')}>
            {change.isPending ? 'Resuming…' : 'Resume my plan'}
          </Button>
        ) : (
          <Button disabled={change.isPending} onClick={() => change.mutate('cancel')}>
            {change.isPending ? 'Cancelling…' : 'Cancel at the end of this period'}
          </Button>
        )}
      </div>
      {change.isError ? (
        <p role="alert" className="text-body text-ink">
          {changeFailure(change.error)}
        </p>
      ) : null}
    </div>
  )
}

export function Plans({
  /** Injected so tests can observe the navigation; production sends the browser to Stripe. */
  redirect = (url: string) => window.location.assign(url),
}: {
  redirect?: (url: string) => void
} = {}) {
  const qc = useQueryClient()
  // B18.20 — the plan a switch moved to. Lens answers Stripe's state after the swap; the allowance's fee
  // follows when Stripe's webhook reaches Lens, so until it does the allowance is re-read.
  const [movedTo, setMovedTo] = useState<PlanOffer | null>(null)
  const [confirming, setConfirming] = useState<PlanId | null>(null)
  const pricing = usePricing()
  const served: Pricing | undefined = pricing.status === 'ok' ? pricing.pricing : undefined
  const priced = served?.plans
  const priceOf = (id: string) => priced?.find((o) => o.id === id)?.usd_cents
  const plan = useQuery({
    queryKey: ['plan-allowance'],
    queryFn: planApi.allowance,
    retry: false,
    refetchInterval: (q) => {
      const fee = q.state.data?.enabled ? q.state.data.data.allowance?.fee_usd_cents : undefined
      return movedTo && fee !== priceOf(movedTo.id) && q.state.dataUpdateCount < 20 ? 3000 : false
    },
  })
  const usage = useQuery({ queryKey: ['usage', 30], queryFn: () => api.usage(30) })
  const earnings = useQuery({ queryKey: ['earnings'], queryFn: () => api.earnings() })
  const me = useAuthMeReader()
  // B27.27 — BYOK grants no allowance, so the subscription says whether this workspace is on it. B32.14 — nor do
  // Team and Business: the subscription names the plan (Lens B32.10).
  const sub = useQuery({ queryKey: SUBSCRIPTION_KEY, queryFn: planApi.subscription, retry: false })
  const st = sub.data?.enabled && sub.data.data.subscribed ? sub.data.data : null
  const onCompany = COMPANY_PLANS.find((p) => p.id === st?.plan) ?? null
  // A workspace that bought BYOK alone, before it became Team's add-on.
  const onBYOK = !!st?.byok && !onCompany
  const addon = useMutation({
    mutationFn: planApi.setBYOKAddon,
    onSuccess: (next) => qc.setQueryData(SUBSCRIPTION_KEY, { enabled: true, data: next }),
  })

  const move = useMutation({
    mutationFn: (p: PlanOffer) => planApi.changePlan(p.id),
    onSuccess: (st, p) => {
      setMovedTo(p)
      setConfirming(null)
      qc.setQueryData(SUBSCRIPTION_KEY, { enabled: true, data: st })
      void qc.invalidateQueries({ queryKey: ['plan-allowance'] })
    },
  })

  const start = useMutation({
    mutationFn: subscribe,
    onSuccess: (session, id) => {
      recordPendingPlan(id)
      if (session.url) redirect(session.url)
    },
  })

  const forSale = plan.data?.enabled === true
  const summary = plan.data?.enabled ? plan.data.data : null
  const allowance = summary?.allowance ?? null
  const subscribed = !!allowance || !!st
  const onFile = allowance ? planForFee(allowance.fee_usd_cents, priced) : null
  const current = onCompany ?? (onBYOK ? BYOK : subscribed ? (movedTo ?? onFile) : null)
  const failure = start.error instanceof SubscribeError ? start.error : null
  const gates = served?.plan_gates

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Plans"
        heading={current ? `You’re on ${current.name}.` : 'Every model, on every plan.'}
        sectionClassName="pb-10 pt-4 wide:pb-12"
      >
        <p className="max-w-2xl text-body text-muted">
          A company’s plan sets its agents, seats and fees; a plan for individuals includes usage each month. Every plan
          reaches every model from every provider. Your answers earn once your workspace has bought credits.
        </p>
        {plan.isError ? (
          <p className="mt-2 max-w-2xl">
            <InlineFailure error={plan.error} failed="Couldn’t load your plan." />
          </p>
        ) : null}
        {plan.isSuccess && !forSale ? (
          <p className="mt-2 max-w-2xl text-body text-ink">
            Plans aren’t on sale on this deployment yet. Prepaid credits on{' '}
            <Link to="/billing" className={inlineLink}>
              Billing
            </Link>{' '}
            run every request in the meantime.
          </p>
        ) : null}
        {allowance && !onFile && !movedTo ? (
          <p className="mt-2 max-w-2xl text-body text-ink">
            This workspace has a plan at{' '}
            <span className="font-figure">{formatCents(summary!.allowance!.fee_usd_cents)}</span> a month.
          </p>
        ) : null}
        {movedTo ? (
          <p role="status" className="mt-2 max-w-2xl text-body text-ink" data-testid="plan-moved">
            {movedTo.id === onFile?.id
              ? `You moved to ${movedTo.name}, and this month’s included usage now follows it.`
              : `You moved to ${movedTo.name}. The difference for the rest of this month is on your next invoice, and the included usage below follows as soon as Stripe confirms it.`}
          </p>
        ) : null}
        {move.isError ? (
          <p role="alert" className="mt-2 max-w-2xl text-body text-ink">
            {changeFailure(move.error)}
          </p>
        ) : null}
        {subscribed ? <PlanRenewal /> : null}
        {failure ? (
          <p role="status" className="mt-3 border-l-2 border-l-slashed pl-2 text-body text-ink">
            {SUBSCRIBE_FAILURE[failure.kind]}
          </p>
        ) : null}
        {addon.isError ? (
          <p role="alert" className="mt-2 max-w-2xl text-body text-ink">
            {changeFailure(addon.error)}
          </p>
        ) : null}
        <h2 className="mt-8 text-head text-ink">For companies</h2>
        {gates ? (
          <div className="mt-4 grid gap-gutter wide:grid-cols-3">
            {[...COMPANY_PLANS.map((p) => p.id), 'enterprise']
              .filter((id) => gates.plans[id])
              .map((id) => {
                const offer = COMPANY_PLANS.find((p) => p.id === id)
                const busy = start.isPending && start.variables === id
                return (
                  <CompanyCard
                    key={id}
                    id={id}
                    gate={gates.plans[id]}
                    pricing={served!}
                    current={current?.id === id}
                    action={
                      current?.id === id ? (
                        <p className="text-body text-ink">Your plan</p>
                      ) : !offer ? (
                        <Button asChild>
                          <a href={`mailto:${COMPANY_CONTACT}`}>Talk to us</a>
                        </Button>
                      ) : forSale && !subscribed ? (
                        <Button disabled={busy} onClick={() => start.mutate(offer.id)}>
                          {busy ? 'Opening checkout…' : `Choose ${offer.name}`}
                        </Button>
                      ) : null
                    }
                  />
                )
              })}
          </div>
        ) : (
          <p className="mt-2 max-w-2xl text-body text-muted">
            {pricing.status === 'loading'
              ? 'Reading the plans…'
              : 'What each plan includes could not be read from this deployment just now.'}
          </p>
        )}
        <ByokAddonCard
          usdCents={served?.byok_add_on_usd_cents}
          plan={onBYOK ? 'byok' : onCompany?.id}
          byok={!!st?.byok}
          busy={addon.isPending}
          onSet={(on) => addon.mutate(on)}
        />
        <h2 className="mt-10 text-head text-ink">For individuals</h2>
        <p className="mt-2 max-w-2xl text-body text-muted">
          The plans differ only in how much usage is included each month.
        </p>
        <ul className="mt-4 grid gap-gutter wide:grid-cols-3">
          {PLANS.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              usdCents={priceOf(p.id)}
              includedULXC={priced?.find((o) => o.id === p.id)?.included_ulxc}
              current={current?.id === p.id}
              canChoose={forSale && !subscribed}
              busy={start.isPending && start.variables === p.id}
              onChoose={(id) => start.mutate(id)}
              switching={
                subscribed && !onBYOK && !onCompany && current?.id !== p.id
                  ? {
                      from: current,
                      confirming: confirming === p.id,
                      busy: move.isPending && move.variables?.id === p.id,
                      onAsk: () => {
                        move.reset()
                        setConfirming(p.id)
                      },
                      onConfirm: () => move.mutate(p),
                      onKeep: () => setConfirming(null),
                    }
                  : undefined
              }
            />
          ))}
        </ul>
        <p className="mt-6 max-w-2xl text-body text-muted" data-testid="plans-tax-line">
          {TAX_LINE}
        </p>
      </Region>

      {allowance ? (
        <>
          <Region index="01" label="This month" className="max-w-2xl">
            <UsageMeter summary={summary!} />
          </Region>
          <Region index="02" label="What you earned" className="max-w-2xl">
            <EarningsCard
              summary={summary!}
              sharing={me.data?.cache_poolable}
              pooled={usage.data?.cache.by_source?.cache_hit_pooled ?? (usage.isSuccess ? 0 : undefined)}
              helped={typeof earnings.data?.helped_workspaces === 'number' ? earnings.data : undefined}
            />
          </Region>
        </>
      ) : null}
    </RegionScreen>
  )
}
