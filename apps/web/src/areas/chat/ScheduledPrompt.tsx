import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Input, focusRing, inlineLink } from '@talyvor/ui'

import { BOOK_KEY } from '../lens/AgentBank'
import { AgentBankError, type PromptSchedule, type PromptScheduleRun, agentBankApi, refusalText } from '../lens/agentBankApi'
import { formatWhen } from '../lens/format'
import { Lxc } from '../lens/money'
import { Card } from '../lens/walletBrand'
import { type ChatModel, statementLineHref } from './chatApi'
import { Markdown } from './Markdown'

// B28.377 — a prompt scheduled from Chat (the talyvor-suite side of B28.125). `/schedule Researcher: summarise what the
// agents spent yesterday` typed in the composer is not asked now: it opens a card with the agent, the prompt, the time
// and how often. Scheduled, Talyvor keeps it and asks the conversation's model at that time on the agent's own wallet
// (apps/bff/prompt_schedules.go), judged by the agent's rules first, so what it cost is a line on the agent's statement.
// The card waits for the run and shows the answer and its charge, linked to that line; /chat/scheduled
// (ScheduledPage.tsx) lists every schedule and its runs, for the answers that came while Chat was closed.

/** A message that schedules a prompt rather than asking it. */
export const SCHEDULE_COMMAND = /^\/schedule(?:\s|$)/i

/** The workspace's prompt schedules, read by the card and the page alike. */
export const PROMPT_SCHEDULES_KEY = ['prompt-schedules'] as const

/** What the command said: `agent` is what came before its first colon ("" with none), `prompt` what came after. */
export interface ScheduleDraft {
  agent: string
  prompt: string
  /** Everything after /schedule: the prompt, when what came before the colon names no agent. */
  whole: string
}

/** Reads `/schedule <agent>: <what to ask>`. */
export function parseSchedule(command: string): ScheduleDraft {
  const whole = command.replace(/^\/schedule\b/i, '').trim()
  const colon = whole.indexOf(':')
  if (colon < 0) return { agent: '', prompt: whole, whole }
  return { agent: whole.slice(0, colon).trim().replace(/^agent\s+/i, ''), prompt: whole.slice(colon + 1).trim(), whole }
}

/** d as a datetime-local input shows it: this browser's time zone, to the minute. */
export function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The next whole hour: the time a new schedule starts at. */
function nextHour(now = new Date()): Date {
  const d = new Date(now)
  d.setMinutes(60, 0, 0)
  return d
}

export const EVERY_WORDS: Record<PromptSchedule['every'], string> = { once: 'Once', day: 'Every day', week: 'Every week' }

/** Near a run that is due the schedules are read every few seconds, so its answer shows within them; otherwise once a minute. */
const NEAR_POLL_MS = 5_000
const FAR_POLL_MS = 60_000
const NEAR_MS = 2 * 60_000

export function pollEvery(list: PromptSchedule[] | null | undefined, now = Date.now()): number {
  const due = (list ?? []).filter((s) => s.active && s.next_run_at !== undefined).map((s) => Date.parse(s.next_run_at ?? ''))
  return due.some((t) => t - now < NEAR_MS) ? NEAR_POLL_MS : FAR_POLL_MS
}

export function usePromptSchedules(enabled = true) {
  return useQuery({
    queryKey: PROMPT_SCHEDULES_KEY,
    queryFn: agentBankApi.promptSchedules,
    enabled,
    retry: false,
    refetchInterval: (q) => pollEvery(q.state.data?.schedules),
  })
}

/** Why it was not scheduled. A 404 with no sentence of Lens's own is a Lens that does not schedule prompts yet. */
function notScheduled(err: unknown): string {
  if (err instanceof AgentBankError && err.status === 404 && (err.sentence === '' || err.sentence === 'Lens refused this')) {
    return 'scheduling prompts is not available here yet.'
  }
  return refusalText(err)
}

/** Lens's sentence for a refused run, as a sentence: "economy: the agent is paused" → "The agent is paused." */
function refusedBecause(detail: string | undefined): string {
  const s = (detail ?? '').trim().replace(/^economy: /, '')
  if (s === '') return 'the agent’s rules refused it.'
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
}

