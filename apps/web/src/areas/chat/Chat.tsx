import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Input, cn, focusRing } from '@talyvor/ui'

import { Region } from '../../components/Region'
import { InlineFailure } from '../../components/SessionExpiredBar'
import { useAuthMeReader } from '../../lib/authMe'
import {
  type ChatMessage,
  type ChatModel,
  fetchModels,
  streamChat,
  streamableModels,
} from './chatApi'
import {
  type Conversation,
  type History,
  loadConversations,
  newConversationId,
  saveConversations,
  upsertConversation,
} from './history'
import { type AnswerCost, formatAnswerCost, formatUsdPer1M, pricedAnswer } from './price'
import { topupApi } from '../lens/topupApi'

// THE CHAT SCREEN — W4.6.1 step 6. The first surface that puts Model 2 in front of a person.
//
// Steps 3 and 4 built the whole lane: `apps/bff/stream.go` relays POST
// /api/ai/stream/{provider}/{rest...} to Lens's streaming proxy, flushing after every chunk, on a
// client with no whole-exchange timeout, using a {proxy}-scoped SESSION key it mints and leases
// server-side. ⚠ SO THE BROWSER NEVER HOLDS A WORKSPACE KEY, which is the reason step 4 exists.
//
// ── WHAT THIS SCREEN CLAIMS, AND WHAT IT REFUSES TO CLAIM ────────────────────
//
// ⚠ "EVERY FRONTIER MODEL" IS THE ITEM'S PHRASE AND IT IS NOT YET TRUE, SO THE SCREEN DOES NOT SAY
// IT. Lens's streaming dispatch is `if provider == "openai" { ServeOpenAI } else { ServeAnthropic }`
// — TWO SSE writers. A Google or Mistral model streamed through the Anthropic parser renders as an
// empty answer, so the picker offers the two provider families whose wire format this client can
// actually read, and STATES how many catalog entries that hid. A count a reader can see is the
// difference between a narrowed list and a false one.
//
// ⚠ THE LIST COMES FROM THE DEPLOYMENT, NOT FROM THIS FILE. `/api/models` proxies Lens's
// `/v1/catalog/models`. A hardcoded model list is the exact shape this project keeps finding — a
// front end documenting a set the server does not have.
//
// ⚠ NOTHING HERE CLAIMS THE CONVERSATION IS BILLED. Measured in talyvor-lens and merged as
// `dd1bb44` (W4.6.1 step 4b): in the default configuration a SESSION-KEY request moves no LXC at
// all — serve()'s entire LXC admission-and-debit block sits inside `if agentKeyID != ""`, and a
// session key carries no APIKeyID by design. This screen therefore shows a model's LIST PRICE, which
// is a fact about the catalog, and says nothing about what the workspace was charged, which would
// be a claim about a ledger that did not move.
//
// ⚠ HISTORY LIVES IN THIS BROWSER (B1.3), NOT ON A SERVER. Lens's migration 0009 states
// "prompt/response text is intentionally NOT stored in DB (privacy)", and a server-side history
// would reverse that for every workspace. ./history.ts keeps conversations in localStorage, scoped
// to the signed-in identity, and the screen says where they are kept.

