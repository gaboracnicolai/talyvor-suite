import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Input, focusRing, inlineLink } from '@talyvor/ui'

import { BOOK_KEY, lineText, statementKey } from '../lens/AgentBank'
import { AgentBankError, type AgentTaskReply, type StatementLine, agentBankApi, refusalText } from '../lens/agentBankApi'
import { Lxc } from '../lens/money'
import { Card } from '../lens/walletBrand'
import { type ChatModel, statementLineHref } from './chatApi'
import { Markdown } from './Markdown'

// B28.359 — hand a task to an agent from Chat (B28.96). `/task Researcher: name three models that read PDFs` typed in the
// composer is not asked of the model on the conversation's account: it opens a card with the agent and the task. Hand it
// over, and the task runs on the agent's own wallet (apps/bff/agent_task.go): the BFF issues the agent a key for this one
// task, sends the task to the conversation's model with it and revokes the key when the answer is in, and Lens charges
// the call to the agent's wallet after judging it by the agent's rules. The card shows the answer, and every line the
// task put on the agent's statement — the statement read just before it was handed over, and again after — each linked.

/** A message that hands a task to an agent rather than asking the model. */
export const TASK_COMMAND = /^\/task(?:\s|$)/i

/** What the command said: `agent` is what came before its first colon ("" with none), `task` what came after. */
export interface TaskDraft {
  agent: string
  task: string
  /** Everything after /task: the task, when what came before the colon names no agent. */
  whole: string
}

/** Reads `/task <agent>: <what to do>`. */
export function parseTask(command: string): TaskDraft {
  const whole = command.replace(/^\/task\b/i, '').trim()
  const colon = whole.indexOf(':')
  if (colon < 0) return { agent: '', task: whole, whole }
  return { agent: whole.slice(0, colon).trim().replace(/^agent\s+/i, ''), task: whole.slice(colon + 1).trim(), whole }
}

/** How often the statement is read after the answer, and how many times: a call's charge can be settled after it answers. */
const LINES_POLL_MS = 2_000
const LINES_POLL_TRIES = 15

const lineKey = (l: StatementLine) => `${l.entry_id}-${l.kind}`

/** Why the task was not done. A refusal is Lens's sentence; past the refusal, the BFF's own (the call may have run). */
function taskRefusal(err: unknown): string {
  if (err instanceof AgentBankError && err.status >= 500) return err.sentence === '' ? 'Lens could not answer just now.' : err.sentence
  return refusalText(err)
}

const selectClass = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

