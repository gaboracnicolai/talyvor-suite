import { useState } from 'react'
import { type UseQueryResult, useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, MuNumeral, NavIcon, type NavIconName, Pill, Row, cn, focusRing, inlineLink } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { InlineFailure, PanelFailure } from '../../components/SessionExpiredBar'
import { APPROVALS_KEY, BOOK_KEY, FORECAST_KEY, PauseEveryAgent, rulesKey } from './AgentBank'
import { type Agent, type AgentBook, type AgentRules, type SpendForecast, agentBankApi } from './agentBankApi'
import { Lxc } from './money'
import { WalletOnboarding } from './Onboarding'
import { SharingLine } from './Sharing'

// Home.tsx — B28.6: the first screen after sign-in is the wallet home. It answers, in order:
//   1. What does the workspace hold, and how much of it have I not yet given to an agent?
//   2. Is anything waiting for me? — the approvals an agent's rules filed for a person.
//   3. How far through its budget is each agent? — this month's spend against its monthly limit.
//   4. Where is the month heading? — Lens's forecast, the pace so far run on to the month's end.
//   5. How do I stop it all? — the one switch that pauses every agent.
// Every figure is Lens's, read through the same BFF routes and the same query keys as Agent Wallets,
// so a change made on either screen is the figure the other shows.
//
// B29.8 — it opens like the board's PRODUCT UI tile: "Welcome to Talyvor", then a raised card for each
// product, each opening the route its sidebar row opens. The figures above are unchanged, one region down.
//
// A workspace with no agents yet opens in onboarding mode: what it holds, the three steps that give its
// first agent a wallet (B28.8, Onboarding.tsx), and the one line that says whether it shares answers. Like Overview's first run, that is a MEASUREMENT — the book answered and
// listed no agents — never a default: a read that failed is not an empty workspace.

const lxc = (micros: number) => <Lxc ulxc={micros} />

/** The products a person reaches from Home, in the sidebar's order; `to` is the route its sidebar row opens. */
export const PRODUCT_CARDS: readonly { title: string; to: string; icon: NavIconName; line: string }[] = [
  { title: 'Agent Wallets', to: '/agents', icon: 'wallet', line: 'A budget and rules for each agent' },
  { title: 'Approvals', to: '/approvals', icon: 'approvals', line: 'Requests waiting for a person' },
  { title: 'Statements', to: '/statements', icon: 'statement', line: 'What each agent spent, line by line' },
  { title: 'Chat', to: '/chat', icon: 'chat', line: 'Ask any model, with its wallet beside it' },
  { title: 'Marketplace', to: '/marketplace', icon: 'grid', line: 'Agents, prompts and skills to use or sell' },
  { title: 'Track', to: '/track', icon: 'issues', line: 'Issues, boards and cycles' },
  { title: 'Docs', to: '/docs', icon: 'docs', line: 'Your workspace’s pages' },
  { title: 'Developers', to: '/setup', icon: 'code', line: 'Connect an agent, keys and routing' },
]

