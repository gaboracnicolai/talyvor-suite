import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Input, inlineLink } from '@talyvor/ui'

import { api } from '../../lib/api'
import { BOOK_KEY, rulesKey, statementKey } from '../lens/AgentBank'
import { type Agent, type AgentKey, agentBankApi, newMoveKey, parseLXC, refusalText } from '../lens/agentBankApi'
import { Lxc } from '../lens/money'
import { firstRequest } from '../lens/Onboarding'
import { CopyBlock } from '../lens/Setup'
import { toolsFor } from '../lens/setupSnippets'
import { Card } from '../lens/walletBrand'
import { statementLineHref } from './chatApi'
import { CopyButton } from './CopyButton'

// B28.350 — launch an agent from Chat. `/agent Researcher budget 20 LXC, 5 a day, ask me above 2` typed in the
// composer is not sent to the model: it opens a card in the conversation with the name, budget and rules filled in
// from the command. Launch then does what Agent Wallets does, through the same BFF routes and query keys: creates
// the agent, saves its rules (the budget as its monthly limit, a daily limit, the amount above which a person must
// approve), moves the budget from the workspace into its wallet once, and issues its key, shown once. The card then
// reads the agent's statement until its first call is on it, and links that line.

/** A message that launches an agent rather than asking the model. */
export const LAUNCH_COMMAND = /^\/agent(?:\s|$)/i

/** What the command said, as the card's fields read it: each amount as typed, "" when it named none. */
export interface LaunchDraft {
  name: string
  budget: string
  daily: string
  approval: string
}

const AMOUNT = String.raw`(?<![\w.])(\d+(?:\.\d{1,6})?)`

/**
 * Reads a `/agent` command: "ask me above 2" (or "approve above 2") is the approval amount, "5 a day" (or "daily 5")
 * the daily limit, "budget 20" (or "20 LXC") the budget; what is left before the first comma or "with" is its name.
 */
