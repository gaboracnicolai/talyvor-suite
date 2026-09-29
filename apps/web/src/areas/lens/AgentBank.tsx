import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader, Input, Pill, RevealOnce, Row, focusRing, type PillStatus } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { isSessionExpired } from '../../lib/productState'
import { formatWhen } from './format'
import { kindLabel, marketApi, priceText } from '../marketplace/marketApi'
import { CATALOG_KEY } from '../marketplace/parts'
import { notifyThisDevice, passkeysSupported, pushSupported, registerThisDevice, signApproval } from './passkeys'
import { AgentCardPanel } from './AgentCardPanel'
import { AgentAddress, AgentTransfers, CreditLinePanel, Loans, MoneyRequests, OfferLoan, RecurringTransfer, SendAndRequest } from './WalletMoney'
import { CashOutCard, CashOuts, Escrows, PayIntoEscrow, Portfolios, Pots } from './WalletHoldings'
import {
  type Agent,
  type AgentApproval,
  type ApprovalPayee,
  type AgentBook,
  type AgentKey,
  type AgentRules,
  type AgentSchedule,
  type AgentTopUp as AgentTopUpValue,
  type StatementLine,
  AgentBankError,
  agentBankApi,
  approvalNamedIn,
  formatULXC,
  limitText,
  parseLXC,
  refusalText,
} from './agentBankApi'

// AgentBank.tsx — B19.4: Agent Wallets (named so by B21.6). Each AI agent a workspace runs has a wallet of its own on
// Lens's double-entry ledger (B19.1): the workspace funds it and takes funds back, the agent spends
// only what it holds, and its statement is every posting against it. Its rules (B19.2) — limits per
// request, day and month, models, providers, active hours, and an amount above which a person must
// approve — are judged by Lens before a provider is called or a payment moves. What needed approval
// waits in the inbox here. Agents pay each other inside the workspace (B19.3).
//
// Lens decides everything: who may move money (the workspace's owner or an admin), whether a rule
// refuses, and what anything holds. This screen shows Lens's figures and, on a refusal, Lens's own
// sentence.

const BOOK_KEY = ['agent-book']
const APPROVALS_KEY = ['agent-approvals']
const rulesKey = (id: string) => ['agent-rules', id]
const statementKey = (id: string) => ['agent-statement', id]

/** A payment this screen sent that is waiting for its approval — sent again, once, when approved. */
interface HeldPayment {
  from: string
  to: string
  amount: number
  memo: string
}

const lxc = (micros: number) => <span className="font-figure">{formatULXC(micros)}</span>

function Note({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p role={ok ? 'status' : 'alert'} className="text-caption text-ink">
      {children}
    </p>
  )
}

function readFailure(err: unknown, what: string): string {
  return isSessionExpired(err) ? `${what} can’t be read until you sign in again.` : `${what} could not be read just now.`
}

function Totals({ book }: { book: AgentBook }) {
  return (
    <p className="text-body text-ink" data-testid="agent-bank-totals">
      The workspace holds {lxc(book.workspace_balance_ulxc)}: {lxc(book.allocated_ulxc)} with its agents and{' '}
      {lxc(book.unallocated_ulxc)} free to fund them. Its agents have spent {lxc(book.spent_ulxc)}.
    </p>
  )
}

/**
 * B19.20 — one switch that stops every agent (Lens B19.7): the next request, payment or hold of each is
 * refused before a provider is called, agents created later included. Starting them again leaves an
 * agent paused on its own still paused.
 */
