import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, focusRing, inlineLink } from '@talyvor/ui'

import { BOOK_KEY } from '../lens/AgentBank'
import { cardKey } from '../lens/AgentCardPanel'
import { type AgentCard, agentBankApi, refusalText } from '../lens/agentBankApi'
import { TestMoneyOnly } from '../lens/WalletMoney'
import { Card } from '../lens/walletBrand'

// B28.360 — freeze or unfreeze an agent's card from Chat (B28.97). `/freeze Researcher` typed in the composer is not
// asked of the model: it opens a card with the agent and its card. Freeze it, and Lens declines every purchase on the
// card — nothing leaves the agent's wallet — until `/unfreeze Researcher` lets them through again, each judged by the
// agent's rules as before. Lens decides; a refusal is its sentence.

/** A message that freezes or unfreezes an agent's card rather than asking the model. */
export const FREEZE_COMMAND = /^\/(?:un)?freeze(?:\s|$)/i

/** What the command said: whether to freeze, and the agent it names ("" with none). */
export function parseFreeze(command: string): { freeze: boolean; agent: string } {
  const freeze = !/^\/unfreeze\b/i.test(command)
  const agent = command
    .replace(/^\/(?:un)?freeze\b/i, '')
    .trim()
    .replace(/^agent\s+/i, '')
    .replace(/[’']s\s+card\.?$/i, '')
    .replace(/\s+card\.?$/i, '')
    .trim()
  return { freeze, agent }
}

const PREVIEW = 'Preview — test money only'

const selectClass = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

export function CardFreezeCard({ command, onClose }: { command: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [typed] = useState(() => parseFreeze(command))
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = (book.data?.agents ?? []).filter((a) => a.archived_at === undefined)
  const named = typed.agent === '' ? undefined : agents.find((a) => a.name.trim().toLowerCase() === typed.agent.toLowerCase())
  // With no agent named, the workspace's only agent is the one meant.
  const [agentId, setAgentId] = useState<string | null>(null)
  const chosen = agentId ?? named?.id ?? (typed.agent === '' && agents.length === 1 ? agents[0].id : '')
  const agent = agents.find((a) => a.id === chosen)

  const card = useQuery({ queryKey: cardKey(chosen), queryFn: () => agentBankApi.card(chosen), enabled: chosen !== '' })
  const held = card.data?.card
  const [done, setDone] = useState<{ name: string; card: AgentCard } | null>(null)
  const act = useMutation({
    mutationFn: async () => {
      const a = agent!
      const got = typed.freeze ? await agentBankApi.freezeCard(a.id) : await agentBankApi.unfreezeCard(a.id)
      return { name: a.name, card: got }
    },
    onSuccess: (d) => setDone(d),
    onSettled: () => qc.invalidateQueries({ queryKey: cardKey(chosen) }),
  })

  const verb = typed.freeze ? 'Freeze' : 'Unfreeze'
  const already = held !== undefined && Boolean(held.frozen) === typed.freeze
  const ready = agent !== undefined && held !== undefined && !already
  // Typed a moment ago in the composer: the card comes into view, however long the conversation above it.
  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <div ref={top}>
      <Card data-testid="chat-card-freeze">
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-caption text-muted">
            {verb} an agent’s card <span className="break-all font-mono">{command}</span>
          </p>
          <TestMoneyOnly capability="agent_card" label={PREVIEW} />
          {done !== null ? (
            <>
              <p role="status" className="text-body text-ink" data-testid="chat-card-freeze-done">
                {done.card.frozen
                  ? `Frozen. Every purchase on ${done.name}’s card •••• ${done.card.last4} is refused, and nothing leaves its wallet, until you unfreeze it.`
                  : `Unfrozen. ${done.name}’s card •••• ${done.card.last4} takes purchases again, each one judged by ${done.name}’s rules.`}
              </p>
              <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
                <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
                  Close
                </Button>
                <Link className={`${inlineLink} text-caption`} to={`/agents?${new URLSearchParams({ agent: chosen }).toString()}`}>
                  See the card on Agent Wallets
                </Link>
              </div>
            </>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (ready && !act.isPending) act.mutate()
              }}
            >
              <select
                aria-label="Agent"
                className={`${selectClass} wide:max-w-48`}
                value={chosen}
                disabled={act.isPending}
                onChange={(e) => setAgentId(e.target.value)}
              >
                <option value="" disabled>
                  Pick an agent
                </option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {typed.agent !== '' && named === undefined && book.data !== undefined && agentId === null ? (
                <p className="text-caption text-muted">No agent is called “{typed.agent}” — pick one.</p>
              ) : null}
              {book.isError ? (
                <p className="text-caption text-muted">Your agents could not be read just now.</p>
              ) : book.data !== undefined && agents.length === 0 ? (
                <p className="text-caption text-muted">
                  The workspace has no agent yet. Launch one with <span className="font-mono">/agent</span>.
                </p>
              ) : null}
              {agent === undefined ? null : card.isError ? (
                <p className="text-caption text-muted">{agent.name}’s card could not be read just now.</p>
              ) : card.isPending ? (
                <p className="text-caption text-muted">Reading {agent.name}’s card…</p>
              ) : held === undefined ? (
                <p className="text-caption text-muted" data-testid="chat-card-freeze-none">
                  {agent.name} has no card.{' '}
                  <Link className={inlineLink} to={`/agents?${new URLSearchParams({ agent: agent.id }).toString()}`}>
                    Issue one on Agent Wallets
                  </Link>
                </p>
              ) : (
                <p className="text-body text-ink" data-testid="chat-card-freeze-state">
                  {held.frozen
                    ? `${agent.name}’s card •••• ${held.last4} is frozen: every purchase on it is refused.`
                    : `${agent.name}’s card •••• ${held.last4} takes purchases now, each one judged by ${agent.name}’s rules.`}
                  {already ? (typed.freeze ? ' It is already frozen.' : ' It is not frozen.') : null}
                </p>
              )}
              {/* One-handed on a phone: full-width buttons; side by side on a wide screen. Send stays the view's one primary. */}
              <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
                {!already ? (
                  <Button type="submit" className="h-12 w-full wide:h-8 wide:w-auto" disabled={!ready || act.isPending}>
                    {act.isPending ? `${typed.freeze ? 'Freezing' : 'Unfreezing'}…` : `${verb} ${agent?.name ?? 'the agent'}’s card`}
                  </Button>
                ) : null}
                {!act.isPending ? (
                  <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
                    {already ? 'Close' : 'Cancel'}
                  </Button>
                ) : null}
              </div>
              {act.isError ? (
                <p role="alert" className="text-caption text-ink">
                  {agent?.name ?? 'The agent'}’s card was not {typed.freeze ? 'frozen' : 'unfrozen'}: {refusalText(act.error)}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </Card>
    </div>
  )
}
