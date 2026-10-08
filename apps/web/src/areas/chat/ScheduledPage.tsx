import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { Button, inlineLink } from '@talyvor/ui'

import { ApiError } from '../../lib/api'
import { BOOK_KEY } from '../lens/AgentBank'
import { type PromptSchedule, agentBankApi, refusalText } from '../lens/agentBankApi'
import { formatWhen } from '../lens/format'
import { fetchModels } from './chatApi'
import { EVERY_WORDS, PROMPT_SCHEDULES_KEY, ScheduledRun, usePromptSchedules } from './ScheduledPrompt'

// B28.377 — Scheduled prompts, linked from Chat's rail: every prompt the workspace scheduled with /schedule, who pays
// for it, when it runs next, and each run's answer with what it cost on the agent's statement — the answers that came
// while Chat was closed are here. A schedule that repeats is stopped here.

/** The runs shown under each schedule; the rest are on the agent's statement. */
const RUNS_SHOWN = 5

function when(s: PromptSchedule): string {
  if (!s.active) return s.every === 'once' && (s.runs ?? []).length > 0 ? 'Ran' : 'Stopped'
  return s.next_run_at === undefined ? EVERY_WORDS[s.every] : `${EVERY_WORDS[s.every]} · next ${formatWhen(s.next_run_at)}`
}

export function ScheduledPage() {
  const qc = useQueryClient()
  const list = usePromptSchedules()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const catalog = useQuery({ queryKey: ['chat-models'], queryFn: fetchModels, retry: false })
  const stop = useMutation({
    mutationFn: (sid: string) => agentBankApi.stopPromptSchedule(sid),
    onSettled: () => qc.invalidateQueries({ queryKey: PROMPT_SCHEDULES_KEY }),
  })
  const schedules = list.data?.schedules ?? []
  const nameOf = (id: string) => book.data?.agents.find((a) => a.id === id)?.name ?? 'The agent'
  const modelOf = (id: string) => catalog.data?.find((m) => m.id === id)?.display_name ?? id

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
      {/* The page's name is the console banner's <h1> (CONSOLE_ROUTES' title), so no second one here. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-body text-muted">
          Prompts asked at a time you set, each on an agent’s own wallet. Schedule one in Chat with{' '}
          <span className="font-mono">/schedule</span>, the agent’s name, a colon and what to ask.
        </p>
        <Link className={`text-body text-ink ${inlineLink}`} to="/chat">
          Back to Chat
        </Link>
      </div>

      {list.isPending ? (
        <p className="text-body text-muted">Reading your scheduled prompts…</p>
      ) : list.isError ? (
        <p className="text-body text-ink" role="alert">
          {list.error instanceof ApiError && list.error.status === 404
            ? 'Scheduled prompts are not available here yet.'
            : 'Your scheduled prompts could not be read just now.'}
        </p>
      ) : schedules.length === 0 ? (
        <p className="text-body text-muted">Nothing is scheduled. Type /schedule in Chat to ask something later, or every day.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {schedules.map((s) => (
            <li key={s.id} className="flex flex-col gap-3 rounded-card border border-rule bg-raised p-4" data-testid="scheduled-prompt">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="min-w-0 text-body font-medium text-ink">{nameOf(s.agent_id)} asks {modelOf(s.model)}</p>
                <p className="font-figure text-caption text-muted">{when(s)}</p>
              </div>
              <p className="line-clamp-4 whitespace-pre-wrap text-caption text-ink">{s.prompt}</p>
              {(s.runs ?? []).slice(0, RUNS_SHOWN).map((r) => (
                <div key={`${r.ran_at}-${r.request_id ?? ''}`} className="flex flex-col gap-1 border-t border-rule pt-3">
                  <p className="font-figure text-caption text-muted">{formatWhen(r.ran_at)}</p>
                  <ScheduledRun run={r} agentID={s.agent_id} agentName={nameOf(s.agent_id)} />
                </div>
              ))}
              {s.active ? (
                <div>
                  <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" disabled={stop.isPending} onClick={() => stop.mutate(s.id)}>
                    Stop it
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {stop.isError ? (
        <p role="alert" className="text-caption text-ink">
          It was not stopped: {refusalText(stop.error)}
        </p>
      ) : null}
    </div>
  )
}
