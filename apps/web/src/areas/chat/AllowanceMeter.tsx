import { useEffect, useRef } from 'react'
import { useQuery, type Query } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { formatULXC } from '../lens/agentBankApi'
import { planApi, usedPercent } from '../lens/planApi'

// B28.104 — the plan's allowance used and the prepaid balance, in Chat under the box. Both are Lens's figures, from
// the reads /billing makes and under the same keys (GET /api/billing/allowance, GET /api/lxc/balance), so the two
// screens never disagree. They are read again when an answer is done, and again each second until one of them moves
// (or ten seconds pass, for an answer that cost nothing), so the meter drops by what the answer was charged.
//
// A deployment that sells no plans, or a workspace without one, shows the balance alone. A read that failed shows
// nothing of its part rather than a figure from before: /billing says why.

const CHASE_MS = 10_000
const CHASE_POLL_MS = 1_000

/** Re-read every second after an answer is done, until the figure moves or ten seconds pass. */
function useChase<T>(figure: (data: T | undefined) => number | undefined) {
  const chase = useRef<{ from: number | undefined; until: number } | null>(null)
  const refetchInterval = (q: Query<T, Error, T, readonly unknown[]>) => {
    const c = chase.current
    if (c === null) return false
    if (Date.now() >= c.until || figure(q.state.data) !== c.from) {
      chase.current = null
      return false
    }
    return CHASE_POLL_MS
  }
  return { chase, refetchInterval }
}

const allowanceLeft = (d: Awaited<ReturnType<typeof planApi.allowance>> | undefined) =>
  d?.enabled ? (d.data.allowance?.remaining_ulxc ?? undefined) : undefined

/** "Plan 25% used · 150 LXC left  Prepaid balance 4.25 LXC" — the figures Lens holds for this workspace now. */
export function AllowanceMeter({ answering }: { answering: boolean }) {
  const planChase = useChase(allowanceLeft)
  const balanceChase = useChase((d: Awaited<ReturnType<typeof api.lxcBalance>> | undefined) => d?.balance_ulxc)
  const plan = useQuery({
    queryKey: ['plan-allowance'],
    queryFn: planApi.allowance,
    retry: false,
    refetchInterval: planChase.refetchInterval,
  })
  const balance = useQuery({
    queryKey: ['lxc-balance'],
    queryFn: api.lxcBalance,
    retry: false,
    refetchInterval: balanceChase.refetchInterval,
  })

  const { refetch: refetchPlan } = plan
  const { refetch: refetchBalance } = balance
  // An answer done, refused or stopped: whatever it was charged has been, or is being, written.
  const wasAnswering = useRef(answering)
  useEffect(() => {
    const settled = wasAnswering.current && !answering
    wasAnswering.current = answering
    if (!settled) return
    const until = Date.now() + CHASE_MS
    planChase.chase.current = { from: allowanceLeft(plan.data), until }
    balanceChase.chase.current = { from: balance.data?.balance_ulxc, until }
    void refetchPlan()
    void refetchBalance()
    // Only an answer being done starts a chase; the figures it starts from are the ones on screen then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answering])

  const a = plan.isSuccess && plan.data.enabled ? plan.data.data.allowance : null
  const prepaid = balance.isSuccess ? balance.data.balance_ulxc : undefined
  if (a === null && prepaid === undefined) return null
  const pct = a === null ? 0 : usedPercent(a)
  return (
    <p className="flex flex-wrap items-center gap-x-3 text-caption text-muted" data-testid="allowance-meter">
      {a !== null ? (
        <>
          <span
            className="relative inline-block h-1.5 w-12 overflow-hidden rounded-pill bg-rule-strong"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Plan allowance used this month"
          >
            {/* width is a runtime value → inline style, not a Tailwind arbitrary class. */}
            <span className="absolute inset-y-0 left-0 rounded-pill bg-accent" style={{ width: `${pct}%` }} />
          </span>
          <span>
            Plan <span className="font-figure text-ink">{pct}%</span> used ·{' '}
            <span className="whitespace-nowrap font-figure text-ink" data-testid="allowance-left">
              {formatULXC(a.remaining_ulxc)}
            </span>{' '}
            left
          </span>
        </>
      ) : null}
      {/* A space between the two in the text a screen reader reads; the gap lays them out. */}
      {a !== null && prepaid !== undefined ? ' ' : null}
      {prepaid !== undefined ? (
        <span>
          Prepaid balance{' '}
          <span className="whitespace-nowrap font-figure text-ink" data-testid="prepaid-balance">
            {formatULXC(prepaid)}
          </span>
        </span>
      ) : null}
    </p>
  )
}
