import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Input, focusRing, inlineLink } from '@talyvor/ui'

import { BOOK_KEY, rulesKey } from '../lens/AgentBank'
import { type AgentRules, agentBankApi, parseLXC, refusalText } from '../lens/agentBankApi'
import { Lxc } from '../lens/money'
import { modelCapKey, useRuleChoices } from '../lens/rulePickers'
import { Card } from '../lens/walletBrand'

// B28.352 — set an agent's rules in plain words. "Cap Researcher at 5 LXC a day on Opus" typed in Chat's composer is
// not sent to the model: it opens a card in the conversation with the agent, the amount, how often and the model read
// from the sentence, each changeable, and what the rule is now beside what it will be. Save reads the agent's rules from
// Lens afresh and puts them back with that one limit changed, through the BFF's existing /api/agents routes, as Agent
// Wallets does; Lens then refuses a call that would take the agent past it.

export type RulePeriod = 'hour' | 'day' | 'week' | 'month'

/** What the sentence said, as the card's fields read it: "" for a model when it named none. */
export interface RuleDraft {
  agent: string
  amount: string
  period: RulePeriod
  model: string
}

const SENTENCE =
  /^\s*(?:please\s+)?(?:cap|limit)\s+(?:agent\s+)?(.+?)\s+(?:at|to)\s+(\d+(?:\.\d{1,6})?)\s*LXC\s+(?:a|an|per|each)\s+(hour|day|week|month)(?:\s+(?:on|for)\s+(.+?))?\s*[.!]?\s*$/i

/**
 * Reads a sentence that sets one of an agent's limits, or null when it is not one: "Cap|Limit [agent] <name> at|to
 * <amount> LXC a|per hour|day|week|month [on <model>]". The amount must be in LXC, so a question about anything else
 * still goes to the model.
 */
