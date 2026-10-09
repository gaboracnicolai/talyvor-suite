import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button, cn, focusRing, inlineLink } from '@talyvor/ui'

import { InlineFailure } from '../../components/SessionExpiredBar'
import { useAuthMeReader } from '../../lib/authMe'
import { pegQuery } from '../lens/money'
import { type ChatMessage, type ChatModel, type Refusal, fetchModels, fetchUnconfiguredProviders, pickerCatalog, streamChat } from './chatApi'
import { cutOff } from './chatStream'
import { previewCost } from './estimate'
import { loadConversations, newConversationId, saveConversations, upsertConversation } from './history'
import { stampChanged } from './historySync'
import { Markdown } from './Markdown'
import { ModelPicker } from './ModelPicker'
import { type AnswerCost, type AnswerSource, answerSourceLine, formatAnswerCost, formatCharged, formatCostRange, formatUsdPer1M, pricedAnswer } from './price'
import { useRevealedText } from './reveal'

// B28.369 — compare models side by side: one question to three models at once, each answer streaming in its own
// column with what it cost under it. Each column is one ordinary Chat request (streamChat, no wallet tools), so Lens
// prices and charges each on its own and says what it charged in the stream (chatStream.ts CHARGE_FRAME); a column
// shows that figure, or the estimate at the list rate until Lens says. An answer can be carried on in Chat.
// B17.123 — every column is asked afresh: a comparison of models is never a cached or shared answer.

const COLUMNS = 3

/** One model's answer to the question, as it arrives. */
interface Column {
  model: ChatModel
  answer: string
  answering: boolean
  cost?: AnswerCost
  source?: AnswerSource
  charged_ulxc?: number
  incomplete?: ChatMessage['incomplete']
  failure?: Refusal
  /** Stop was pressed before this answer finished. */
  stopped?: boolean
}

const listRate = (m: ChatModel) => m.input_per_1m + m.output_per_1m

/**
 * The models a comparison starts with: Chat's default, the cheapest model offered, and the newest model on a provider
 * neither of those is on — so the first comparison already sets a frontier model against a cheap one and another
 * provider. Fewer are offered, fewer columns.
 */
export function defaultTrio(offered: readonly ChatModel[], first: ChatModel | undefined): ChatModel[] {
  const chosen: ChatModel[] = first !== undefined ? [first] : []
  const cheapest = [...offered].sort((a, b) => listRate(a) - listRate(b)).find((m) => !chosen.includes(m))
  if (cheapest !== undefined) chosen.push(cheapest)
  const other =
    offered.find((m) => !chosen.includes(m) && !chosen.some((c) => c.provider === m.provider)) ?? offered.find((m) => !chosen.includes(m))
  if (other !== undefined) chosen.push(other)
  return chosen.slice(0, COLUMNS)
}

/** The line under a column's answer, worded as the line under a Chat answer is. */
function costLine(c: Column, usdPerLXC: number | undefined): string {
  if (c.source !== undefined) return answerSourceLine(c.source)
  if (c.cost !== undefined) {
    const figure = c.charged_ulxc !== undefined ? formatCharged(c.charged_ulxc) : formatAnswerCost(c.cost.usd, usdPerLXC)
    return `${figure} · ${c.cost.model} · ${c.cost.input_tokens.toLocaleString('en-US')} in / ${c.cost.output_tokens.toLocaleString('en-US')} out tokens`
  }
  if (c.charged_ulxc !== undefined) return formatCharged(c.charged_ulxc)
  return 'Price not known — the provider reported no token counts for this answer'
}