function PauseEveryAgent({ book }: { book: AgentBook }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const change = useMutation({
    mutationFn: (pause: boolean) => (pause ? agentBankApi.pauseAll(reason.trim()) : agentBankApi.resumeAll()),
    onSuccess: () => setReason(''),
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  return (
    <div className="flex flex-col gap-2">
      {book.all_paused_at ? (
        <>
          <p role="status" className="text-body text-ink" data-testid="agents-all-paused">
            Every agent is paused{book.all_paused_reason ? ` — ${book.all_paused_reason}` : ''}. Lens refuses each one’s
            next request or payment until you start them again.
          </p>
          <div>
            <Button variant="primary" disabled={change.isPending} onClick={() => change.mutate(false)}>
              Start every agent again
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Why every agent is paused"
            placeholder="Reason (optional)"
            className="wide:w-56"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button disabled={change.isPending} onClick={() => change.mutate(true)}>
            Pause every agent
          </Button>
        </div>
      )}
      {change.isError ? <Note ok={false}>{refusalText(change.error)}</Note> : null}
    </div>
  )
}

/** B19.20 — pausing one agent (Lens B19.6): its every movement is refused until it is resumed. */
function PauseAgent({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const change = useMutation({
    mutationFn: (pause: boolean) => (pause ? agentBankApi.pause(agent.id, 'paused from Agent Wallets') : agentBankApi.resume(agent.id)),
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {agent.paused_at ? (
          <>
            <p className="text-body text-ink" data-testid="agent-paused">
              {agent.name} is paused{agent.paused_reason ? ` — ${agent.paused_reason}` : ''}.
            </p>
            <Button variant="primary" disabled={change.isPending} onClick={() => change.mutate(false)}>
              Resume {agent.name}
            </Button>
          </>
        ) : (
          <Button disabled={change.isPending} onClick={() => change.mutate(true)}>
            Pause {agent.name}
          </Button>
        )}
      </div>
      {change.isError ? <Note ok={false}>{refusalText(change.error)}</Note> : null}
    </div>
  )
}

/** B19.20 — this month's spend run on to its end (Lens B19.6), and the unusual-spend alerts. */
function Spending({ nameOf }: { nameOf: (id: string) => string }) {
  const forecast = useQuery({ queryKey: ['agent-forecast'], queryFn: agentBankApi.forecast })
  const alerts = useQuery({ queryKey: ['agent-alerts'], queryFn: agentBankApi.alerts })
  const list = alerts.data?.alerts ?? []
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>Month-end forecast</CardHeader>
        {forecast.isError ? (
          <p className="px-gutter py-3 text-body text-muted">{readFailure(forecast.error, 'The forecast')}</p>
        ) : forecast.isPending ? (
          <p className="px-gutter py-3 text-body text-muted">Reading…</p>
        ) : (
          <>
            {(forecast.data.agents ?? []).map((f) => (
              <Row key={f.agent_id} label={f.name} hint={<>Spent {lxc(f.spent_ulxc)} so far this month</>}>
                <span className="font-figure text-body text-ink">{formatULXC(f.forecast_ulxc)}</span>
              </Row>
            ))}
            <Row label="Every agent" hint={<>Spent {lxc(forecast.data.spent_ulxc)} so far; the pace so far, run to the month’s end</>}>
              <span className="font-figure text-body text-ink" data-testid="agents-forecast">
                {formatULXC(forecast.data.forecast_ulxc)}
              </span>
            </Row>
          </>
        )}
      </Card>
      <Card>
        <CardHeader>Unusual spend</CardHeader>
        {alerts.isError ? (
          <p className="px-gutter py-3 text-body text-muted">{readFailure(alerts.error, 'The alerts')}</p>
        ) : alerts.isPending ? (
          <p className="px-gutter py-3 text-body text-muted">Reading…</p>
        ) : list.length > 0 ? (
          list.slice(0, 10).map((a) => (
            <Row
              key={a.id}
              label={
                <>
                  {nameOf(a.agent_id)} spent {lxc(a.last_hour_ulxc)} in an hour
                </>
              }
              hint={
                <>
                  Usually {lxc(a.usual_per_hour_ulxc)} an hour · <span className="font-figure">{formatWhen(a.created_at)}</span>
                </>
              }
            >
              {a.paused ? <Pill status="parked">Paused it</Pill> : null}
            </Row>
          ))
        ) : (
          <p className="px-gutter py-3 text-body text-muted">
            No unusual spend. An alert appears here when Lens raises one. {alerts.data.rule}
          </p>
        )}
      </Card>
    </div>
  )
}

const SCHEDULES_KEY = ['agent-schedules']
const scheduleSelect = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`
const EVERY: readonly [AgentSchedule['every'], string][] = [
  ['hour', 'every hour'],
  ['day', 'every day'],
  ['week', 'every week'],
  ['month', 'every month'],
]
const everyText = (e: AgentSchedule['every']) => EVERY.find(([v]) => v === e)?.[1] ?? e

/** B19.21 — one schedule's ticks, newest first: paid, or refused and why. */
function ScheduleRuns({ sid }: { sid: string }) {
  const runs = useQuery({ queryKey: ['agent-schedule-runs', sid], queryFn: () => agentBankApi.scheduleRuns(sid) })
  if (runs.isError) return <p className="px-gutter py-2 text-caption text-muted">{readFailure(runs.error, 'Its runs')}</p>
  if (runs.isPending) return <p className="px-gutter py-2 text-caption text-muted">Reading…</p>
  const list = runs.data.runs ?? []
  return list.length > 0 ? (
    <>
      {list.slice(0, 10).map((r) => (
        <Row key={r.tick_at} className="pl-8" label={<span className="font-figure">{formatWhen(r.tick_at)}</span>} hint={r.detail || undefined}>
          <Pill status={r.outcome === 'paid' ? 'settled' : 'slashed'}>{r.outcome === 'paid' ? 'Paid' : 'Refused'}</Pill>
        </Row>
      ))}
    </>
  ) : (
    <p className="px-gutter py-2 pl-8 text-caption text-muted">It has not run yet.</p>
  )
}

/**
 * B19.21 — the agent pays another agent, or a marketplace listing, every hour, day, week or month
 * (Lens B19.8, B19.17). Lens runs each tick once, judged by the payer's rules; a refused tick is kept
 * with its reason.
 */
function Schedules({ agent, agents, nameOf }: { agent: Agent; agents: Agent[]; nameOf: (id: string) => string }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: SCHEDULES_KEY, queryFn: agentBankApi.schedules })
  const catalog = useQuery({ queryKey: [...CATALOG_KEY, ''], queryFn: () => marketApi.catalog('') })
  const others = agents.filter((a) => a.id !== agent.id)
  const listings = catalog.data ?? []
  const [payee, setPayee] = useState('')
  const [amount, setAmount] = useState('')
  const [every, setEvery] = useState<AgentSchedule['every']>('week')
  const [memo, setMemo] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const toListing = payee.startsWith('listing:')
  // To a listing an amount is the most a tick pays, and empty means its price at the time.
  const micros = toListing && amount.trim() === '' ? 0 : parseLXC(amount)
  const invalidate = () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY })
  const create = useMutation({
    mutationFn: () =>
      agentBankApi.schedule(agent.id, {
        to_agent_id: toListing ? '' : payee.slice('agent:'.length),
        to_listing_id: toListing ? payee.slice('listing:'.length) : '',
        amount_ulxc: micros ?? 0,
        memo: memo.trim(),
        every,
      }),
    onSuccess: () => {
      setAmount('')
      setMemo('')
    },
    onSettled: invalidate,
  })
  const stop = useMutation({ mutationFn: (sid: string) => agentBankApi.stopSchedule(sid), onSettled: invalidate })
  const mine = (list.data?.schedules ?? []).filter((sc) => sc.from_agent_id === agent.id && sc.active)
  const payeeOf = (sc: AgentSchedule) =>
    sc.to_listing_id ? (listings.find((l) => l.id === sc.to_listing_id)?.title ?? 'a marketplace listing') : nameOf(sc.to_agent_id)
  return (
    <Card>
      <CardHeader>Scheduled payments</CardHeader>
      {list.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(list.error, 'Its schedules')}</p>
      ) : list.isPending ? (
        <p className="px-gutter py-3 text-body text-muted">Reading…</p>
      ) : mine.length > 0 ? (
        mine.map((sc) => (
          <div key={sc.id}>
            <Row
              label={
                <>
                  Pays {payeeOf(sc)} {sc.to_listing_id && sc.amount_ulxc === 0 ? 'its price' : lxc(sc.amount_ulxc)} {everyText(sc.every)}
                </>
              }
              hint={
                <>
                  Next <span className="font-figure">{formatWhen(sc.next_run_at)}</span>
                  {sc.memo ? ` · ${sc.memo}` : ''}
                </>
              }
            >
              <Button aria-pressed={shown === sc.id} onClick={() => setShown(shown === sc.id ? null : sc.id)}>
                Runs
              </Button>
              <Button disabled={stop.isPending} onClick={() => stop.mutate(sc.id)}>
                Stop
              </Button>
            </Row>
            {shown === sc.id ? <ScheduleRuns sid={sc.id} /> : null}
          </div>
        ))
      ) : (
        <p className="px-gutter py-3 text-body text-muted">{agent.name} pays nothing on a schedule.</p>
      )}
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (payee !== '' && micros !== null && !create.isPending) create.mutate()
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Who ${agent.name} pays on a schedule`}
            className={`${scheduleSelect} w-56`}
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
          >
            <option value="">Pay…</option>
            {others.map((a) => (
              <option key={a.id} value={`agent:${a.id}`}>
                {a.name}
              </option>
            ))}
            {listings.map((l) => (
              <option key={l.id} value={`listing:${l.id}`}>
                {l.title} (marketplace)
              </option>
            ))}
          </select>
          <Input
            aria-label={`Scheduled amount in LXC for ${agent.name}`}
            inputMode="decimal"
            placeholder={toListing ? 'At most — its price' : 'LXC'}
            className="w-32 font-figure"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <select
            aria-label={`How often ${agent.name} pays`}
            className={`${scheduleSelect} w-36`}
            value={every}
            onChange={(e) => setEvery(e.target.value as AgentSchedule['every'])}
          >
            {EVERY.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <Input
            aria-label={`Memo for ${agent.name}’s scheduled payment`}
            placeholder="Memo"
            className="wide:w-40"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={payee === '' || micros === null || create.isPending}>
            Schedule
          </Button>
        </div>
        {create.isError ? <Note ok={false}>{refusalText(create.error)}</Note> : null}
        {stop.isError ? <Note ok={false}>{refusalText(stop.error)}</Note> : null}
      </form>
    </Card>
  )
}

/** B19.21 — below one balance, the workspace tops the agent back up to another (Lens B19.8), once per dip. */
function AgentTopUpCard({ agent }: { agent: Agent }) {
  const topUp = useQuery({ queryKey: ['agent-topup', agent.id], queryFn: () => agentBankApi.topUp(agent.id) })
  return (
    <Card>
      <CardHeader>Automatic top-up</CardHeader>
      {topUp.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(topUp.error, 'Its top-up')}</p>
      ) : topUp.isPending ? (
        <p className="px-gutter py-3 text-body text-muted">Reading…</p>
      ) : (
        <TopUpForm key={topUp.dataUpdatedAt} agent={agent} current={topUp.data} />
      )}
    </Card>
  )
}

