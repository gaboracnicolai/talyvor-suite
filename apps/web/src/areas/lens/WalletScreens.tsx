import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, Row, inlineLink } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { isSessionExpired } from '../../lib/productState'
import { APPROVALS_KEY, Approvals, BOOK_KEY, Statement, StatementDownload } from './AgentBank'
import { agentBankApi } from './agentBankApi'
import { CurrencyPicker, Lxc } from './money'

// B28.7 — the sidebar is wallet-first: Approvals and Statements are destinations of their own, not
// regions a person scrolls to inside Agent Wallets. Both read the same cache as Agent Wallets and Home,
// so a decision made on any of them is the figure the others show.

function readFailure(err: unknown, what: string): string {
  return isSessionExpired(err) ? `${what} can’t be read until you sign in again.` : `${what} could not be read just now.`
}

function useAgentNames() {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = book.data?.agents ?? []
  return { book, agents, nameOf: (id: string) => agents.find((a) => a.id === id)?.name ?? 'an agent' }
}

/** B28.45 — how often the sidebar asks again while the tab is showing. */
export const PENDING_POLL_MS = 10_000

/**
 * How many approvals are waiting for a person — the sidebar's badge. Null until it is known.
 * B28.45: live. An agent files an approval, or a person decides one from a push or another device,
 * with no click on this page — so the count is read again every PENDING_POLL_MS while the tab is
 * showing, and on coming back to it. A failed read stops the polling; coming back tries once more.
 */
export function usePendingApprovals(): number | null {
  const list = useQuery({
    queryKey: APPROVALS_KEY,
    queryFn: agentBankApi.approvals,
    refetchInterval: (q) => (q.state.status === 'error' ? false : PENDING_POLL_MS),
    refetchOnWindowFocus: true,
  })
  return list.isSuccess ? (list.data.approvals ?? []).filter((a) => a.status === 'pending').length : null
}

export function ApprovalsScreen() {
  const { nameOf } = useAgentNames()
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Approvals"
        heading="What your agents are waiting on"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          A request or payment waits here when it is above an agent’s approval amount. Approve it and the agent’s next
          identical request goes through, once; deny it and the request is refused.
        </p>
        <CurrencyPicker />
        <Approvals nameOf={nameOf} held={{}} onSent={() => {}} />
      </Region>
    </RegionScreen>
  )
}

export function StatementsScreen() {
  const { book, agents, nameOf } = useAgentNames()
  const [chosen, setChosen] = useState<string | null>(null)
  const agent = agents.find((a) => a.id === chosen) ?? agents[0] ?? null
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Statements"
        heading="Every movement in every agent’s wallet"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <CurrencyPicker />
        {book.isError ? (
          <p className="text-body text-muted">{readFailure(book.error, 'The agents')}</p>
        ) : book.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : agents.length === 0 ? (
          <p className="text-body text-muted">
            No agents yet.{' '}
            <Link className={`text-ink ${inlineLink}`} to="/agents">
              Create one on Agent Wallets
            </Link>
            ; its statement starts the first time its wallet is funded.
          </p>
        ) : (
          <>
            <Card>
              <CardHeader>Statement for every agent</CardHeader>
              <StatementDownload agent={null} />
            </Card>
            <Card>
              <CardHeader>Agents</CardHeader>
              {agents.map((a) => (
                <Row key={a.id} label={a.name}>
                  <div className="flex items-center gap-3">
                    <span className="text-body text-ink">
                      <Lxc ulxc={a.balance_ulxc} />
                    </span>
                    <Button aria-pressed={agent?.id === a.id} onClick={() => setChosen(a.id)}>
                      {agent?.id === a.id ? 'Showing' : 'Show statement'}
                    </Button>
                  </div>
                </Row>
              ))}
            </Card>
          </>
        )}
      </Region>
      {agent ? (
        <Region index="01" label={agent.name} className="flex max-w-2xl flex-col gap-3">
          <Statement key={agent.id} agent={agent} nameOf={nameOf} />
        </Region>
      ) : null}
    </RegionScreen>
  )
}