/** One model's column: its answer as it arrives, and under it what it cost. */
function CompareColumn({
  c,
  asked,
  pending,
  canKeep,
  usdPerLXC,
  onRetry,
  onKeep,
}: {
  c: Column
  asked: string
  pending: boolean
  canKeep: boolean
  usdPerLXC: number | undefined
  onRetry: () => void
  onKeep: () => void
}) {
  // B16.3, as under a Chat answer: the answer grows at a steady pace however it arrives (a burst, or a whole answer in
  // one piece), and its price appears once all of it is on screen.
  const shown = useRevealedText(c.answer, c.answering)
  const settled = !c.answering && !shown.revealing
  return (
    <section
      role="listitem"
      aria-label={c.model.display_name}
      data-testid="compare-column"
      className="flex min-h-64 min-w-0 flex-col rounded-card border border-rule bg-surface p-4"
    >
      <h2 className="text-head text-ink">{c.model.display_name}</h2>
      <p className="font-figure text-caption text-faint">
        {formatUsdPer1M(c.model.input_per_1m)} in / {formatUsdPer1M(c.model.output_per_1m)} out per 1M tokens
      </p>
      <div className="mt-3 flex-1" aria-live="polite" aria-busy={c.answering}>
        {c.failure !== undefined ? (
          <div role="alert" className="space-y-2" data-testid="compare-failure">
            <p className="text-body text-ink">
              {c.failure.text}
              {c.failure.remedy !== undefined && 'to' in c.failure.remedy ? (
                <>
                  {' '}
                  <Link className={inlineLink} to={c.failure.remedy.to}>
                    {c.failure.remedy.label}
                  </Link>
                </>
              ) : null}
            </p>
            <Button onClick={onRetry} disabled={pending}>
              Retry
            </Button>
          </div>
        ) : c.answering && c.answer === '' ? (
          <p className="text-body text-muted">Answering…</p>
        ) : c.incomplete === 'blank' ? (
          <div role="alert" className="flex flex-wrap items-center gap-3" data-testid="compare-blank">
            <p className="text-body text-ink">No answer came back.</p>
            <Button onClick={onRetry} disabled={pending}>
              Retry
            </Button>
          </div>
        ) : c.answer !== '' ? (
          <Markdown source={shown.text} />
        ) : asked === '' ? (
          <p className="text-body text-faint">Its answer appears here.</p>
        ) : null}
      </div>
      {settled && c.answer !== '' && c.failure === undefined ? (
        <div className="mt-3 space-y-2 border-t border-rule pt-3">
          {c.incomplete === 'cut_off' ? (
            <p className="text-caption text-muted">
              <span className="mr-1 rounded-control border border-rule px-1.5 py-0.5 text-ink">Cut off</span> The model reached its length
              limit before it finished this answer.
            </p>
          ) : null}
          {c.stopped ? (
            <p className="text-caption text-muted">Stopped before it finished.</p>
          ) : (
            <p className="font-figure text-caption text-faint" data-testid="compare-cost">
              {costLine(c, usdPerLXC)}
            </p>
          )}
          <button
            type="button"
            disabled={!canKeep}
            onClick={onKeep}
            className={cn('-ml-2 rounded-control px-2 py-1 text-caption text-muted transition-colors duration-200 hover:text-ink disabled:opacity-50', focusRing)}
          >
            Continue in Chat
          </button>
        </div>
      ) : null}
    </section>
  )
}