/** The board's product cards: raised, a brand line icon, the product's name and one line, and an arrow. */
function ProductCards() {
  return (
    <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Products">
      {PRODUCT_CARDS.map((p) => (
        <li key={p.to} className="flex">
          <Link
            to={p.to}
            data-testid={`home-card-${p.to.slice(1)}`}
            className={cn('flex w-full flex-col gap-3 rounded-card border border-rule bg-raised p-4', focusRing)}
          >
            <span className="flex items-start justify-between gap-2">
              <NavIcon name={p.icon} className="h-7 w-7 text-accent-strong" />
              <NavIcon name="arrow" className="h-4 w-4 text-muted" />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-head text-ink">{p.title}</span>
              <span className="text-body text-muted">{p.line}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="px-gutter py-3 text-body text-muted">{children}</p>
}

/** The workspace's money: everything it holds, and the part no agent has been given yet. */
function Holdings({ book }: { book: AgentBook }) {
  return (
    <div className="grid gap-px border border-rule bg-rule wide:grid-cols-2">
      <div className="flex flex-col gap-2 bg-surface px-gutter py-4">
        <span className="font-figure text-eyebrow uppercase text-faint">Total balance</span>
        <span data-testid="home-total-balance">
          <MuNumeral micros={book.workspace_balance_ulxc} unit="lxc" />
        </span>
        <span className="text-caption font-normal text-muted">{lxc(book.allocated_ulxc)} of it is with agents</span>
      </div>
      <div className="flex flex-col gap-2 bg-surface px-gutter py-4">
        <span className="font-figure text-eyebrow uppercase text-faint">Not yet given to agents</span>
        <span data-testid="home-unallocated">
          <MuNumeral micros={book.unallocated_ulxc} unit="lxc" />
        </span>
        <span className="text-caption font-normal text-muted">Free to fund an agent’s wallet</span>
      </div>
    </div>
  )
}

/** What is waiting for a person: the count, and where to decide it. */
function ApprovalsWaiting() {
  const list = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals })
  const pending = (list.data?.approvals ?? []).filter((a) => a.status === 'pending').length
  return (
    <Card>
      <CardHeader>Approvals waiting</CardHeader>
      {list.isError ? (
        <PanelFailure error={list.error} what="the approvals" />
      ) : list.isPending ? (
        <Muted>Reading…</Muted>
      ) : (
        <Row
          stack
          label={
            <span className="whitespace-normal">
              {pending === 0
                ? 'Nothing is waiting for you.'
                : `${pending === 1 ? 'One request is' : `${pending} requests are`} waiting for a person to approve`}
            </span>
          }
          hint="A request or payment waits here when it is above an agent’s approval amount."
        >
          <span className="font-figure text-body text-ink" data-testid="home-approvals-waiting">
            {pending}
          </span>
          {pending > 0 ? (
            <Button asChild variant="primary">
              <Link to="/agents">Decide</Link>
            </Button>
          ) : null}
        </Row>
      )}
    </Card>
  )
}

/**
 * One agent's month against its budget: the monthly limit its rules set, when they set one. Two reads
 * feed it — the month's spend from the forecast, the budget from the agent's rules — and each says on
 * its own whether it is still reading or failed, so a rules read that failed never reads as "no budget".
 */
function BudgetRow({
  agent,
  forecast,
  rules,
}: {
  agent: Agent
  forecast: UseQueryResult<SpendForecast>
  rules: UseQueryResult<AgentRules>
}) {
  // Lens's forecast lists every agent in the workspace; one created since it was read has spent nothing.
  const spent = forecast.data ? ((forecast.data.agents ?? []).find((f) => f.agent_id === agent.id)?.spent_ulxc ?? 0) : null
  const limit = rules.data ? rules.data.monthly_limit_ulxc : null
  const pct = spent !== null && limit !== null && limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : null
  const spend = forecast.isError ? (
    <>
      This month’s spend: <InlineFailure error={forecast.error} className="" />
    </>
  ) : spent === null ? (
    'Reading this month’s spend…'
  ) : (
    <>Spent {lxc(spent)} this month</>
  )
  const budget = rules.isError ? (
    <>
      Budget: <InlineFailure error={rules.error} className="" />
    </>
  ) : limit === null ? null : limit > 0 ? (
    <>monthly budget {lxc(limit)}</>
  ) : (
    'no monthly budget set'
  )
  return (
    <Row
      stack
      label={
        <span className="flex items-center gap-2">
          {agent.name}
          {agent.paused_at ? <Pill status="parked">Paused</Pill> : null}
        </span>
      }
      hint={
        <span className="whitespace-normal">
          {spend}
          {budget ? <> · {budget}</> : null} · {lxc(agent.balance_ulxc)} left in its wallet
        </span>
      }
    >
      {pct !== null ? (
        <div className="flex w-full items-center gap-3 wide:w-56">
          <div
            className="relative h-2 flex-1 overflow-hidden rounded-pill bg-rule-strong"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${agent.name}’s monthly budget used`}
          >
            {/* width is a runtime value → inline style, not a Tailwind arbitrary class. */}
            <div className="absolute inset-y-0 left-0 rounded-pill bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-12 text-right font-figure text-body text-ink" data-testid={`home-budget-used-${agent.id}`}>
            {pct}%
          </span>
        </div>
      ) : limit === 0 ? (
        <Button asChild>
          <Link to="/agents">Set a budget</Link>
        </Button>
      ) : null}
    </Row>
  )
}

/** Each agent's budget used. The month's spend is the forecast's; the budget is each agent's own rules. */
function Budgets({ agents, forecast }: { agents: Agent[]; forecast: UseQueryResult<SpendForecast> }) {
  const rules = useQueries({
    queries: agents.map((a) => ({ queryKey: rulesKey(a.id), queryFn: () => agentBankApi.rules(a.id) })),
  })
  return (
    <Card>
      <CardHeader>Budget used this month</CardHeader>
      {agents.map((a, i) => (
        <BudgetRow key={a.id} agent={a} forecast={forecast} rules={rules[i]} />
      ))}
    </Card>
  )
}

/** Lens's month-end forecast for every agent together. */
function Forecast({ forecast }: { forecast: UseQueryResult<SpendForecast> }) {
  return (
    <Card>
      <CardHeader>This month</CardHeader>
      {forecast.isError ? (
        <PanelFailure error={forecast.error} what="the forecast" />
      ) : forecast.isPending ? (
        <Muted>Reading…</Muted>
      ) : (
        <>
          <Row label="Spent so far" hint="Every agent, since the first of the month (UTC)">
            <span className="text-body text-ink">{lxc(forecast.data.spent_ulxc)}</span>
          </Row>
          <Row label="Forecast for the month" hint="The pace so far, run on to the month’s end">
            <span className="text-body text-ink" data-testid="home-forecast">
              {lxc(forecast.data.forecast_ulxc)}
            </span>
          </Row>
        </>
      )}
    </Card>
  )
}

function useForecast() {
  return useQuery({ queryKey: FORECAST_KEY, queryFn: agentBankApi.forecast })
}

/** Onboarding: the workspace's first agent, in three steps (B28.8), and the one line about sharing. */
function FirstWallet({ book, onStarted, onFinished }: { book: AgentBook; onStarted: () => void; onFinished: () => void }) {
  return (
    <>
      <p className="max-w-2xl text-body text-muted" data-testid="home-onboarding">
        Every AI agent gets a wallet: a budget, rules and approvals, checked by Lens before the model is called or a
        payment moves. This workspace holds {lxc(book.workspace_balance_ulxc)}; give its first agent a wallet in three
        steps.
      </p>
      <WalletOnboarding book={book} onStarted={onStarted} onFinished={onFinished} />
      <SharingLine />
      <p className="text-caption text-muted">
        Already pointing tools at Lens with a workspace key?{' '}
        <Link to="/setup" className={inlineLink}>
          Setup
        </Link>{' '}
        has the base URL, and{' '}
        <Link to="/overview" className={inlineLink}>
          Overview
        </Link>{' '}
        has what the workspace spends and earns.
      </p>
    </>
  )
}

export function Home() {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const forecast = useForecast()
  const agents = book.data?.agents ?? []
  // B28.8 — the onboarding begun here stays open after its agent exists, until the person is done with it.
  const [onboarding, setOnboarding] = useState(false)
  // The failed read is decided first: a book that could not be read is not a workspace with no agents.
  const state = book.isError ? 'failed' : book.isPending ? 'reading' : agents.length === 0 || onboarding ? 'onboarding' : 'wallets'
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Home"
        heading="Welcome to Talyvor"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex flex-col gap-6"
        fullWidth
      >
        {state === 'onboarding' || state === 'wallets' ? (
          <p className="text-body text-muted" data-testid="home-lead">
            {state === 'onboarding' ? 'Give every agent a wallet.' : 'Your agents’ wallets, at a glance.'}
          </p>
        ) : null}
        <ProductCards />
      </Region>
      <Region index="01" label="Your wallets" className="flex flex-col gap-3">
        {state === 'failed' ? (
          <PanelFailure error={book.error} what="the workspace’s wallets" />
        ) : !book.data ? (
          <p className="text-body text-muted">Reading…</p>
        ) : state === 'onboarding' ? (
          <FirstWallet book={book.data} onStarted={() => setOnboarding(true)} onFinished={() => setOnboarding(false)} />
        ) : (
          <Holdings book={book.data} />
        )}
      </Region>
      {state === 'wallets' && book.data ? (
        <>
          <Region index="02" label="Waiting for you">
            <ApprovalsWaiting />
          </Region>
          <Region index="03" label="Each agent’s budget">
            <Budgets agents={agents} forecast={forecast} />
          </Region>
          <Region index="04" label="Where the month is heading">
            <Forecast forecast={forecast} />
          </Region>
          <Region index="05" label="Stop every agent" className="flex flex-col gap-3">
            <p className="text-body text-muted">
              One switch: Lens refuses each agent’s next request, payment or hold before a provider is called.
            </p>
            <PauseEveryAgent book={book.data} />
          </Region>
        </>
      ) : null}
    </RegionScreen>
  )
}