export function TaskCard({ command, model, onClose }: { command: string; model: ChatModel | undefined; onClose: () => void }) {
  const qc = useQueryClient()
  const [typed] = useState(() => parseTask(command))
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = (book.data?.agents ?? []).filter((a) => a.archived_at === undefined)
  const named = typed.agent === '' ? undefined : agents.find((a) => a.name.trim().toLowerCase() === typed.agent.toLowerCase())
  // With no agent named, the workspace's only agent is the one meant.
  const [agentId, setAgentId] = useState<string | null>(null)
  const chosen = agentId ?? named?.id ?? (typed.agent === '' && agents.length === 1 ? agents[0].id : '')
  const agent = agents.find((a) => a.id === chosen)
  // Before the colon was not an agent's name: it was part of the task.
  const [edited, setEdited] = useState<string | null>(null)
  const task = edited ?? (named !== undefined || typed.agent === '' || book.data === undefined ? typed.task : typed.whole)

  // The task's model is the conversation's, as it stood when the command was typed.
  const [on] = useState(model)
  // The statement as it stood just before the task was handed over: every line not on it is the task's.
  const before = useRef<Set<string> | null>(null)
  const [ranFor, setRanFor] = useState<{ id: string; name: string } | null>(null)
  const run = useMutation({
    mutationFn: async (): Promise<AgentTaskReply> => {
      const a = agent!
      before.current = new Set(((await agentBankApi.statement(a.id)).lines ?? []).map(lineKey))
      setRanFor({ id: a.id, name: a.name })
      return agentBankApi.task(a.id, { task: task.trim(), provider: on!.provider, model: on!.id })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  const done = run.data

  // After the answer, the agent's statement, read on this card's own key — or, answered from the cache, once.
  const asked = useId()
  const linesKey = [...statementKey(ranFor?.id ?? ''), 'task', asked]
  const st = useQuery({
    queryKey: linesKey,
    queryFn: () => agentBankApi.statement(ranFor!.id),
    enabled: done !== undefined && ranFor !== null,
    refetchInterval: (q) => (done?.replayed || q.state.dataUpdateCount >= LINES_POLL_TRIES ? false : LINES_POLL_MS),
  })
  const reads = qc.getQueryState(linesKey)?.dataUpdateCount ?? 0
  function added(lines: StatementLine[] | null | undefined): StatementLine[] {
    const was = before.current
    return was === null ? [] : (lines ?? []).filter((l) => !was.has(lineKey(l)))
  }
  const lines = added(st.data?.lines)
  const net = lines.reduce((s, l) => s + l.amount_ulxc, 0)
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? 'another agent'

  const ready = agent !== undefined && on !== undefined && task.trim() !== ''
  // Typed a moment ago in the composer: the card comes into view, however long the conversation above it.
  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <div ref={top}>
      <Card data-testid="chat-task">
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-caption text-muted">
            Hand a task to an agent <span className="break-all font-mono">{command}</span>
          </p>
          {done !== undefined && ranFor !== null ? (
            <>
              <p role="status" className="text-body text-ink" data-testid="chat-task-done">
                {ranFor.name} did the task{done.model ? ` on ${on?.id === done.model ? on.display_name : done.model}` : ''}, on its own wallet:
              </p>
              <div className="rounded-control border border-rule px-3 py-2 text-reading text-ink" data-testid="chat-task-answer">
                {done.answer.trim() === '' ? <p className="text-muted">The model answered nothing.</p> : <Markdown source={done.answer} />}
              </div>
              {lines.length > 0 ? (
                <div className="flex flex-col gap-1" data-testid="chat-task-billed">
                  <p className="text-body text-ink">
                    {ranFor.name}’s wallet paid for it: <Lxc ulxc={Math.abs(net)} sign={net < 0 ? '−' : '+'} /> on its statement, leaving{' '}
                    <Lxc ulxc={lines[0].balance_after_ulxc} />.
                  </p>
                  <ul className="flex flex-col gap-1">
                    {lines.map((l) => (
                      <li key={lineKey(l)} className="text-caption">
                        <Link className={inlineLink} to={statementLineHref({ agent_id: ranFor.id, entry_id: l.entry_id })}>
                          {lineText(l, nameOf)}
                        </Link>{' '}
                        <Lxc ulxc={Math.abs(l.amount_ulxc)} sign={l.amount_ulxc < 0 ? '−' : '+'} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : done.replayed ? (
                <p className="text-caption text-muted" data-testid="chat-task-replayed">
                  Lens answered it from the cache, so nothing was charged to {ranFor.name}.
                </p>
              ) : st.isError ? (
                <p className="text-caption text-muted">{ranFor.name}’s statement could not be read just now; Agent Wallets has it.</p>
              ) : !st.isFetching && reads >= LINES_POLL_TRIES ? (
                <p className="text-caption text-muted">Nothing for it is on {ranFor.name}’s statement yet; Agent Wallets shows it when it lands.</p>
              ) : (
                <p className="text-caption text-muted" data-testid="chat-task-waiting">
                  Reading {ranFor.name}’s statement for what it was charged…
                </p>
              )}
              {!done.key_revoked ? (
                <p className="text-caption text-ink">
                  The key the task ran on could not be revoked just now.{' '}
                  <Link className={inlineLink} to="/keys">
                    Revoke “Task from Chat” on API keys
                  </Link>
                </p>
              ) : null}
              <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
                <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (ready && !run.isPending) run.mutate()
              }}
            >
              <div className="flex flex-col gap-3 wide:flex-row wide:items-center">
                <select
                  aria-label="Agent"
                  className={`${selectClass} wide:max-w-48`}
                  value={chosen}
                  disabled={run.isPending}
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
                <Input aria-label="The task" placeholder="What it should do" value={task} disabled={run.isPending} onChange={(e) => setEdited(e.target.value)} />
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
              <p className="text-caption text-muted" data-testid="chat-task-terms">
                {on === undefined ? (
                  'Pick a model in the message box first: the task goes to the conversation’s model.'
                ) : (
                  <>
                    It goes to {on.display_name} on {agent?.name ?? 'the agent'}’s own wallet: every call it makes is charged there, and
                    Lens judges each by {agent === undefined ? 'its' : `${agent.name}’s`} rules first. The conversation’s account pays nothing.
                  </>
                )}
              </p>
              {/* One-handed on a phone: full-width buttons; side by side on a wide screen. Send stays the view's one primary. */}
              <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
                <Button type="submit" className="h-12 w-full wide:h-8 wide:w-auto" disabled={!ready || run.isPending}>
                  {run.isPending ? `${agent?.name ?? 'The agent'} is working on it…` : `Hand it to ${agent?.name ?? 'the agent'}`}
                </Button>
                {!run.isPending ? (
                  <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
                    Cancel
                  </Button>
                ) : null}
              </div>
              {run.isError ? (
                <p role="alert" className="text-caption text-ink">
                  {agent?.name ?? 'The agent'} did not do the task: {taskRefusal(run.error)}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </Card>
    </div>
  )
}