export function parseRule(text: string): RuleDraft | null {
  const m = SENTENCE.exec(text)
  if (m === null) return null
  const unquote = (s: string) => s.replace(/^[\s"'“‘]+|[\s"'”’]+$/g, '')
  return { agent: unquote(m[1]), amount: m[2], period: m[3].toLowerCase() as RulePeriod, model: unquote(m[4] ?? '') }
}

/** A message that sets a rule rather than asking the model. */
export const isRuleCommand = (text: string) => parseRule(text) !== null

const FIELD: Record<RulePeriod, 'hourly_limit_ulxc' | 'daily_limit_ulxc' | 'weekly_limit_ulxc' | 'monthly_limit_ulxc'> = {
  hour: 'hourly_limit_ulxc',
  day: 'daily_limit_ulxc',
  week: 'weekly_limit_ulxc',
  month: 'monthly_limit_ulxc',
}
const PERIOD_TEXT: Record<RulePeriod, string> = { hour: 'an hour', day: 'a day', week: 'a week', month: 'a month' }

/**
 * The catalog model a name in the sentence means: the one whose name or id holds every word of it, newest first as
 * the picker lists them, so "Opus" is the newest Opus. Undefined when none does.
 */
export function resolveModel(typed: string, options: { value: string; label: string }[]): string | undefined {
  const words = typed.toLowerCase().split(/\s+/).filter((w) => w !== '')
  const exact = options.find((o) => o.value.toLowerCase() === typed.toLowerCase() || o.label.toLowerCase() === typed.toLowerCase())
  return (exact ?? options.find((o) => words.length > 0 && words.every((w) => `${o.label} ${o.value}`.toLowerCase().includes(w))))?.value
}

/** The rules with the one limit the card names changed; every other rule as Lens holds it. */
export function withRule(current: AgentRules, period: RulePeriod, model: string, ulxc: number): AgentRules {
  if (model === '') return { ...current, [FIELD[period]]: ulxc }
  const others = Object.entries(current.model_daily_limits_ulxc ?? {}).filter(([m]) => modelCapKey(m) !== modelCapKey(model))
  return { ...current, model_daily_limits_ulxc: { ...Object.fromEntries(others), [model]: ulxc } }
}

/** The limit as the rules hold it now: 0 is none. */
function limitNow(rules: AgentRules, period: RulePeriod, model: string): number {
  if (model === '') return rules[FIELD[period]] ?? 0
  return Object.entries(rules.model_daily_limits_ulxc ?? {}).find(([m]) => modelCapKey(m) === modelCapKey(model))?.[1] ?? 0
}

const selectClass = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

export function RuleCard({ command, onClose }: { command: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [typed] = useState(() => parseRule(command) ?? { agent: '', amount: '', period: 'day' as RulePeriod, model: '' })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = (book.data?.agents ?? []).filter((a) => a.archived_at === undefined)
  const choices = useRuleChoices()
  const options = choices.models.flatMap((g) => g.options)

  // The agent and the model as the sentence named them, once the book and the catalog are read; then as chosen.
  const [agentId, setAgentId] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [amount, setAmount] = useState(typed.amount)
  const [period, setPeriod] = useState<RulePeriod>(typed.period)
  const named = agents.find((a) => a.name.trim().toLowerCase() === typed.agent.toLowerCase())
  const typedModel = typed.model === '' ? '' : resolveModel(typed.model, options)
  const chosenAgent = agentId ?? named?.id ?? ''
  const chosenModel = model ?? typedModel ?? null // null: a model was named that the catalog does not list
  const agent = agents.find((a) => a.id === chosenAgent)

  const rules = useQuery({ queryKey: rulesKey(chosenAgent), queryFn: () => agentBankApi.rules(chosenAgent), enabled: chosenAgent !== '' })
  const ulxc = parseLXC(amount)
  const byDay = chosenModel === '' || period === 'day'
  const ready = agent !== undefined && chosenModel !== null && ulxc !== null && ulxc > 0 && byDay

  const save = useMutation({
    mutationFn: async () => {
      // Read afresh, so a rule changed elsewhere since the card opened is kept, not put back as it was.
      const current = await agentBankApi.rules(chosenAgent)
      return agentBankApi.setRules(chosenAgent, withRule(current, period, chosenModel ?? '', ulxc ?? 0))
    },
    onSuccess: (saved) => qc.setQueryData(rulesKey(chosenAgent), saved),
  })
  const saved = save.data

  const modelName = (id: string) => options.find((o) => o.value === id)?.label ?? id
  const what = (
    <>
      at most <Lxc ulxc={ulxc ?? 0} /> {PERIOD_TEXT[period]}
      {chosenModel ? ` on ${modelName(chosenModel)}` : ''}
    </>
  )
  const now = rules.data === undefined ? null : limitNow(rules.data, period, chosenModel ?? '')

  // Typed a moment ago in the composer: the card comes into view, however long the conversation above it.
  const top = useRef<HTMLDivElement | null>(null)
  // A block body: in Chromium scrollIntoView answers a promise, and an effect that returns one is not a cleanup.
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <div ref={top}>
      <Card data-testid="chat-rule">
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-caption text-muted">
            Set a rule <span className="break-all font-mono">{command}</span>
          </p>
          {saved !== undefined && agent !== undefined ? (
            <p role="status" className="text-body text-ink" data-testid="chat-rule-saved">
              Saved: {agent.name} may spend {what}. Lens refuses a call that would take it past that.{' '}
              <Link className={inlineLink} to={`/agents?${new URLSearchParams({ agent: agent.id }).toString()}`}>
                See its rules on Agent Wallets
              </Link>
            </p>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (ready && !save.isPending) save.mutate()
              }}
            >
              <div className="flex flex-col gap-3 wide:flex-row wide:flex-wrap wide:items-center">
                <select aria-label="Agent" className={`${selectClass} wide:max-w-48`} value={chosenAgent} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="" disabled>
                    Pick an agent
                  </option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="At most, in LXC"
                  inputMode="decimal"
                  placeholder="At most, LXC"
                  className="font-figure wide:w-28"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <select aria-label="How often" className={selectClass} value={period} onChange={(e) => setPeriod(e.target.value as RulePeriod)}>
                  {(Object.keys(PERIOD_TEXT) as RulePeriod[]).map((p) => (
                    <option key={p} value={p}>
                      {PERIOD_TEXT[p]}
                    </option>
                  ))}
                </select>
                <select aria-label="On which model" className={`${selectClass} wide:max-w-56`} value={chosenModel ?? '?'} onChange={(e) => setModel(e.target.value)}>
                  <option value="?" disabled hidden>
                    Pick a model
                  </option>
                  <option value="">on every model</option>
                  {choices.models
                    .filter((g) => g.options.length > 0)
                    .map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            on {o.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              </div>
              {typed.agent !== '' && named === undefined && book.data !== undefined ? (
                <p className="text-caption text-muted">No agent is called “{typed.agent}” — pick one.</p>
              ) : null}
              {chosenModel === null && (choices.models.length > 0 || choices.failed) ? (
                <p className="text-caption text-muted">No model in the catalog is called “{typed.model}” — pick one.</p>
              ) : null}
              {!byDay ? <p className="text-caption text-muted">Lens caps one model by the day: choose a day, or every model.</p> : null}
              {agent !== undefined && ulxc !== null && ulxc > 0 && chosenModel !== null && byDay ? (
                <p className="text-body text-ink" data-testid="chat-rule-change">
                  {agent.name} may spend {what}.{' '}
                  <span className="text-muted">
                    {now === null ? '' : now > 0 ? (
                      <>
                        It is <Lxc ulxc={now} /> now.
                      </>
                    ) : (
                      'There is no such limit now.'
                    )}
                  </span>
                </p>
              ) : null}
              {/* One-handed on a phone: full-width buttons; side by side on a wide screen. Send stays the view's one primary. */}
              <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
                <Button type="submit" className="h-12 w-full wide:h-8 wide:w-auto" disabled={!ready || save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save the rule'}
                </Button>
                {!save.isPending ? (
                  <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
                    Cancel
                  </Button>
                ) : null}
              </div>
              {save.isError ? (
                <p role="alert" className="text-caption text-ink">
                  The rule was not saved: {refusalText(save.error)}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </Card>
    </div>
  )
}

// B28.353 — the approval amount in plain words. "Ask me above 2 LXC", or "… for Researcher", typed in Chat's composer is
// not sent to the model either: it opens a card with the agent and the amount, each changeable, and the amount as it is
// now. Save puts the agent's rules back with only approval_above_ulxc changed, as the card above does for a limit; Lens
// then holds any request or payment of the agent's above it until a person approves it.

/** What an approval sentence said: "" for an agent when it named none. */
export interface AskAboveDraft {
  agent: string
  amount: string
}

const ASK_ABOVE =
  /^\s*(?:please\s+)?ask\s+(?:me|a\s+person)\s+(?:(?:before|about|for)\s+anything\s+)?(?:above|over|more\s+than)\s+(\d+(?:\.\d{1,6})?)\s*LXC(?:\s+(?:for|from|on)\s+(?:agent\s+)?(.+?))?\s*[.!]?\s*$/i

/**
 * Reads a sentence that sets an agent's approval amount, or null when it is not one: "Ask me|a person [before anything]
 * above|over|more than <amount> LXC [for <agent>]". The amount must be in LXC, so a question about anything else still
 * goes to the model.
 */
export function parseAskAbove(text: string): AskAboveDraft | null {
  const m = ASK_ABOVE.exec(text)
  if (m === null) return null
  return { agent: (m[2] ?? '').replace(/^[\s"'“‘]+|[\s"'”’]+$/g, ''), amount: m[1] }
}

/** A message that sets an agent's approval amount rather than asking the model. */
export const isAskAboveCommand = (text: string) => parseAskAbove(text) !== null

export function AskAboveCard({ command, onClose }: { command: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [typed] = useState(() => parseAskAbove(command) ?? { agent: '', amount: '' })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = (book.data?.agents ?? []).filter((a) => a.archived_at === undefined)

  // The agent the sentence named; with none named, the workspace's one agent if it has only one. Then as chosen.
  const [agentId, setAgentId] = useState<string | null>(null)
  const [amount, setAmount] = useState(typed.amount)
  const named = typed.agent === '' ? (agents.length === 1 ? agents[0] : undefined) : agents.find((a) => a.name.trim().toLowerCase() === typed.agent.toLowerCase())
  const chosenAgent = agentId ?? named?.id ?? ''
  const agent = agents.find((a) => a.id === chosenAgent)

  const rules = useQuery({ queryKey: rulesKey(chosenAgent), queryFn: () => agentBankApi.rules(chosenAgent), enabled: chosenAgent !== '' })
  const ulxc = parseLXC(amount)
  const ready = agent !== undefined && ulxc !== null && ulxc > 0

  const save = useMutation({
    mutationFn: async () => {
      // Read afresh, so a rule changed elsewhere since the card opened is kept, not put back as it was.
      const current = await agentBankApi.rules(chosenAgent)
      return agentBankApi.setRules(chosenAgent, { ...current, approval_above_ulxc: ulxc ?? 0 })
    },
    onSuccess: (saved) => qc.setQueryData(rulesKey(chosenAgent), saved),
  })
  const saved = save.data
  const now = rules.data?.approval_above_ulxc ?? null

  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  const what = (name: string) => (
    <>
      any request or payment {name} makes above <Lxc ulxc={ulxc ?? 0} />
    </>
  )

  return (
    <div ref={top}>
      <Card data-testid="chat-ask-above">
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-caption text-muted">
            Set a rule <span className="break-all font-mono">{command}</span>
          </p>
          {saved !== undefined && agent !== undefined ? (
            <p role="status" className="text-body text-ink" data-testid="chat-ask-above-saved">
              Saved: a person must approve {what(agent.name)}. Until then it waits in Approvals.{' '}
              <Link className={inlineLink} to={`/agents?${new URLSearchParams({ agent: agent.id }).toString()}`}>
                See its rules on Agent Wallets
              </Link>
            </p>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (ready && !save.isPending) save.mutate()
              }}
            >
              <div className="flex flex-col gap-3 wide:flex-row wide:flex-wrap wide:items-center">
                <select aria-label="Agent" className={`${selectClass} wide:max-w-48`} value={chosenAgent} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="" disabled>
                    Pick an agent
                  </option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="Ask above, in LXC"
                  inputMode="decimal"
                  placeholder="Ask above, LXC"
                  className="font-figure wide:w-28"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              {typed.agent !== '' && named === undefined && book.data !== undefined ? (
                <p className="text-caption text-muted">No agent is called “{typed.agent}” — pick one.</p>
              ) : null}
              {agent !== undefined && ulxc !== null && ulxc > 0 ? (
                <p className="text-body text-ink" data-testid="chat-ask-above-change">
                  A person must approve {what(agent.name)}.{' '}
                  <span className="text-muted">
                    {now === null ? '' : now > 0 ? (
                      <>
                        It is <Lxc ulxc={now} /> now.
                      </>
                    ) : (
                      'Nothing waits for a person now.'
                    )}
                  </span>
                </p>
              ) : null}
              <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
                <Button type="submit" className="h-12 w-full wide:h-8 wide:w-auto" disabled={!ready || save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save the rule'}
                </Button>
                {!save.isPending ? (
                  <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
                    Cancel
                  </Button>
                ) : null}
              </div>
              {save.isError ? (
                <p role="alert" className="text-caption text-ink">
                  The rule was not saved: {refusalText(save.error)}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </Card>
    </div>
  )
}