function TopUpForm({ agent, current }: { agent: Agent; current: AgentTopUpValue | null }) {
  const qc = useQueryClient()
  const [below, setBelow] = useState(current ? limitText(current.below_ulxc) : '')
  const [to, setTo] = useState(current ? limitText(current.to_ulxc) : '')
  const belowMicros = parseLXC(below)
  const toMicros = parseLXC(to)
  const refresh = () => qc.invalidateQueries({ queryKey: ['agent-topup', agent.id] })
  const save = useMutation({ mutationFn: () => agentBankApi.setTopUp(agent.id, belowMicros ?? 0, toMicros ?? 0), onSettled: refresh })
  const remove = useMutation({ mutationFn: () => agentBankApi.removeTopUp(agent.id), onSettled: refresh })
  return (
    <form
      className="flex flex-col gap-2 px-gutter py-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (belowMicros !== null && toMicros !== null && !save.isPending) save.mutate()
      }}
    >
      <p className="text-body text-ink" data-testid="agent-topup">
        {current ? (
          <>
            When {agent.name} holds less than {lxc(current.below_ulxc)}, the workspace tops it up to {lxc(current.to_ulxc)}.
          </>
        ) : (
          `${agent.name} is not topped up automatically.`
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Top ${agent.name} up below, in LXC`}
          inputMode="decimal"
          placeholder="Below LXC"
          className="w-28 font-figure"
          value={below}
          onChange={(e) => setBelow(e.target.value)}
        />
        <Input
          aria-label={`Top ${agent.name} up to, in LXC`}
          inputMode="decimal"
          placeholder="Up to LXC"
          className="w-28 font-figure"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={belowMicros === null || toMicros === null || save.isPending}>
          {current ? 'Change top-up' : 'Set top-up'}
        </Button>
        {current ? (
          <Button type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        ) : null}
      </div>
      {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
      {remove.isError ? <Note ok={false}>{refusalText(remove.error)}</Note> : null}
    </form>
  )
}

function CreateAgent({ onCreated }: { onCreated: (a: Agent) => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => agentBankApi.create(name.trim()),
    onSuccess: (a) => {
      setName('')
      onCreated(a)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() !== '' && !create.isPending) create.mutate()
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          aria-label="New agent name"
          placeholder="Agent name"
          className="min-w-0 flex-1 wide:w-56 wide:flex-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={name.trim() === '' || create.isPending}>
          {create.isPending ? 'Creating…' : 'Create agent'}
        </Button>
      </div>
      {create.isError ? <Note ok={false}>{refusalText(create.error)}</Note> : null}
    </form>
  )
}

function AgentList({ agents, selected, onSelect }: { agents: Agent[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <Card>
      <CardHeader>Agents</CardHeader>
      {agents.map((a) => (
        <Row
          key={a.id}
          label={a.name}
          hint={
            <>
              Spent {lxc(a.spent_ulxc)} · <span className="font-figure">{a.keys.length}</span>{' '}
              {a.keys.length === 1 ? 'key' : 'keys'}
            </>
          }
        >
          <div className="flex items-center gap-3">
            {a.paused_at ? <Pill status="parked">Paused</Pill> : null}
            {a.owner_user_id === '' ? <Pill status="held">No owner</Pill> : a.verified ? <Pill status="settled">Verified</Pill> : null}
            <span className="font-figure text-body text-ink" data-testid={`agent-balance-${a.id}`}>
              {formatULXC(a.balance_ulxc)}
            </span>
            <Button aria-pressed={selected === a.id} onClick={() => onSelect(a.id)}>
              {selected === a.id ? 'Open' : 'Manage'}
            </Button>
          </div>
        </Row>
      ))}
    </Card>
  )
}

function Money({ agent, book }: { agent: Agent; book: AgentBook }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const micros = parseLXC(amount)
  const move = useMutation({
    mutationFn: (dir: 'fund' | 'withdraw') =>
      dir === 'fund' ? agentBankApi.fund(agent.id, micros ?? 0) : agentBankApi.withdraw(agent.id, micros ?? 0),
    onSuccess: () => setAmount(''),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: statementKey(agent.id) }),
      ]),
  })
  // B19.23 — Lens B19.11 gives an agent with no owner no balance, so it is claimed before it is funded.
  const claim = useMutation({
    mutationFn: () => agentBankApi.claim(agent.id),
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  const busy = move.isPending || micros === null
  if (agent.owner_user_id === '') {
    return (
      <Card>
        <CardHeader>Money</CardHeader>
        <div className="flex flex-col gap-2 px-gutter py-3">
          <p className="text-body text-ink" data-testid="agent-ownerless">
            {agent.name} has no owner, so it cannot be funded: Lens gives an agent a balance, a top-up or a payment
            only once a person of this workspace owns it. Claim it to become its owner.
          </p>
          <div>
            <Button variant="primary" disabled={claim.isPending} onClick={() => claim.mutate()}>
              Claim {agent.name}
            </Button>
          </div>
          {claim.isError ? <Note ok={false}>{refusalText(claim.error)}</Note> : null}
        </div>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>Money</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        <p className="text-body text-ink">
          {agent.name} holds {lxc(agent.balance_ulxc)}. The workspace has {lxc(book.unallocated_ulxc)} free to fund it.
        </p>
        {claim.isSuccess && claim.data.agent_id === agent.id ? <Note ok>You own {agent.name} now. Fund it here.</Note> : null}
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Amount in LXC for ${agent.name}`}
            inputMode="decimal"
            placeholder="LXC"
            className="w-28 font-figure"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button variant="primary" disabled={busy} onClick={() => move.mutate('fund')}>
            Fund
          </Button>
          <Button disabled={busy} onClick={() => move.mutate('withdraw')}>
            Take back
          </Button>
        </div>
        {/* Said only while it is still true: a payment or a request moves the balance after it. */}
        {move.isSuccess && move.data.balance_ulxc === agent.balance_ulxc ? (
          <Note ok>
            {agent.name} now holds {lxc(move.data.balance_ulxc)}.
          </Note>
        ) : null}
        {move.isError ? <Note ok={false}>{refusalText(move.error)}</Note> : null}
      </div>
    </Card>
  )
}

