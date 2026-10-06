import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { cn, focusRing, inlineLink } from '@talyvor/ui'

import { BOOK_KEY } from '../lens/AgentBank'
import { type Agent, type AgentBook, agentBankApi } from '../lens/agentBankApi'
import type { AnswerPayer } from './chatApi'

// B28.354 — which wallet pays for a conversation. "Paid by", under the composer, names the workspace or one of
// its agents; the choice is kept with the conversation (history.ts) and every request the conversation makes
// carries it to Lens (chatApi.ts PAID_BY_HEADER). Under each answer the screen says who paid only as Lens's
// answer says it: an agent's name when Lens billed that agent, and that it did not when it did not.

/** The agents that can be chosen to pay: the workspace's, archived ones aside. Read with Agent Wallets' query. */
export function usePayers(): { book: UseQueryResult<AgentBook>; payers: Agent[] } {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  return { book, payers: (book.data?.agents ?? []).filter((a) => a.archived_at === undefined) }
}

export function PaidBy({
  book,
  payers,
  value,
  onChange,
  disabled,
}: {
  book: UseQueryResult<AgentBook>
  payers: Agent[]
  /** The chosen agent's id; '' is the workspace. */
  value: string
  onChange: (agentID: string) => void
  disabled: boolean
}) {
  // A failed read is not "no agents": the choice stands, and the line says it cannot be changed just now.
  if (book.isError && book.data === undefined) {
    return (
      <p className="text-caption text-muted">
        Paid by {value === '' ? 'the workspace' : 'the agent chosen'}. Your agents could not be read just now, so it cannot be changed.
      </p>
    )
  }
  // With no agent there is nothing to choose: the workspace pays, as it always has.
  if (payers.length === 0 && value === '') return null
  const gone = value !== '' && !payers.some((a) => a.id === value)
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="font-figure text-eyebrow uppercase text-label">Paid by</span>
      <select
        id="chat-paid-by"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'min-w-0 max-w-48 rounded-control border border-rule bg-canvas px-2 py-1 text-caption text-ink',
          'transition-colors duration-200 hover:border-rule-strong disabled:opacity-50',
          focusRing,
        )}
      >
        <option value="">The workspace</option>
        {payers.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
        {gone ? <option value={value}>An agent no longer here</option> : null}
      </select>
    </label>
  )
}

/** Under an answer in a conversation an agent pays for: who Lens billed for it. */
export function PayerLine({ payer }: { payer: AnswerPayer }) {
  return (
    <p className="ml-1 w-full text-caption text-muted" data-testid="turn-paid-by" data-billed={payer.billed}>
      {payer.billed ? (
        <>
          Paid by{' '}
          <Link className={inlineLink} to={`/agents?agent=${encodeURIComponent(payer.agent_id)}`}>
            {payer.name}
          </Link>
          ’s wallet
        </>
      ) : (
        `Lens did not bill ${payer.name} for this answer.`
      )}
    </p>
  )
}
