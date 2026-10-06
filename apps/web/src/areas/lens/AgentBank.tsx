import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Pill, RevealOnce, Row, focusRing, type PillStatus } from '@talyvor/ui'
import { Card, pressed } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { isSessionExpired } from '../../lib/productState'
import { formatWhen } from './format'
import { kindLabel, marketApi, priceText } from '../marketplace/marketApi'
import { CATALOG_KEY } from '../marketplace/parts'
import { notifyThisDevice, passkeysSupported, pushSupported, registerThisDevice, signApproval } from './passkeys'
import { AgentCardPanel } from './AgentCardPanel'
import { CurrencyPicker, Lxc } from './money'
import { ChoicePicker, ModelLimitsPicker, RulesInWords, TimePicker, TimeZonePicker, useRuleChoices } from './rulePickers'
import { RULE_TEMPLATES, type RuleTemplate } from './ruleTemplates'
import { AgentAddress, AgentTransfers, CreditLinePanel, Loans, MoneyRequests, OfferLoan, RecurringTransfer, SendAndRequest } from './WalletMoney'
import { CashOutCard, CashOuts, Escrows, PayIntoEscrow, Portfolios, Pots } from './WalletHoldings'
import {
  type Agent,
  type AgentApproval,
  type AgentArchive,
  type ApprovalPayee,
  type AgentBook,
  type AgentKey,
  type AgentRules,
  type AgentRulesVersion,
  type AgentRuleBoost,
  type AgentSchedule,
  type AgentTopUp as AgentTopUpValue,
  type StatementLine,
  AgentBankError,
  agentBankApi,
  approvalNamedIn,
  limitText,
  newMoveKey,
  parseLXC,
  refusalText,
  retryMoveThroughRestart,
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

// Exported because Home (B28.6) reads the same book, approvals and rules: one cache, so a change made
// on either screen is the figure the other shows.
export const BOOK_KEY = ['agent-book']
export const APPROVALS_KEY = ['agent-approvals']
export const rulesKey = (id: string) => ['agent-rules', id]
export const rulesHistoryKey = (id: string) => ['agent-rules-history', id]
export const boostsKey = (id: string) => ['agent-rule-boosts', id]
export const FORECAST_KEY = ['agent-forecast']
export const statementKey = (id: string) => ['agent-statement', id]

/** A payment this screen sent that is waiting for its approval — sent again, once, when approved. */
interface HeldPayment {
  from: string
  to: string
  amount: number
  memo: string
}

// B27.21: the figure in the figure face, the unit in the sentence's. A space inside the monospace span is a
// full digit wide, so "Payee 3 1 LXC" read with a double gap before LXC.
const lxc = (micros: number) => <Lxc ulxc={micros} />

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
export function PauseEveryAgent({ book }: { book: AgentBook }) {
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
            <Button disabled={change.isPending} onClick={() => change.mutate(false)}>
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
            <Button disabled={change.isPending} onClick={() => change.mutate(false)}>
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
  const forecast = useQuery({ queryKey: FORECAST_KEY, queryFn: agentBankApi.forecast })
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
                <span className="text-body text-ink">{lxc(f.forecast_ulxc)}</span>
              </Row>
            ))}
            <Row label="Every agent" hint={<>Spent {lxc(forecast.data.spent_ulxc)} so far; the pace so far, run to the month’s end</>}>
              <span className="font-figure text-body text-ink" data-testid="agents-forecast">
                {lxc(forecast.data.forecast_ulxc)}
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
          <Button type="submit" disabled={payee === '' || micros === null || create.isPending}>
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
        <Button type="submit" disabled={belowMicros === null || toMicros === null || save.isPending}>
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

/**
 * B28.305 — a new agent can start from a rule template: created, then its rules saved as the template, in
 * the one click. When Lens refuses the rules the agent still exists, so it opens and the note says so.
 */
