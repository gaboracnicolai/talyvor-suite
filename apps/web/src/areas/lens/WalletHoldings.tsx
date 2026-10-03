import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader, Input, Pill, Row, focusRing, type PillStatus } from '@talyvor/ui'
import { formatUSD, formatWhen } from './format'
import {
  type Agent,
  type CashOut,
  type Escrow,
  type Portfolio,
  type Pot,
  type SimOrder,
  type SimOrderInput,
  agentBankApi,
  formatULXC,
  newMoveKey,
  parseLXC,
  refusalText,
  retryMoveThroughRestart,
} from './agentBankApi'
import { Note, TestMoneyOnly, readFailure } from './WalletMoney'

// WalletHoldings.tsx — B22.12: Agent Wallets' escrow (Lens B22.6), pots (B22.7), simulated portfolios and
// orders (B22.8) and cash-out (B22.9). Each capability carries its class the way B22.10's screens show it:
// an AMBER or RED one Talyvor has not cleared is marked beside it, with why, in one plain sentence.
// Lens decides; the screen shows Lens's figures and, on a refusal, Lens's own sentence.

const BOOK_KEY = ['agent-book']
const ESCROWS_KEY = ['wallet-escrows']
const CASH_OUTS_KEY = ['wallet-cash-outs']
const QUOTES_KEY = ['wallet-quotes']
const potsKey = (id: string) => ['agent-pots', id]
const portfoliosKey = (id: string) => ['agent-portfolios', id]

const selectClass = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

const lxc = (micros: number) => <span className="font-figure">{formatULXC(micros)}</span>

/** A date field's `YYYY-MM-DD` → the start of that day, here, as RFC 3339. Null for an empty or bad date. */
function startOfDay(date: string): string | null {
  const d = new Date(`${date}T00:00:00`)
  return date === '' || Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** 1,500,000 micros of an instrument → `1.5`. */
const units = (micros: number) => (micros / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 6 })

/** Lens's `1.08450000` → `$1.0845`. */
const price = (usdText: string) => `$${Number(usdText).toLocaleString('en-US', { maximumFractionDigits: 8 })}`

// ── Pots ────────────────────────────────────────────────────────────────────────────────────────────

const POT_KINDS: readonly [Pot['kind'], string][] = [
  ['goal', 'Goal'],
  ['budget', 'Budget'],
  ['reserve', 'Reserve'],
]

