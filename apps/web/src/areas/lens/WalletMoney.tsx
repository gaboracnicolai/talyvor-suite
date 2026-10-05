import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Pill, Row, type PillStatus } from '@talyvor/ui'
import { Card, pressed } from './walletBrand'
import { isSessionExpired } from '../../lib/productState'
import { formatWhen } from './format'
import { Lxc } from './money'
import {
  type Agent,
  type AgentTransfer,
  type Loan,
  type LoanOffer,
  type WalletCapability,
  agentBankApi,
  formatULXC,
  parseLXC,
  refusalText,
} from './agentBankApi'

// WalletMoney.tsx — B22.10: Agent Wallets' money between owners. An agent's address (its wallet ID and a
// handle), sending credits to any agent on Talyvor and asking one for them (Lens B22.3), the requests the
// workspace's agents made and were made, paying another owner's agent every day, week or month, the
// company's credit line (B22.4), and loans between companies — offered, accepted, their instalments,
// late and default (B22.5).
//
// Every capability here carries its class (B22.1). An AMBER or RED one that Talyvor has not cleared takes
// test money only, and the screen says so beside it, with why, in one plain sentence. Lens decides; the
// screen shows Lens's figures and, on a refusal, Lens's own sentence.

export const CAPABILITIES_KEY = ['wallet-capabilities']
const REQUESTS_KEY = ['wallet-requests']
const LOANS_KEY = ['wallet-loans']
const CREDIT_KEY = ['wallet-credit-line']
const BOOK_KEY = ['agent-book']
const transfersKey = (id: string) => ['agent-transfers', id]

const lxc = (micros: number) => <Lxc ulxc={micros} />

export function Note({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p role={ok ? 'status' : 'alert'} className="text-caption text-ink">
      {children}
    </p>
  )
}

export function readFailure(err: unknown, what: string): string {
  return isSessionExpired(err) ? `${what} can’t be read until you sign in again.` : `${what} could not be read just now.`
}

/** Why a class keeps a capability to test money, in one plain sentence. */
const WHY: Record<WalletCapability['class'], string> = {
  GREEN: '',
  AMBER: 'Talyvor is waiting for a lawyer’s sign-off before this moves real money, so for now it uses test credits only.',
  RED: 'This needs a licensed partner before it can use real money, so for now it uses test credits only.',
}

function useCapabilities() {
  return useQuery({ queryKey: CAPABILITIES_KEY, queryFn: agentBankApi.capabilities })
}

/**
 * "Test money only" beside an AMBER or RED capability Talyvor has not cleared, and why. Nothing for a
 * GREEN one or a cleared one, and nothing while the classes are unread. A capability that never touches
 * credits here (B22.12's simulated investing) names what it uses instead, with label and why.
 */
export function TestMoneyOnly({ capability, label = 'Test money only', why }: { capability: string; label?: string; why?: string }) {
  const caps = useCapabilities()
  const c = caps.data?.capabilities?.find((x) => x.capability === capability)
  if (!c || c.real_money) return null
  return (
    <p className="flex flex-wrap items-center gap-2 text-caption text-ink" data-testid={`test-money-only-${capability}`}>
      <Pill status="held">{label}</Pill>
      <span>
        {c.name}: {why ?? WHY[c.class]}
      </span>
    </p>
  )
}