/**
 * B19.23 — whether the agent's owner is verified (Lens B19.11). Lens knows a person only as their
 * workspace, so the badge is this workspace's verification: a completed card purchase, or Talyvor's vouch.
 */
function Ownership({ agent }: { agent: Agent }) {
  if (agent.owner_user_id === undefined) return null
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="agent-ownership">
      {agent.owner_user_id === '' ? (
        <>
          <Pill status="held">No owner</Pill>
          <span className="text-caption text-muted">Nobody owns {agent.name} yet — claim it under Money.</span>
        </>
      ) : agent.verified ? (
        <>
          <Pill status="settled">Verified</Pill>
          <span className="text-caption text-muted">
            Its owner is verified: this workspace has bought LXC with a card, or Talyvor vouches for it.
          </span>
        </>
      ) : (
        <>
          <Pill status="idle">Not verified</Pill>
          <span className="text-caption text-muted">
            {agent.name} has an owner who is not verified yet. Buying LXC with a card on Billing verifies this
            workspace, and every agent in it with an owner.
          </span>
        </>
      )}
    </div>
  )
}

const LIMITS = [
  ['max_per_request_ulxc', 'Limit per request'],
  ['daily_limit_ulxc', 'Daily limit'],
  ['monthly_limit_ulxc', 'Monthly limit'],
  ['approval_above_ulxc', 'Ask a person above'],
] as const

type LimitField = (typeof LIMITS)[number][0]

function RulesForm({ agent, rules }: { agent: Agent; rules: AgentRules }) {
  const qc = useQueryClient()
  const [limits, setLimits] = useState<Record<LimitField, string>>(() => ({
    max_per_request_ulxc: limitText(rules.max_per_request_ulxc),
    daily_limit_ulxc: limitText(rules.daily_limit_ulxc),
    monthly_limit_ulxc: limitText(rules.monthly_limit_ulxc),
    approval_above_ulxc: limitText(rules.approval_above_ulxc),
  }))
  const [models, setModels] = useState((rules.allowed_models ?? []).join(', '))
  const [providers, setProviders] = useState((rules.allowed_providers ?? []).join(', '))
  const [listings, setListings] = useState<string[]>(rules.allowed_listings ?? [])
  const [pauseOnUnusual, setPauseOnUnusual] = useState(rules.pause_on_unusual_spend ?? false)
  const [from, setFrom] = useState(rules.active_from)
  const [until, setUntil] = useState(rules.active_until)
  const [timezone, setTimezone] = useState(rules.timezone)
  const bad = LIMITS.some(([f]) => limits[f].trim() !== '' && parseLXC(limits[f]) === null)
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const save = useMutation({
    mutationFn: () =>
      agentBankApi.setRules(agent.id, {
        max_per_request_ulxc: parseLXC(limits.max_per_request_ulxc) ?? 0,
        daily_limit_ulxc: parseLXC(limits.daily_limit_ulxc) ?? 0,
        monthly_limit_ulxc: parseLXC(limits.monthly_limit_ulxc) ?? 0,
        approval_above_ulxc: parseLXC(limits.approval_above_ulxc) ?? 0,
        allowed_models: list(models),
        allowed_providers: list(providers),
        allowed_listings: listings,
        active_from: from.trim(),
        active_until: until.trim(),
        timezone: timezone.trim(),
        pause_on_unusual_spend: pauseOnUnusual,
      }),
    onSuccess: (saved) => qc.setQueryData(rulesKey(agent.id), saved),
  })
  const text = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <Row label={label}>
      <Input
        aria-label={`${label} for ${agent.name}`}
        placeholder={placeholder}
        className="w-56"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </Row>
  )
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!bad && !save.isPending) save.mutate()
      }}
    >
      {LIMITS.map(([field, label]) => (
        <Row key={field} label={label} hint="LXC; empty for no limit">
          <Input
            aria-label={`${label} for ${agent.name}, in LXC`}
            inputMode="decimal"
            placeholder="No limit"
            className="w-28 font-figure"
            value={limits[field]}
            onChange={(e) => setLimits({ ...limits, [field]: e.target.value })}
          />
        </Row>
      ))}
      {text('Allowed models', models, setModels, 'Any model')}
      {text('Allowed providers', providers, setProviders, 'Any provider')}
      <ListingsPicker agent={agent} chosen={listings} onChange={setListings} />
      <Row label="Pause on unusual spend" hint="An unusual-spend alert also pauses this agent until you resume it">
        <Button
          type="button"
          aria-label={`Pause ${agent.name} on unusual spend`}
          aria-pressed={pauseOnUnusual}
          variant={pauseOnUnusual ? 'primary' : undefined}
          onClick={() => setPauseOnUnusual((on) => !on)}
        >
          {pauseOnUnusual ? 'On' : 'Off'}
        </Button>
      </Row>
      {text('Active from', from, setFrom, 'HH:MM — any time')}
      {text('Active until', until, setUntil, 'HH:MM')}
      {text('Time zone', timezone, setTimezone, 'UTC')}
      <div className="flex flex-col gap-2 px-gutter py-3">
        <div>
          <Button type="submit" variant="primary" disabled={bad || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save rules'}
          </Button>
        </div>
        {bad ? <Note ok={false}>A limit is an amount of LXC with at most six decimals, or empty.</Note> : null}
        {save.isSuccess ? <Note ok>Saved. Lens applies these rules to the next request or payment.</Note> : null}
        {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
      </div>
    </form>
  )
}

