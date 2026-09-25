import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, formatDay, MuNumeral, Row } from '@talyvor/ui'
import { planApi } from './planApi'
import { formatCents } from './topupApi'

/**
 * B1.6 — a subscriber's plan, on /billing under the LXC balance: what it costs, what the team's
 * answers earned back against it, and how much of this period's allowance is used and left.
 *
 * ⚠ IT DRAWS NOTHING UNLESS THERE IS A PLAN TO DESCRIBE. No plans sold here (`enabled:false`),
 * not subscribed (`allowance: null`), still loading, or a read that failed — none of those is a
 * sentence about a plan, and a card saying "no plan" to a workspace whose read merely failed would
 * be the conflation this app has paid for twice. A failed read draws nothing rather than a claim;
 * the balance card above already reports an unreachable Lens.
 */
export function YourPlan() {
  const plan = useQuery({ queryKey: ['plan-allowance'], queryFn: planApi.allowance, retry: false })
  if (!plan.data?.enabled || !plan.data.data.allowance) return null

  const summary = plan.data.data
  const a = summary.allowance!
  return (
    <Card className="mt-4">
      <CardHeader>Your plan</CardHeader>
      <div className="border-b border-rule px-gutter py-4">
        {a.fee_usd_cents > 0 ? (
          <p className="text-body text-ink">
            Your plan is <span className="font-figure">{formatCents(a.fee_usd_cents)}</span>. Your
            team’s answers earned{' '}
            <span className="font-figure">{formatCents(summary.earned_back_usd_cents)}</span> of
            it back.
          </p>
        ) : (
          // Lens counts nothing back against a fee it could not read (earnedBack of 0 is its
          // ceiling), so the sentence is not drawn with a price nobody confirmed.
          <p className="text-body text-ink">
            Your plan’s price couldn’t be read from Stripe, so nothing is counted back against it yet.
          </p>
        )}
        {summary.earned_held_ulens > 0 ? (
          <p className="mt-1 text-caption font-normal text-muted">
            Some of what was earned is still inside its holdback, so it can yet be revoked.
          </p>
        ) : null}
      </div>
      <Row
        label="Allowance used"
        hint={`Since ${formatDay(a.period_start)}; the allowance renews ${formatDay(a.period_end)}`}
      >
        <MuNumeral micros={a.consumed_ulxc} unit="lxc" />
        <span className="text-body text-muted">of</span>
        <MuNumeral micros={a.granted_ulxc} unit="lxc" />
      </Row>
      <Row
        label="Allowance left"
        hint="When it runs out, chat draws the LXC balance above — the plan never bills an overage"
      >
        <MuNumeral micros={a.remaining_ulxc} unit="lxc" />
      </Row>
    </Card>
  )
}
