import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Input, inlineLink } from '@talyvor/ui'
import { api } from '../../lib/api'
import { BOOK_KEY, rulesKey, statementKey } from './AgentBank'
import { CopyBlock } from './Setup'
import { toolsFor } from './setupSnippets'
import {
  type Agent,
  type AgentBook,
  type AgentKey,
  type StatementLine,
  agentBankApi,
  formatULXC,
  newMoveKey,
  parseLXC,
  refusalText,
  retryMoveThroughRestart,
} from './agentBankApi'

// Onboarding.tsx — B28.8: a new workspace's first agent, in three steps on Home. It replaced the
// full-screen sharing-consent page a new workspace used to open on; sharing is now one line on Home.
//   1. Create the agent with a monthly budget and the amount above which a person must approve.
//   2. Fund it from the workspace.
//   3. Issue its key and copy a snippet, then watch its first request land on its statement.
// Each step writes through the same BFF routes and query keys as Agent Wallets, so what is done here
// is what that screen shows. Lens judges every write; a refusal shows Lens's own sentence.

const lxc = (micros: number) => (
  <>
    <span className="font-figure">{formatULXC(micros).replace(/ LXC$/, '')}</span> LXC
  </>
)

function Refused({ error }: { error: unknown }) {
  return (
    <p role="alert" className="text-caption text-ink">
      {refusalText(error)}
    </p>
  )
}