/**
 * B19.19 — the marketplace listings an agent may use (Lens B19.14). None chosen allows any; once one
 * is, Lens refuses the agent's use of every other listing before a model is called. The choices are
 * the public catalog, plus any listing the rules already name that the catalog does not show (unlisted,
 * private, or withdrawn) — kept, by its id, so saving the other rules never drops it.
 */
function ListingsPicker({ agent, chosen, onChange }: { agent: Agent; chosen: string[]; onChange: (ids: string[]) => void }) {
  const catalog = useQuery({ queryKey: [...CATALOG_KEY, ''], queryFn: () => marketApi.catalog('') })
  const listed = (catalog.data ?? []).map((l) => ({ id: l.id, title: l.title, hint: `${kindLabel(l.kind)} · ${priceText(l.price_per_use_ulxc)}` }))
  const named = chosen
    .filter((id) => !listed.some((l) => l.id === id))
    .map((id) => ({ id, title: id, hint: 'Not in the public catalog' }))
  const toggle = (id: string, on: boolean) => onChange(on ? [...chosen, id] : chosen.filter((x) => x !== id))
  return (
    <>
      <Row
        label="Marketplace listings"
        hint={
          catalog.isError
            ? 'The marketplace could not be read just now; the listings already chosen are kept.'
            : chosen.length > 0
              ? 'Only the listings marked Allowed — Lens refuses any other.'
              : 'Any listing. Mark some Allowed to allow only those.'
        }
      />
      {[...listed, ...named].map((l) => (
        <Row key={l.id} label={l.title} hint={l.hint} className="pl-8">
          <Button
            type="button"
            aria-label={`${agent.name} may use ${l.title}`}
            aria-pressed={chosen.includes(l.id)}
            variant={chosen.includes(l.id) ? 'primary' : undefined}
            onClick={() => toggle(l.id, !chosen.includes(l.id))}
          >
            Allowed
          </Button>
        </Row>
      ))}
    </>
  )
}

function Rules({ agent }: { agent: Agent }) {
  const rules = useQuery({ queryKey: rulesKey(agent.id), queryFn: () => agentBankApi.rules(agent.id) })
  return (
    <Card>
      <CardHeader>Rules</CardHeader>
      {rules.isSuccess ? (
        <RulesForm key={agent.id} agent={agent} rules={rules.data} />
      ) : (
        <p className="px-gutter py-3 text-body text-muted">
          {rules.isError ? readFailure(rules.error, 'This agent’s rules') : 'Reading…'}
        </p>
      )}
    </Card>
  )
}