/** One run: the answer and what the agent's wallet paid for it, linked to its statement line; or why it was refused. */
export function ScheduledRun({ run, agentID, agentName }: { run: PromptScheduleRun; agentID: string; agentName: string }) {
  if (run.outcome === 'refused') {
    return (
      <p className="text-body text-ink" data-testid="scheduled-run-refused">
        It was not asked: {refusedBecause(run.detail)}
      </p>
    )
  }
  const charged = run.charged_ulxc ?? 0
  const line = run.entry_id === undefined || run.entry_id === '' ? `/agents?${new URLSearchParams({ agent: agentID }).toString()}` : statementLineHref({ agent_id: agentID, entry_id: run.entry_id })
  return (
    <div className="flex flex-col gap-2" data-testid="scheduled-run">
      <div className="rounded-control border border-rule px-3 py-2 text-reading text-ink" data-testid="scheduled-run-answer">
        {(run.answer ?? '').trim() === '' ? <p className="text-muted">The model answered nothing.</p> : <Markdown source={run.answer ?? ''} />}
      </div>
      {charged > 0 ? (
        <p className="text-caption text-ink" data-testid="scheduled-run-billed">
          {agentName}’s wallet paid <Lxc ulxc={charged} /> for it:{' '}
          <Link className={inlineLink} to={line}>
            the line on its statement
          </Link>
        </p>
      ) : (
        <p className="text-caption text-muted" data-testid="scheduled-run-billed">
          Answered from the cache, so nothing was charged to {agentName}.
        </p>
      )}
    </div>
  )
}

const selectClass = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