export function Chat() {
  const catalog = useQuery({ queryKey: ['chat-models'], queryFn: fetchModels, retry: false })
  // The credit peg, from the deployment. Absent ⇒ answers are priced in dollars, never at a guess.
  const peg = useQuery({ queryKey: ['topup-options'], queryFn: topupApi.options, retry: false })
  const usdPerLXC = peg.data?.usd_per_lxc

  const [modelId, setModelId] = useState<string>('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [unreadable, setUnreadable] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  // History is scoped to who is signed in; until that is known there is nowhere to keep it.
  const me = useAuthMeReader()
  const scope =
    me.data?.user?.sub ?? me.data?.workspace_id ?? (me.data?.mode === 'disabled' ? 'local' : null)
  const [history, setHistory] = useState<History>({ list: [], error: null })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [storageRefused, setStorageRefused] = useState(false)

  const open = useCallback((c: Conversation | undefined) => {
    setActiveId(c?.id ?? null)
    setMessages(c?.messages ?? [])
    if (c !== undefined) setModelId(c.model_id)
    setFailure(null)
    setUnreadable(0)
    setRenaming(null)
    setConfirmingDelete(false)
  }, [])

  // Reopening the tab lands on the most recent conversation — "it is still there", literally.
  useEffect(() => {
    if (scope === null) return
    const read = loadConversations(scope)
    setHistory(read)
    open(read.list[0])
  }, [scope, open])

  // ⚠ READS STORAGE, NOT STATE. It runs after an await inside send(), where `history` from the
  // closure is a render old; merging into that would drop a rename made while it streamed.
  const store = useCallback(
    (update: (list: Conversation[]) => Conversation[]) => {
      if (scope === null) return
      const next = update(loadConversations(scope).list)
      setStorageRefused(!saveConversations(scope, next))
      setHistory({ list: next, error: null })
    },
    [scope],
  )

  // ⚠ ABORT ON UNMOUNT. r.Context() in the BFF is the browser's connection, and cancelling it
  // cancels the upstream — which is what stops Lens generating, and being billed for, tokens
  // nobody will read. Navigating away from this screen must do that.
  useEffect(() => () => abortRef.current?.abort(), [])

  const { models, hidden } = streamableModels(catalog.data ?? [])
  const selected: ChatModel | undefined =
    models.find((m) => m.id === modelId) ?? models[0]

  const send = useCallback(async () => {
    const text = draft.trim()
    if (text === '' || selected === undefined || pending) return

    const turn: ChatMessage[] = [...messages, { role: 'user', content: text }]
    const id = activeId ?? newConversationId()
    const model = selected.id
    setActiveId(id)
    // The question is kept before the answer starts, so a tab closed mid-stream loses only the
    // answer.
    store((list) => upsertConversation(list, id, model, turn, Date.now()))
    setMessages([...turn, { role: 'assistant', content: '' }])
    setDraft('')
    setPending(true)
    setFailure(null)
    setUnreadable(0)

    const controller = new AbortController()
    abortRef.current = controller
    let answer = ''
    let cost: AnswerCost | undefined

    await streamChat(
      selected.provider,
      selected.id,
      turn,
      {
        onDelta: (chunk) => {
          answer += chunk
          // ⚠ APPENDED PER DELTA, NOT ASSIGNED AT THE END. This is what makes the screen a stream
          // rather than a spinner that resolves. Chat.test.tsx asserts partial text is on screen
          // while the response is still open, because a buffering client's finished DOM is
          // identical to a streaming one's.
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last !== undefined && last.role === 'assistant') {
              next[next.length - 1] = { role: 'assistant', content: last.content + chunk }
            }
            return next
          })
        },
        onDone: ({ unrecognised, usage, model: servedBy }) => {
          // B1.4 — every answer carries its price; see pricedAnswer() for which model names it.
          const priced = pricedAnswer(usage, selected, servedBy)
          if (priced !== undefined) {
            cost = priced
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last !== undefined && last.role === 'assistant') next[next.length - 1] = { ...last, cost: priced }
              return next
            })
          }
          setPending(false)
          setUnreadable(unrecognised)
        },
        onError: (message) => {
          setPending(false)
          setFailure(message)
        },
      },
      controller.signal,
    )
    store((list) =>
      upsertConversation(list, id, model, [...turn, { role: 'assistant', content: answer, cost }], Date.now()),
    )
  }, [activeId, draft, messages, pending, selected, store])

  const active = history.list.find((c) => c.id === activeId)

  return (
    <>
      <Region
        index="01"
        label="What you can ask"
        heading="One subscription, the models this deployment actually serves."
      >
        {catalog.isPending ? (
          <p className="mt-6 text-body text-muted">Reading the model catalog…</p>
        ) : catalog.isError ? (
          // ⚠ A FAILED READ IS NOT AN EMPTY CATALOG. This project has paid twice for that
          // conflation. The screen says the read failed and offers no picker at all, rather than
          // rendering an empty list that reads as "this deployment serves nothing".
          <div className="mt-6">
            <InlineFailure error={catalog.error} failed="Couldn’t read the model catalog" />
          </div>
        ) : models.length === 0 ? (
          <NoStreamableModels total={catalog.data?.length ?? 0} />
        ) : (
          <ModelPicker
            models={models}
            hidden={hidden}
            selectedId={selected?.id ?? ''}
            onSelect={setModelId}
            disabled={pending}
          />
        )}
      </Region>

      <div className="wide:flex">
        <Region
          index="02"
          label="Your conversations"
          sectionClassName="wide:w-72 wide:shrink-0 wide:border-b-0 wide:border-r"
        >
          <Button className="mt-6" onClick={() => open(undefined)} disabled={pending || activeId === null}>
            New conversation
          </Button>
          {scope === null ? (
            <p className="mt-4 text-caption text-muted">
              {me.isPending
                ? 'Reading who is signed in…'
                : 'Conversations can’t be kept until this browser knows who is signed in.'}
            </p>
          ) : history.error !== null ? (
            <p className="mt-4 text-caption text-ink" role="alert">
              {history.error} Nothing is shown rather than an empty list that would read as none saved.
            </p>
          ) : history.list.length === 0 ? (
            <p className="mt-4 text-caption text-muted">
              None yet. Send a message and the conversation is kept here.
            </p>
          ) : (
            <ul className="mt-4 space-y-1" aria-label="Saved conversations">
              {history.list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={cn(
                      'block w-full truncate border px-3 py-2 text-left text-body text-ink',
                      'transition-colors duration-200 hover:border-rule-strong',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      c.id === activeId ? 'border-rule bg-surface' : 'border-transparent',
                      focusRing,
                    )}
                    aria-current={c.id === activeId ? 'true' : undefined}
                    disabled={pending}
                    onClick={() => open(c)}
                  >
                    {c.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-caption text-muted">
            Kept in this browser only, not on Talyvor&rsquo;s servers — another browser won&rsquo;t
            have them, and clearing site data removes them.
          </p>
          {storageRefused ? (
            <p className="mt-2 text-caption text-ink" role="alert">
              This browser refused to save the latest change, so it will be gone after a reload.
            </p>
          ) : null}
        </Region>

        <div className="min-w-0 wide:flex-1">
          <Region index="03" label="The conversation">
            {active !== undefined ? (
              <ConversationTitle
                conversation={active}
                renaming={renaming}
                confirmingDelete={confirmingDelete}
                disabled={pending}
                onRenameStart={() => {
                  setConfirmingDelete(false)
                  setRenaming(active.title)
                }}
                onRenameChange={setRenaming}
                onRenameCancel={() => setRenaming(null)}
                onRenameSave={() => {
                  const title = (renaming ?? '').replace(/\s+/g, ' ').trim()
                  if (title !== '') {
                    store((list) => list.map((c) => (c.id === active.id ? { ...c, title, renamed: true } : c)))
                  }
                  setRenaming(null)
                }}
                onDeleteStart={() => {
                  setRenaming(null)
                  setConfirmingDelete(true)
                }}
                onDeleteCancel={() => setConfirmingDelete(false)}
                onDeleteConfirm={() => {
                  store((list) => list.filter((c) => c.id !== active.id))
                  open(undefined)
                }}
              />
            ) : null}
            {catalog.isError ? (
              // ⚠ AN EMPTY CONVERSATION IS NOT A FAILED ONE, AND emptyVsFault.test.ts REFUSED THIS
              // SCREEN UNTIL IT SAID SO. With no catalog there is no model, so the composer is
              // disabled — telling the reader to "type a message below" would point at a control that
              // cannot be used, which is the shape where an absence reads as a working empty system.
              <p className="mt-6 max-w-2xl text-body text-muted">
                The model catalog could not be read, so there is nothing to ask yet. This is a failed
                read, not an empty deployment — the catalog is above.
              </p>
            ) : messages.length === 0 ? (
              <div className="mt-6 flex flex-col items-start gap-3">
                <p className="max-w-2xl text-body text-muted">
                  Nothing asked yet — type a message in the box below and send it. The conversation is
                  kept in this browser as you go.
                </p>
                {/* B3.4 — the empty state goes where it points: the caret lands in the message box. */}
                <Button onClick={() => document.getElementById('chat-message')?.focus()}>Ask something</Button>
              </div>
            ) : (
              <ol className="mt-6 max-w-3xl space-y-4">
                {messages.map((m, i) => (
                  <li
                    // The index is the identity here: turns are append-only and never reordered, and
                    // two turns can carry byte-identical text.
                    key={i}
                    className="border border-rule bg-surface px-gutter py-4"
                    data-testid={m.role === 'user' ? 'turn-user' : 'turn-assistant'}
                  >
                    <span className="font-figure text-eyebrow uppercase text-faint">
                      {m.role === 'user' ? 'You' : (m.cost?.model ?? selected?.display_name ?? 'Assistant')}
                    </span>
                    <p className="mt-2 whitespace-pre-wrap text-body text-ink">
                      {m.content === '' && pending ? (
                        <span className="text-muted">Answering…</span>
                      ) : (
                        m.content
                      )}
                    </p>
                    {m.role === 'assistant' && m.content !== '' && !(pending && i === messages.length - 1) ? (
                      // B1.4 — every answer carries its price. Figures on the figure face.
                      <p className="mt-3 font-figure text-caption text-muted" data-testid="turn-cost">
                        {m.cost !== undefined
                          ? `${formatAnswerCost(m.cost.usd, usdPerLXC)} · ${m.cost.model} · ` +
                            `${m.cost.input_tokens.toLocaleString('en-US')} in / ` +
                            `${m.cost.output_tokens.toLocaleString('en-US')} out tokens`
                          : 'Price not known — the provider reported no token counts for this answer'}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}

            {failure !== null ? (
              <p className="mt-4 max-w-2xl text-body text-ink" role="alert">
                {failure}{' '}
                {failure.includes('Top up') ? <Link className="underline" to="/billing">Billing</Link> : null}
              </p>
            ) : null}

            {unreadable > 0 ? (
              // ⚠ SURFACED, NEVER SWALLOWED. The parser knows two wire shapes; a frame it cannot read
              // is counted rather than dropped, because "the model answered nothing" and "I could not
              // read what it sent" look identical on screen and have completely different causes.
              <p className="mt-4 max-w-2xl text-caption text-muted" role="status">
                <span className="font-figure">{unreadable}</span> frame(s) in that response were in a shape this client
                does not read, so part of the answer may be missing.
              </p>
            ) : null}

            <form
              className="mt-6 flex max-w-3xl items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <label className="flex-1">
                <span className="font-figure text-eyebrow uppercase text-muted">Your message</span>
                <textarea
                  id="chat-message"
                  className={cn(
                    'mt-2 block w-full resize-y border border-rule bg-surface px-3 py-2 text-body text-ink',
                    'placeholder:text-faint',
                    // ⚠ THE SAME CONTRACT Input.tsx GIVES EVERY OTHER TEXT FIELD. controlParity.test.ts
                    // refused this field without it, correctly: a hand-rolled control that hovers,
                    // disables or transitions differently from the shared one is a second opinion about
                    // what a text field is.
                    'transition-colors duration-200 hover:border-rule-strong',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    focusRing,
                  )}
                  rows={3}
                  value={draft}
                  disabled={selected === undefined}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={selected === undefined ? 'No model available' : 'Ask anything'}
                />
              </label>
              <Button type="submit" variant="primary" disabled={pending || draft.trim() === '' || selected === undefined}>
                {pending ? 'Answering…' : 'Send'}
              </Button>
            </form>
          </Region>
        </div>
      </div>
    </>
  )
}

function ConversationTitle({
  conversation,
  renaming,
  confirmingDelete,
  disabled,
  onRenameStart,
  onRenameChange,
  onRenameCancel,
  onRenameSave,
  onDeleteStart,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  conversation: Conversation
  renaming: string | null
  confirmingDelete: boolean
  disabled: boolean
  onRenameStart: () => void
  onRenameChange: (title: string) => void
  onRenameCancel: () => void
  onRenameSave: () => void
  onDeleteStart: () => void
  onDeleteCancel: () => void
  onDeleteConfirm: () => void
}) {
  if (renaming !== null) {
    return (
      <form
        className="mt-6 flex max-w-3xl items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          onRenameSave()
        }}
      >
        <label className="flex-1">
          <span className="font-figure text-eyebrow uppercase text-muted">Conversation name</span>
          <Input
            className="mt-2"
            value={renaming}
            autoFocus
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onRenameCancel()
            }}
          />
        </label>
        <Button type="submit" variant="primary" disabled={renaming.trim() === ''}>
          Save name
        </Button>
        <Button onClick={onRenameCancel}>Cancel</Button>
      </form>
    )
  }
  if (confirmingDelete) {
    return (
      <div className="mt-6 flex max-w-3xl flex-wrap items-center gap-3" role="group" aria-label="Confirm delete">
        <p className="text-body text-ink">
          Delete &ldquo;{conversation.title}&rdquo; from this browser? It can&rsquo;t be brought back.
        </p>
        <Button variant="danger" onClick={onDeleteConfirm}>
          Delete conversation
        </Button>
        <Button onClick={onDeleteCancel}>Keep it</Button>
      </div>
    )
  }
  return (
    <div className="mt-6 flex max-w-3xl flex-wrap items-center gap-3">
      <h3 className="min-w-0 flex-1 truncate text-title text-ink">{conversation.title}</h3>
      <Button onClick={onRenameStart} disabled={disabled}>
        Rename
      </Button>
      <Button variant="danger" onClick={onDeleteStart} disabled={disabled}>
        Delete
      </Button>
    </div>
  )
}

/**
 * ⚠ THE TWO WAYS TO HAVE NO PICKER ARE DIFFERENT STATES WITH DIFFERENT NEXT ACTIONS, so they are
 * not one apologetic sentence: a catalog that is empty (nothing is configured) and a catalog that
 * is full of models this client cannot stream (a Lens change, not an operator one).
 */
function NoStreamableModels({ total }: { total: number }) {
  if (total === 0) {
    return (
      <p className="mt-6 max-w-2xl text-body text-muted">
        This deployment&rsquo;s model catalog is empty, so there is nothing to chat with yet.
      </p>
    )
  }
  return (
    <p className="mt-6 max-w-2xl text-body text-muted">
      This deployment serves <span className="font-figure">{total}</span> model(s), and none of them is on a provider
      whose stream this console can read yet. Chat reads two wire formats — OpenAI&rsquo;s and
      Anthropic&rsquo;s — because those are the two Lens streams.
    </p>
  )
}

function ModelPicker({
  models,
  hidden,
  selectedId,
  onSelect,
  disabled,
}: {
  models: ChatModel[]
  hidden: number
  selectedId: string
  onSelect: (id: string) => void
  disabled: boolean
}) {
  return (
    <div className="mt-6">
      <label className="block max-w-sm">
        <span className="font-figure text-eyebrow uppercase text-muted">Model</span>
        <select
          className={cn(
            'mt-2 block w-full border border-rule bg-surface px-3 py-2 text-body text-ink',
            focusRing,
          )}
          value={selectedId}
          disabled={disabled}
          onChange={(e) => onSelect(e.target.value)}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
      </label>

      {/* ⚠ THE PRICE IS THE CATALOG'S LIST RATE AND IS LABELLED AS SUCH. It is NOT what this
          conversation cost: a session-key request moves no LXC in the default configuration
          (measured in talyvor-lens, dd1bb44 — re-verified at lens cc1576a, where serve()'s LXC
          admission-and-debit block still sits inside `if agentKeyID != ""` and the session-key
          branch still leaves APIKeyID empty), so a "you spent" figure here would be a claim about a
          ledger that did not move. A list price is a fact about the catalog and is true.

          ⚠ IT RENDERED WITHOUT A CURRENCY MARK UNTIL W4.9. Measured in the DOM: `List price · 2.5
          in / 10 out per 1M tokens` — no `$` anywhere, on the one screen whose thesis is cost, and
          the two figures disagreeing about their decimals. The figure audit could not have caught
          it and is not at fault: this text carries words, so figureKind() reads it as prose and
          declines to police it (its own TRAP TWO). See ./price.ts for why formatCost is the wrong
          formatter here. */}
      {(() => {
        const shown = models.find((m) => m.id === selectedId) ?? models[0]
        return shown === undefined ? null : (
          <>
            {/* The figure caption is ON THE FACE, which is the treatment this product gives every
                other derived-value caption. The sentence that qualifies it is prose and carries no
                digits, so it stays in the sans. */}
            <p className="mt-3 font-figure text-caption text-muted">
              List price · {formatUsdPer1M(shown.input_per_1m)} in /{' '}
              {formatUsdPer1M(shown.output_per_1m)} out per 1M tokens
            </p>
            <p className="mt-1 text-caption text-muted">
              That is the catalog rate, not this conversation&rsquo;s bill.
            </p>
          </>
        )
      })()}

      {hidden > 0 ? (
        <p className="mt-4 max-w-2xl text-caption text-muted">
          <span className="font-figure">{hidden}</span> further catalog entr(y/ies) are not offered here — they are
          deprecated, or on a provider whose stream this console does not read yet.
        </p>
      ) : null}
    </div>
  )
}
