import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, focusRing, inlineLink } from '@talyvor/ui'

import { FORECAST_KEY } from '../lens/AgentBank'
import { type SpendForecast, agentBankApi } from '../lens/agentBankApi'
import { Lxc } from '../lens/money'
import { Card } from '../lens/walletBrand'
import { readFailure } from '../lens/WalletMoney'

// B28.357 — "Will Researcher run out this month?" typed in Chat's composer is not sent to the model: it opens a card in
// the conversation that answers from Lens's month-end forecast (GET /api/agents/forecast, as Agent Wallets reads it).
// The date it states is the one Lens's forecast gives for that agent, runs_out_at, read as the calendar date Lens wrote
// it in, never moved through this browser's time zone. B28.94 has Lens give that date; until it does, the card says
// Lens has not said and gives the month's spend and its month-end forecast.

type AgentForecast = NonNullable<SpendForecast['agents']>[number]

const RUN_OUT =
  /^\s*(?:please\s+)?(?:will|does|is|when\s+(?:will|does))\s+(?:agent\s+)?(.+?)\s+(?:going\s+to\s+)?runs?\s+out(?:\s+of\s+(?:money|LXC|credits?|funds|budget))?(?:\s+(?:this\s+month|before\s+the\s+(?:month['’]s\s+end|end\s+of\s+the\s+month)))?\s*\??\s*$/i

/**
 * The agent a run-out question names, or null when it is not one: "Will|Does|Is|When will [agent] <name> [going to]
 * run out [of money] [this month]?". Anything else still goes to the model.
 */
export function parseRunOut(text: string): string | null {
  const m = RUN_OUT.exec(text)
  return m === null ? null : m[1].replace(/^[\s"'“‘]+|[\s"'”’]+$/g, '')
}

/** A question the forecast answers rather than the model. */
export const isRunOutQuestion = (text: string) => parseRunOut(text) !== null

// '2026-10-24' is '24 October 2026': a calendar date, never moved through this browser's time zone.
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const longDate = (day: string) => DAY.format(Date.parse(`${day}T00:00:00Z`))

const selectClass = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

/** The answer, from the forecast's runs_out_at for the agent; Lens's forecast may not carry one yet. */
function answer(f: SpendForecast, a: AgentForecast): ReactNode {
  if (a.runs_out_at === undefined) return <>Lens’s forecast does not say yet when {a.name} runs out.</>
  if (a.runs_out_at === null) return <>No. At its pace so far this month, {a.name} does not run out.</>
  const day = a.runs_out_at.slice(0, 10)
  const date = (
    <time dateTime={day} data-testid="chat-forecast-date" className="font-figure">
      {longDate(day)}
    </time>
  )
  const at = Date.parse(a.runs_out_at)
  if (at <= Date.parse(f.at)) return <>Yes. {a.name} has run out: its balance reached nothing on {date}.</>
  if (at < Date.parse(f.month_end)) return <>Yes. At its pace so far this month, {a.name} runs out on {date}.</>
  return <>No, not this month. At its pace so far, {a.name} runs out on {date}.</>
}

export function ForecastCard({ question, onClose }: { question: string; onClose: () => void }) {
  const [typed] = useState(() => parseRunOut(question) ?? '')
  // Its own read, as of the question: never a forecast cached a moment before it was asked.
  const asked = useId()
  const forecast = useQuery({ queryKey: [...FORECAST_KEY, 'asked', asked], queryFn: agentBankApi.forecast })
  const agents = forecast.data?.agents ?? []
  const [agentId, setAgentId] = useState<string | null>(null)
  const named = agents.find((a) => a.name.trim().toLowerCase() === typed.toLowerCase())
  const chosen = agentId ?? named?.agent_id ?? ''
  const agent = agents.find((a) => a.agent_id === chosen)

  // Typed a moment ago in the composer: the card comes into view, however long the conversation above it.
  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <div ref={top}>
      <Card data-testid="chat-forecast">
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-caption text-muted">
            Asked <span className="break-all font-mono">{question}</span>
          </p>
          {forecast.isError ? (
            <p role="alert" className="text-body text-ink">
              {readFailure(forecast.error, 'The forecast')}
            </p>
          ) : forecast.isPending ? (
            <p className="text-body text-muted">Reading the forecast…</p>
          ) : (
            <>
              {agent === undefined ? (
                <>
                  <select aria-label="Agent" className={`${selectClass} wide:max-w-48`} value={chosen} onChange={(e) => setAgentId(e.target.value)}>
                    <option value="" disabled>
                      Pick an agent
                    </option>
                    {agents.map((a) => (
                      <option key={a.agent_id} value={a.agent_id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-caption text-muted">No agent is called “{typed}” — pick one.</p>
                </>
              ) : (
                <>
                  <p role="status" className="text-body text-ink" data-testid="chat-forecast-answer">
                    {answer(forecast.data, agent)}
                  </p>
                  <p className="text-caption text-muted">
                    It has spent <Lxc ulxc={agent.spent_ulxc} /> this month; at that pace, <Lxc ulxc={agent.forecast_ulxc} /> by the month’s end
                    {agent.balance_ulxc === undefined ? '' : <>. It holds <Lxc ulxc={agent.balance_ulxc} /> now</>}.{' '}
                    <Link className={inlineLink} to={`/agents?${new URLSearchParams({ agent: agent.agent_id }).toString()}`}>
                      See it on Agent Wallets
                    </Link>
                  </p>
                </>
              )}
            </>
          )}
          <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
            <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