function Pay({
  agent,
  agents,
  waiting,
  onHeld,
}: {
  agent: Agent
  agents: Agent[]
  waiting: Record<string, HeldPayment>
  onHeld: (approvalID: string, p: HeldPayment) => void
}) {
  const qc = useQueryClient()
  const others = agents.filter((a) => a.id !== agent.id)
  const [to, setTo] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const micros = parseLXC(amount)
  const payee = others.find((a) => a.id === to) ?? null
  const pay = useMutation({
    mutationFn: () => agentBankApi.pay(agent.id, payee?.id ?? '', micros ?? 0, memo.trim()),
    onSuccess: () => {
      setAmount('')
      setMemo('')
    },
    onError: (err) => {
      const approval = approvalNamedIn(err)
      if (approval && payee && micros !== null) onHeld(approval, { from: agent.id, to: payee.id, amount: micros, memo: memo.trim() })
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: APPROVALS_KEY }),
        qc.invalidateQueries({ queryKey: statementKey(agent.id) }),
      ]),
  })
  const held = approvalNamedIn(pay.error)
  // Once its approval sent the payment, Approvals says so and this refusal is no longer true.
  const settled = held !== null && !(held in waiting)
  return (
    <Card>
      <CardHeader>Pay another agent</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (payee && micros !== null && !pay.isPending) pay.mutate()
        }}
      >
        <p className="text-body text-muted">
          Judged by {agent.name}’s rules, like any request it makes. It stays inside this workspace.
        </p>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Pay to">
          {others.map((a) => (
            <Button key={a.id} aria-pressed={to === a.id} variant={to === a.id ? 'primary' : 'default'} onClick={() => setTo(a.id)}>
              {a.name}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={`Payment in LXC from ${agent.name}`}
            inputMode="decimal"
            placeholder="LXC"
            className="w-28 font-figure"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input
            aria-label="What the payment is for"
            placeholder="What it is for"
            className="wide:w-56"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={!payee || micros === null || pay.isPending}>
            {pay.isPending ? 'Paying…' : 'Pay'}
          </Button>
        </div>
        {pay.isSuccess ? (
          <Note ok>
            Paid {lxc(pay.data.amount_ulxc)} to {payee?.name ?? 'the agent'}. {agent.name} now holds{' '}
            {lxc(pay.data.from_balance_ulxc)}.
          </Note>
        ) : null}
        {pay.isError && !settled ? (
          <Note ok={false}>
            Refused. {refusalText(pay.error)}
            {held ? ' It is waiting in Approvals; approve it there and this payment is sent.' : ''}
          </Note>
        ) : null}
      </form>
    </Card>
  )
}

function IssueKey({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [issued, setIssued] = useState<AgentKey | null>(null)
  const issue = useMutation({
    mutationFn: () => agentBankApi.issueKey(agent.id, agent.name),
    onSuccess: (k) => setIssued(k), // held in local state only; rendered once
  })
  if (issued) {
    return (
      <RevealOnce
        title={`${agent.name}’s key — shown once`}
        secret={issued.key}
        copyLabel="Copy key"
        identifier={issued.prefix}
        identifierNote="Safe to share; this is how the key appears in lists."
        onDone={() => {
          setIssued(null)
          issue.reset()
          void qc.invalidateQueries({ queryKey: BOOK_KEY })
        }}
      />
    )
  }
  return (
    <Card>
      <CardHeader>Key</CardHeader>
      <Row label="Issue a key" hint="A proxy key that spends only this agent’s balance, under its rules; shown once">
        <Button disabled={issue.isPending} onClick={() => issue.mutate()}>
          {issue.isPending ? 'Issuing…' : 'Issue a key'}
        </Button>
      </Row>
      {issue.isError ? (
        <div className="px-gutter py-2">
          <Note ok={false}>{refusalText(issue.error)}</Note>
        </div>
      ) : null}
    </Card>
  )
}

function lineText(l: StatementLine, nameOf: (id: string) => string): string {
  switch (l.kind) {
    case 'fund':
      return 'Funded by the workspace'
    case 'withdraw':
      return 'Taken back by the workspace'
    case 'pay': {
      const other = l.counterparty.startsWith('agent:') ? nameOf(l.counterparty.slice(6)) : 'another agent'
      const what = l.amount_ulxc < 0 ? `Paid ${other}` : `Received from ${other}`
      return l.ref ? `${what} — ${l.ref}` : what
    }
    case 'hold':
      return 'Held for a request'
    case 'release':
      return 'Released after a request'
    case 'settle':
      return 'Settled a request'
    default:
      return 'Spent on a request'
  }
}

function Statement({ agent, nameOf }: { agent: Agent; nameOf: (id: string) => string }) {
  const st = useQuery({ queryKey: statementKey(agent.id), queryFn: () => agentBankApi.statement(agent.id) })
  const lines = st.data?.lines ?? []
  return (
    <Card>
      <CardHeader>Statement</CardHeader>
      {st.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(st.error, 'This agent’s statement')}</p>
      ) : st.isPending ? (
        <p className="px-gutter py-3 text-body text-muted">Reading…</p>
      ) : lines.length === 0 ? (
        <p className="px-gutter py-3 text-body text-muted">Nothing has moved in this wallet yet. Fund it under Money to start.</p>
      ) : (
        <table className="w-full text-body" data-testid="agent-statement">
          <thead>
            <tr className="text-left text-caption text-muted">
              <th className="px-gutter py-2 font-normal">When</th>
              <th className="py-2 font-normal">What</th>
              <th className="py-2 text-right font-normal">Amount</th>
              <th className="px-gutter py-2 text-right font-normal">Balance</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.entry_id}-${l.kind}`} className="border-t border-rule text-ink">
                <td className="px-gutter py-2 font-figure text-caption text-muted">{formatWhen(l.at)}</td>
                <td className="py-2">{lineText(l, nameOf)}</td>
                <td className="py-2 text-right font-figure">
                  {l.amount_ulxc > 0 ? '+' : '−'}
                  {formatULXC(Math.abs(l.amount_ulxc))}
                </td>
                <td className="px-gutter py-2 text-right font-figure">{formatULXC(l.balance_after_ulxc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="border-t border-rule">
        <StatementDownload key={`statement-${agent.id}`} agent={agent} />
      </div>
    </Card>
  )
}

/** A UTC day as YYYY-MM-DD, the form Lens reads a statement's dates in. */
const utcDay = (d: Date) => d.toISOString().slice(0, 10)

/** Last month, or this month so far, as its first and last UTC day. */
function monthPeriod(which: 'last' | 'this', now = new Date()): { from: string; through: string } {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  return which === 'last'
    ? { from: utcDay(new Date(Date.UTC(y, m - 1, 1))), through: utcDay(new Date(Date.UTC(y, m, 0))) }
    : { from: utcDay(new Date(Date.UTC(y, m, 1))), through: utcDay(now) }
}

/** The day after a YYYY-MM-DD day: Lens's period ends before `to`, and the screen names the last day it covers. */
function dayAfter(d: string): string {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return utcDay(t)
}

function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * B19.22 — a statement for any period as a file an auditor can open: one agent's account, or with no
 * agent every wallet in the workspace. Lens builds it (B19.5): each account's opening balance, every line
 * naming its posting and entry, and each account's closing balance. Days are whole UTC days, the last
 * one included.
 */
function StatementDownload({ agent }: { agent: Agent | null }) {
  const [period, setPeriod] = useState(() => monthPeriod('last'))
  const [format, setFormat] = useState<'csv' | 'json'>('csv')
  const who = agent ? `${agent.name}’s` : 'every agent’s'
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(period.from) && /^\d{4}-\d{2}-\d{2}$/.test(period.through) && period.from <= period.through
  const get = useMutation({
    mutationFn: async () => {
      const stem = agent ? agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent' : 'agent-wallets'
      const name = `${stem}-statement-${period.from}-to-${period.through}.${format}`
      saveFile(name, await agentBankApi.statementFile(agent?.id ?? null, period.from, dayAfter(period.through), format))
      return name
    },
  })
  return (
    <form
      className="flex flex-col gap-2 px-gutter py-3"
      data-testid={agent ? 'agent-statement-download' : 'bank-statement-download'}
      onSubmit={(e) => {
        e.preventDefault()
        if (valid && !get.isPending) get.mutate()
      }}
    >
      <p className="text-caption text-muted">
        Download {who} statement for a period: the opening balance, every movement with its posting and entry, and the
        closing balance. Days are UTC; the last day is included.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setPeriod(monthPeriod('last'))}>
          Last month
        </Button>
        <Button type="button" onClick={() => setPeriod(monthPeriod('this'))}>
          This month
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          aria-label={`First day of ${who} statement`}
          className="w-40 font-figure"
          value={period.from}
          onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
        />
        <span className="text-caption text-muted">to</span>
        <Input
          type="date"
          aria-label={`Last day of ${who} statement`}
          className="w-40 font-figure"
          value={period.through}
          onChange={(e) => setPeriod((p) => ({ ...p, through: e.target.value }))}
        />
        <select
          aria-label={`File type of ${who} statement`}
          className={`${scheduleSelect} w-24`}
          value={format}
          onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}
        >
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
        </select>
        <Button type="submit" variant="primary" disabled={!valid || get.isPending}>
          {get.isPending ? 'Preparing…' : 'Download'}
        </Button>
      </div>
      {!valid ? <Note ok={false}>Choose a first day on or before the last day.</Note> : null}
      {get.isSuccess ? <Note ok>Saved {get.data}.</Note> : null}
      {get.isError ? (
        <Note ok={false}>
          {get.error instanceof AgentBankError && get.error.status < 500
            ? refusalText(get.error)
            : readFailure(get.error, 'The statement')}
        </Note>
      ) : null}
    </form>
  )
}

const PAYEE_KIND: Record<ApprovalPayee['kind'], string> = {
  agent: 'an agent',
  listing: 'a marketplace listing',
  company: 'a company',
  merchant: 'a card merchant',
}

const DECIDED: Record<AgentApproval['status'], { status: PillStatus; label: string }> = {
  pending: { status: 'held', label: 'Waiting' },
  approved: { status: 'settled', label: 'Approved' },
  used: { status: 'settled', label: 'Approved and used' },
  denied: { status: 'slashed', label: 'Denied' },
}

const PASSKEYS_KEY = ['agent-passkeys']

/** What went wrong on this device, in words: Lens's sentence, a cancelled prompt, or our own message. */
function deviceText(err: unknown, fallback: string): string {
  if (err instanceof AgentBankError) return refusalText(err)
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Cancelled — nothing changed.'
  if (err instanceof DOMException && err.name === 'NotSupportedError') return fallback
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * B19.10 — the phone half: a passkey made here signs every approval from now on, and this device can
 * be told when one is filed. Lens keeps both (B19.16); nothing is kept in the browser but the passkey.
 */
function FaceID({ signed, passkeyCount }: { signed: boolean; passkeyCount: number }) {
  const qc = useQueryClient()
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
  const register = useMutation({
    mutationFn: () => registerThisDevice(navigator.userAgent.includes('iPhone') ? 'iPhone' : 'This device'),
    onSuccess: () => setSaid({ ok: true, text: 'This device now signs approvals. Face ID asks each time you approve or deny.' }),
    onError: (err) => setSaid({ ok: false, text: deviceText(err, 'No passkey was made.') }),
    onSettled: () => qc.invalidateQueries({ queryKey: PASSKEYS_KEY }),
  })
  const notify = useMutation({
    mutationFn: notifyThisDevice,
    onSuccess: () => setSaid({ ok: true, text: 'This device is told when an agent asks for approval.' }),
    onError: (err) => setSaid({ ok: false, text: deviceText(err, 'Notifications could not be turned on.') }),
  })
  return (
    <Card>
      <CardHeader>Face ID and notifications</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        <p className="text-body text-muted">
          {signed
            ? `Approvals are signed with a passkey (${passkeyCount} registered). Nothing is approved without one.`
            : 'Approvals are not signed yet. Make a passkey on your phone and every approval asks for Face ID.'}
        </p>
        {said ? <Note ok={said.ok}>{said.text}</Note> : null}
        <div className="flex flex-col gap-2 wide:flex-row">
          {passkeysSupported() ? (
            <Button className="h-12 wide:h-8" disabled={register.isPending} onClick={() => register.mutate()}>
              {signed ? 'Add this device' : 'Approve with Face ID from now on'}
            </Button>
          ) : (
            <p className="text-caption text-muted">This browser cannot make a passkey.</p>
          )}
          {pushSupported() ? (
            <Button className="h-12 wide:h-8" disabled={notify.isPending} onClick={() => notify.mutate()}>
              Notify this device
            </Button>
          ) : (
            <p className="text-caption text-muted">
              To be told on an iPhone, add Talyvor to the Home Screen (Share, then Add to Home Screen) and open it from there.
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}

function Approvals({
  nameOf,
  held,
  onSent,
}: {
  nameOf: (id: string) => string
  held: Record<string, HeldPayment>
  onSent: (approvalID: string) => void
}) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals })
  const keys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: agentBankApi.passkeys })
  const signed = (keys.data?.passkeys ?? []).length > 0
  const [outcome, setOutcome] = useState<{ ok: boolean; text: React.ReactNode } | null>(null)
  const decide = useMutation({
    mutationFn: async ({ a, decision }: { a: AgentApproval; decision: 'approve' | 'deny' }) => {
      // B19.10: once the workspace has a passkey, Lens takes a decision only signed with one — Face ID
      // (or Touch ID, or the device's PIN) asks here, over a challenge naming this approval alone.
      await agentBankApi.decide(a.id, decision, signed ? await signApproval(a.id) : undefined)
      const p = held[a.id]
      if (decision === 'deny') return { ok: true, text: <>Denied. {nameOf(a.agent_id)}’s request will be refused.</> }
      if (!p) {
        return {
          ok: true,
          text: <>Approved. {nameOf(a.agent_id)}’s next identical request goes through, once.</>,
        }
      }
      // The payment this screen sent, sent again: Lens lets it through once against this approval.
      const paid = await agentBankApi.pay(p.from, p.to, p.amount, p.memo)
      onSent(a.id)
      return {
        ok: true,
        text: (
          <>
            Approved and paid {lxc(paid.amount_ulxc)} from {nameOf(p.from)} to {nameOf(p.to)}.
          </>
        ),
      }
    },
    onSuccess: setOutcome,
    onError: (err) => setOutcome({ ok: false, text: refusalText(err) }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: APPROVALS_KEY }),
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: ['agent-statement'] }),
      ]),
  })
  const all = list.data?.approvals ?? []
  const pending = all.filter((a) => a.status === 'pending')
  const decided = all.filter((a) => a.status !== 'pending').slice(0, 5)
  const what = (a: AgentApproval) =>
    a.reason ? a.reason : a.model ? `a request to ${a.model}` : a.payee ? `a payment to ${PAYEE_KIND[a.payee.kind] ?? 'an account'}` : 'a payment'
  // B23.10: a payment names who it pays and why (Lens B23.5), so the person approving sees the payee. The
  // sentence wraps where a Row label would clip: the payee and memo are what is being approved.
  const asks = (a: AgentApproval) =>
    a.payee ? (
      <span className="whitespace-normal">
        {nameOf(a.agent_id)} wants to pay {a.payee.name || a.payee.id} {lxc(a.amount_ulxc)}
        {a.memo ? ` — ${a.memo}` : ''}
      </span>
    ) : (
      <>
        {nameOf(a.agent_id)} · {lxc(a.amount_ulxc)}
      </>
    )
  return (
    <div className="flex flex-col gap-3">
      <FaceID signed={signed} passkeyCount={(keys.data?.passkeys ?? []).length} />
      {outcome ? <Note ok={outcome.ok}>{outcome.text}</Note> : null}
      {list.isError ? (
        <p className="text-body text-muted">{readFailure(list.error, 'The approvals')}</p>
      ) : list.isPending ? (
        <p className="text-body text-muted">Reading…</p>
      ) : (
        <Card>
          <CardHeader>Waiting for a person</CardHeader>
          {pending.length === 0 ? (
            <p className="px-gutter py-3 text-body text-muted">
              Nothing is waiting. A request or payment appears here when it is above an agent’s approval amount.
            </p>
          ) : (
            pending.map((a) => (
              <Row
                key={a.id}
                label={asks(a)}
                hint={
                  <>
                    {what(a)}, asked <span className="font-figure">{formatWhen(a.created_at)}</span>
                  </>
                }
              >
                {/* One-handed on a phone: two full-width buttons under the thumb; side by side on a wide screen. */}
                <div className="flex w-full items-center gap-2 wide:w-auto">
                  <Button
                    variant="primary"
                    className="h-12 flex-1 wide:h-8 wide:flex-none"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ a, decision: 'approve' })}
                  >
                    {signed ? 'Approve with Face ID' : 'Approve'}
                  </Button>
                  <Button
                    className="h-12 flex-1 wide:h-8 wide:flex-none"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ a, decision: 'deny' })}
                  >
                    Deny
                  </Button>
                </div>
              </Row>
            ))
          )}
          {decided.map((a) => (
            <Row key={a.id} label={asks(a)} hint={what(a)}
            >
              <Pill status={DECIDED[a.status].status}>{DECIDED[a.status].label}</Pill>
            </Row>
          ))}
        </Card>
      )}
    </div>
  )
}

export function AgentBank() {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const [chosen, setChosen] = useState<string | null>(null)
  const [held, setHeld] = useState<Record<string, HeldPayment>>({})
  const agents = book.data?.agents ?? []
  const agent = agents.find((a) => a.id === chosen) ?? agents[0] ?? null
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? 'an agent'
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Agent Wallets"
        heading="Each agent spends its own money, inside its own rules"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          Give every AI agent a wallet of its own. Fund it from the workspace, set what it may spend and when a
          person must approve, and read every movement on its statement. Lens checks the rules before a provider is
          called or a payment moves.
        </p>
        {book.isSuccess ? (
          <>
            <Totals book={book.data} />
            <PauseEveryAgent book={book.data} />
            {book.data.agents.length > 0 ? (
              <Card>
                <CardHeader>Statement for every agent</CardHeader>
                <StatementDownload agent={null} />
              </Card>
            ) : null}
          </>
        ) : (
          <p className="text-body text-muted">{book.isError ? readFailure(book.error, 'The agents') : 'Reading…'}</p>
        )}
      </Region>

      <Region index="01" label="Approvals">
        <Approvals
          nameOf={nameOf}
          held={held}
          onSent={(id) =>
            setHeld((h) => {
              const next = { ...h }
              delete next[id]
              return next
            })
          }
        />
      </Region>

      <Region index="02" label="Agents" className="flex flex-col gap-3">
        <CreateAgent onCreated={(a) => setChosen(a.id)} />
        {book.isError ? (
          <p className="text-body text-muted">{readFailure(book.error, 'The agents')}</p>
        ) : book.isSuccess && agents.length === 0 ? (
          <p className="text-body text-muted">No agents yet. Create one, then fund it and set its rules.</p>
        ) : agents.length > 0 ? (
          <AgentList agents={agents} selected={agent?.id ?? null} onSelect={setChosen} />
        ) : null}
      </Region>

      <Region index="03" label="Spending">
        <Spending nameOf={nameOf} />
      </Region>

      {agent && book.data ? (
        <Region index="04" label="Agent" className="flex flex-col gap-gutter">
          <p className="text-head text-ink" data-testid="agent-open">
            {agent.name}
          </p>
          <Ownership agent={agent} />
          <PauseAgent agent={agent} />
          <Money agent={agent} book={book.data} />
          <Rules key={`rules-${agent.id}`} agent={agent} />
          {agents.length > 1 ? (
            <Pay
              key={`pay-${agent.id}`}
              agent={agent}
              agents={agents}
              waiting={held}
              onHeld={(id, p) => setHeld((h) => ({ ...h, [id]: p }))}
            />
          ) : (
            <Card>
              <CardHeader>Pay another agent</CardHeader>
              <p className="px-gutter py-3 text-body text-muted">Create a second agent to pay it from this one.</p>
            </Card>
          )}
          <AgentAddress key={`address-${agent.id}`} agent={agent} />
          <SendAndRequest key={`send-${agent.id}`} agent={agent} />
          <AgentTransfers agent={agent} />
          <Schedules key={`schedules-${agent.id}`} agent={agent} agents={agents} nameOf={nameOf} />
          <RecurringTransfer key={`recurring-${agent.id}`} agent={agent} />
          <OfferLoan key={`loan-${agent.id}`} agent={agent} />
          <PayIntoEscrow key={`escrow-${agent.id}`} agent={agent} />
          <Pots key={`pots-${agent.id}`} agent={agent} />
          <Portfolios key={`portfolios-${agent.id}`} agent={agent} />
          <CashOutCard key={`cash-out-${agent.id}`} agent={agent} />
          <AgentTopUpCard key={`topup-${agent.id}`} agent={agent} />
          <IssueKey key={`key-${agent.id}`} agent={agent} />
          <AgentCardPanel key={`card-${agent.id}`} agent={agent} />
          <Statement agent={agent} nameOf={nameOf} />
        </Region>
      ) : null}

      {book.isSuccess ? (
        <Region index="05" label="Between owners" className="flex flex-col gap-gutter">
          <MoneyRequests agents={agents} />
          <CreditLinePanel />
          <Loans agents={agents} />
        </Region>
      ) : null}

      {book.isSuccess ? (
        <Region index="06" label="Held and cashed out" className="flex flex-col gap-gutter">
          <Escrows agents={agents} />
          <CashOuts agents={agents} />
        </Region>
      ) : null}
    </RegionScreen>
  )
}