export function ScheduleCard({ command, model, paidBy, onClose }: { command: string; model: ChatModel | undefined; paidBy: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [typed] = useState(() => parseSchedule(command))
  // Read afresh when the card opens: the agent named may have been made on Agent Wallets a moment ago.
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book, refetchOnMount: 'always' })
  const agents = (book.data?.agents ?? []).filter((a) => a.archived_at === undefined)
  const named = typed.agent === '' ? undefined : agents.find((a) => a.name.trim().toLowerCase() === typed.agent.toLowerCase())
  // With no agent named: the one paying for the conversation, else the workspace's only agent.
  const [agentId, setAgentId] = useState<string | null>(null)
  const unnamed = agents.some((a) => a.id === paidBy) ? paidBy : agents.length === 1 ? agents[0].id : ''
  const chosen = agentId ?? named?.id ?? (typed.agent === '' ? unnamed : '')
  const agent = agents.find((a) => a.id === chosen)
  // Before the colon was not an agent's name: it was part of the prompt.
  const [edited, setEdited] = useState<string | null>(null)
  const prompt = edited ?? (named !== undefined || typed.agent === '' || book.data === undefined ? typed.prompt : typed.whole)
  const [when, setWhen] = useState(() => localInput(nextHour()))
  const [every, setEvery] = useState<PromptSchedule['every']>('once')
  // The prompt's model is the conversation's, as it stood when the command was typed.
  const [on] = useState(model)

  // A datetime-local value carries no zone, and is read in this browser's.
  const at = new Date(when)
  const gone = !Number.isNaN(at.getTime()) && at.getTime() < Date.now() - 60_000
  const ready = agent !== undefined && on !== undefined && prompt.trim() !== '' && !Number.isNaN(at.getTime()) && !gone

  const create = useMutation({
    mutationFn: () =>
      agentBankApi.schedulePrompt(agent!.id, { prompt: prompt.trim(), provider: on!.provider, model: on!.id, every, first_run_at: at.toISOString() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROMPT_SCHEDULES_KEY }),
  })
  const created = create.data
  const list = usePromptSchedules(created !== undefined)
  const current = list.data?.schedules?.find((s) => s.id === created?.id) ?? created
  const latest = current?.runs?.[0]
  const stop = useMutation({
    mutationFn: () => agentBankApi.stopPromptSchedule(current!.id),
    onSettled: () => qc.invalidateQueries({ queryKey: PROMPT_SCHEDULES_KEY }),
  })
  const payer = agents.find((a) => a.id === current?.agent_id)?.name ?? agent?.name ?? 'The agent'

  // Typed a moment ago in the composer: the card comes into view, however long the conversation above it.
  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <div ref={top}>
      <Card data-testid="chat-schedule">
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-caption text-muted">
            Schedule a prompt <span className="break-all font-mono">{command}</span>
          </p>
          {current !== undefined ? (
            <>
              {latest === undefined ? (
                <p role="status" className="text-body text-ink" data-testid="chat-schedule-waiting">
                  Scheduled: at <span className="font-figure">{formatWhen(current.next_run_at ?? at.toISOString())}</span> {payer} asks{' '}
                  {on?.id === current.model ? on.display_name : current.model} on its own wallet. The answer shows here, and under{' '}
                  <Link className={inlineLink} to="/chat/scheduled">
                    Scheduled prompts
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <p role="status" className="text-body text-ink" data-testid="chat-schedule-done">
                    At <span className="font-figure">{formatWhen(latest.ran_at)}</span> {payer} {latest.outcome === 'refused' ? 'was to ask' : 'asked'}{' '}
                    {on?.id === current.model ? on.display_name : current.model}:
                  </p>
                  <ScheduledRun run={latest} agentID={current.agent_id} agentName={payer} />
                  {current.active && current.next_run_at !== undefined ? (
                    <p className="text-caption text-muted">
                      Next at <span className="font-figure">{formatWhen(current.next_run_at)}</span>.
                    </p>
                  ) : null}
                </>
              )}
              {list.isError ? <p className="text-caption text-muted">The schedule could not be read just now; Scheduled prompts has it.</p> : null}
              <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
                {current.active && current.every !== 'once' ? (
                  <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" disabled={stop.isPending} onClick={() => stop.mutate()}>
                    Stop it
                  </Button>
                ) : null}
                <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
                  Close
                </Button>
              </div>
              {stop.isError ? (
                <p role="alert" className="text-caption text-ink">
                  It was not stopped: {refusalText(stop.error)}
                </p>
              ) : null}
            </>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (ready && !create.isPending) create.mutate()
              }}
            >
              <div className="flex flex-col gap-3 wide:flex-row wide:items-center">
                <select
                  aria-label="Agent"
                  className={`${selectClass} wide:max-w-48`}
                  value={chosen}
                  disabled={create.isPending}
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
                <Input aria-label="The prompt" placeholder="What to ask" value={prompt} disabled={create.isPending} onChange={(e) => setEdited(e.target.value)} />
              </div>
              <div className="flex flex-col gap-3 wide:flex-row wide:items-center">
                <Input
                  type="datetime-local"
                  aria-label="When"
                  className="font-figure wide:w-56"
                  value={when}
                  disabled={create.isPending}
                  onChange={(e) => setWhen(e.target.value)}
                />
                <select
                  aria-label="How often"
                  className={`${selectClass} wide:max-w-40`}
                  value={every}
                  disabled={create.isPending}
                  onChange={(e) => setEvery(e.target.value as PromptSchedule['every'])}
                >
                  {(Object.keys(EVERY_WORDS) as PromptSchedule['every'][]).map((k) => (
                    <option key={k} value={k}>
                      {EVERY_WORDS[k]}
                    </option>
                  ))}
                </select>
              </div>
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
              {gone ? <p className="text-caption text-ink">That time has passed — pick a time to come.</p> : null}
              <p className="text-caption text-muted" data-testid="chat-schedule-terms">
                {on === undefined ? (
                  'Pick a model in the message box first: the prompt goes to the conversation’s model.'
                ) : (
                  <>
                    At the time set, {on.display_name} is asked on {agent?.name ?? 'the agent'}’s own wallet: each run is charged there, and
                    Lens judges it by {agent === undefined ? 'its' : `${agent.name}’s`} rules first. The conversation’s account pays nothing.
                    Talyvor keeps the prompt and its answers, so it runs while Chat is closed.
                  </>
                )}
              </p>
              {/* One-handed on a phone: full-width buttons; side by side on a wide screen. Send stays the view's one primary. */}
              <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
                <Button type="submit" className="h-12 w-full wide:h-8 wide:w-auto" disabled={!ready || create.isPending}>
                  {create.isPending ? 'Scheduling…' : 'Schedule it'}
                </Button>
                {!create.isPending ? (
                  <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
                    Cancel
                  </Button>
                ) : null}
              </div>
              {create.isError ? (
                <p role="alert" className="text-caption text-ink">
                  It was not scheduled: {notScheduled(create.error)}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </Card>
    </div>
  )
}