export function parseLaunch(command: string): LaunchDraft {
  let rest = command.replace(/^\/agent\b/i, ' ')
  const take = (...patterns: string[]): string => {
    for (const p of patterns) {
      const m = new RegExp(p, 'i').exec(rest)
      if (m === null) continue
      rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`
      return m[1]
    }
    return ''
  }
  const approval = take(String.raw`\b(?:ask(?:\s+me|\s+a\s+person)?|approv\w*)\s+(?:above|over)\s+${AMOUNT}(?:\s*LXC)?`)
  const daily = take(String.raw`${AMOUNT}\s*(?:LXC\s*)?(?:a|per|each)\s+day\b`, String.raw`\bdaily(?:\s+limit)?(?:\s+of)?\s+${AMOUNT}(?:\s*LXC)?`)
  const budget = take(String.raw`\bbudget(?:\s+of)?\s+${AMOUNT}(?:\s*LXC)?(?:\s+a\s+month)?`, String.raw`${AMOUNT}\s*LXC\b(?:\s+a\s+month)?`)
  const name = (rest.split(/[,;]|\s(?:with|budget)\b/i)[0] ?? '').replace(/\s+/g, ' ').replace(/^[\s\u0022\u0027\u201c\u2018]+|[\s\u0022\u0027\u201d\u2019.:]+$/g, '')
  return { name, budget, daily, approval }
}

export function LaunchAgentCard({ command, onClose }: { command: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState(() => parseLaunch(command))
  const set = (field: keyof LaunchDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [field]: e.target.value }))
  const budget = parseLXC(draft.budget)
  const daily = draft.daily.trim() === '' ? 0 : parseLXC(draft.daily)
  const approval = draft.approval.trim() === '' ? 0 : parseLXC(draft.approval)
  // What Lens has done so far, so Try again repeats none of it: one agent, and its budget moved once under this
  // card's own Idempotency-Key. The rules are saved again on each try, as they stand in the fields then.
  const done = useRef<{ agent?: Agent; funded?: boolean; fundKey: string }>({ fundKey: newMoveKey() })
  const [agent, setAgent] = useState<Agent | null>(null)
  const [failedAt, setFailedAt] = useState<'create' | 'rules' | 'fund' | 'key'>('create')
  const [issued, setIssued] = useState<AgentKey | null>(null)

  const launch = useMutation({
    mutationFn: async () => {
      const d = done.current
      setFailedAt('create')
      const a = d.agent ?? (await agentBankApi.create(draft.name.trim()))
      d.agent = a
      setAgent(a)
      setFailedAt('rules')
      const current = await agentBankApi.rules(a.id)
      const saved = await agentBankApi.setRules(a.id, {
        ...current,
        monthly_limit_ulxc: budget ?? 0,
        daily_limit_ulxc: daily || current.daily_limit_ulxc,
        approval_above_ulxc: approval ?? 0,
      })
      qc.setQueryData(rulesKey(a.id), saved)
      if (!d.funded) {
        setFailedAt('fund')
        await agentBankApi.fund(a.id, budget ?? 0, d.fundKey)
        d.funded = true
      }
      setFailedAt('key')
      return agentBankApi.issueKey(a.id, a.name)
    },
    onSuccess: setIssued, // held in this card only; the key is shown while it is open
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })

  const ctx = useQuery({ queryKey: ['context'], queryFn: api.context, staleTime: 60_000, enabled: issued !== null })
  // Read every three seconds once the key exists, until the agent's first call has landed.
  const st = useQuery({
    queryKey: statementKey(agent?.id ?? ''),
    queryFn: () => agentBankApi.statement(agent!.id),
    enabled: issued !== null && agent !== null,
    refetchInterval: (q) => (firstRequest(q.state.data?.lines) === null ? 3_000 : false),
  })
  const first = firstRequest(st.data?.lines)

  const name = agent?.name ?? draft.name.trim()
  const ready = name !== '' && budget !== null && daily !== null && approval !== null
  // Typed a moment ago in the composer: the card comes into view, however long the conversation above it.
  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => top.current?.scrollIntoView?.({ block: 'nearest' }), [])

  return (
    <div ref={top}>
      <Card data-testid="chat-launch">
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-caption text-muted">
            Launch an agent <span className="break-all font-mono">{command}</span>
          </p>
          {issued === null || agent === null ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (ready && !launch.isPending) launch.mutate()
              }}
            >
              <Input aria-label="Agent name" placeholder="Agent name" value={agent?.name ?? draft.name} disabled={agent !== null} onChange={set('name')} />
              <div className="flex flex-col gap-3 wide:flex-row">
                <Input
                  aria-label="Budget, in LXC"
                  inputMode="decimal"
                  placeholder="Budget, LXC"
                  className="font-figure"
                  value={draft.budget}
                  disabled={agent !== null}
                  onChange={set('budget')}
                />
                <Input aria-label="At most a day, in LXC" inputMode="decimal" placeholder="A day, LXC" className="font-figure" value={draft.daily} onChange={set('daily')} />
                <Input
                  aria-label="Ask a person above, in LXC"
                  inputMode="decimal"
                  placeholder="Ask above, LXC"
                  className="font-figure"
                  value={draft.approval}
                  onChange={set('approval')}
                />
              </div>
              <p className="text-caption text-muted">
                The budget moves from the workspace into its wallet, and Lens refuses what would take it past the budget in a month.
                Leave a day blank for no daily limit, and the approval amount blank and nothing is held for a person.
              </p>
              {/* One-handed on a phone: full-width buttons; side by side on a wide screen. Send stays the view's one primary. */}
              <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
                <Button type="submit" className="h-12 w-full wide:h-8 wide:w-auto" disabled={!ready || launch.isPending}>
                  {launch.isPending ? 'Launching…' : agent !== null ? 'Try again' : `Launch ${name || 'the agent'}`}
                </Button>
                {agent === null && !launch.isPending ? (
                  <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
                    Cancel
                  </Button>
                ) : null}
              </div>
              {launch.isError ? (
                <p role="alert" className="text-caption text-ink">
                  {agent !== null ? `${agent.name} is made, but ${failedAt === 'fund' ? 'its budget was not moved' : failedAt === 'key' ? 'its key was not issued' : 'its rules were not saved'}: ` : ''}
                  {refusalText(launch.error)}
                  {failedAt === 'fund' ? (
                    <>
                      {' '}
                      <Link className={inlineLink} to="/billing">
                        Put credit in on Billing
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : null}
            </form>
          ) : (
            <>
              <p role="status" className="text-body text-ink" data-testid="chat-launch-done">
                Launched {agent.name} with <Lxc ulxc={budget ?? 0} /> in its wallet.{' '}
                <Link className={inlineLink} to={`/agents?${new URLSearchParams({ agent: agent.id }).toString()}`}>
                  Open it on Agent Wallets
                </Link>
              </p>
              <div className="flex flex-col gap-1">
                <p className="text-body text-ink">Its key — store it now, it will not be shown again:</p>
                <p className="flex flex-wrap items-center gap-x-2">
                  <span className="break-all font-mono text-ink" data-testid="chat-launch-key">
                    {issued.key}
                  </span>
                  <CopyButton text={issued.key} label="Copy key" />
                </p>
              </div>
              {ctx.isError ? (
                <p className="text-caption text-muted">The address to point it at could not be read just now; Setup has it.</p>
              ) : ctx.data ? (
                toolsFor(ctx.data.lens_public_base_url, issued.key)
                  .filter((t) => t.kind === 'env')
                  .map((t) => (
                    <div key={t.id} className="flex flex-col gap-1">
                      <p className="text-caption text-ink">{t.name}</p>
                      <CopyBlock text={t.copyText} label="the two lines" />
                    </div>
                  ))
              ) : null}
              {first !== null ? (
                <p role="status" className="text-body text-ink" data-testid="chat-launch-first-call">
                  {agent.name}’s first call is on its statement: <Lxc ulxc={Math.abs(first.amount_ulxc)} sign={first.amount_ulxc < 0 ? '−' : '+'} />,
                  leaving <Lxc ulxc={first.balance_after_ulxc} /> in its wallet.{' '}
                  <Link className={inlineLink} to={statementLineHref({ agent_id: agent.id, entry_id: first.entry_id })}>
                    See it on the statement
                  </Link>
                </p>
              ) : st.isError ? (
                <p className="text-caption text-muted">{agent.name}’s statement could not be read just now; Agent Wallets has it.</p>
              ) : (
                <p className="text-caption text-muted" data-testid="chat-launch-waiting">
                  Waiting for {agent.name}’s first call. Send one with the key, and it lands here.
                </p>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
