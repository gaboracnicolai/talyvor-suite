import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, formatDay, Row } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { api } from '../../lib/api'
import { useAuthMeReader } from '../../lib/authMe'
import {
  PLANS,
  planApi,
  planForFee,
  recordPendingPlan,
  subscribe,
  SubscribeError,
  usedPercent,
  type PlanId,
  type PlanOffer,
  type PlanSummary,
} from './planApi'
import { formatCents } from './topupApi'

// /plans (B13.3) — the three plans side by side, and for a subscriber: how much of this period's
// included usage is used, and what their answers earned back.
//
// Every figure about THIS workspace is Lens's: the plan is the period's fee (GET
// /api/billing/allowance), the meter is consumed ÷ granted from the same read, the earnings are
// its earned_back (capped at the fee by Lens), and the pooled answers are /api/usage's
// cache_hit_pooled. The three prices are the Stripe TEST prices of talyvor-lens #548.

const SUBSCRIBE_FAILURE: Record<SubscribeError['kind'], string> = {
  not_for_sale: 'Plans aren’t on sale on this deployment yet. Nothing was charged.',
  already_subscribed: 'This workspace already has a plan. Nothing was charged.',
  signed_out: 'Your session has expired — sign in again to choose a plan. Nothing was charged.',
  upstream: 'Lens couldn’t start the checkout just now. Nothing was charged — try again in a moment.',
}

function PlanCard({
  plan,
  current,
  canChoose,
  busy,
  onChoose,
}: {
  plan: PlanOffer
  current: boolean
  canChoose: boolean
  busy: boolean
  onChoose: (id: PlanId) => void
}) {
  return (
    <li
      className={`flex flex-col rounded-card border bg-surface ${current ? 'border-accent' : 'border-rule'}`}
      aria-current={current ? 'true' : undefined}
    >
      <div className="flex flex-1 flex-col gap-3 px-gutter py-5">
        <p className="font-figure text-eyebrow uppercase text-muted">{plan.name}</p>
        <p className="flex items-baseline gap-2">
          <span className="font-figure text-page text-ink">{formatCents(plan.usd_cents)}</span>
          <span className="text-body text-muted">a month</span>
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-muted">
          <li>Every model from every provider</li>
          <li>{plan.usage}</li>
          <li>Past it, chat continues on prepaid credits — never an overage</li>
        </ul>
      </div>
      {current || canChoose ? (
        <div className="border-t border-rule px-gutter py-3">
          {current ? (
            <p className="text-body text-ink">Your plan</p>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => onChoose(plan.id)}>
              {busy ? 'Opening checkout…' : `Choose ${plan.name}`}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  )
}

function UsageMeter({ summary }: { summary: PlanSummary }) {
  const a = summary.allowance!
  const pct = usedPercent(a)
  return (
    <Card>
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

function EarningsCard({ summary, sharing, pooled }: { summary: PlanSummary; sharing: boolean | undefined; pooled: number | undefined }) {
  const fee = summary.allowance!.fee_usd_cents
  const back = summary.earned_back_usd_cents
  return (
    <Card>
      <CardHeader>What you earned</CardHeader>
      <div className="flex flex-col gap-2 border-b border-rule px-gutter py-4">
        {sharing === false ? (
          <p className="text-body text-ink">
            Answer sharing is off, so your answers earn nothing.{' '}
            <Link to="/features" className="underline underline-offset-2">
              Turn it on in Features
            </Link>
            .
          </p>
        ) : fee > 0 ? (
          // "Next month you pay $X" waits on B13.2, which credits the earnings against the next
          // invoice; until that lands the bill is unchanged, so the sentence stops at what is true.
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
    </Card>
  )
}

export function Plans({
  /** Injected so tests can observe the navigation; production sends the browser to Stripe. */
  redirect = (url: string) => window.location.assign(url),
}: {
  redirect?: (url: string) => void
} = {}) {
  const plan = useQuery({ queryKey: ['plan-allowance'], queryFn: planApi.allowance, retry: false })
  const usage = useQuery({ queryKey: ['usage', 30], queryFn: () => api.usage(30) })
  const me = useAuthMeReader()

  const start = useMutation({
    mutationFn: subscribe,
    onSuccess: (session, id) => {
      recordPendingPlan(id)
      if (session.url) redirect(session.url)
    },
  })

  const forSale = plan.data?.enabled === true
  const summary = plan.data?.enabled ? plan.data.data : null
  const subscribed = !!summary?.allowance
  const current = subscribed ? planForFee(summary!.allowance!.fee_usd_cents) : null
  const failure = start.error instanceof SubscribeError ? start.error : null

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Plans"
        heading={current ? `You’re on ${current.name}.` : 'Every model, on every plan.'}
        sectionClassName="pb-10 pt-4 wide:pb-12"
      >
        <p className="max-w-2xl text-body text-muted">
          The plans differ only in how much usage is included each month. Every plan reaches every model from every
          provider, and your answers earn on every plan.
        </p>
        {plan.isSuccess && !forSale ? (
          <p className="mt-2 max-w-2xl text-body text-ink">
            Plans aren’t on sale on this deployment yet. Prepaid credits on{' '}
            <Link to="/billing" className="underline underline-offset-2">
              Billing
            </Link>{' '}
            run every request in the meantime.
          </p>
        ) : null}
        {subscribed && !current ? (
          <p className="mt-2 max-w-2xl text-body text-ink">
            This workspace has a plan at{' '}
            <span className="font-figure">{formatCents(summary!.allowance!.fee_usd_cents)}</span> a month.
          </p>
        ) : null}
        {subscribed ? (
          <p className="mt-2 max-w-2xl text-caption text-muted">Changing plan isn’t available here yet.</p>
        ) : null}
        {failure ? (
          <p role="status" className="mt-3 border-l-2 border-l-slashed pl-2 text-body text-ink">
            {SUBSCRIBE_FAILURE[failure.kind]}
          </p>
        ) : null}
        <ul className="mt-6 grid gap-gutter wide:grid-cols-3">
          {PLANS.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              current={current?.id === p.id}
              canChoose={forSale && !subscribed}
              busy={start.isPending && start.variables === p.id}
              onChoose={(id) => start.mutate(id)}
            />
          ))}
        </ul>
      </Region>

      {subscribed ? (
        <>
          <Region index="01" label="This month" className="max-w-2xl">
            <UsageMeter summary={summary!} />
          </Region>
          <Region index="02" label="What you earned" className="max-w-2xl">
            <EarningsCard
              summary={summary!}
              sharing={me.data?.cache_poolable}
              pooled={usage.data?.cache.by_source?.cache_hit_pooled ?? (usage.isSuccess ? 0 : undefined)}
            />
          </Region>
        </>
      ) : null}
    </RegionScreen>
  )
}