export function CompareModels() {
  // The same reads, under the same keys, as Chat: a person arriving from Chat has them already.
  const catalog = useQuery({ queryKey: ['chat-models'], queryFn: fetchModels, retry: false })
  const providers = useQuery({ queryKey: ['chat-unconfigured-providers'], queryFn: fetchUnconfiguredProviders, retry: false, staleTime: 5 * 60_000 })
  const peg = useQuery(pegQuery)
  const usdPerLXC = peg.data?.usd_per_lxc
  const me = useAuthMeReader()
  const scope = me.data?.user?.sub ?? me.data?.workspace_id ?? (me.data?.mode === 'disabled' ? 'local' : null)
  const navigate = useNavigate()

  // Auto is left out: a comparison is between models a person names.
  const picker = { ...pickerCatalog(catalog.data ?? [], providers.data ?? []), auto: undefined }
  const trio = defaultTrio(picker.offered, picker.defaultModel)
  const [chosen, setChosen] = useState<string[]>([])
  const models = trio.map((d, i) => picker.offered.find((m) => m.id === chosen[i]) ?? d)

  const [draft, setDraft] = useState('')
  const [asked, setAsked] = useState('')
  const [columns, setColumns] = useState<Column[]>([])
  const [keepRefused, setKeepRefused] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const pending = columns.some((c) => c.answering)

  // Leaving the page stops every answer, so nobody is charged for tokens nobody will read.
  useEffect(() => () => abortRef.current?.abort(), [])

  const choose = (i: number, id: string) =>
    setChosen((prev) => models.map((m, j) => (j === i ? id : (prev[j] ?? m.id))))

  const ready = models.length > 0

  // Streams `model`'s answer to `question` into column `i`.
  const run = useCallback(
    async (i: number, model: ChatModel, question: string, controller: AbortController) => {
      const update = (change: (c: Column) => Column) => setColumns((prev) => prev.map((c, j) => (j === i ? change(c) : c)))
      update(() => ({ model, answer: '', answering: true }))
      let answer = ''
      await streamChat(
        model.provider,
        model.id,
        [{ role: 'user', content: question }],
        {
          onDelta: (text) => {
            answer += text
            update((c) => ({ ...c, answer }))
          },
          onDone: ({ usage, model: servedBy, source, finish, chargedULXC }) => {
            const cost = source === undefined ? pricedAnswer(usage, model, servedBy, catalog.data ?? []) : undefined
            const incomplete = answer.trim() === '' ? 'blank' : cutOff(finish) ? 'cut_off' : undefined
            update((c) => ({ ...c, answering: false, cost, source, charged_ulxc: chargedULXC, incomplete }))
          },
          onError: (text, remedy) => update((c) => ({ ...c, answering: false, failure: { text, remedy } })),
        },
        controller.signal,
        true,
      )
      // Stopped: streamChat returns without a word, and the answer keeps what had arrived.
      if (controller.signal.aborted) update((c) => (c.answering ? { ...c, answering: false, stopped: true } : c))
    },
    [catalog.data],
  )

  const compare = useCallback(() => {
    const question = draft.trim()
    if (question === '' || pending || !ready) return
    const controller = new AbortController()
    abortRef.current = controller
    setAsked(question)
    setDraft('')
    setKeepRefused(false)
    setColumns(models.map((model) => ({ model, answer: '', answering: true })))
    // ⚠ ALL AT ONCE, NOT ONE AFTER ANOTHER: the three answers stream side by side.
    models.forEach((model, i) => void run(i, model, question, controller))
  }, [draft, models, pending, ready, run])

  // A column that was refused or came back blank asks its model again; the others stay as they are.
  const retry = (i: number) => {
    if (pending) return
    const controller = new AbortController()
    abortRef.current = controller
    void run(i, columns[i].model, asked, controller)
  }

  // Carries one answer on in Chat: a new conversation with the question and this answer, priced as it was here.
  const keep = (c: Column) => {
    if (scope === null) return
    const thread: ChatMessage[] = [
      { role: 'user', content: asked },
      { role: 'assistant', content: c.answer, cost: c.cost, source: c.source, charged_ulxc: c.charged_ulxc, incomplete: c.incomplete },
    ]
    const now = Date.now()
    const list = loadConversations(scope).list
    if (!saveConversations(scope, stampChanged(list, upsertConversation(list, newConversationId(), c.model.id, thread, now), now))) {
      setKeepRefused(true)
      return
    }
    navigate('/chat')
  }

  const question = draft.trim()
  const ranges = question === '' || pending ? [] : models.map((m) => previewCost([], question, [], m, []))
  const preview = ranges.length > 0 && ranges.every((r) => r !== undefined) ? ranges : undefined
  const shown: Column[] = columns.length > 0 ? columns : models.map((model) => ({ model, answer: '', answering: false }))

  return (
    <div className="space-y-4 py-6">
      {/* The page's name is the console banner's <h1> (CONSOLE_ROUTES' title), so no second one here. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-body text-muted">One question to three models at once. Each answer streams in its own column, with what it cost under it.</p>
        <Link className={`text-body text-ink ${inlineLink}`} to="/chat">
          Back to the chat
        </Link>
      </div>
      {catalog.isError ? (
        <p role="alert">
          <InlineFailure error={catalog.error} failed="Couldn’t read the model catalog" />
        </p>
      ) : null}
      {asked !== '' ? (
        <p className="text-body text-ink" data-testid="compare-question">
          <span className="text-muted">Asked: </span>
          {asked}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-label="Answers" role="list">
        {shown.map((c, i) => (
          <CompareColumn
            key={i}
            c={c}
            asked={asked}
            pending={pending}
            canKeep={scope !== null}
            usdPerLXC={usdPerLXC}
            onRetry={() => retry(i)}
            onKeep={() => keep(c)}
          />
        ))}
      </div>
      {keepRefused ? (
        <p role="alert" className="text-caption text-ink">
          This browser refused to save the conversation, so it could not be opened in Chat.
        </p>
      ) : null}
      <form
        // `relative` so each model picker's panel opens above the whole box, over the columns.
        className="relative rounded-card border border-rule-strong bg-raised transition-colors duration-200"
        onSubmit={(e) => {
          e.preventDefault()
          compare()
        }}
      >
        <label htmlFor="compare-question" className="sr-only">
          Your question for all three models
        </label>
        <textarea
          id="compare-question"
          className={cn(
            'block max-h-60 w-full resize-none rounded-t-card bg-raised px-4 pt-3 text-reading text-ink',
            'placeholder:text-faint',
            'transition-colors duration-200 hover:border-rule-strong',
            'disabled:cursor-not-allowed disabled:opacity-50',
            focusRing,
          )}
          rows={2}
          value={draft}
          disabled={!ready}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.shiftKey && !e.metaKey && !e.ctrlKey) return
            e.preventDefault()
            compare()
          }}
          placeholder={catalog.isError ? 'The model catalog could not be read' : ready ? 'Ask all three' : 'No model available'}
        />
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2 pt-1">
          {models.map((m, i) => (
            <div key={i} role="group" aria-label={`Column ${i + 1}`} className="min-w-0 max-w-full">
              <ModelPicker catalog={picker} selected={m} onSelect={(id) => choose(i, id)} disabled={pending} />
            </div>
          ))}
          <div className="flex-1" />
          {pending ? (
            <Button key="stop" type="button" onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          ) : (
            <Button key="compare" type="submit" variant="primary" disabled={question === '' || !ready}>
              Compare
            </Button>
          )}
        </div>
      </form>
      {preview !== undefined ? (
        // At the list rate, like the line each answer will carry: every column is a request of its own.
        <p className="text-caption text-muted" data-testid="compare-preview">
          {models.length === 1 ? 'Asking it' : models.length === 2 ? 'Asking both' : 'Asking all three'}{' '}
          <span className="font-figure text-ink">
            {formatCostRange(
              preview.reduce((n, r) => n + (r?.low_usd ?? 0), 0),
              preview.reduce((n, r) => n + (r?.high_usd ?? 0), 0),
              usdPerLXC,
            )}
          </span>
        </p>
      ) : null}
    </div>
  )
}
