import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Pill, type PillStatus, inlineLink } from '@talyvor/ui'

import { BOOK_KEY, FORECAST_KEY, rulesKey } from '../lens/AgentBank'
import { type Agent, type AgentRules, type AgentSpendAlert, type AgentTopUp, type SpendForecast, agentBankApi } from '../lens/agentBankApi'
import { formatWhen } from '../lens/format'
import { Lxc } from '../lens/money'
import { Card } from '../lens/walletBrand'

// B28.91 — what the agents' wallets warn about, in the conversation, without leaving it:
//   · unusual spend — Lens's own alert (B19.6), while the hour it measured is still the last hour, or while the
//     agent it paused is still paused;
//   · low balance — an agent that has spent this month and holds nothing, or holds less than the line its own
//     automatic top-up refills from;
//   · limit approached — an agent whose month, by Lens's forecast, reaches its monthly limit, or has reached it.
// Every line is the owner's own setting or Lens's own figure; no threshold is made up here. The reads run every
// ALERT_POLL_MS, so a notice is on screen within ten seconds of what raised it. A notice put away stays away in
// this browser until the thing it says changes: the agent spends again, its limit moves, or Lens raises a new alert.

/** Half the ten seconds a notice has to appear in, so one slow read still lands inside them. */
export const ALERT_POLL_MS = 5_000
const UNUSUAL_HOUR_MS = 60 * 60 * 1000
export const DISMISSED_ALERTS_KEY = 'talyvor.chat.dismissed-alerts'

export interface WalletNotice {
  /** What it says, so putting it away holds only until that changes. */
  key: string
  agent: Agent
  kind: 'unusual' | 'low' | 'limit'
  status: PillStatus
  label: string
  text: React.ReactNode
  at?: string
}

/** The notices the wallets raise now, oldest kind first: unusual spend, then low balances, then limits. */
export function walletNotices(
  agents: Agent[],
  alerts: AgentSpendAlert[],
  forecast: SpendForecast | undefined,
  rules: Record<string, AgentRules | undefined>,
  topUps: Record<string, AgentTopUp | null | undefined>,
  now: number,
): WalletNotice[] {
  const live = agents.filter((a) => !a.archived_at)
  const byID = new Map(live.map((a) => [a.id, a]))
  const month = forecast?.month_start ?? ''
  const spentOf = (id: string) => forecast?.agents?.find((f) => f.agent_id === id)
  const out: WalletNotice[] = []

  for (const al of alerts) {
    const agent = byID.get(al.agent_id)
    if (agent === undefined) continue
    const stillPaused = al.paused && Boolean(agent.paused_at)
    if (now - Date.parse(al.created_at) > UNUSUAL_HOUR_MS && !stillPaused) continue
    out.push({
      key: `unusual:${al.id}`,
      agent,
      kind: 'unusual',
      status: stillPaused ? 'slashed' : 'held',
      label: 'Unusual spend',
      at: al.created_at,
      text: (
        <>
          {agent.name} spent <Lxc ulxc={al.last_hour_ulxc} /> in an hour; it usually spends <Lxc ulxc={al.usual_per_hour_ulxc} /> an hour.
          {stillPaused ? ` Lens paused it, so it spends nothing until you resume it.` : ''}
        </>
      ),
    })
  }

  for (const agent of live) {
    const f = spentOf(agent.id)
    const line = topUps[agent.id]?.below_ulxc ?? 0
    if (agent.balance_ulxc <= 0 && (f?.spent_ulxc ?? 0) > 0) {
      out.push({
        key: `low:${agent.id}:${month}:${f?.spent_ulxc}`,
        agent,
        kind: 'low',
        status: 'slashed',
        label: 'Low balance',
        text: <>{agent.name} has run out: it holds nothing, so Lens refuses its next request or payment until it is funded.</>,
      })
    } else if (line > 0 && agent.balance_ulxc < line) {
      out.push({
        key: `low:${agent.id}:${month}:${f?.spent_ulxc ?? 0}:${line}`,
        agent,
        kind: 'low',
        status: 'held',
        label: 'Low balance',
        text: (
          <>
            {agent.name} holds <Lxc ulxc={agent.balance_ulxc} />, under the <Lxc ulxc={line} /> its automatic top-up refills from.
          </>
        ),
      })
    }
  }

  for (const agent of live) {
    const f = spentOf(agent.id)
    const limit = rules[agent.id]?.monthly_limit_ulxc ?? 0
    if (f === undefined || limit <= 0 || f.forecast_ulxc < limit) continue
    const reached = f.spent_ulxc >= limit
    out.push({
      key: `limit:${agent.id}:${month}:${limit}:${reached ? 'reached' : 'near'}`,
      agent,
      kind: 'limit',
      status: reached ? 'slashed' : 'held',
      label: reached ? 'Limit reached' : 'Near its limit',
      text: reached ? (
        <>
          {agent.name} has reached its <Lxc ulxc={limit} /> monthly limit: it has spent <Lxc ulxc={f.spent_ulxc} /> this month, and Lens
          refuses anything more until the month ends.
        </>
      ) : (
        <>
          {agent.name} is on course for its <Lxc ulxc={limit} /> monthly limit: <Lxc ulxc={f.spent_ulxc} /> spent so far, and{' '}
          <Lxc ulxc={f.forecast_ulxc} /> by the month’s end at this pace.
        </>
      ),
    })
  }
  return out
}

