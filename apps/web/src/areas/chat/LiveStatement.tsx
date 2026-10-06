import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { focusRing, inlineLink } from '@talyvor/ui'

import { BOOK_KEY, lineText, statementKey } from '../lens/AgentBank'
import { type StatementLine, agentBankApi } from '../lens/agentBankApi'
import { formatWhen } from '../lens/format'
import { Lxc } from '../lens/money'
import { readFailure } from '../lens/WalletMoney'
import { PENDING_POLL_MS } from '../lens/WalletScreens'
import { statementLineHref } from './chatApi'
import { WalletButtons } from './WalletButtons'

// B28.351 — an agent's statement beside the conversation, live. The panel reads the agent's statement through the
// same BFF route and query key as Agent Wallets (GET /api/agents/{id}/statement, newest first) every
// LIVE_STATEMENT_POLL_MS while the tab is open, so a debit the agent makes shows here within a few seconds without a
// reload. Lines that arrive after the panel first read the statement are marked new. Each line links to its row on
// Agent Wallets. Which agent it follows is kept per browser. B28.87: under the picker, the followed agent's wallet
// buttons (WalletButtons.tsx).

/** How often the panel reads the statement: a new line shows within this plus one round trip, inside 5 seconds. */
export const LIVE_STATEMENT_POLL_MS = 2_000
/** The newest lines shown; the rest are on Agent Wallets. */
export const LIVE_STATEMENT_LINES = 8
/** Which agent the panel follows, per browser. */
export const LIVE_STATEMENT_AGENT_KEY = 'talyvor.chat.statement-agent'

function readFollowed(): string | null {
  try {
    return window.localStorage.getItem(LIVE_STATEMENT_AGENT_KEY)
  } catch {
    return null
  }
}

function writeFollowed(id: string): void {
  try {
    window.localStorage.setItem(LIVE_STATEMENT_AGENT_KEY, id)
  } catch {
    // Storage refused: the choice lasts for this visit only.
  }
}

const lineKey = (l: StatementLine) => `${l.entry_id}-${l.kind}`

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function LiveStatement() {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = (book.data?.agents ?? []).filter((a) => a.archived_at === undefined)
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? 'another agent'
  const [followed, setFollowed] = useState(readFollowed)
  const agent = agents.find((a) => a.id === followed) ?? agents[0]

  const st = useQuery({
    queryKey: statementKey(agent?.id ?? ''),
    queryFn: () => agentBankApi.statement(agent!.id),
    enabled: agent !== undefined,
    // A failed read is tried again, more slowly, so the panel comes back by itself.
    refetchInterval: (q) => (q.state.status === 'error' ? PENDING_POLL_MS : LIVE_STATEMENT_POLL_MS),
  })
  const lines = st.data?.lines ?? []

  // The lines on the statement when the panel first read it for this agent; anything after is new.
  const [first, setFirst] = useState<{ agent: string; keys: Set<string> } | null>(null)
  const read = st.data
  useEffect(() => {
    if (agent !== undefined && read !== undefined && first?.agent !== agent.id) setFirst({ agent: agent.id, keys: new Set((read.lines ?? []).map(lineKey)) })
  }, [agent, read, first])
  const isNew = (l: StatementLine) => first !== null && first.agent === agent?.id && !first.keys.has(lineKey(l))
  const shown = lines.slice(0, LIVE_STATEMENT_LINES)
  const newest = shown.find(isNew)

  return (
    <section aria-label="Live statement" data-testid="chat-live-statement" className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-rule px-gutter py-3">
        <p className="font-figure text-eyebrow uppercase text-label">Live statement</p>
        {agents.length > 0 ? (
          <label className="flex items-center gap-2 text-caption text-muted">
            Agent
            <select
              className={`min-w-0 flex-1 rounded-control border border-rule bg-canvas px-2 py-1 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`}
              value={agent?.id ?? ''}
              onChange={(e) => {
                setFollowed(e.target.value)
                writeFollowed(e.target.value)
              }}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {agent !== undefined && book.data !== undefined ? <WalletButtons key={agent.id} agent={agent} book={book.data} /> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {book.isPending ? (
          <p className="px-gutter py-3 text-caption text-muted">Reading your agents…</p>
        ) : book.isError ? (
          <p className="px-gutter py-3 text-caption text-muted">{readFailure(book.error, 'Your agents')}</p>
        ) : agent === undefined ? (
          <p className="px-gutter py-3 text-caption text-muted">
            No agent yet. Launch one here with /agent, or create one on{' '}
            <Link className={inlineLink} to="/agents">
              Agent Wallets
            </Link>
            .
          </p>
        ) : st.isPending ? (
          <p className="px-gutter py-3 text-caption text-muted">Reading {agent.name}’s statement…</p>
        ) : st.isError && st.data === undefined ? (
          <p className="px-gutter py-3 text-caption text-muted">{readFailure(st.error, `${agent.name}’s statement`)}</p>
        ) : shown.length === 0 ? (
          <p className="px-gutter py-3 text-caption text-muted">Nothing has moved in {agent.name}’s wallet yet.</p>
        ) : (
          <ol aria-label={`${agent.name}’s newest statement lines`}>
            {shown.map((l) => (
              <li key={lineKey(l)} className="border-b border-rule transition-colors duration-200 hover:bg-surface">
                <Link
                  to={statementLineHref({ agent_id: agent.id, entry_id: l.entry_id })}
                  data-testid="live-statement-line"
                  data-entry={l.entry_id}
                  data-new={isNew(l) ? 'true' : undefined}
                  className={`block px-gutter py-2 ${isNew(l) ? 'bg-accent-tint' : ''} ${focusRing}`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-body text-ink">
                      {isNew(l) ? <span className="sr-only">New: </span> : null}
                      {lineText(l, nameOf)}
                    </span>
                    <span className="shrink-0 text-body text-ink" data-testid="live-statement-amount">
                      <Lxc ulxc={Math.abs(l.amount_ulxc)} sign={l.amount_ulxc > 0 ? '+' : '−'} />
                    </span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 font-figure text-caption text-muted">
                    <span className="font-figure">{formatWhen(l.at)}</span>
                    <span>
                      Balance <Lxc ulxc={l.balance_after_ulxc} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>

      {agent !== undefined ? (
        <div className="space-y-1 border-t border-rule px-gutter py-3">
          {st.data !== undefined ? (
            <p className="text-caption text-faint" data-testid="live-statement-read">
              Live · read at <span className="font-figure">{clock(st.dataUpdatedAt)}</span>
              {st.isError ? '. The latest read failed; trying again.' : ''}
            </p>
          ) : null}
          <Link className={`block text-caption text-ink ${inlineLink}`} to={`/agents?${new URLSearchParams({ agent: agent.id }).toString()}`}>
            {agent.name}’s whole statement
          </Link>
        </div>
      ) : null}

      {newest !== undefined && agent !== undefined ? (
        <p className="sr-only" role="status">
          New on {agent.name}’s statement: {lineText(newest, nameOf)}
        </p>
      ) : null}
    </section>
  )
}