/** Step 1: the agent, its monthly budget and its approval amount. A blank approval amount asks nobody. */
function CreateStep({ onCreated }: { onCreated: (a: Agent) => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [budget, setBudget] = useState('')
  const [approval, setApproval] = useState('')
  const budgetMicros = parseLXC(budget)
  const approvalMicros = approval.trim() === '' ? 0 : parseLXC(approval)
  // The agent is kept once Lens made it, so a rules write that failed is tried again without a second agent.
  const [made, setMade] = useState<Agent | null>(null)
  const create = useMutation({
    mutationFn: async () => {
      const a = made ?? (await agentBankApi.create(name.trim()))
      setMade(a)
      const current = await agentBankApi.rules(a.id)
      const saved = await agentBankApi.setRules(a.id, {
        ...current,
        monthly_limit_ulxc: budgetMicros ?? 0,
        approval_above_ulxc: approvalMicros ?? 0,
      })
      qc.setQueryData(rulesKey(a.id), saved)
      return a
    },
    onSuccess: onCreated,
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  const ready = (made !== null || name.trim() !== '') && budgetMicros !== null && approvalMicros !== null
  return (
    <form
      className="mt-4 flex w-full flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !create.isPending) create.mutate()
      }}
    >
      <Input aria-label="Agent name" placeholder="Agent name" value={made?.name ?? name} disabled={made !== null} onChange={(e) => setName(e.target.value)} />
      <div className="flex flex-col gap-3 wide:flex-row">
        <Input
          aria-label="Monthly budget, in LXC"
          inputMode="decimal"
          placeholder="Monthly budget, LXC"
          className="font-figure"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
        <Input
          aria-label="Ask a person above, in LXC"
          inputMode="decimal"
          placeholder="Ask a person above, LXC"
          className="font-figure"
          value={approval}
          onChange={(e) => setApproval(e.target.value)}
        />
      </div>
      <p className="text-caption font-normal text-muted">
        Lens refuses what would take it past its budget this month, and holds anything above the approval amount for a
        person to approve. Leave the approval amount blank and nothing is held.
      </p>
      <div>
        <Button type="submit" variant="primary" disabled={!ready || create.isPending}>
          {create.isPending ? 'Creating…' : made ? 'Save its rules' : 'Create agent'}
        </Button>
      </div>
      {create.isError ? <Refused error={create.error} /> : null}
    </form>
  )
}

/** Step 2: the workspace funds the agent. With nothing free to give, Billing is where credit comes from. */
function FundStep({ agent, book, onFunded }: { agent: Agent; book: AgentBook; onFunded: () => void }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const micros = parseLXC(amount)
  // B17.26 — the amount and the Idempotency-Key are the mutation's own, so a retry through a deploy's
  // restart repeats both and Lens moves the LXC once.
  const fund = useMutation({
    mutationFn: ({ ulxc, key }: { ulxc: number; key: string }) => agentBankApi.fund(agent.id, ulxc, key),
    retry: retryMoveThroughRestart,
    retryDelay: (failures) => Math.min(500 * 2 ** failures, 4_000),
    onSuccess: onFunded,
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: statementKey(agent.id) }),
      ]),
  })
  if (book.unallocated_ulxc <= 0) {
    return (
      <div className="mt-4 flex flex-col items-start gap-3">
        <p className="text-body text-ink" data-testid="onboarding-no-credit">
          The workspace has no LXC free to give {agent.name}. Put credit in it on Billing, then fund {agent.name} here.
        </p>
        <Button asChild variant="primary">
          <Link to="/billing">Open Billing</Link>
        </Button>
      </div>
    )
  }
  return (
    <form
      className="mt-4 flex w-full flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (micros !== null && !fund.isPending) fund.mutate({ ulxc: micros, key: newMoveKey() })
      }}
    >
      <p className="text-body text-ink">
        The workspace has {lxc(book.unallocated_ulxc)} free. {agent.name} spends only what you give it.
      </p>
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Amount to fund ${agent.name}, in LXC`}
          inputMode="decimal"
          placeholder="LXC"
          className="w-28 font-figure"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={micros === null || fund.isPending}>
          {fund.isPending ? 'Funding…' : `Fund ${agent.name}`}
        </Button>
      </div>
      {fund.isError ? <Refused error={fund.error} /> : null}
    </form>
  )
}

const REQUEST_KINDS: readonly StatementLine['kind'][] = ['spend', 'hold', 'settle', 'release']

/** The oldest line a request put on the statement; Lens lists it newest first. Chat's launch card (B28.350) reads it too. */
export const firstRequest = (lines: StatementLine[] | null | undefined): StatementLine | null =>
  [...(lines ?? [])].reverse().find((l) => REQUEST_KINDS.includes(l.kind)) ?? null

/** Step 3: its key, a snippet to paste, and the statement read until the agent's first request is on it. */
function KeyStep({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [issued, setIssued] = useState<AgentKey | null>(null)
  const issue = useMutation({
    mutationFn: () => agentBankApi.issueKey(agent.id, agent.name),
    onSuccess: (k) => setIssued(k), // held in this component only; shown while the step is open
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  const ctx = useQuery({ queryKey: ['context'], queryFn: api.context, staleTime: 60_000 })
  // Read every three seconds once the key exists, until a request has landed. Lens lists newest first.
  const st = useQuery({
    queryKey: statementKey(agent.id),
    queryFn: () => agentBankApi.statement(agent.id),
    enabled: issued !== null,
    refetchInterval: (q) => (firstRequest(q.state.data?.lines) === null ? 3_000 : false),
  })
  const first = firstRequest(st.data?.lines)

  if (issued === null) {
    return (
      <div className="mt-4 flex flex-col items-start gap-3">
        <p className="text-caption font-normal text-muted">A key that spends only {agent.name}’s wallet, under its rules. It is shown once.</p>
        <Button variant="primary" disabled={issue.isPending} onClick={() => issue.mutate()}>
          {issue.isPending ? 'Issuing…' : 'Issue its key'}
        </Button>
        {issue.isError ? <Refused error={issue.error} /> : null}
      </div>
    )
  }
  const base = ctx.data?.lens_public_base_url ?? ''
  const tools = toolsFor(base, issued.key).filter((t) => t.kind === 'env')
  return (
    <div className="mt-4 flex w-full flex-col gap-3">
      <p className="text-body text-ink">
        {agent.name}’s key — store it now, it will not be shown again:{' '}
        <span className="break-all font-mono" data-testid="onboarding-key">
          {issued.key}
        </span>
      </p>
      {ctx.isError ? (
        <p className="text-caption text-muted">The address to point it at could not be read just now; Setup has it.</p>
      ) : !ctx.data ? (
        <p className="text-caption text-muted">Reading the address to point it at…</p>
      ) : tools.length === 0 ? (
        <p className="text-caption text-muted">
          This deployment publishes no Lens address yet, so there is nothing to point it at.{' '}
          <Link to="/setup" className={inlineLink}>
            Setup
          </Link>{' '}
          says who sets it.
        </p>
      ) : (
        tools.map((t) => (
          <div key={t.id} className="flex flex-col gap-1">
            <p className="text-caption text-ink">{t.name}</p>
            <CopyBlock text={t.copyText} label="the two lines" />
          </div>
        ))
      )}
      {first !== null ? (
        <p role="status" className="text-body text-ink" data-testid="onboarding-first-request">
          {agent.name}’s first request is on its statement: {first.amount_ulxc < 0 ? '−' : '+'}
          {lxc(Math.abs(first.amount_ulxc))}, leaving {lxc(first.balance_after_ulxc)} in its wallet.
        </p>
      ) : st.isError ? (
        <p className="text-caption text-muted">{agent.name}’s statement could not be read just now; Agent Wallets has it.</p>
      ) : (
        <p className="text-caption text-muted" data-testid="onboarding-waiting">
          Waiting for {agent.name}’s first request. Send one with the key, and it lands here.
        </p>
      )}
    </div>
  )
}

interface StepView {
  index: string
  title: string
  done: React.ReactNode | null
  body: React.ReactNode | null
}

/**
 * The three steps. `onStarted` fires once the agent exists, so Home keeps this open after the book
 * lists it; `onFinished` hands Home back its wallets view.
 */
export function WalletOnboarding({ book, onStarted, onFinished }: { book: AgentBook; onStarted: () => void; onFinished: () => void }) {
  const [agentID, setAgentID] = useState<string | null>(null)
  const [funded, setFunded] = useState(false)
  // The book's copy of the agent, so its balance is Lens's; the created one until the book has re-read.
  const [created, setCreated] = useState<Agent | null>(null)
  const agent = (agentID && book.agents.find((a) => a.id === agentID)) || created
  const steps: StepView[] = [
    {
      index: '01',
      title: 'Create an agent with a budget.',
      done: agent ? <>{agent.name} exists, with its budget and approval amount set.</> : null,
      body: agent ? null : (
        <CreateStep
          onCreated={(a) => {
            setCreated(a)
            setAgentID(a.id)
            onStarted()
          }}
        />
      ),
    },
    {
      index: '02',
      title: 'Fund it.',
      done: agent && funded ? <>{agent.name} holds {lxc(agent.balance_ulxc)}.</> : null,
      body: agent && !funded ? <FundStep agent={agent} book={book} onFunded={() => setFunded(true)} /> : null,
    },
    {
      index: '03',
      title: 'Issue its key, and watch its first request.',
      done: null,
      body: agent && funded ? <KeyStep agent={agent} /> : null,
    },
  ]
  return (
    <>
      <ol className="mt-2 grid gap-px border border-rule bg-rule" data-testid="wallet-onboarding">
        {steps.map((s) => (
          <li key={s.index} className="flex flex-col items-start bg-surface px-gutter py-5" aria-current={s.body ? 'step' : undefined}>
            <span className="font-figure text-eyebrow uppercase text-faint">Step {s.index}</span>
            <p className={`mt-3 text-body ${s.done || s.body ? 'text-ink' : 'text-muted'}`}>{s.title}</p>
            {s.done ? <p className="mt-1 text-caption font-normal text-muted">{s.done}</p> : null}
            {s.body}
          </li>
        ))}
      </ol>
      {agent && funded ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/agents">Open {agent.name}’s wallet</Link>
          </Button>
          <Button onClick={onFinished}>Done</Button>
        </div>
      ) : null}
    </>
  )
}