/** The agent's address: its wallet ID, and a handle others can send to. */
export function AgentAddress({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [handle, setHandle] = useState(agent.handle ?? '')
  const save = useMutation({
    mutationFn: () => agentBankApi.setHandle(agent.id, handle.trim().replace(/^@/, '')),
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  return (
    <Card>
      <CardHeader>Address</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (handle.trim() && !save.isPending) save.mutate()
        }}
      >
        <p className="text-body text-ink" data-testid="agent-address">
          Anyone on Talyvor can send {agent.name} credits at wallet ID <span className="font-figure">{agent.id}</span>
          {agent.handle ? (
            <>
              {' '}
              or <span className="font-figure">@{agent.handle}</span>
            </>
          ) : null}
          .
        </p>
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Handle for ${agent.name}`}
            placeholder="handle"
            className="min-w-0 flex-1 wide:w-48 wide:flex-none"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
          <Button type="submit" disabled={!handle.trim() || save.isPending}>
            {agent.handle ? 'Change handle' : 'Set handle'}
          </Button>
        </div>
        {save.isSuccess ? <Note ok>{agent.name} is now @{save.data.handle}.</Note> : null}
        {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
      </form>
    </Card>
  )
}

/** Send credits to any agent on Talyvor, or ask one for them. */
export function SendAndRequest({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'send' | 'request'>('send')
  const [who, setWho] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const micros = parseLXC(amount)
  const move = useMutation({
    mutationFn: async () => {
      const address = who.trim()
      if (mode === 'send') return { kind: 'sent' as const, t: await agentBankApi.send(agent.id, address, micros ?? 0, memo.trim()) }
      await agentBankApi.request(agent.id, address, micros ?? 0, memo.trim())
      return { kind: 'asked' as const, t: null }
    },
    onSuccess: () => {
      setAmount('')
      setMemo('')
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: REQUESTS_KEY }),
        qc.invalidateQueries({ queryKey: transfersKey(agent.id) }),
      ]),
  })
  const sent = move.data?.t ?? null
  return (
    <Card>
      <CardHeader>Send or request</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (who.trim() && micros !== null && !move.isPending) move.mutate()
        }}
      >
        <p className="text-body text-muted">
          To or from any agent on Talyvor, by its wallet ID or @handle. Credits stay credits: the other side can spend
          them only on Talyvor. Sending is judged by {agent.name}’s rules.
        </p>
        <TestMoneyOnly capability="pay_another_owner" />
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Send or request">
          <Button aria-pressed={mode === 'send'} className={pressed} onClick={() => setMode('send')}>
            Send
          </Button>
          <Button aria-pressed={mode === 'request'} className={pressed} onClick={() => setMode('request')}>
            Request
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={mode === 'send' ? 'Send to (wallet ID or @handle)' : 'Request from (wallet ID or @handle)'}
            placeholder="@handle or wallet ID"
            className="wide:w-56"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          />
          <Input
            aria-label={`Amount in LXC to ${mode}`}
            inputMode="decimal"
            placeholder="LXC"
            className="w-28 font-figure"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input aria-label="What it is for" placeholder="What it is for" className="wide:w-56" value={memo} onChange={(e) => setMemo(e.target.value)} />
          <Button type="submit" disabled={!who.trim() || micros === null || move.isPending}>
            {mode === 'send' ? 'Send credits' : 'Ask for credits'}
          </Button>
        </div>
        {move.isSuccess && sent ? (
          <Note ok>
            Sent {lxc(sent.amount_ulxc)}
            {sent.test_funded_ulxc > 0 ? ' of test money' : ''}. {sent.class === 'AMBER' ? 'It went to another owner’s agent.' : 'It stayed with one owner.'}
          </Note>
        ) : null}
        {move.isSuccess && !sent ? <Note ok>Asked. They see the request and can accept or decline it.</Note> : null}
        {move.isError ? <Note ok={false}>Refused. {refusalText(move.error)}</Note> : null}
      </form>
    </Card>
  )
}

/** Pay another owner's agent every day, week or month: a schedule whose payee is any agent (Lens B22.3). */
export function RecurringTransfer({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [who, setWho] = useState('')
  const [amount, setAmount] = useState('')
  const [every, setEvery] = useState<'day' | 'week' | 'month'>('month')
  const [memo, setMemo] = useState('')
  const micros = parseLXC(amount)
  const start = useMutation({
    mutationFn: async () => {
      const to = await agentBankApi.address(who.trim())
      return agentBankApi.schedule(agent.id, { to_agent_id: to.wallet_id, to_listing_id: '', amount_ulxc: micros ?? 0, memo: memo.trim(), every })
    },
    onSuccess: () => {
      setAmount('')
      setMemo('')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['agent-schedules'] }),
  })
  return (
    <Card>
      <CardHeader>Recurring transfer</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (who.trim() && micros !== null && !start.isPending) start.mutate()
        }}
      >
        <p className="text-body text-muted">Pay any agent on Talyvor the same amount every day, week or month.</p>
        <TestMoneyOnly capability="pay_another_owner" />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Pay every period to (wallet ID or @handle)"
            placeholder="@handle or wallet ID"
            className="wide:w-56"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          />
          <Input
            aria-label="Recurring amount in LXC"
            inputMode="decimal"
            placeholder="LXC"
            className="w-28 font-figure"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="flex items-center gap-1" role="group" aria-label="How often">
            {(['day', 'week', 'month'] as const).map((p) => (
              <Button key={p} aria-pressed={every === p} className={pressed} onClick={() => setEvery(p)}>
                Every {p}
              </Button>
            ))}
          </div>
          <Input aria-label="What the recurring transfer is for" placeholder="What it is for" className="wide:w-48" value={memo} onChange={(e) => setMemo(e.target.value)} />
          <Button type="submit" disabled={!who.trim() || micros === null || start.isPending}>
            Start
          </Button>
        </div>
        {start.isSuccess ? (
          <Note ok>
            {lxc(start.data.amount_ulxc)} every {start.data.every}, first on{' '}
            <span className="font-figure">{formatWhen(start.data.next_run_at)}</span>. It is listed under Scheduled payments.
          </Note>
        ) : null}
        {start.isError ? <Note ok={false}>Not started. {refusalText(start.error)}</Note> : null}
      </form>
    </Card>
  )
}

function transferText(t: AgentTransfer, agentID: string): string {
  const out = t.from_agent_id === agentID
  const verb = t.refund_of ? (out ? 'Gave back' : 'Given back') : out ? 'Sent' : 'Received'
  const other = out ? t.to_agent_id : t.from_agent_id
  return `${verb} ${out ? 'to' : 'from'} ${other}${t.memo ? ` — ${t.memo}` : ''}`
}

/**
 * What the agent sent to and received from other agents. B28.23: a transfer it received and Lens says it may
 * still give back has "Give back", asked twice; Lens moves the same amount back to the sender as one refund.
 */
export function AgentTransfers({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: transfersKey(agent.id), queryFn: () => agentBankApi.transfers(agent.id) })
  const [asking, setAsking] = useState<string | null>(null)
  const giveBack = useMutation({
    mutationFn: (t: AgentTransfer) => agentBankApi.refundTransfer(t.id),
    onSettled: () => {
      setAsking(null)
      return Promise.all([
        qc.invalidateQueries({ queryKey: transfersKey(agent.id) }),
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: ['agent-statement'] }),
      ])
    },
  })
  const transfers = list.data?.transfers ?? []
  return (
    <Card>
      <CardHeader>Transfers</CardHeader>
      {list.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(list.error, 'The transfers')}</p>
      ) : list.isSuccess && transfers.length === 0 ? (
        <p className="px-gutter py-3 text-body text-muted">{agent.name} has not sent or received a transfer yet.</p>
      ) : (
        transfers.map((t) => (
          <Row key={t.id} label={transferText(t, agent.id)} hint={formatWhen(t.created_at)}>
            <span className="flex flex-wrap items-center gap-2">
              {t.test_funded_ulxc > 0 ? <Pill status="held">Test money</Pill> : null}
              {t.refunded_by ? <Pill status="settled">Given back</Pill> : null}
              {lxc(t.from_agent_id === agent.id ? -t.amount_ulxc : t.amount_ulxc)}
              {!t.refundable ? null : asking === t.id ? (
                <>
                  <Button disabled={giveBack.isPending} onClick={() => giveBack.mutate(t)}>
                    Yes, give it back
                  </Button>
                  <Button disabled={giveBack.isPending} onClick={() => setAsking(null)}>
                    Keep it
                  </Button>
                </>
              ) : (
                <Button disabled={giveBack.isPending} onClick={() => setAsking(t.id)}>
                  Give back
                </Button>
              )}
            </span>
          </Row>
        ))
      )}
      {giveBack.isSuccess ? (
        <div className="px-gutter py-2">
          <Note ok>
            Gave {lxc(giveBack.data.amount_ulxc)} back to {giveBack.data.to_agent_id}.
          </Note>
        </div>
      ) : giveBack.isError ? (
        <div className="px-gutter py-2">
          <Note ok={false}>Not given back. {refusalText(giveBack.error)}</Note>
        </div>
      ) : null}
    </Card>
  )
}

/** The requests the workspace's agents were asked and made; an incoming one is accepted or declined here. */
export function MoneyRequests({ agents }: { agents: Agent[] }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: REQUESTS_KEY, queryFn: agentBankApi.moneyRequests })
  const answer = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => agentBankApi.answerRequest(id, accept),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: REQUESTS_KEY }), qc.invalidateQueries({ queryKey: BOOK_KEY })]),
  })
  const mine = new Set(agents.map((a) => a.id))
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  const requests = list.data?.requests ?? []
  return (
    <Card>
      <CardHeader>Requests</CardHeader>
      {list.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(list.error, 'The requests')}</p>
      ) : list.isSuccess && requests.length === 0 ? (
        <p className="px-gutter py-3 text-body text-muted">
          No requests yet. Ask any agent for credits from an agent’s Send or request card; what others ask of your agents
          appears here to accept or decline.
        </p>
      ) : (
        requests.map((r) => {
          const incoming = mine.has(r.to_agent_id)
          return (
            <Row
              key={r.id}
              label={incoming ? `${nameOf(r.from_agent_id)} asks ${nameOf(r.to_agent_id)}` : `${nameOf(r.from_agent_id)} asked ${nameOf(r.to_agent_id)}`}
              hint={`${r.memo ? `${r.memo} · ` : ''}${formatWhen(r.created_at)}`}
            >
              <span className="flex flex-wrap items-center gap-2">
                {lxc(r.amount_ulxc)}
                {r.status !== 'pending' ? (
                  <Pill status={r.status === 'accepted' ? 'settled' : 'slashed'}>{r.status === 'accepted' ? 'Accepted' : 'Declined'}</Pill>
                ) : incoming ? (
                  <>
                    <Button disabled={answer.isPending} onClick={() => answer.mutate({ id: r.id, accept: true })}>
                      Accept
                    </Button>
                    <Button disabled={answer.isPending} onClick={() => answer.mutate({ id: r.id, accept: false })}>
                      Decline
                    </Button>
                  </>
                ) : (
                  <Pill status="idle">Waiting</Pill>
                )}
              </span>
            </Row>
          )
        })
      )}
      {answer.isError ? (
        <div className="px-gutter py-2">
          <Note ok={false}>Not paid. {refusalText(answer.error)}</Note>
        </div>
      ) : null}
    </Card>
  )
}

/** The company's credit line: what it may use, what it has used, and its monthly invoices. */
export function CreditLinePanel() {
  const line = useQuery({ queryKey: CREDIT_KEY, queryFn: agentBankApi.creditLine })
  return (
    <Card>
      <CardHeader>Credit line</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        <TestMoneyOnly capability="company_credit_line" />
        {line.isError ? (
          <p className="text-body text-muted">{readFailure(line.error, 'The credit line')}</p>
        ) : line.isSuccess && line.data === null ? (
          <p className="text-body text-muted" data-testid="no-credit-line">
            This workspace has no credit line. Talyvor can give a company one: its agents then spend past zero, up to
            the limit, and the company pays what they used once a month.
          </p>
        ) : line.data ? (
          <>
            <p className="text-body text-ink" data-testid="credit-line">
              Your agents may spend up to {lxc(line.data.limit_ulxc)} past zero. They have used {lxc(line.data.used_ulxc)}, and{' '}
              {lxc(line.data.available_ulxc)} is left.
            </p>
            {line.data.paused ? (
              <Note ok={false}>The credit line is paused{line.data.paused_reason ? `: ${line.data.paused_reason}` : ''}.</Note>
            ) : null}
            {line.data.invoices.map((i) => (
              <Row key={i.id} label={`Invoice for use before ${formatWhen(i.period_end)}`} hint={`Due ${formatWhen(i.due_at)}`}>
                <span className="flex items-center gap-2">
                  <span className="font-figure">${(i.amount_cents / 100).toFixed(2)}</span>
                  <Pill status={i.paid_at ? 'settled' : i.late ? 'slashed' : 'held'}>{i.paid_at ? 'Paid' : i.late ? 'Late' : 'Open'}</Pill>
                </span>
              </Row>
            ))}
          </>
        ) : (
          <p className="text-body text-muted">Reading…</p>
        )}
      </div>
    </Card>
  )
}

const LOAN_STATUS: Record<Loan['status'], [string, PillStatus]> = {
  offered: ['Offered', 'idle'],
  declined: ['Declined', 'parked'],
  withdrawn: ['Withdrawn', 'parked'],
  active: ['Repaying', 'held'],
  late: ['Late', 'slashed'],
  defaulted: ['In default', 'slashed'],
  repaid: ['Repaid', 'settled'],
}

function eventText(e: Loan['events'][number], l: Loan): string {
  switch (e.kind) {
    case 'payout':
      return 'Paid out to the borrower'
    case 'instalment':
      return `Instalment ${e.instalment} of ${l.instalments} repaid: ${formatULXC(e.principal_ulxc ?? 0)} + ${formatULXC(e.interest_ulxc ?? 0)} interest${
        e.late_fee_ulxc ? ` + ${formatULXC(e.late_fee_ulxc)} late fee` : ''
      }`
    case 'missed':
      return `Instalment ${e.instalment} missed${e.detail ? ` — ${e.detail.replace(/^economy: /, '')}` : ''}`
    case 'late':
      return 'The loan is late; the instalment is tried again one period on, with the late fee'
    case 'defaulted':
      return 'Missed again: the loan is in default'
  }
}

/** One loan, as either side sees it. */
function LoanRow({ loan, agents }: { loan: Loan; agents: Agent[] }) {
  const qc = useQueryClient()
  const mine = new Set(agents.map((a) => a.id))
  const lending = mine.has(loan.lender_agent_id)
  const act = useMutation({
    mutationFn: (action: 'accept' | 'decline' | 'withdraw') =>
      action === 'accept'
        ? agentBankApi.acceptLoan(loan.id)
        : action === 'decline'
          ? agentBankApi.declineLoan(loan.id)
          : agentBankApi.withdrawLoan(loan.id),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: LOANS_KEY }), qc.invalidateQueries({ queryKey: BOOK_KEY })]),
  })
  const [label, status] = LOAN_STATUS[loan.status]
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  return (
    <div className="flex flex-col gap-1 border-t border-rule px-gutter py-3" data-testid="loan">
      <p className="flex flex-wrap items-center gap-2 text-body text-ink">
        {lending ? `${nameOf(loan.lender_agent_id)} lends ${loan.borrower_agent_id}` : `${nameOf(loan.borrower_agent_id)} borrows from ${loan.lender_agent_id}`}{' '}
        {lxc(loan.principal_ulxc)} at {loan.interest_bps / 100}% over {loan.instalments} {loan.every === 'day' ? 'daily' : `${loan.every}ly`}{' '}
        instalments
        <Pill status={status}>{label}</Pill>
      </p>
      <p className="text-caption text-muted">
        <span className="font-figure">
          {loan.paid_instalments} of {loan.instalments}
        </span>{' '}
        repaid
        {loan.next_due_at ? (
          <>
            {' '}
            · next due <span className="font-figure">{formatWhen(loan.next_due_at)}</span>
          </>
        ) : null}
        {loan.late_fee_ulxc ? <> · late fee {lxc(loan.late_fee_ulxc)}</> : null}
        {loan.memo ? ` · ${loan.memo}` : ''}
      </p>
      {loan.events.map((e, i) => (
        <p key={i} className="text-caption text-ink">
          <span className="font-figure">{formatWhen(e.at)}</span> {eventText(e, loan)}
        </p>
      ))}
      {loan.status === 'offered' ? (
        <div className="flex gap-2">
          {lending ? (
            <Button disabled={act.isPending} onClick={() => act.mutate('withdraw')}>
              Withdraw the offer
            </Button>
          ) : (
            <>
              <Button disabled={act.isPending} onClick={() => act.mutate('accept')}>
                Accept the loan
              </Button>
              <Button disabled={act.isPending} onClick={() => act.mutate('decline')}>
                Decline
              </Button>
            </>
          )}
        </div>
      ) : null}
      {act.isError ? <Note ok={false}>{refusalText(act.error)}</Note> : null}
    </div>
  )
}

/** The loans the workspace lends and borrows. */
export function Loans({ agents }: { agents: Agent[] }) {
  const list = useQuery({ queryKey: LOANS_KEY, queryFn: agentBankApi.loans })
  const loans = list.data?.loans ?? []
  return (
    <Card>
      <CardHeader>Loans</CardHeader>
      <div className="px-gutter pt-3">
        <TestMoneyOnly capability="loans_between_companies" />
      </div>
      {list.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(list.error, 'The loans')}</p>
      ) : list.isSuccess && loans.length === 0 ? (
        <p className="px-gutter py-3 text-body text-muted">
          No loans yet. Open an agent and offer one to another company’s agent; a loan offered to yours appears here when
          it is made.
        </p>
      ) : (
        loans.map((l) => <LoanRow key={l.id} loan={l} agents={agents} />)
      )}
    </Card>
  )
}

/** Offer a loan from this agent to another company's agent. */
export function OfferLoan({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [to, setTo] = useState('')
  const [principal, setPrincipal] = useState('')
  const [rate, setRate] = useState('')
  const [instalments, setInstalments] = useState('3')
  const [every, setEvery] = useState<LoanOffer['every']>('month')
  const [fee, setFee] = useState('')
  const [memo, setMemo] = useState('')
  const micros = parseLXC(principal)
  const pct = /^\s*\d+(\.\d{1,2})?\s*$/.test(rate) ? Math.round(Number(rate) * 100) : null
  const n = /^\s*\d+\s*$/.test(instalments) ? Number(instalments) : null
  const lateFee = fee.trim() === '' ? 0 : parseLXC(fee)
  const ready = to.trim() !== '' && micros !== null && pct !== null && n !== null && n >= 1 && lateFee !== null
  const offer = useMutation({
    mutationFn: () =>
      agentBankApi.offerLoan(agent.id, {
        to: to.trim(),
        principal_ulxc: micros ?? 0,
        interest_bps: pct ?? 0,
        instalments: n ?? 0,
        every,
        late_fee_ulxc: lateFee ?? 0,
        memo: memo.trim(),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: LOANS_KEY }),
  })
  return (
    <Card>
      <CardHeader>Offer a loan</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !offer.isPending) offer.mutate()
        }}
      >
        <p className="text-body text-muted">
          To another company’s agent. The borrower repays in equal instalments with the interest; a missed one makes the
          loan late, and missed again it is in default. Both companies see every instalment.
        </p>
        <TestMoneyOnly capability="loans_between_companies" />
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Lend to (wallet ID or @handle)" placeholder="@handle or wallet ID" className="wide:w-48" value={to} onChange={(e) => setTo(e.target.value)} />
          <Input aria-label="Loan amount in LXC" inputMode="decimal" placeholder="LXC" className="w-24 font-figure" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          <Input aria-label="Interest over the whole loan, in percent" inputMode="decimal" placeholder="% interest" className="w-28 font-figure" value={rate} onChange={(e) => setRate(e.target.value)} />
          <Input aria-label="Number of instalments" inputMode="numeric" className="w-16 font-figure" value={instalments} onChange={(e) => setInstalments(e.target.value)} />
          <div className="flex items-center gap-1" role="group" aria-label="Instalments every">
            {(['day', 'week', 'month'] as const).map((p) => (
              <Button key={p} aria-pressed={every === p} className={pressed} onClick={() => setEvery(p)}>
                Every {p}
              </Button>
            ))}
          </div>
          <Input aria-label="Late fee in LXC" inputMode="decimal" placeholder="late fee" className="w-24 font-figure" value={fee} onChange={(e) => setFee(e.target.value)} />
          <Input aria-label="What the loan is for" placeholder="What it is for" className="wide:w-48" value={memo} onChange={(e) => setMemo(e.target.value)} />
          <Button type="submit" disabled={!ready || offer.isPending}>
            Offer
          </Button>
        </div>
        {offer.isSuccess ? <Note ok>Offered. It is under Loans until the borrower accepts or declines.</Note> : null}
        {offer.isError ? <Note ok={false}>Not offered. {refusalText(offer.error)}</Note> : null}
      </form>
    </Card>
  )
}
