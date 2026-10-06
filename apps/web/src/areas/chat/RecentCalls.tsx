import { Link } from 'react-router-dom'

import { focusRing } from '@talyvor/ui'

import type { StatementLine } from '../lens/agentBankApi'
import { formatWhen } from '../lens/format'
import { Lxc } from '../lens/money'
import { statementLineHref } from './chatApi'

// B28.356 — the talyvor-suite side of B28.93: an agent's recent calls beside the conversation, each with its model,
// its cost and where it came from. The rows are built from the very statement the Live statement panel reads
// (GET /api/agents/{id}/statement, newest first), so each one is what the call took from the agent's wallet: every
// line one request wrote — its debit, a settle that refunds an over-estimate or charges the rest, its platform fee —
// added up under the request they share (`ref`). The model and the source are Lens's words on those lines
// (B28.93: Lens names them on each statement line as `model` and `source`, passed through the BFF untouched); a call
// whose lines name neither still shows, with its cost and when.

/** The newest calls shown; the rest are on Agent Wallets. */
export const RECENT_CALLS = 20

/** The statement kinds a call to a model writes, each under the request's ref. */
const CALL_KINDS: ReadonlySet<string> = new Set(['spend', 'hold', 'settle', 'release', 'platform_fee'])

export interface RecentCall {
  /** The request its lines share. */
  ref: string
  /** The line that opened the call: its row on Agent Wallets. */
  entry_id: string
  /** Every statement line of the call, newest first. */
  entries: string[]
  /** What the call took from the agent's wallet, µLXC: minus the sum of its lines. */
  cost_ulxc: number
  model?: string
  source?: string
  /** When the call was opened. */
  at: string
}

/** The newest `n` calls on a statement (its lines newest first), newest first. */
export function recentCalls(lines: readonly StatementLine[], n = RECENT_CALLS): RecentCall[] {
  const calls = new Map<string, RecentCall>()
  for (const l of lines) {
    if (!CALL_KINDS.has(l.kind)) continue
    const ref = l.ref || l.entry_id
    const c = calls.get(ref)
    if (c === undefined) {
      calls.set(ref, { ref, entry_id: l.entry_id, entries: [l.entry_id], cost_ulxc: -l.amount_ulxc, model: l.model || undefined, source: l.source || undefined, at: l.at })
      continue
    }
    // An older line of the same call: the call was opened no later than it.
    c.entry_id = l.entry_id
    c.entries.push(l.entry_id)
    c.cost_ulxc -= l.amount_ulxc
    c.model ??= l.model || undefined
    c.source ??= l.source || undefined
    c.at = l.at
  }
  return [...calls.values()].sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).slice(0, n)
}

/** The calls as rows, each linked to its row on Agent Wallets. LiveStatement says when there are none, or none could be read. */
export function RecentCalls({ agent, calls }: { agent: { id: string; name: string }; calls: readonly RecentCall[] }) {
  return (
    <>
      <p className="px-gutter pt-3 pb-2 text-caption text-muted">
        {agent.name}’s newest calls, each what it took from {agent.name}’s wallet.
      </p>
      <ol aria-label={`${agent.name}’s recent calls`}>
        {calls.map((c) => (
          <li key={c.ref} className="border-b border-rule transition-colors duration-200 hover:bg-surface">
            <Link
              to={statementLineHref({ agent_id: agent.id, entry_id: c.entry_id })}
              data-testid="recent-call"
              data-entry={c.entry_id}
              data-ref={c.ref}
              className={`block px-gutter py-2 ${focusRing}`}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-figure text-body text-ink" data-testid="recent-call-model">
                  {c.model ?? 'Model call'}
                </span>
                <span className="shrink-0 text-body text-ink" data-testid="recent-call-cost">
                  <Lxc ulxc={Math.abs(c.cost_ulxc)} sign={c.cost_ulxc > 0 ? '−' : c.cost_ulxc < 0 ? '+' : ''} />
                </span>
              </span>
              <span className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 text-caption text-muted">
                <span className="font-figure">{formatWhen(c.at)}</span>
                {c.source ? <span data-testid="recent-call-source">{c.source}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  )
}