function readDismissed(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(DISMISSED_ALERTS_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const poll = { refetchInterval: (q: { state: { status: string } }) => (q.state.status === 'error' ? false : ALERT_POLL_MS), refetchOnWindowFocus: true }

export function AlertNotices() {
  const qc = useQueryClient()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book, ...poll })
  const alerts = useQuery({ queryKey: ['agent-alerts'], queryFn: agentBankApi.alerts, ...poll })
  const forecast = useQuery({ queryKey: FORECAST_KEY, queryFn: agentBankApi.forecast, ...poll })
  const agents = book.data?.agents ?? []
  // Only an agent that has spent this month can be near a limit or run dry; its rules and top-up are read again
  // each time its spend moves, and not otherwise.
  const spending = agents.filter((a) => !a.archived_at && (forecast.data?.agents?.find((f) => f.agent_id === a.id)?.spent_ulxc ?? 0) > 0)
  const rules = useQueries({ queries: spending.map((a) => ({ queryKey: rulesKey(a.id), queryFn: () => agentBankApi.rules(a.id) })) })
  const topUps = useQueries({
    queries: spending.map((a) => ({ queryKey: ['agent-topup', a.id], queryFn: () => agentBankApi.topUp(a.id) })),
  })
  const seen = useRef(new Map<string, number>())
  useEffect(() => {
    for (const f of forecast.data?.agents ?? []) {
      const was = seen.current.get(f.agent_id)
      if (was !== undefined && was !== f.spent_ulxc) {
        void qc.invalidateQueries({ queryKey: rulesKey(f.agent_id) })
        void qc.invalidateQueries({ queryKey: ['agent-topup', f.agent_id] })
      }
      seen.current.set(f.agent_id, f.spent_ulxc)
    }
  }, [forecast.data, qc])
  const [dismissed, setDismissed] = useState<string[]>(readDismissed)

  if (book.isError || alerts.isError || forecast.isError) {
    return (
      <p className="pb-6 text-caption text-muted" data-testid="chat-alerts-unread">
        Your agents’ wallet alerts could not be read just now.{' '}
        <Link className={inlineLink} to="/agents">
          Open Agent Wallets
        </Link>
      </p>
    )
  }

  const notices = walletNotices(
    agents,
    alerts.data?.alerts ?? [],
    forecast.data,
    Object.fromEntries(spending.map((a, i) => [a.id, rules[i]?.data])),
    Object.fromEntries(spending.map((a, i) => [a.id, topUps[i]?.data])),
    Date.now(),
  )
  const shown = notices.filter((n) => !dismissed.includes(n.key))
  if (shown.length === 0) return null

  const dismiss = (key: string) => {
    // Only what is on screen now is kept, so the list never outgrows the notices it hides.
    const next = [...dismissed.filter((k) => notices.some((n) => n.key === k)), key]
    setDismissed(next)
    try {
      window.localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(next))
    } catch {
      // A browser that keeps nothing still hides it until the page is reloaded.
    }
  }

  return (
    <section aria-label="Wallet alerts" className="flex flex-col gap-3 pb-6">
      {shown.map((n) => (
        <Card key={n.key} data-testid="chat-alert" data-kind={n.kind} data-agent={n.agent.id}>
          <div className="flex flex-col gap-2 px-4 py-3">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
              <Pill status={n.status}>{n.label}</Pill>
              {n.at ? <span className="font-figure">{formatWhen(n.at)}</span> : null}
            </p>
            <p className="text-body text-ink" data-testid="chat-alert-text" role="status">
              {n.text}
            </p>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link className={`text-caption ${inlineLink}`} to={`/agents?${new URLSearchParams({ agent: n.agent.id }).toString()}`}>
                {n.kind === 'low' ? `Fund ${n.agent.name}` : n.kind === 'limit' ? `${n.agent.name}’s rules` : `Open ${n.agent.name}`}
              </Link>
              <Button className="h-8" onClick={() => dismiss(n.key)} aria-label={`Dismiss: ${n.label} for ${n.agent.name}`}>
                Dismiss
              </Button>
            </p>
          </div>
        </Card>
      ))}
    </section>
  )
}
