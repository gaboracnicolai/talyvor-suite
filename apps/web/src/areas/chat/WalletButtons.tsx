import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button, Input } from '@talyvor/ui'

import { BOOK_KEY, statementKey } from '../lens/AgentBank'
import { type Agent, type AgentBook, agentBankApi, newMoveKey, parseLXC, refusalText, retryMoveThroughRestart } from '../lens/agentBankApi'
import { Lxc } from '../lens/money'
import { Note } from '../lens/WalletMoney'

// B28.87 — the wallet's buttons beside the conversation: fund or withdraw the followed agent, pause it, or pause every
// agent, each asked once more before anything is sent. They go through the BFF's existing /api/agents routes, as Agent
// Wallets does: a fund or withdraw carries an Idempotency-Key made when its question opens, so a second click on Yes or
// a retry through a deploy's restart moves the LXC once; a pause is Lens's, so the agent's next request or payment is refused before a provider is
// called.

/** What a button asks to do, held until it is confirmed. */
export type WalletAsk = { kind: 'fund' | 'withdraw'; ulxc: number } | { kind: 'pause' | 'resume' | 'pause-all' | 'resume-all' }

/** Why Lens says an agent is paused, when it was paused here. */
export const PAUSED_FROM_CHAT = 'paused from Chat'

function send(agent: Agent, ask: WalletAsk, key: string): Promise<unknown> {
  switch (ask.kind) {
    case 'fund':
      return agentBankApi.fund(agent.id, ask.ulxc, key)
    case 'withdraw':
      return agentBankApi.withdraw(agent.id, ask.ulxc, key)
    case 'pause':
      return agentBankApi.pause(agent.id, PAUSED_FROM_CHAT)
    case 'resume':
      return agentBankApi.resume(agent.id)
    case 'pause-all':
      return agentBankApi.pauseAll(PAUSED_FROM_CHAT)
    case 'resume-all':
      return agentBankApi.resumeAll()
  }
}

function question(agent: Agent, ask: WalletAsk): { said: React.ReactNode; yes: string } {
  switch (ask.kind) {
    case 'fund':
      return {
        said: (
          <>
            Move <Lxc ulxc={ask.ulxc} /> from the workspace into {agent.name}’s wallet?
          </>
        ),
        yes: 'Yes, fund',
      }
    case 'withdraw':
      return {
        said: (
          <>
            Take <Lxc ulxc={ask.ulxc} /> out of {agent.name}’s wallet, back to the workspace?
          </>
        ),
        yes: 'Yes, withdraw',
      }
    case 'pause':
      return { said: `Pause ${agent.name}? Lens refuses its next request or payment until you resume it.`, yes: `Yes, pause ${agent.name}` }
    case 'resume':
      return { said: `Resume ${agent.name}? Its requests and payments are served again.`, yes: `Yes, resume ${agent.name}` }
    case 'pause-all':
      return { said: 'Pause every agent? Lens refuses each one’s next request or payment until you start them again.', yes: 'Yes, pause all' }
    case 'resume-all':
      return { said: 'Start every agent again? An agent paused on its own stays paused.', yes: 'Yes, start all again' }
  }
}

export function WalletButtons({ agent, book }: { agent: Agent; book: AgentBook }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [asked, setAsked] = useState<{ ask: WalletAsk; key: string } | null>(null)
  const ask = asked?.ask ?? null
  const micros = parseLXC(amount)
  const done = useMutation({
    mutationFn: ({ ask: a, key }: { ask: WalletAsk; key: string }) => send(agent, a, key),
    retry: retryMoveThroughRestart,
    retryDelay: (failures) => Math.min(500 * 2 ** failures, 4_000),
    onSuccess: (_, { ask: a }) => {
      setAsked(null)
      if (a.kind === 'fund' || a.kind === 'withdraw') setAmount('')
    },
    onSettled: () =>
      Promise.all([qc.invalidateQueries({ queryKey: BOOK_KEY }), qc.invalidateQueries({ queryKey: statementKey(agent.id) })]),
  })
  const open = (a: WalletAsk) => {
    done.reset()
    setAsked({ ask: a, key: newMoveKey() })
  }
  const moved = done.isSuccess && (done.variables.ask.kind === 'fund' || done.variables.ask.kind === 'withdraw')
  const q = ask === null ? null : question(agent, ask)

  return (
    <div className="space-y-2" data-testid="chat-wallet-buttons">
      {book.all_paused_at ? (
        <p className="text-caption text-ink" data-testid="chat-all-paused">
          Every agent is paused{book.all_paused_reason ? ` — ${book.all_paused_reason}` : ''}.
        </p>
      ) : agent.paused_at ? (
        <p className="text-caption text-ink" data-testid="chat-agent-paused">
          {agent.name} is paused{agent.paused_reason ? ` — ${agent.paused_reason}` : ''}.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Input
          aria-label={`Amount in LXC for ${agent.name}`}
          inputMode="decimal"
          placeholder="LXC"
          className="w-20 min-w-0 font-figure"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            if (ask?.kind === 'fund' || ask?.kind === 'withdraw') setAsked(null)
          }}
        />
        <Button disabled={micros === null || done.isPending} onClick={() => open({ kind: 'fund', ulxc: micros ?? 0 })}>
          Fund
        </Button>
        <Button disabled={micros === null || done.isPending} onClick={() => open({ kind: 'withdraw', ulxc: micros ?? 0 })}>
          Withdraw
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {agent.paused_at ? (
          <Button disabled={done.isPending} onClick={() => open({ kind: 'resume' })}>
            Resume {agent.name}
          </Button>
        ) : (
          <Button disabled={done.isPending} onClick={() => open({ kind: 'pause' })}>
            Pause {agent.name}
          </Button>
        )}
        {book.all_paused_at ? (
          <Button disabled={done.isPending} onClick={() => open({ kind: 'resume-all' })}>
            Start all again
          </Button>
        ) : (
          <Button disabled={done.isPending} onClick={() => open({ kind: 'pause-all' })}>
            Pause all
          </Button>
        )}
      </div>

      {asked !== null && q !== null ? (
        <div role="group" aria-label="Confirm" className="space-y-2 rounded-control border border-rule-strong px-3 py-2" data-testid="chat-wallet-confirm">
          <p className="text-caption text-ink">{q.said}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={done.isPending} onClick={() => done.mutate(asked)}>
              {q.yes}
            </Button>
            <Button disabled={done.isPending} onClick={() => setAsked(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {/* Said only while it is still true: a request or a payment moves the balance after it. */}
      {moved && (done.data as { balance_ulxc: number }).balance_ulxc === agent.balance_ulxc ? (
        <Note ok>
          {agent.name} now holds <Lxc ulxc={agent.balance_ulxc} />.
        </Note>
      ) : null}
      {done.isError ? <Note ok={false}>{refusalText(done.error)}</Note> : null}
    </div>
  )
}