function CreateAgent({ first = false, onCreated }: { first?: boolean; onCreated: (a: Agent) => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<RuleTemplate | null>(null)
  const create = useMutation({
    mutationFn: async () => {
      const a = await agentBankApi.create(name.trim())
      if (template === null) return { a, unsaved: null }
      try {
        qc.setQueryData(rulesKey(a.id), await agentBankApi.setRules(a.id, template.rules))
        return { a, unsaved: null }
      } catch (err) {
        return { a, unsaved: `${a.name} was created, but its ${template.name} rules were not saved: ${refusalText(err)} Set them on its Rules card.` }
      }
    },
    onSuccess: ({ a }) => {
      setName('')
      onCreated(a)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  const form = (
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
        <Button type="submit" disabled={name.trim() === '' || create.isPending}>
          {create.isPending ? 'Creating…' : 'Create agent'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Rules to start from">
        <span className="text-caption text-muted">Start from</span>
        {[null, ...RULE_TEMPLATES].map((t) => (
          <Button
            key={t?.id ?? 'none'}
            aria-pressed={template?.id === t?.id}
            className={pressed}
            onClick={() => setTemplate(t)}
          >
            {t?.name ?? 'No rules'}
          </Button>
        ))}
      </div>
      {template ? <p className="text-caption text-muted">{template.summary}</p> : null}
      {create.isError ? <Note ok={false}>{refusalText(create.error)}</Note> : null}
      {create.data?.unsaved ? <Note ok={false}>{create.data.unsaved}</Note> : null}
    </form>
  )
  // B28.271 — a workspace with no agents sees this one card. The same component stays mounted once the
  // agent exists, so a note about rules that were not saved survives the screen filling in.
  return first ? (
    <Card data-testid="agent-first">
      <CardHeader>Create your first agent</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        <p className="text-body text-muted">
          Name it and choose the rules it starts with. Then fund it and issue its key; its spending, approvals and
          statement appear here once it exists.
        </p>
        {form}
      </div>
    </Card>
  ) : (
    form
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
            {a.archived_at ? <Pill status="idle">Archived</Pill> : null}
            {a.paused_at ? <Pill status="parked">Paused</Pill> : null}
            {a.owner_user_id === '' ? <Pill status="held">No owner</Pill> : a.verified ? <Pill status="settled">Verified</Pill> : null}
            <span className="font-figure text-body text-ink" data-testid={`agent-balance-${a.id}`}>
              {lxc(a.balance_ulxc)}
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
  // B17.26 — the amount and the Idempotency-Key are the mutation's own, so a retry through a deploy's
  // restart repeats both and Lens moves the LXC once.
  const move = useMutation({
    mutationFn: ({ dir, ulxc, key }: { dir: 'fund' | 'withdraw'; ulxc: number; key: string }) =>
      dir === 'fund' ? agentBankApi.fund(agent.id, ulxc, key) : agentBankApi.withdraw(agent.id, ulxc, key),
    retry: retryMoveThroughRestart,
    retryDelay: (failures) => Math.min(500 * 2 ** failures, 4_000),
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
            <Button disabled={claim.isPending} onClick={() => claim.mutate()}>
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
          <Button variant="primary" disabled={busy} onClick={() => move.mutate({ dir: 'fund', ulxc: micros ?? 0, key: newMoveKey() })}>
            Fund
          </Button>
          <Button disabled={busy} onClick={() => move.mutate({ dir: 'withdraw', ulxc: micros ?? 0, key: newMoveKey() })}>
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

/** B28.21 — the agent's name and what it is for, in its owner's words (Lens keeps up to 500 characters). */
function AgentDetails({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description ?? '')
  const save = useMutation({
    mutationFn: () => agentBankApi.update(agent.id, { name: name.trim(), description: description.trim() }),
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  const changed = name.trim() !== agent.name || description.trim() !== (agent.description ?? '')
  return (
    <Card>
      <CardHeader>Name and description</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (changed && name.trim() !== '' && !save.isPending) save.mutate()
        }}
      >
        <Input aria-label={`Name of ${agent.name}`} placeholder="Agent name" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea
          aria-label={`What ${agent.name} is for`}
          maxLength={500}
          rows={3}
          placeholder="What it is for, e.g. answers support tickets overnight"
          className={`w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div>
          <Button type="submit" disabled={!changed || name.trim() === '' || save.isPending}>
            Save
          </Button>
        </div>
        {save.isSuccess && !changed ? <Note ok>Saved.</Note> : null}
        {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
      </form>
    </Card>
  )
}

/**
 * B28.21 — archiving retires the agent for good (Lens B28.298): in one step its whole balance goes back to
 * the workspace as one withdraw entry, its keys stop working, and its top-up and schedules stop. Asked twice.
 */
function ArchiveAgent({ agent, onArchived }: { agent: Agent; onArchived: (done: AgentArchive) => void }) {
  const qc = useQueryClient()
  const [asking, setAsking] = useState(false)
  const archive = useMutation({
    mutationFn: () => agentBankApi.archive(agent.id),
    onSuccess: onArchived,
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: statementKey(agent.id) }),
      ]),
  })
  const keys = agent.keys.length
  return (
    <Card>
      <CardHeader>Archive</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        <p className="text-body text-ink">
          Archiving {agent.name} moves the {lxc(agent.balance_ulxc)} it holds back to the workspace, stops its{' '}
          <span className="font-figure">{keys}</span> {keys === 1 ? 'key' : 'keys'} working, and ends its top-up and
          schedules. Its statement is kept. It cannot be undone.
        </p>
        {asking ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="danger" disabled={archive.isPending} onClick={() => archive.mutate()}>
              {archive.isPending ? 'Archiving…' : `Yes, archive ${agent.name}`}
            </Button>
            <Button disabled={archive.isPending} onClick={() => setAsking(false)}>
              Keep it
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="danger" onClick={() => setAsking(true)}>
              Archive {agent.name}
            </Button>
          </div>
        )}
        {archive.isError ? <Note ok={false}>{refusalText(archive.error)}</Note> : null}
      </div>
    </Card>
  )
}

/** B28.21 — an archived agent: when, and what archiving did when this screen did it. */
function Archived({ agent, done }: { agent: Agent; done: AgentArchive | undefined }) {
  return (
    <p role="status" className="text-body text-ink" data-testid="agent-archived">
      {agent.name} was archived <span className="font-figure">{formatWhen(agent.archived_at ?? '')}</span>
      {done ? (
        <>
          : {lxc(done.swept_ulxc)} went back to the workspace and{' '}
          <span className="font-figure">{done.revoked_keys.length}</span> {done.revoked_keys.length === 1 ? 'key was' : 'keys were'}{' '}
          revoked
        </>
      ) : null}
      . It can no longer be funded, spend or pay; its statement is kept below.
    </p>
  )
}

const LIMITS = [
  ['max_per_request_ulxc', 'Limit per request'],
  ['hourly_limit_ulxc', 'Hourly limit'],
  ['daily_limit_ulxc', 'Daily limit'],
  ['weekly_limit_ulxc', 'Weekly limit'],
  ['monthly_limit_ulxc', 'Monthly limit'],
  ['approval_above_ulxc', 'Ask a person above'],
] as const

type LimitField = (typeof LIMITS)[number][0]

/** B28.26 — a cap on requests a minute as typed: a whole number Lens can hold, or empty for none; null when neither. */
function parseRate(text: string): number | null {
  const t = text.trim()
  if (t === '') return 0
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n <= 2_147_483_647 ? n : null
}

const rateText = (n: number) => (n > 0 ? String(n) : '')

function RulesForm({ agent, agents, rules }: { agent: Agent; agents: Agent[]; rules: AgentRules }) {
  const qc = useQueryClient()
  const [limits, setLimits] = useState<Record<LimitField, string>>(() => ({
    max_per_request_ulxc: limitText(rules.max_per_request_ulxc),
    hourly_limit_ulxc: limitText(rules.hourly_limit_ulxc ?? 0),
    daily_limit_ulxc: limitText(rules.daily_limit_ulxc),
    weekly_limit_ulxc: limitText(rules.weekly_limit_ulxc ?? 0),
    monthly_limit_ulxc: limitText(rules.monthly_limit_ulxc),
    approval_above_ulxc: limitText(rules.approval_above_ulxc),
  }))
  const [rate, setRate] = useState(() => rateText(rules.requests_per_minute ?? 0))
  const [models, setModels] = useState<string[]>(rules.allowed_models ?? [])
  // B28.25 — each capped model with its amount as typed; saved, they replace Lens's caps whole.
  const [modelLimits, setModelLimits] = useState<[string, string][]>(() =>
    Object.entries(rules.model_daily_limits_ulxc ?? {}).map(([m, v]) => [m, limitText(v)]),
  )
  const [providers, setProviders] = useState<string[]>(rules.allowed_providers ?? [])
  const choices = useRuleChoices()
  const [listings, setListings] = useState<string[]>(rules.allowed_listings ?? [])
  const [payees, setPayees] = useState<Payees>(() => payeesOf(rules))
  const [pauseOnUnusual, setPauseOnUnusual] = useState(rules.pause_on_unusual_spend ?? false)
  const [from, setFrom] = useState(rules.active_from)
  const [until, setUntil] = useState(rules.active_until)
  const [timezone, setTimezone] = useState(rules.timezone)
  // B28.305 — a template fills every rule on the form; nothing reaches Lens until Save rules.
  const [filled, setFilled] = useState<RuleTemplate | null>(null)
  const fill = (t: RuleTemplate) => {
    const r = t.rules
    setLimits({
      max_per_request_ulxc: limitText(r.max_per_request_ulxc),
      hourly_limit_ulxc: limitText(r.hourly_limit_ulxc ?? 0),
      daily_limit_ulxc: limitText(r.daily_limit_ulxc),
      weekly_limit_ulxc: limitText(r.weekly_limit_ulxc ?? 0),
      monthly_limit_ulxc: limitText(r.monthly_limit_ulxc),
      approval_above_ulxc: limitText(r.approval_above_ulxc),
    })
    setRate(rateText(r.requests_per_minute ?? 0))
    setModels(r.allowed_models ?? [])
    setModelLimits(Object.entries(r.model_daily_limits_ulxc ?? {}).map(([m, v]) => [m, limitText(v)]))
    setProviders(r.allowed_providers ?? [])
    setListings(r.allowed_listings ?? [])
    setPayees(payeesOf(r))
    setPauseOnUnusual(r.pause_on_unusual_spend ?? false)
    setFrom(r.active_from)
    setUntil(r.active_until)
    setTimezone(r.timezone)
    setFilled(t)
  }
  const badAmount = [...LIMITS.map(([f]) => limits[f]), ...modelLimits.map(([, t]) => t), ...Object.values(payees.caps)].some(
    (t) => t.trim() !== '' && parseLXC(t) === null,
  )
  const badRate = parseRate(rate) === null
  const bad = badAmount || badRate
  const save = useMutation({
    mutationFn: () =>
      agentBankApi.setRules(agent.id, {
        max_per_request_ulxc: parseLXC(limits.max_per_request_ulxc) ?? 0,
        hourly_limit_ulxc: parseLXC(limits.hourly_limit_ulxc) ?? 0,
        daily_limit_ulxc: parseLXC(limits.daily_limit_ulxc) ?? 0,
        weekly_limit_ulxc: parseLXC(limits.weekly_limit_ulxc) ?? 0,
        monthly_limit_ulxc: parseLXC(limits.monthly_limit_ulxc) ?? 0,
        approval_above_ulxc: parseLXC(limits.approval_above_ulxc) ?? 0,
        requests_per_minute: parseRate(rate) ?? 0,
        model_daily_limits_ulxc: Object.fromEntries(
          modelLimits.map(([m, t]) => [m, parseLXC(t) ?? 0] as const).filter(([, v]) => v > 0),
        ),
        allowed_models: models,
        allowed_providers: providers,
        allowed_listings: listings,
        allowed_payees: payees.allowed,
        blocked_payees: payees.blocked,
        payee_daily_limits_ulxc: Object.fromEntries(
          Object.entries(payees.caps).map(([id, t]) => [id, parseLXC(t) ?? 0] as const).filter(([, v]) => v > 0),
        ),
        active_from: from.trim(),
        active_until: until.trim(),
        timezone: timezone.trim(),
        pause_on_unusual_spend: pauseOnUnusual,
      }),
    onSuccess: (saved) => {
      qc.setQueryData(rulesKey(agent.id), saved)
      void qc.invalidateQueries({ queryKey: rulesHistoryKey(agent.id) })
    },
  })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!bad && !save.isPending) save.mutate()
      }}
    >
      <Row
        label="Start from a template"
        hint={filled ? `${filled.summary} Save rules to apply it.` : 'Fills every rule below; nothing changes until you save.'}
      >
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Rule templates for ${agent.name}`}>
          {RULE_TEMPLATES.map((t) => (
            <Button key={t.id} aria-pressed={filled?.id === t.id} onClick={() => fill(t)}>
              {t.name}
            </Button>
          ))}
        </div>
      </Row>
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
      <Row label="Requests per minute" hint="Past it a request is refused until the minute has room; empty for no limit">
        <Input
          aria-label={`Requests per minute for ${agent.name}`}
          inputMode="numeric"
          placeholder="No limit"
          className="w-28 font-figure"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      </Row>
      <ChoicePicker
        label="Allowed models"
        agentName={agent.name}
        chosen={models}
        onChange={setModels}
        groups={choices.models}
        anyText="Any model"
        hint={choices.failed ? 'The model list could not be read just now; the models already chosen are kept.' : undefined}
      />
      <ModelLimitsPicker agentName={agent.name} limits={modelLimits} onChange={setModelLimits} groups={choices.models} />
      <ChoicePicker
        label="Allowed providers"
        agentName={agent.name}
        chosen={providers}
        onChange={setProviders}
        groups={[{ label: 'Providers', options: choices.providers }]}
        anyText="Any provider"
      />
      <ListingsPicker agent={agent} chosen={listings} onChange={setListings} />
      <PayeesPicker agent={agent} agents={agents} payees={payees} onChange={setPayees} />
      <Row label="Pause on unusual spend" hint="An unusual-spend alert also pauses this agent until you resume it">
        <Button
          type="button"
          aria-label={`Pause ${agent.name} on unusual spend`}
          aria-pressed={pauseOnUnusual}
          className={pressed}
          onClick={() => setPauseOnUnusual((on) => !on)}
        >
          {pauseOnUnusual ? 'On' : 'Off'}
        </Button>
      </Row>
      <TimePicker label="Active from" agentName={agent.name} value={from} onChange={setFrom} />
      <TimePicker label="Active until" agentName={agent.name} value={until} onChange={setUntil} />
      <TimeZonePicker agentName={agent.name} value={timezone} onChange={setTimezone} />
      <div className="flex flex-col gap-2 px-gutter py-3">
        <div>
          <Button type="submit" disabled={bad || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save rules'}
          </Button>
        </div>
        {badAmount ? <Note ok={false}>A limit is an amount of LXC with at most six decimals, or empty.</Note> : null}
        {badRate ? <Note ok={false}>Requests per minute is a whole number, or empty.</Note> : null}
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
            className={pressed}
            onClick={() => toggle(l.id, !chosen.includes(l.id))}
          >
            Allowed
          </Button>
        </Row>
      ))}
    </>
  )
}

/**
 * B28.27 — who an agent may pay and who it may not, as the Rules form holds them until Save rules; and (B28.28)
 * what it may pay each payee in a day, by the payee's id, as typed.
 */
interface Payees {
  allowed: string[]
  blocked: string[]
  caps: Record<string, string>
}

const payeesOf = (r: AgentRules): Payees => ({
  allowed: r.allowed_payees ?? [],
  blocked: r.blocked_payees ?? [],
  caps: Object.fromEntries(Object.entries(r.payee_daily_limits_ulxc ?? {}).map(([id, v]) => [id, limitText(v)])),
})

/** What a payee the workspace's agents do not name is, read from its id. */
function payeeHint(id: string): string {
  if (id.startsWith('agt_')) return 'Another company’s agent'
  if (id.startsWith('lst_')) return 'A marketplace listing'
  return 'A company or a card merchant'
}

/**
 * B28.27 — who the agent may pay and who it may not (Lens B28.303). Each of the workspace's other agents
 * can be marked Allowed or Blocked; any other payee — another company (its workspace id), its agent, a
 * marketplace listing or a card merchant — is added by its id. Lens refuses a payment to a Blocked payee
 * and, once any is Allowed, to every payee not Allowed; a refused payment moves nothing. A payee is one or
 * the other, never both (Lens refuses that), so marking it one clears the other. B28.28 — each payee also
 * takes a daily cap (Lens B28.304): a payment that would take the day's total to it past the cap is refused
 * and posts nothing.
 */
function PayeesPicker({ agent, agents, payees, onChange }: { agent: Agent; agents: Agent[]; payees: Payees; onChange: (p: Payees) => void }) {
  const [typed, setTyped] = useState('')
  const ours = agents.filter((a) => a.id !== agent.id).map((a) => ({ id: a.id, title: a.name, hint: 'Your agent' }))
  const named = [...new Set([...payees.allowed, ...payees.blocked, ...Object.keys(payees.caps)])]
    .filter((id) => !ours.some((a) => a.id === id))
    .map((id) => ({ id, title: id, hint: payeeHint(id) }))
  const mark = (id: string, as: 'allowed' | 'blocked' | null) =>
    onChange({
      ...payees,
      allowed: as === 'allowed' ? [...payees.allowed.filter((x) => x !== id), id] : payees.allowed.filter((x) => x !== id),
      blocked: as === 'blocked' ? [...payees.blocked.filter((x) => x !== id), id] : payees.blocked.filter((x) => x !== id),
    })
  const id = typed.trim()
  const add = (as: 'allowed' | 'blocked') => {
    mark(id, as)
    setTyped('')
  }
  const cap = (payee: string, text: string) => onChange({ ...payees, caps: { ...payees.caps, [payee]: text } })
  return (
    <>
      <Row
        label="Who it may pay"
        hint={`${
          payees.allowed.length > 0
            ? 'Only the payees marked Allowed — Lens refuses a payment to any other.'
            : payees.blocked.length > 0
              ? 'Anyone but the payees marked Blocked.'
              : 'Anyone. Mark a payee Blocked to refuse it, or Allowed to allow only those.'
        } The box beside a payee caps what it may be paid in a day, in LXC.`}
      />
      {[...ours, ...named].map((p) => {
        const allowed = payees.allowed.includes(p.id)
        const blocked = payees.blocked.includes(p.id)
        return (
          <Row key={p.id} label={p.title} hint={p.hint} className="pl-8">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                aria-label={`${agent.name} may pay ${p.title}`}
                aria-pressed={allowed}
                className={pressed}
                onClick={() => mark(p.id, allowed ? null : 'allowed')}
              >
                Allowed
              </Button>
              <Button
                type="button"
                aria-label={`${agent.name} may not pay ${p.title}`}
                aria-pressed={blocked}
                className={pressed}
                onClick={() => mark(p.id, blocked ? null : 'blocked')}
              >
                Blocked
              </Button>
              <Input
                aria-label={`Daily limit on payments to ${p.title} from ${agent.name}, in LXC`}
                inputMode="decimal"
                placeholder="No daily cap"
                className="w-28 font-figure"
                value={payees.caps[p.id] ?? ''}
                onChange={(e) => cap(p.id, e.target.value)}
              />
            </div>
          </Row>
        )
      })}
      <Row label="Another payee" hint="A company’s workspace id, its agent’s or listing’s id, or a card merchant’s id" className="pl-8">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={`A payee’s id for ${agent.name}`}
            placeholder="Payee id"
            className="wide:w-56"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <Button type="button" disabled={id === '' || /\s/.test(id)} onClick={() => add('allowed')}>
            Allow
          </Button>
          <Button type="button" disabled={id === '' || /\s/.test(id)} onClick={() => add('blocked')}>
            Block
          </Button>
          <Button
            type="button"
            disabled={id === '' || /\s/.test(id)}
            onClick={() => {
              cap(id, payees.caps[id] ?? '')
              setTyped('')
            }}
          >
            Cap a day
          </Button>
        </div>
      </Row>
    </>
  )
}

function Rules({ agent, agents }: { agent: Agent; agents: Agent[] }) {
  const qc = useQueryClient()
  const rules = useQuery({ queryKey: rulesKey(agent.id), queryFn: () => agentBankApi.rules(agent.id) })
  // B28.31 — the form is filled once from the rules it opened with, so a rollback starts it again from the rules
  // the rollback put back.
  const [rolledBack, setRolledBack] = useState(0)
  return (
    <>
      <Card>
        <CardHeader>Rules</CardHeader>
        {rules.isSuccess ? (
          <>
            <RulesInWords agentName={agent.name} rules={rules.data} payeeName={(id) => agents.find((a) => a.id === id)?.name ?? id} />
            <RulesForm key={`${agent.id}:${rolledBack}`} agent={agent} agents={agents} rules={rules.data} />
          </>
        ) : (
          <p className="px-gutter py-3 text-body text-muted">
            {rules.isError ? readFailure(rules.error, 'This agent’s rules') : 'Reading…'}
          </p>
        )}
      </Card>
      {rules.isSuccess ? <LimitBoost agent={agent} rules={rules.data} /> : null}
      <RulesHistory
        agent={agent}
        agents={agents}
        onRolledBack={(back) => {
          qc.setQueryData(rulesKey(agent.id), back)
          setRolledBack((n) => n + 1)
        }}
      />
    </>
  )
}

/** B28.31 — how a version came to be, from Lens's change: set, template <id>, rollback to <n> or before history. */
function changeText(change: string): string {
  if (change === 'set') return 'Saved'
  if (change === 'before history') return 'As they were before history was kept'
  const template = /^template (.+)$/.exec(change)?.[1]
  if (template !== undefined) return `${RULE_TEMPLATES.find((t) => t.id === template)?.name ?? template} template applied`
  const back = /^rollback to (\d+)$/.exec(change)?.[1]
  if (back !== undefined) return `Rolled back to version ${back}`
  return change
}

/**
 * B28.31 — who made a version, from the credential Lens names: the operator, a key (by its id), or a signed-in
 * session — on Talyvor that is the workspace's own, so "you". Lens names nobody for rules set before history.
 */
function changedBy(by: string): string {
  if (by === '') return ''
  if (by === 'operator') return ' by Talyvor support'
  const key = /:key:([^:]+)$/.exec(by)?.[1]
  if (key !== undefined) return ` with key ${key}`
  if (by.startsWith('jwt')) return ' by you'
  return ` by ${by}`
}

const NO_RULES: AgentRules = {
  max_per_request_ulxc: 0,
  daily_limit_ulxc: 0,
  monthly_limit_ulxc: 0,
  approval_above_ulxc: 0,
  allowed_models: null,
  allowed_providers: null,
  active_from: '',
  active_until: '',
  timezone: '',
}

interface RuleChange {
  rule: string
  from: React.ReactNode
  to: React.ReactNode
}

/** B28.31 — every rule the screen shows that differs between two versions, as it was and as it became. */
function ruleChanges(was: AgentRules, now: AgentRules, payeeName: (id: string) => string): RuleChange[] {
  const out: RuleChange[] = []
  const amount = (v: number | undefined) => ((v ?? 0) > 0 ? lxc(v ?? 0) : 'none')
  for (const [field, rule] of LIMITS) {
    if ((was[field] ?? 0) !== (now[field] ?? 0)) out.push({ rule, from: amount(was[field]), to: amount(now[field]) })
  }
  if ((was.requests_per_minute ?? 0) !== (now.requests_per_minute ?? 0)) {
    const rate = (n: number | undefined) => ((n ?? 0) > 0 ? <span className="font-figure">{n}</span> : 'none')
    out.push({ rule: 'Requests a minute', from: rate(was.requests_per_minute), to: rate(now.requests_per_minute) })
  }
  const lists: [keyof AgentRules, string, string, (id: string) => string][] = [
    ['allowed_models', 'Allowed models', 'any', (id) => id],
    ['allowed_providers', 'Allowed providers', 'any', (id) => id],
    ['allowed_listings', 'Allowed listings', 'any', (id) => id],
    ['allowed_payees', 'May pay only', 'anyone', payeeName],
    ['blocked_payees', 'May never pay', 'nobody', payeeName],
  ]
  for (const [field, rule, none, name] of lists) {
    const text = (v: AgentRules[keyof AgentRules]) => {
      const ids = [...((v as string[] | null | undefined) ?? [])].sort()
      return ids.length > 0 ? ids.map(name).join(', ') : none
    }
    if (text(was[field]) !== text(now[field])) out.push({ rule, from: text(was[field]), to: text(now[field]) })
  }
  const caps: ['model_daily_limits_ulxc' | 'payee_daily_limits_ulxc', (id: string) => string][] = [
    ['model_daily_limits_ulxc', (m) => `Daily limit on ${m}`],
    ['payee_daily_limits_ulxc', (id) => `Daily limit to ${payeeName(id)}`],
  ]
  for (const [field, rule] of caps) {
    const before = was[field] ?? {}
    const after = now[field] ?? {}
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      if ((before[key] ?? 0) !== (after[key] ?? 0)) out.push({ rule: rule(key), from: amount(before[key]), to: amount(after[key]) })
    }
  }
  const hours: ['active_from' | 'active_until', string][] = [
    ['active_from', 'Works from'],
    ['active_until', 'Works until'],
  ]
  for (const [field, rule] of hours) {
    if (was[field] !== now[field]) out.push({ rule, from: was[field] || 'any time', to: now[field] || 'any time' })
  }
  if ((was.timezone || 'UTC') !== (now.timezone || 'UTC')) out.push({ rule: 'Time zone', from: was.timezone || 'UTC', to: now.timezone || 'UTC' })
  if (Boolean(was.pause_on_unusual_spend) !== Boolean(now.pause_on_unusual_spend)) {
    out.push({ rule: 'Pause on unusual spend', from: was.pause_on_unusual_spend ? 'on' : 'off', to: now.pause_on_unusual_spend ? 'on' : 'off' })
  }
  return out
}

/**
 * B28.31 — every version of an agent's rules (Lens B28.307), newest first: how each came to be, who made it and
 * what it changed from the version before. Any earlier version can be put back exactly as it was; Lens records the
 * rollback as a new version, by whoever asked, so a rollback can itself be rolled back.
 */
function RulesHistory({ agent, agents, onRolledBack }: { agent: Agent; agents: Agent[]; onRolledBack: (rules: AgentRules) => void }) {
  const qc = useQueryClient()
  const history = useQuery({ queryKey: rulesHistoryKey(agent.id), queryFn: () => agentBankApi.rulesHistory(agent.id) })
  const rollback = useMutation({
    mutationFn: (version: number) => agentBankApi.rollbackRules(agent.id, version),
    onSuccess: (back) => {
      onRolledBack(back)
      void qc.invalidateQueries({ queryKey: rulesHistoryKey(agent.id) })
    },
  })
  const versions: AgentRulesVersion[] = history.data?.versions ?? []
  const payeeName = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  return (
    <Card>
      <CardHeader>Rules history</CardHeader>
      {history.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(history.error, `${agent.name}’s rules history`)}</p>
      ) : !history.isSuccess ? (
        <p className="px-gutter py-3 text-body text-muted">Reading…</p>
      ) : versions.length === 0 ? (
        <p className="px-gutter py-3 text-body text-muted">{agent.name}’s rules have not been changed yet. Every save will be kept here.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-rule" aria-label={`Versions of ${agent.name}’s rules`}>
          {versions.map((v, i) => {
            const older = versions[i + 1] ?? (v.version === 1 ? { rules: NO_RULES } : undefined)
            const changes = older ? ruleChanges(older.rules, v.rules, payeeName) : []
            return (
              <li key={v.version} className="flex flex-col gap-1 px-gutter py-3" data-testid={`rules-version-${v.version}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body text-ink">
                    Version <span className="font-figure">{v.version}</span>
                  </span>
                  {i === 0 ? <Pill status="settled">In force</Pill> : null}
                  <span className="text-caption text-muted">
                    {changeText(v.change)}
                    {changedBy(v.changed_by)}, <span className="font-figure">{formatWhen(v.created_at)}</span>
                  </span>
                  {i > 0 ? (
                    <Button
                      className="ml-auto"
                      disabled={rollback.isPending}
                      aria-label={`Roll ${agent.name}’s rules back to version ${v.version}`}
                      onClick={() => rollback.mutate(v.version)}
                    >
                      Roll back to this
                    </Button>
                  ) : null}
                </div>
                {older === undefined ? (
                  <p className="text-caption text-muted">Older versions are not shown.</p>
                ) : changes.length === 0 ? (
                  <p className="text-caption text-muted">Only rules this screen does not show changed.</p>
                ) : (
                  <ul className="flex list-disc flex-col gap-0.5 pl-6 text-caption text-ink">
                    {changes.map((c) => (
                      <li key={c.rule}>
                        {c.rule}: was {c.from}, now {c.to}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {rollback.isSuccess || rollback.isError ? (
        <div className="px-gutter pb-3">
          {rollback.isSuccess ? (
            <Note ok>
              {agent.name}’s rules are back as they were at version <span className="font-figure">{rollback.variables}</span>. The
              rollback is kept as a new version.
            </Note>
          ) : (
            <Note ok={false}>{refusalText(rollback.error)}</Note>
          )}
        </div>
      ) : null}
    </Card>
  )
}

type BoostField = LimitField | 'requests_per_minute'

/** B28.32 — the limits a boost may raise (Lens's boostableRules), named as the Rules card names them. */
const BOOSTABLE: readonly (readonly [BoostField, string])[] = [...LIMITS, ['requests_per_minute', 'Requests a minute']]

/** B28.32 — a limit's figure as its rule counts it: LXC, or requests a minute. */
function boostFigure(rule: string, v: number): React.ReactNode {
  return rule === 'requests_per_minute' ? (
    <>
      <span className="font-figure">{v}</span> requests a minute
    </>
  ) : (
    lxc(v)
  )
}

/** B28.32 — a moment as a datetime-local input holds it: in the browser's own time zone, to the minute. */
function localMinute(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * B28.32 — raise one of an agent's limits until a time (Lens B28.308). Lens judges every request at its own time with
 * the boosts in force laid over the rules, so from that time on the limit is the rules' again with nothing to undo,
 * and the rules and their history are never touched. A boost raises only a limit the rules set, and only while the
 * rules leave that limit where it was; it can be ended early.
 */
function LimitBoost({ agent, rules }: { agent: Agent; rules: AgentRules }) {
  const qc = useQueryClient()
  const boosts = useQuery({
    queryKey: boostsKey(agent.id),
    queryFn: () => agentBankApi.boosts(agent.id),
    // A boost ends by itself: read again just after the soonest one's time, so the card stops showing it then.
    refetchInterval: (q) => {
      const soonest = q.state.data?.boosts?.[0]?.until
      return soonest ? Math.min(Math.max(Date.parse(soonest) - Date.now() + 1000, 1000), 2_147_483_647) : false
    },
  })
  const settable = BOOSTABLE.filter(([field]) => (rules[field] ?? 0) > 0)
  const [picked, setPicked] = useState('')
  const rule = settable.find(([field]) => field === picked) ?? settable[0]
  const [value, setValue] = useState('')
  const [until, setUntil] = useState(() => localMinute(new Date(Date.now() + 60 * 60_000)))
  const rate = rule?.[0] === 'requests_per_minute'
  const raisedTo = rate ? (/^\s*\d+\s*$/.test(value) && Number(value) > 0 ? Number(value) : null) : parseLXC(value)
  const at = new Date(until)
  const raise = useMutation({
    mutationFn: () => agentBankApi.boost(agent.id, { rule: rule?.[0] ?? '', value: raisedTo ?? 0, until: at.toISOString() }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: boostsKey(agent.id) }),
  })
  const end = useMutation({
    mutationFn: (r: string) => agentBankApi.endBoost(agent.id, r),
    onSuccess: () => {
      raise.reset()
      void qc.invalidateQueries({ queryKey: boostsKey(agent.id) })
    },
  })
  const label = (r: string) => BOOSTABLE.find(([field]) => field === r)?.[1] ?? r
  const inForce: AgentRuleBoost[] = boosts.data?.boosts ?? []
  const ready = rule !== undefined && raisedTo !== null && !Number.isNaN(at.getTime()) && !raise.isPending
  return (
    <Card>
      <CardHeader>Limit boost</CardHeader>
      {boosts.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(boosts.error, `${agent.name}’s raised limits`)}</p>
      ) : inForce.length > 0 ? (
        <ul className="flex flex-col divide-y divide-rule" aria-label={`Limits raised for ${agent.name}`}>
          {inForce.map((b) => (
            <li key={b.rule} className="flex flex-wrap items-center gap-2 px-gutter py-3" data-testid={`boost-${b.rule}`}>
              <span className="text-body text-ink">
                {label(b.rule)} raised to {boostFigure(b.rule, b.value)} until <span className="font-figure">{formatWhen(b.until)}</span>,
                then {boostFigure(b.rule, b.raised_from)} again by itself.
              </span>
              {(rules[b.rule as BoostField] ?? 0) === b.raised_from ? (
                <Pill status="settled">In force</Pill>
              ) : (
                <span className="text-caption text-muted">No longer applies: the rules have changed this limit since.</span>
              )}
              <span className="text-caption text-muted">
                Set{changedBy(b.created_by)}, <span className="font-figure">{formatWhen(b.created_at)}</span>
              </span>
              <Button
                className="ml-auto"
                disabled={end.isPending}
                aria-label={`End the boost on ${agent.name}’s ${label(b.rule).toLowerCase()} now`}
                onClick={() => end.mutate(b.rule)}
              >
                End now
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {rule === undefined ? (
        <p className="px-gutter py-3 text-body text-muted">{agent.name} has no limit set to raise. Set one under Rules first.</p>
      ) : (
        <form
          className="flex flex-col gap-2 px-gutter py-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready) raise.mutate()
          }}
        >
          <p className="text-body text-muted">
            Raise one of {agent.name}’s limits for a while. At the time you pick it goes back to the limit in its rules by
            itself; the rules do not change.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Limit to raise for ${agent.name}`}
              className={`${scheduleSelect} w-48`}
              value={rule[0]}
              onChange={(e) => {
                setPicked(e.target.value)
                raise.reset()
              }}
            >
              {settable.map(([field, name]) => (
                <option key={field} value={field}>
                  {name}
                </option>
              ))}
            </select>
            <span className="text-body text-muted">from {boostFigure(rule[0], rules[rule[0]] ?? 0)} to</span>
            <Input
              aria-label={`Raise ${agent.name}’s limit to`}
              inputMode={rate ? 'numeric' : 'decimal'}
              placeholder={rate ? 'a minute' : 'LXC'}
              className="w-28 font-figure"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <span className="text-body text-muted">until</span>
            <Input
              type="datetime-local"
              aria-label={`Raise ${agent.name}’s limit until`}
              className="w-56 font-figure"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
            <Button type="submit" disabled={!ready}>
              {raise.isPending ? 'Raising…' : 'Raise until then'}
            </Button>
          </div>
          {raise.isSuccess ? (
            <Note ok>
              {agent.name}’s {label(raise.data.rule).toLowerCase()} is {boostFigure(raise.data.rule, raise.data.value)} until{' '}
              <span className="font-figure">{formatWhen(raise.data.until)}</span>, then{' '}
              {boostFigure(raise.data.rule, raise.data.raised_from)} again by itself.
            </Note>
          ) : null}
          {raise.isError ? <Note ok={false}>{refusalText(raise.error)}</Note> : null}
          {end.isError ? <Note ok={false}>{refusalText(end.error)}</Note> : null}
        </form>
      )}
    </Card>
  )
}

/**
 * B28.30 — "would this request pass my rules?" (Lens B28.306). A question to a model, or a payment to another of
 * the workspace's agents, is judged by the agent's rules exactly as a real one is — against what it has really
 * spent — and nothing is spent, posted or sent for approval. The answer is Lens's: allowed, refused with the
 * rule's own sentence, or waiting for a person's approval.
 */
function TryRules({ agent, agents }: { agent: Agent; agents: Agent[] }) {
  const choices = useRuleChoices()
  const others = agents.filter((a) => a.id !== agent.id)
  const [kind, setKind] = useState<'question' | 'payment'>('question')
  const [model, setModel] = useState('')
  const [to, setTo] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const micros = parseLXC(amount)
  const payee = kind === 'payment' ? (others.find((a) => a.id === to) ?? null) : null
  // The catalog's groups are its providers, so the model chosen names the provider Lens judges it by.
  const provider = choices.providers[choices.models.findIndex((g) => g.options.some((o) => o.value === model))]?.value ?? ''
  const sim = useMutation({
    mutationFn: () =>
      agentBankApi.simulate(
        agent.id,
        payee ? { amount_ulxc: micros ?? 0, payee: { kind: 'agent', id: payee.id } } : { amount_ulxc: micros ?? 0, model, provider },
      ),
  })
  const ready = micros !== null && (kind === 'question' || payee !== null) && !sim.isPending
  const answer = sim.data
  const what = (k: 'question' | 'payment') => {
    setKind(k)
    sim.reset()
  }
  return (
    <Card>
      <CardHeader>Would it pass?</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) sim.mutate()
        }}
      >
        <p className="text-body text-muted">
          Ask whether {agent.name}’s rules would let a request through, counting what it has really spent. Nothing is
          spent, paid or sent for approval.
        </p>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="What to try">
          <Button aria-pressed={kind === 'question'} className={pressed} onClick={() => what('question')}>
            A question to a model
          </Button>
          {others.length > 0 ? (
            <Button aria-pressed={kind === 'payment'} className={pressed} onClick={() => what('payment')}>
              A payment
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {kind === 'question' ? (
            <select aria-label={`Model ${agent.name} would ask`} className={`${scheduleSelect} w-56`} value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Any model</option>
              {choices.models
                .filter((g) => g.options.length > 0)
                .map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
          ) : (
            <select aria-label={`Who ${agent.name} would pay`} className={`${scheduleSelect} w-56`} value={to ?? ''} onChange={(e) => setTo(e.target.value || null)}>
              <option value="">Choose an agent…</option>
              {others.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <Input
            aria-label={`Amount in LXC to try for ${agent.name}`}
            inputMode="decimal"
            placeholder="LXC"
            className="w-28 font-figure"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button type="submit" disabled={!ready}>
            {sim.isPending ? 'Asking…' : 'Would it pass?'}
          </Button>
        </div>
        {answer ? (
          <Note ok={answer.verdict === 'allowed'}>
            <span data-testid="rule-verdict">
              {answer.verdict === 'allowed' ? 'Allowed.' : answer.verdict === 'refused' ? 'Refused.' : 'Needs approval.'}
            </span>{' '}
            {answer.verdict === 'allowed'
              ? `${agent.name}’s rules would let this through.`
              : `${answer.reason.charAt(0).toUpperCase()}${answer.reason.slice(1)}${answer.reason.endsWith('.') ? '' : '.'}`}
            {answer.verdict !== 'refused' && answer.amount_ulxc > answer.balance_ulxc ? (
              <> It holds only {lxc(answer.balance_ulxc)}, so it could not pay this until it is funded.</>
            ) : null}{' '}
            Nothing was spent.
          </Note>
        ) : null}
        {sim.isError ? <Note ok={false}>{refusalText(sim.error)}</Note> : null}
      </form>
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
            <Button key={a.id} aria-pressed={to === a.id} className={pressed} onClick={() => setTo(a.id)}>
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
          <Button type="submit" disabled={!payee || micros === null || pay.isPending}>
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
  const out = l.amount_ulxc < 0
  const other = l.counterparty.startsWith('agent:') ? nameOf(l.counterparty.slice(6)) : 'another agent'
  switch (l.kind) {
    case 'fund':
      return 'Funded by the workspace'
    case 'withdraw':
      return 'Taken back by the workspace'
    case 'topup':
      return 'Topped up automatically by the workspace'
    case 'credit_line':
      return 'Covered by the credit line'
    case 'pay': {
      const what = out ? `Paid ${other}` : `Received from ${other}`
      return l.ref ? `${what} — ${l.ref}` : what
    }
    case 'transfer':
      return out ? `Transferred to ${other}` : `Transfer from ${other}`
    case 'reversal':
      return out ? `Test money given back to ${other}` : `Test money returned by ${other}`
    case 'escrow':
      return out ? 'Held in escrow' : 'Released from escrow'
    case 'card':
      return out ? 'Card charge' : 'Card refund'
    case 'cash_out':
      return out ? 'Cashed out' : 'Cash-out returned'
    case 'pot_in':
      return 'Moved into a pot'
    case 'pot_out':
      return 'Moved out of a pot'
    case 'spend':
      return 'Spent on a request'
    case 'hold':
      return 'Held for a request'
    case 'release':
      return 'Released after a request'
    case 'settle':
      return 'Settled a request'
    case 'platform_fee':
      // B32.69 — Lens's words, rate and all; never retyped here.
      if (l.label) return l.label
      return out ? 'Money out' : 'Money in'
    default:
      // A kind Lens added after this screen: say which way it moved rather than guess what it was.
      return out ? 'Money out' : 'Money in'
  }
}

/** B29.9 — a statement line's state: money held for a request or in escrow is held; every other line has settled. */
function lineStatus(l: StatementLine): { status: PillStatus; label: string } {
  const held = l.kind === 'hold' || (l.kind === 'escrow' && l.amount_ulxc < 0)
  return held ? { status: 'held', label: 'Held' } : { status: 'settled', label: 'Settled' }
}

export function Statement({ agent, nameOf, entry }: { agent: Agent; nameOf: (id: string) => string; entry?: string }) {
  const st = useQuery({ queryKey: statementKey(agent.id), queryFn: () => agentBankApi.statement(agent.id) })
  const lines = st.data?.lines ?? []
  // B28.349 — a line linked to (from a spend answer in Chat) is marked, and brought into view.
  const linked = useRef<HTMLTableRowElement | null>(null)
  const found = entry !== undefined && lines.some((l) => l.entry_id === entry)
  useEffect(() => {
    if (found) linked.current?.scrollIntoView?.({ block: 'center' })
  }, [found])
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
              <tr
                key={`${l.entry_id}-${l.kind}`}
                ref={l.entry_id === entry ? linked : undefined}
                aria-current={l.entry_id === entry ? 'true' : undefined}
                data-testid={l.entry_id === entry ? 'statement-line-linked' : undefined}
                className={`border-t border-rule text-ink${l.entry_id === entry ? ' bg-accent-tint' : ''}`}
              >
                <td className="px-gutter py-2 font-figure text-caption text-muted">{formatWhen(l.at)}</td>
                <td className="py-2">
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span data-testid="statement-what">{lineText(l, nameOf)}</span>
                    <Pill status={lineStatus(l).status}>{lineStatus(l).label}</Pill>
                  </span>
                </td>
                <td className="py-2 text-right font-figure">
                  <Lxc ulxc={Math.abs(l.amount_ulxc)} sign={l.amount_ulxc > 0 ? '+' : '−'} />
                </td>
                <td className="px-gutter py-2 text-right font-figure">{lxc(l.balance_after_ulxc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {entry !== undefined && st.isSuccess && !found ? (
        <p className="border-t border-rule px-gutter py-3 text-body text-muted">
          The line you followed is older than the ones shown here. Download this agent’s statement for its period below.
        </p>
      ) : null}
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
/** `primary` (B29.9): Download is the teal action only on the screen it is for — Statements' every-agent card. */
export function StatementDownload({ agent, primary = false }: { agent: Agent | null; primary?: boolean }) {
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
        <Button type="submit" variant={primary ? 'primary' : 'default'} disabled={!valid || get.isPending}>
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

export function Approvals({
  nameOf,
  held,
  onSent,
  primary = false,
}: {
  nameOf: (id: string) => string
  held: Record<string, HeldPayment>
  onSent: (approvalID: string) => void
  /** B29.9 — Approve is the teal action on Approvals; on Agent Wallets that is Fund. */
  primary?: boolean
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
                stack
                label={asks(a)}
                hint={
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Pill status={DECIDED.pending.status}>{DECIDED.pending.label}</Pill>
                    <span>
                      {what(a)}, asked <span className="font-figure">{formatWhen(a.created_at)}</span>
                    </span>
                  </span>
                }
              >
                {/* One-handed on a phone: two full-width buttons under the sentence and the thumb; side by side on a wide screen. */}
                <div className="flex w-full flex-col gap-2 wide:w-auto wide:flex-row wide:items-center">
                  <Button
                    variant={primary ? 'primary' : 'default'}
                    className="h-12 w-full wide:h-8 wide:w-auto"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ a, decision: 'approve' })}
                  >
                    {signed ? 'Approve with Face ID' : 'Approve'}
                  </Button>
                  <Button
                    className="h-12 w-full wide:h-8 wide:w-auto"
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
  // B28.349 — /agents?agent=…&entry=… (a statement line a spend answer in Chat links to) opens that agent at that line.
  const [params] = useSearchParams()
  const linkedAgent = params.get('agent')
  const linkedEntry = params.get('entry') ?? undefined
  const [chosen, setChosen] = useState<string | null>(linkedAgent)
  useEffect(() => {
    if (linkedAgent !== null) setChosen(linkedAgent)
  }, [linkedAgent])
  const [held, setHeld] = useState<Record<string, HeldPayment>>({})
  const [archived, setArchived] = useState<Record<string, AgentArchive>>({})
  const agents = book.data?.agents ?? []
  // B28.21 — an archived agent stays listed, but is no one's payee and is not the one opened first.
  const live = agents.filter((a) => !a.archived_at)
  const agent = agents.find((a) => a.id === chosen) ?? live[0] ?? agents[0] ?? null
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? 'an agent'
  // B28.271 — until an agent exists there is nothing to pause, forecast, approve, lend or hold: the screen is
  // the one card that creates it. Every region below keeps its place in the tree (null while hidden), so the
  // create form is the same instance before and after the first agent.
  const hasAgents = agents.length > 0
  const first = book.isSuccess && !hasAgents
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
        {first ? null : <CurrencyPicker />}
        {book.isSuccess ? (
          <>
            {hasAgents ? <Totals book={book.data} /> : null}
            {/* A pause already set still says so: it holds an agent created later too. */}
            {hasAgents || book.data.all_paused_at ? <PauseEveryAgent book={book.data} /> : null}
            {hasAgents ? (
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

      {hasAgents ? (
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
      ) : null}

      <Region index={hasAgents ? '02' : '01'} label="Agents" className="flex flex-col gap-3">
        <CreateAgent first={first} onCreated={(a) => setChosen(a.id)} />
        {book.isError ? (
          <p className="text-body text-muted">{readFailure(book.error, 'The agents')}</p>
        ) : hasAgents ? (
          <AgentList agents={agents} selected={agent?.id ?? null} onSelect={setChosen} />
        ) : null}
      </Region>

      {hasAgents ? (
        <Region index="03" label="Spending">
          <Spending nameOf={nameOf} />
        </Region>
      ) : null}

      {agent && book.data ? (
        <Region index="04" label="Agent" className="flex flex-col gap-gutter">
          <p className="text-head text-ink" data-testid="agent-open">
            {agent.name}
          </p>
          {agent.description ? (
            <p className="text-body text-muted" data-testid="agent-description">
              {agent.description}
            </p>
          ) : null}
          {agent.archived_at ? (
            <>
              <Archived agent={agent} done={archived[agent.id]} />
              <AgentDetails key={`details-${agent.id}`} agent={agent} />
              <Statement agent={agent} nameOf={nameOf} entry={agent.id === linkedAgent ? linkedEntry : undefined} />
            </>
          ) : (
            <>
              <Ownership agent={agent} />
              <PauseAgent agent={agent} />
              <AgentDetails key={`details-${agent.id}`} agent={agent} />
              <Money agent={agent} book={book.data} />
              <Rules key={`rules-${agent.id}`} agent={agent} agents={live} />
              <TryRules key={`try-${agent.id}`} agent={agent} agents={live} />
              {live.length > 1 ? (
                <Pay
                  key={`pay-${agent.id}`}
                  agent={agent}
                  agents={live}
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
              <Schedules key={`schedules-${agent.id}`} agent={agent} agents={live} nameOf={nameOf} />
              <RecurringTransfer key={`recurring-${agent.id}`} agent={agent} />
              <OfferLoan key={`loan-${agent.id}`} agent={agent} />
              <PayIntoEscrow key={`escrow-${agent.id}`} agent={agent} />
              <Pots key={`pots-${agent.id}`} agent={agent} />
              <Portfolios key={`portfolios-${agent.id}`} agent={agent} />
              <CashOutCard key={`cash-out-${agent.id}`} agent={agent} />
              <AgentTopUpCard key={`topup-${agent.id}`} agent={agent} />
              <IssueKey key={`key-${agent.id}`} agent={agent} />
              <AgentCardPanel key={`card-${agent.id}`} agent={agent} />
              <Statement agent={agent} nameOf={nameOf} entry={agent.id === linkedAgent ? linkedEntry : undefined} />
              <ArchiveAgent
                key={`archive-${agent.id}`}
                agent={agent}
                onArchived={(done) => setArchived((m) => ({ ...m, [done.agent_id]: done }))}
              />
            </>
          )}
        </Region>
      ) : null}

      {book.isSuccess && hasAgents ? (
        <Region index="05" label="Between owners" className="flex flex-col gap-gutter">
          <MoneyRequests agents={agents} />
          <CreditLinePanel />
          <Loans agents={agents} />
        </Region>
      ) : null}

      {book.isSuccess && hasAgents ? (
        <Region index="06" label="Held and cashed out" className="flex flex-col gap-gutter">
          <Escrows agents={agents} />
          <CashOuts agents={agents} />
        </Region>
      ) : null}
    </RegionScreen>
  )
}