function PotRow({ agent, pot }: { agent: Agent; pot: Pot }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [until, setUntil] = useState('')
  const micros = parseLXC(amount)
  const lockAt = startOfDay(until)
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: potsKey(agent.id) }), qc.invalidateQueries({ queryKey: BOOK_KEY })])
  // B17.33 — as Money's Fund and Take back (B17.26): the amount and the Idempotency-Key are the mutation's
  // own, so a move sent again through a deploy's restart repeats both and Lens moves the LXC once.
  const move = useMutation({
    mutationFn: ({ dir, ulxc, key }: { dir: 'in' | 'out'; ulxc: number; key: string }) => agentBankApi.movePot(agent.id, pot.id, dir, ulxc, key),
    retry: retryMoveThroughRestart,
    retryDelay: (failures) => Math.min(500 * 2 ** failures, 4_000),
    onSuccess: () => setAmount(''),
    onSettled: refresh,
  })
  const lock = useMutation({
    mutationFn: () => agentBankApi.lockPot(agent.id, pot.id, lockAt),
    onSuccess: () => setUntil(''),
    onSettled: refresh,
  })
  const locked = pot.locked_until !== undefined && new Date(pot.locked_until).getTime() > Date.now()
  return (
    <div className="flex flex-col gap-2 border-t border-rule px-gutter py-3" data-testid="pot">
      <p className="flex flex-wrap items-center gap-2 text-body text-ink">
        {pot.name}
        <Pill status="idle">{POT_KINDS.find(([k]) => k === pot.kind)?.[1] ?? pot.kind}</Pill>
        {lxc(pot.balance_ulxc)}
        {pot.target_ulxc ? <> of {lxc(pot.target_ulxc)}</> : null}
        {locked && pot.locked_until ? (
          <Pill status="held">
            Locked until <span className="font-figure">{formatWhen(pot.locked_until)}</span>
          </Pill>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Amount in LXC to move for ${pot.name}`}
          inputMode="decimal"
          placeholder="LXC"
          className="w-24 font-figure"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button disabled={micros === null || move.isPending} onClick={() => move.mutate({ dir: 'in', ulxc: micros ?? 0, key: newMoveKey() })}>
          Move in
        </Button>
        <Button disabled={micros === null || move.isPending} onClick={() => move.mutate({ dir: 'out', ulxc: micros ?? 0, key: newMoveKey() })}>
          Move out
        </Button>
        <Input type="date" aria-label={`Lock ${pot.name} until`} className="w-40 font-figure" value={until} onChange={(e) => setUntil(e.target.value)} />
        <Button disabled={lockAt === null || lock.isPending} onClick={() => lock.mutate()}>
          {locked ? 'Lock for longer' : 'Lock'}
        </Button>
      </div>
      {move.isError ? <Note ok={false}>Not moved. {refusalText(move.error)}</Note> : null}
      {lock.isError ? <Note ok={false}>Not locked. {refusalText(lock.error)}</Note> : null}
    </div>
  )
}

/** The agent's pots: credits set aside for a goal, a budget or a reserve, and a lock until a date. */
export function Pots({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: potsKey(agent.id), queryFn: () => agentBankApi.pots(agent.id) })
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Pot['kind']>('goal')
  const [target, setTarget] = useState('')
  const [until, setUntil] = useState('')
  const targetMicros = target.trim() === '' ? 0 : parseLXC(target)
  const ready = name.trim() !== '' && targetMicros !== null && (until === '' || startOfDay(until) !== null)
  const create = useMutation({
    mutationFn: () => agentBankApi.createPot(agent.id, { name: name.trim(), kind, target_ulxc: targetMicros ?? 0, locked_until: startOfDay(until) }),
    onSuccess: () => {
      setName('')
      setTarget('')
      setUntil('')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: potsKey(agent.id) }),
  })
  const pots = list.data?.pots ?? []
  return (
    <Card>
      <CardHeader>Pots</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        <p className="text-body text-muted">
          Credits {agent.name} sets aside for a goal, a budget or a reserve. They stay {agent.name}’s, but neither it nor the
          workspace can spend them until they are moved back out, and a locked pot keeps them until its date. Pots earn no
          interest.
        </p>
        <TestMoneyOnly capability="rules_approvals_statements_pots" />
      </div>
      {list.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(list.error, 'The pots')}</p>
      ) : list.isSuccess && pots.length === 0 ? (
        <p className="px-gutter pb-3 text-body text-muted">{agent.name} has no pots yet.</p>
      ) : (
        pots.map((p) => <PotRow key={p.id} agent={agent} pot={p} />)
      )}
      <form
        className="flex flex-col gap-2 border-t border-rule px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !create.isPending) create.mutate()
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="New pot’s name" placeholder="Name" className="wide:w-40" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex items-center gap-1" role="group" aria-label="What the pot is for">
            {POT_KINDS.map(([k, label]) => (
              <Button key={k} aria-pressed={kind === k} variant={kind === k ? 'primary' : 'default'} onClick={() => setKind(k)}>
                {label}
              </Button>
            ))}
          </div>
          <Input
            aria-label="Target in LXC (optional)"
            inputMode="decimal"
            placeholder="target"
            className="w-24 font-figure"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <Input type="date" aria-label="Locked until (optional)" className="w-40 font-figure" value={until} onChange={(e) => setUntil(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!ready || create.isPending}>
            Create pot
          </Button>
        </div>
        {create.isError ? <Note ok={false}>Not created. {refusalText(create.error)}</Note> : null}
      </form>
    </Card>
  )
}

// ── Escrow ──────────────────────────────────────────────────────────────────────────────────────────

/** Pay credits into escrow for any agent: held until delivery is confirmed or the release date passes. */
export function PayIntoEscrow({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [who, setWho] = useState('')
  const [amount, setAmount] = useState('')
  const [release, setRelease] = useState('')
  const [memo, setMemo] = useState('')
  const micros = parseLXC(amount)
  const releaseAt = startOfDay(release)
  const ready = who.trim() !== '' && micros !== null && releaseAt !== null
  const pay = useMutation({
    mutationFn: () => agentBankApi.payIntoEscrow(agent.id, { to: who.trim(), amount_ulxc: micros ?? 0, release_at: releaseAt ?? '', memo: memo.trim() }),
    onSuccess: () => {
      setAmount('')
      setMemo('')
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ESCROWS_KEY }), qc.invalidateQueries({ queryKey: BOOK_KEY })]),
  })
  return (
    <Card>
      <CardHeader>Pay into escrow</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !pay.isPending) pay.mutate()
        }}
      >
        <p className="text-body text-muted">
          The credits leave {agent.name} now and are held, in neither side’s balance, until you confirm the work was
          delivered or the release date passes with no dispute. A dispute holds them until Talyvor decides.
        </p>
        <TestMoneyOnly capability="escrow" />
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Hold for (wallet ID or @handle)" placeholder="@handle or wallet ID" className="wide:w-48" value={who} onChange={(e) => setWho(e.target.value)} />
          <Input
            aria-label="Amount in LXC to hold"
            inputMode="decimal"
            placeholder="LXC"
            className="w-24 font-figure"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input type="date" aria-label="Release on" className="w-40 font-figure" value={release} onChange={(e) => setRelease(e.target.value)} />
          <Input aria-label="What the escrow is for" placeholder="What it is for" className="wide:w-48" value={memo} onChange={(e) => setMemo(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!ready || pay.isPending}>
            Pay into escrow
          </Button>
        </div>
        {pay.isSuccess ? (
          <Note ok>
            Held {lxc(pay.data.amount_ulxc)}
            {pay.data.test_funded_ulxc > 0 ? ' of test money' : ''} until{' '}
            <span className="font-figure">{formatWhen(pay.data.release_at)}</span>. It is under Escrow.
          </Note>
        ) : null}
        {pay.isError ? <Note ok={false}>Not paid in. {refusalText(pay.error)}</Note> : null}
      </form>
    </Card>
  )
}

const ESCROW_STATUS: Record<Escrow['status'], [string, PillStatus]> = {
  held: ['Held', 'held'],
  disputed: ['Disputed', 'slashed'],
  released: ['Released', 'settled'],
  returned: ['Returned', 'parked'],
}

function escrowEventText(e: Escrow['events'][number]): string {
  switch (e.kind) {
    case 'held':
      return 'Paid in and held'
    case 'disputed':
      return `Disputed${e.detail ? `: ${e.detail}` : ''}. Held until Talyvor decides`
    case 'released':
      return e.actor === 'payer'
        ? 'Released to the payee: delivery confirmed'
        : e.actor === 'deadline'
          ? 'Released to the payee at the release date'
          : `Released to the payee by Talyvor${e.detail ? `: ${e.detail}` : ''}`
    case 'returned':
      return `Returned to the payer by Talyvor${e.detail ? `: ${e.detail}` : ''}`
  }
}

function EscrowRow({ escrow, agents }: { escrow: Escrow; agents: Agent[] }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  const paying = agents.some((a) => a.id === escrow.payer_agent_id)
  const act = useMutation({
    mutationFn: (action: 'confirm' | 'dispute') =>
      action === 'confirm' ? agentBankApi.confirmEscrow(escrow.id) : agentBankApi.disputeEscrow(escrow.id, reason.trim()),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ESCROWS_KEY }), qc.invalidateQueries({ queryKey: BOOK_KEY })]),
  })
  const [label, status] = ESCROW_STATUS[escrow.status]
  return (
    <div className="flex flex-col gap-1 border-t border-rule px-gutter py-3" data-testid="escrow">
      <p className="flex flex-wrap items-center gap-2 text-body text-ink">
        {paying
          ? `${nameOf(escrow.payer_agent_id)} holds for ${nameOf(escrow.payee_agent_id)}`
          : `${nameOf(escrow.payee_agent_id)} is owed by ${escrow.payer_agent_id}`}{' '}
        {lxc(escrow.amount_ulxc)}
        <Pill status={status}>{label}</Pill>
        {escrow.test_funded_ulxc > 0 ? <Pill status="held">Test money</Pill> : null}
      </p>
      <p className="text-caption text-muted">
        Releases <span className="font-figure">{formatWhen(escrow.release_at)}</span> unless disputed
        {escrow.memo ? ` · ${escrow.memo}` : ''}
      </p>
      {escrow.events.map((e, i) => (
        <p key={i} className="text-caption text-ink">
          <span className="font-figure">{formatWhen(e.at)}</span> {escrowEventText(e)}
        </p>
      ))}
      {paying && escrow.status === 'held' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={act.isPending} onClick={() => act.mutate('confirm')}>
            Confirm delivered
          </Button>
          <Input aria-label="Why you dispute it" placeholder="Why you dispute it" className="wide:w-56" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button disabled={!reason.trim() || act.isPending} onClick={() => act.mutate('dispute')}>
            Dispute
          </Button>
        </div>
      ) : null}
      {act.isError ? <Note ok={false}>{refusalText(act.error)}</Note> : null}
    </div>
  )
}

/** Every escrow the workspace's agents paid into or are owed from. */
export function Escrows({ agents }: { agents: Agent[] }) {
  const list = useQuery({ queryKey: ESCROWS_KEY, queryFn: agentBankApi.escrows })
  const escrows = list.data?.escrows ?? []
  return (
    <Card>
      <CardHeader>Escrow</CardHeader>
      <div className="px-gutter pt-3">
        <TestMoneyOnly capability="escrow" />
      </div>
      {list.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(list.error, 'The escrows')}</p>
      ) : list.isSuccess && escrows.length === 0 ? (
        <p className="px-gutter py-3 text-body text-muted">
          Nothing in escrow. Open an agent to pay into escrow for any agent; what others hold for yours appears here too.
        </p>
      ) : (
        escrows.map((e) => <EscrowRow key={e.id} escrow={e} agents={agents} />)
      )}
    </Card>
  )
}

// ── Investing, simulated ────────────────────────────────────────────────────────────────────────────

const ORDER_STATUS: Record<SimOrder['status'], [string, PillStatus]> = {
  open: ['Open', 'held'],
  filled: ['Filled', 'settled'],
  cancelled: ['Cancelled', 'parked'],
  rejected: ['Rejected', 'slashed'],
}

function orderText(o: SimOrder): string {
  const what = `${o.side === 'buy' ? 'Buy' : 'Sell'} ${units(o.quantity_micros)} ${o.instrument}`
  const how = o.type === 'market' ? 'at market' : `at ${price(o.limit_price_usd ?? '0')} or better`
  const outcome =
    o.status === 'filled' && o.fill_price_usd
      ? ` — filled at ${price(o.fill_price_usd)}${o.fill_rate_date ? ` (${o.fill_rate_date} rate)` : ''}`
      : o.status === 'rejected' && o.reason
        ? ` — ${o.reason.replace(/^economy: /, '')}`
        : ''
  return `${what} ${how}${outcome}`
}

function PortfolioView({ agent, portfolio, instruments }: { agent: Agent; portfolio: Portfolio; instruments: string[] }) {
  const qc = useQueryClient()
  const [instrument, setInstrument] = useState('')
  const [side, setSide] = useState<SimOrderInput['side']>('buy')
  const [type, setType] = useState<SimOrderInput['type']>('market')
  const [quantity, setQuantity] = useState('')
  const [limit, setLimit] = useState('')
  const qty = parseLXC(quantity)
  const limitOK = type === 'market' || /^\s*\d+(\.\d{1,8})?\s*$/.test(limit)
  const ready = instrument !== '' && qty !== null && limitOK
  const refresh = () => qc.invalidateQueries({ queryKey: portfoliosKey(agent.id) })
  const place = useMutation({
    mutationFn: () =>
      agentBankApi.placeOrder(agent.id, portfolio.id, {
        instrument,
        side,
        type,
        quantity_micros: qty ?? 0,
        ...(type === 'limit' ? { limit_price_usd: limit.trim() } : {}),
      }),
    onSuccess: () => {
      setQuantity('')
      setLimit('')
    },
    onSettled: refresh,
  })
  const cancel = useMutation({ mutationFn: (oid: string) => agentBankApi.cancelOrder(agent.id, portfolio.id, oid), onSettled: refresh })
  const positions = portfolio.positions ?? []
  const orders = portfolio.orders ?? []
  return (
    <div className="flex flex-col gap-2 border-t border-rule px-gutter py-3" data-testid="portfolio">
      <p className="flex flex-wrap items-center gap-2 text-body text-ink">
        {portfolio.name}
        <Pill status="idle">Simulated</Pill>
        <span>
          worth <span className="font-figure">{formatUSD(portfolio.value_uusd)}</span>: <span className="font-figure">{formatUSD(portfolio.cash_uusd)}</span>{' '}
          cash, started with <span className="font-figure">{formatUSD(portfolio.starting_cash_uusd)}</span>
        </span>
      </p>
      <p className="text-caption text-muted">{portfolio.notice}</p>
      {positions.map((p) => (
        <Row key={p.instrument} label={`${units(p.quantity_micros)} ${p.instrument}`} hint={`at ${price(p.price_usd)}`}>
          <span className="font-figure">{formatUSD(p.value_uusd)}</span>
        </Row>
      ))}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !place.isPending) place.mutate()
        }}
      >
        <select aria-label={`Instrument for ${portfolio.name}`} className={`${selectClass} w-28`} value={instrument} onChange={(e) => setInstrument(e.target.value)}>
          <option value="">Currency…</option>
          {instruments.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1" role="group" aria-label="Buy or sell">
          {(['buy', 'sell'] as const).map((s) => (
            <Button key={s} aria-pressed={side === s} variant={side === s ? 'primary' : 'default'} onClick={() => setSide(s)}>
              {s === 'buy' ? 'Buy' : 'Sell'}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Order type">
          {(['market', 'limit'] as const).map((t) => (
            <Button key={t} aria-pressed={type === t} variant={type === t ? 'primary' : 'default'} onClick={() => setType(t)}>
              {t === 'market' ? 'At market' : 'Limit'}
            </Button>
          ))}
        </div>
        <Input aria-label="Quantity" inputMode="decimal" placeholder="quantity" className="w-28 font-figure" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        {type === 'limit' ? (
          <Input aria-label="Limit price in US dollars" inputMode="decimal" placeholder="$ limit" className="w-28 font-figure" value={limit} onChange={(e) => setLimit(e.target.value)} />
        ) : null}
        <Button type="submit" variant="primary" disabled={!ready || place.isPending}>
          Place order
        </Button>
      </form>
      {place.isSuccess ? (
        <Note ok={place.data.status !== 'rejected'}>
          {place.data.status === 'filled'
            ? `Filled: ${orderText(place.data)}.`
            : place.data.status === 'open'
              ? 'Open: it fills when the price crosses your limit.'
              : `Rejected: ${orderText(place.data)}.`}
        </Note>
      ) : null}
      {place.isError ? <Note ok={false}>Not placed. {refusalText(place.error)}</Note> : null}
      {orders.map((o) => (
        <Row key={o.id} label={orderText(o)} hint={formatWhen(o.created_at)}>
          <span className="flex items-center gap-2">
            <Pill status={ORDER_STATUS[o.status][1]}>{ORDER_STATUS[o.status][0]}</Pill>
            {o.status === 'open' ? (
              <Button disabled={cancel.isPending} onClick={() => cancel.mutate(o.id)}>
                Cancel
              </Button>
            ) : null}
          </span>
        </Row>
      ))}
      {cancel.isError ? <Note ok={false}>Not cancelled. {refusalText(cancel.error)}</Note> : null}
    </div>
  )
}

/** The agent's simulated portfolios: simulated US dollars trading real currencies at real prices. */
export function Portfolios({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: portfoliosKey(agent.id), queryFn: () => agentBankApi.portfolios(agent.id) })
  const quotes = useQuery({ queryKey: QUOTES_KEY, queryFn: agentBankApi.quotes })
  const [name, setName] = useState('')
  const [cash, setCash] = useState('')
  const cashMicros = parseLXC(cash)
  const open = useMutation({
    mutationFn: () => agentBankApi.openPortfolio(agent.id, name.trim(), cashMicros ?? 0),
    onSuccess: () => {
      setName('')
      setCash('')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: portfoliosKey(agent.id) }),
  })
  const portfolios = list.data?.portfolios ?? []
  const instruments = (quotes.data?.quotes ?? []).map((q) => q.instrument)
  return (
    <Card>
      <CardHeader>Investing, simulated</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        <p className="text-body text-muted">
          Portfolios of simulated US dollars that buy and sell real currencies at real prices
          {quotes.data?.market_data ? ` (${quotes.data.market_data})` : ''}. No credits move, and no order is ever sent to a
          market.
        </p>
        <TestMoneyOnly
          capability="invest_and_trade"
          label="Simulated only"
          why="Talyvor trades real assets only through an authorised broker partner, and has none yet, so every portfolio here is simulated."
        />
      </div>
      {list.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(list.error, 'The portfolios')}</p>
      ) : list.isSuccess && portfolios.length === 0 ? (
        <p className="px-gutter pb-3 text-body text-muted">{agent.name} has no portfolio yet.</p>
      ) : (
        portfolios.map((p) => <PortfolioView key={p.id} agent={agent} portfolio={p} instruments={instruments} />)
      )}
      <form
        className="flex flex-wrap items-center gap-2 border-t border-rule px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() && cashMicros !== null && !open.isPending) open.mutate()
        }}
      >
        <Input aria-label="New portfolio’s name" placeholder="Name" className="wide:w-40" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          aria-label="Starting simulated US dollars"
          inputMode="decimal"
          placeholder="simulated $"
          className="w-32 font-figure"
          value={cash}
          onChange={(e) => setCash(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!name.trim() || cashMicros === null || open.isPending}>
          Open portfolio
        </Button>
        {open.isError ? <Note ok={false}>Not opened. {refusalText(open.error)}</Note> : null}
      </form>
    </Card>
  )
}

// ── Cash-out ────────────────────────────────────────────────────────────────────────────────────────

/** Ask to turn the agent's credits back into money, paid through Talyvor's payments partner. */
export function CashOutCard({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [destination, setDestination] = useState('')
  const micros = parseLXC(amount)
  const ready = micros !== null && destination.trim() !== ''
  const ask = useMutation({
    mutationFn: () => agentBankApi.requestCashOut(agent.id, micros ?? 0, destination.trim()),
    onSuccess: () => setAmount(''),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: CASH_OUTS_KEY }), qc.invalidateQueries({ queryKey: BOOK_KEY })]),
  })
  return (
    <Card>
      <CardHeader>Cash out</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !ask.isPending) ask.mutate()
        }}
      >
        <p className="text-body text-muted">
          Turn {agent.name}’s credits back into money, paid to the account you name. The credits are held while Talyvor’s
          payments partner pays it, and come back if the payment fails. Only the workspace’s owner can ask.
        </p>
        <TestMoneyOnly capability="cash_out" />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Amount in LXC to cash out"
            inputMode="decimal"
            placeholder="LXC"
            className="w-24 font-figure"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input
            aria-label="Pay to (a name for the account)"
            placeholder="Pay to"
            className="wide:w-56"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={!ready || ask.isPending}>
            Ask to cash out
          </Button>
        </div>
        {ask.isSuccess ? (
          <Note ok>
            Asked: {lxc(ask.data.amount_ulxc)}
            {ask.data.test_funded_ulxc > 0 ? ' of test money' : ''} is held and is under Cash-outs until it is paid.
          </Note>
        ) : null}
        {ask.isError ? <Note ok={false}>Not cashed out. {refusalText(ask.error)}</Note> : null}
      </form>
    </Card>
  )
}

const CASH_OUT_STATUS: Record<CashOut['status'], [string, PillStatus]> = {
  held: ['Held', 'held'],
  submitted: ['With the partner', 'idle'],
  paid: ['Paid', 'settled'],
  failed: ['Failed, credits back', 'slashed'],
}

/** Every cash-out the workspace asked for, and where it stands. */
export function CashOuts({ agents }: { agents: Agent[] }) {
  const list = useQuery({ queryKey: CASH_OUTS_KEY, queryFn: agentBankApi.cashOuts })
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  const cashOuts = list.data?.cash_outs ?? []
  return (
    <Card>
      <CardHeader>Cash-outs</CardHeader>
      <div className="px-gutter pt-3">
        <TestMoneyOnly capability="cash_out" />
      </div>
      {list.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(list.error, 'The cash-outs')}</p>
      ) : list.isSuccess && cashOuts.length === 0 ? (
        <p className="px-gutter py-3 text-body text-muted">No cash-outs yet. Open an agent to ask for one.</p>
      ) : (
        cashOuts.map((c) => (
          <Row
            key={c.id}
            label={`${nameOf(c.agent_id)} to ${c.destination}`}
            hint={`${formatWhen(c.created_at)}${c.detail ? ` · ${c.detail}` : ''}`}
          >
            <span className="flex flex-wrap items-center gap-2" data-testid="cash-out">
              {c.test_funded_ulxc > 0 ? <Pill status="held">Test money</Pill> : null}
              {lxc(c.amount_ulxc)} = <span className="font-figure">{formatUSD(c.amount_uusd)}</span>
              <Pill status={CASH_OUT_STATUS[c.status][1]}>{CASH_OUT_STATUS[c.status][0]}</Pill>
            </span>
          </Row>
        ))
      )}
    </Card>
  )
}
