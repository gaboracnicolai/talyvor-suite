import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Input, cn, focusRing } from '@talyvor/ui'

import { InlineFailure } from '../../components/SessionExpiredBar'
import { useAuthMeReader } from '../../lib/authMe'
import {
  type ChatAttachment,
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
import { Markdown } from './Markdown'
import { CopyButton } from './CopyButton'
import { FilePicker } from './FilePicker'
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
//
// ── B10.3: THE LAYOUT PEOPLE ALREADY KNOW ────────────────────────────────────
//
// A collapsible rail (New chat, conversations newest first, the how-to link), one centred reading
// column, and a composer pinned to the bottom with the model picker inside it. Replies render as
// Markdown. Explanations live on /chat/help (./ChatHelp.tsx), not on this screen; what stays here
// is what a reader needs at the moment of reading — a price, a failure, where history is kept.

/**
 * B10.3 — the documents a question can carry: exactly the formats Lens's converter reads
 * (talyvor-lens internal/distill/orchestrator.go, FormatFromMediaType). Keyed by extension because
 * a browser often reports no type for .md or .csv. Slide decks are not among them.
 */
export const ATTACHABLE: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
  md: 'text/markdown',
}

/**
 * ⚠ 2.5 MB OF DOCUMENTS PER CONVERSATION, AND THE REASON IS THE WIRE. The BFF and Lens each refuse a
 * request body over 4 MiB, a document travels base64-encoded (a third larger), and every later
 * question in the conversation carries it again.
 */
export const ATTACH_LIMIT_BYTES = 2_500_000

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'))
    reader.readAsDataURL(file)
  })
}

function formatSize(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** Click-to-ask prompts for an empty conversation. Plain requests, no instructions. */
export const EXAMPLE_PROMPTS: readonly string[] = [
  'Explain the difference between TCP and UDP in plain words',
  'Write a short, polite email declining a meeting',
  'What makes a code review genuinely useful?',
  'Plan a relaxed weekend in Lisbon',
]

export function Chat() {
  const catalog = useQuery({ queryKey: ['chat-models'], queryFn: fetchModels, retry: false })
  // The credit peg, from the deployment. Absent ⇒ answers are priced in dollars, never at a guess.
  const peg = useQuery({ queryKey: ['topup-options'], queryFn: topupApi.options, retry: false })
  const usdPerLXC = peg.data?.usd_per_lxc

  const [modelId, setModelId] = useState<string>('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
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

  // The rail: collapsed on a wide screen by choice, a drawer on a narrow one.
  const [railHidden, setRailHidden] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const open = useCallback((c: Conversation | undefined) => {
    setActiveId(c?.id ?? null)
    setMessages(c?.messages ?? [])
    if (c !== undefined) setModelId(c.model_id)
    setFailure(null)
    setUnreadable(0)
    setRenaming(null)
    setConfirmingDelete(false)
    setDrawerOpen(false)
  }, [])

  // Reopening the tab lands on the most recent conversation — "it is still there", literally.
  useEffect(() => {
    if (scope === null) return
    const read = loadConversations(scope)
    setHistory(read)
    open(read.list[0])
  }, [scope, open])

  // ⚠ READS STORAGE, NOT STATE. It runs after an await inside run(), where `history` from the
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

  /** Streams an answer to `turn`, whose last message is the question. */
  const run = useCallback(
    async (turn: ChatMessage[]) => {
      if (selected === undefined || pending) return
      const id = activeId ?? newConversationId()
      const model = selected.id
      setActiveId(id)
      // The question is kept before the answer starts, so a tab closed mid-stream loses only the
      // answer.
      store((list) => upsertConversation(list, id, model, turn, Date.now()))
      setMessages([...turn, { role: 'assistant', content: '' }])
      setPending(true)
      setFailure(null)
      setUnreadable(0)

      const controller = new AbortController()
      abortRef.current = controller
      let answer = ''
      let cost: AnswerCost | undefined
      // B10.3 — whether Lens converted the documents this question carried, marked on the question.
      const asked = turn.length - 1
      const carriedDocs = turn[asked]?.attachments?.some((a) => a.data !== undefined) === true
      let sentTurn = turn

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
          onDone: ({ unrecognised, usage, model: servedBy, converted }) => {
            if (carriedDocs) {
              sentTurn = turn.map((m, i) => (i === asked ? { ...m, converted } : m))
              setMessages((prev) => prev.map((m, i) => (i === asked ? { ...m, converted } : m)))
            }
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
        upsertConversation(list, id, model, [...sentTurn, { role: 'assistant', content: answer, cost }], Date.now()),
      )
    },
    [activeId, pending, selected, store],
  )

  const send = useCallback(
    (text: string = draft) => {
      const question = text.trim()
      if (question === '' || selected === undefined || pending) return
      setDraft('')
      const docs = attachments
      setAttachments([])
      setAttachError(null)
      void run([...messages, docs.length > 0 ? { role: 'user', content: question, attachments: docs } : { role: 'user', content: question }])
    },
    [attachments, draft, messages, pending, run, selected],
  )

  const attach = useCallback(
    async (files: File[]) => {
      setAttachError(null)
      const inMemory = [...messages.flatMap((m) => m.attachments ?? []), ...attachments]
        .filter((a) => a.data !== undefined)
        .reduce((sum, a) => sum + a.size, 0)
      let room = ATTACH_LIMIT_BYTES - inMemory
      const added: ChatAttachment[] = []
      for (const f of files) {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
        const mediaType = ATTACHABLE[ext]
        if (mediaType === undefined) {
          setAttachError(
            `${f.name} can’t be converted. PDF, Word, Excel, CSV, HTML, JSON, XML, text and Markdown files can — save a slide deck as PDF first.`,
          )
          continue
        }
        if (f.size > room) {
          setAttachError(
            `${f.name} is too large: documents are limited to 2.5 MB per conversation, because a request can carry at most 4 MB and a document travels base64-encoded.`,
          )
          continue
        }
        try {
          added.push({ name: f.name, media_type: mediaType, size: f.size, data: await readBase64(f) })
          room -= f.size
        } catch {
          setAttachError(`${f.name} could not be read by this browser.`)
        }
      }
      if (added.length > 0) setAttachments((prev) => [...prev, ...added])
    },
    [attachments, messages],
  )

  // Regenerate answers the last question again: the previous answer is dropped, not kept beside it.
  const regenerate = useCallback(() => {
    const lastUser = messages.map((m) => m.role).lastIndexOf('user')
    if (lastUser < 0) return
    void run(messages.slice(0, lastUser + 1))
  }, [messages, run])

  // B10.2 — Stop ends the answer where it is. streamChat returns silently on an aborted signal
  // (neither onDone nor onError), so the screen leaves the answering state here; run() then keeps
  // whatever part of the answer had arrived.
  const stop = useCallback(() => {
    abortRef.current?.abort()
    setPending(false)
  }, [])

  const active = history.list.find((c) => c.id === activeId)

  // The newest turn stays in view as it streams, unless the reader has scrolled up to read.
  const endRef = useRef<HTMLDivElement | null>(null)
  const lastContent = messages[messages.length - 1]?.content
  useEffect(() => {
    const el = endRef.current
    if (el === null || typeof el.scrollIntoView !== 'function') return
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160
    if (nearBottom) el.scrollIntoView({ block: 'end' })
  }, [messages.length, lastContent])

  const rail = (
    <ChatRail
      history={history}
      activeId={activeId}
      pending={pending}
      signedIn={scope !== null}
      readingIdentity={me.isPending}
      storageRefused={storageRefused}
      onNew={() => open(undefined)}
      onOpen={open}
    />
  )

  return (
    <div className="-m-gutter flex min-h-below-header">
      {/* The rail on a wide screen: a column beside the conversation, collapsible. */}
      {railHidden ? null : (
        <aside
          aria-label="Conversations"
          className="hidden border-r border-rule bg-sidebar wide:sticky wide:top-12 wide:flex wide:h-below-header wide:w-64 wide:shrink-0 wide:flex-col"
        >
          {rail}
        </aside>
      )}

      {/* The rail on a narrow screen: a drawer over the conversation. */}
      {drawerOpen ? (
        <Drawer onClose={() => setDrawerOpen(false)}>{rail}</Drawer>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-row items-center gap-2 px-gutter pt-2">
          <button
            type="button"
            className={cn(railButtonClass, 'wide:hidden')}
            onClick={() => setDrawerOpen(true)}
          >
            Conversations
          </button>
          <button
            type="button"
            className={cn(railButtonClass, 'hidden wide:inline-flex')}
            aria-expanded={!railHidden}
            onClick={() => setRailHidden((h) => !h)}
          >
            {railHidden ? 'Show conversations' : 'Hide conversations'}
          </button>
          <div className="min-w-0 flex-1">
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
          </div>
        </div>

        <div className="flex flex-1 flex-col px-gutter">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
            {catalog.isPending ? (
              <p className="mt-10 text-body text-muted">Reading the model catalog…</p>
            ) : catalog.isError ? (
              // ⚠ A FAILED READ IS NOT AN EMPTY CATALOG, AND AN EMPTY CONVERSATION IS NOT A FAILED
              // ONE. emptyVsFault.test.ts refused this screen until it said so. With no catalog
              // there is no model, so the composer is disabled and no greeting invites a question.
              <div className="mt-10 space-y-3">
                <InlineFailure error={catalog.error} failed="Couldn’t read the model catalog" />
                <p className="text-body text-muted">
                  The model catalog could not be read, so there is nothing to ask yet. This is a failed
                  read, not an empty deployment.
                </p>
              </div>
            ) : models.length === 0 ? (
              <NoStreamableModels total={catalog.data?.length ?? 0} />
            ) : messages.length === 0 ? (
              <Greeting disabled={pending} onAsk={(prompt) => send(prompt)} />
            ) : (
              <ol className="space-y-8 py-6">
                {messages.map((m, i) => (
                  <li
                    // The index is the identity here: turns are append-only and never reordered, and
                    // two turns can carry byte-identical text.
                    key={i}
                    data-testid={m.role === 'user' ? 'turn-user' : 'turn-assistant'}
                    className={m.role === 'user' ? 'flex justify-end' : undefined}
                  >
                    {m.role === 'user' ? (
                      <div className="max-w-prose rounded-card bg-surface px-4 py-3 text-body text-ink">
                        <span className="sr-only">You: </span>
                        {m.attachments !== undefined && m.attachments.length > 0 ? (
                          <SentDocuments message={m} answering={pending && i === messages.length - 2} />
                        ) : null}
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </div>
                    ) : (
                      <Reply
                        message={m}
                        answering={pending && i === messages.length - 1}
                        canRegenerate={!pending && i === messages.length - 1}
                        onRegenerate={regenerate}
                        usdPerLXC={usdPerLXC}
                        fallbackModel={selected?.display_name}
                      />
                    )}
                  </li>
                ))}
              </ol>
            )}

            {failure !== null ? (
              <p className="mb-4 text-body text-ink" role="alert">
                {failure}{' '}
                {failure.includes('Top up') ? <Link className="underline" to="/billing">Billing</Link> : null}
              </p>
            ) : null}

            {unreadable > 0 ? (
              // ⚠ SURFACED, NEVER SWALLOWED. The parser knows two wire shapes; a frame it cannot read
              // is counted rather than dropped, because "the model answered nothing" and "I could not
              // read what it sent" look identical on screen and have completely different causes.
              <p className="mb-4 text-caption text-muted" role="status">
                <span className="font-figure">{unreadable}</span> frame(s) in that response were in a shape this client
                does not read, so part of the answer may be missing.
              </p>
            ) : null}
            <div ref={endRef} />
          </div>
        </div>

        <div className="sticky bottom-0 bg-canvas px-gutter pb-gutter pt-2">
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              attachments={attachments}
              onAttach={(files) => void attach(files)}
              onRemoveAttachment={(i) => setAttachments((prev) => prev.filter((_, j) => j !== i))}
              attachError={attachError}
              draft={draft}
              onDraft={setDraft}
              onSend={() => send()}
              onStop={stop}
              pending={pending}
              models={models}
              selected={selected}
              onSelectModel={setModelId}
            />
            {selected !== undefined ? (
              // ⚠ THE PRICE IS THE CATALOG'S LIST RATE AND IS LABELLED AS SUCH. A session-key
              // request moves no LXC in the default configuration (see this file's header), so a
              // "you spent" figure here would be a claim about a ledger that did not move. Figures
              // on the figure face.
              <p className="mt-2 font-figure text-caption text-faint">
                List price · {formatUsdPer1M(selected.input_per_1m)} in /{' '}
                {formatUsdPer1M(selected.output_per_1m)} out per 1M tokens
                {hidden > 0 ? (
                  <>
                    {' · '}
                    {hidden} catalog model(s) not offered here
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

const railButtonClass = cn(
  'inline-flex h-8 items-center rounded-control px-2 text-caption text-muted transition-colors duration-200 hover:text-ink',
  focusRing,
)

function ChatRail({
  history,
  activeId,
  pending,
  signedIn,
  readingIdentity,
  storageRefused,
  onNew,
  onOpen,
}: {
  history: History
  activeId: string | null
  pending: boolean
  signedIn: boolean
  readingIdentity: boolean
  storageRefused: boolean
  onNew: () => void
  onOpen: (c: Conversation) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <Button className="w-full justify-start" onClick={onNew} disabled={pending || activeId === null}>
        New chat
      </Button>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {!signedIn ? (
          <p className="px-2 text-caption text-muted">
            {readingIdentity
              ? 'Reading who is signed in…'
              : 'Conversations can’t be kept until this browser knows who is signed in.'}
          </p>
        ) : history.error !== null ? (
          <p className="px-2 text-caption text-ink" role="alert">
            {history.error} Nothing is shown rather than an empty list that would read as none saved.
          </p>
        ) : history.list.length === 0 ? (
          <p className="px-2 text-caption text-muted">No conversations yet.</p>
        ) : (
          <ul className="space-y-1" aria-label="Saved conversations">
            {history.list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={cn(
                    'block w-full truncate rounded-control px-2 py-2 text-left text-body text-ink',
                    'transition-colors duration-200 hover:bg-surface',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    c.id === activeId ? 'bg-surface' : undefined,
                    focusRing,
                  )}
                  aria-current={c.id === activeId ? 'true' : undefined}
                  disabled={pending}
                  onClick={() => onOpen(c)}
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        {storageRefused ? (
          <p className="mt-2 px-2 text-caption text-ink" role="alert">
            This browser refused to save the latest change, so it will be gone after a reload.
          </p>
        ) : null}
      </div>
      <div className="mt-2 space-y-1 border-t border-rule px-2 pt-3">
        <Link className={cn('block text-caption text-ink underline', focusRing)} to="/chat/help">
          How to use Talyvor Chat
        </Link>
        <p className="text-caption text-faint">Kept in this browser only.</p>
      </div>
    </div>
  )
}

/** The rail as a drawer on a narrow screen. Escape or the backdrop closes it. */
function Drawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>('button:not(:disabled), a')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-20 wide:hidden">
      <button type="button" aria-label="Close conversations" className="absolute inset-0 bg-canvas opacity-80" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Conversations"
        className="absolute inset-y-0 left-0 flex w-72 max-w-full flex-col border-r border-rule bg-sidebar"
      >
        {children}
      </div>
    </div>
  )
}

/**
 * The documents a question carried, and what became of them. Lens says `applied` when it converted
 * them to text before the model read them; without that, the model was sent the original file.
 */
function SentDocuments({ message, answering }: { message: ChatMessage; answering: boolean }) {
  const docs = message.attachments ?? []
  const kept = docs.every((d) => d.data !== undefined)
  return (
    <div className="mb-2 space-y-1">
      <ul className="flex flex-wrap gap-2" aria-label="Documents sent">
        {docs.map((d, i) => (
          <li key={`${d.name}-${i}`} className="rounded-control border border-rule bg-canvas px-2 py-1 text-caption text-ink">
            {d.name} <span className="font-figure text-faint">{formatSize(d.size)}</span>
          </li>
        ))}
      </ul>
      <p className="text-caption text-muted" data-testid="documents-status">
        {message.converted === true
          ? 'Converted to text before the model read it.'
          : message.converted === false
            ? 'Sent as the original file — Lens did not convert it (document conversion is off for this workspace; see Settings).'
            : answering
              ? 'Sending…'
              : kept
                ? ''
                : 'The file itself isn’t kept after a reload, so later questions can’t see it.'}
      </p>
    </div>
  )
}

function Greeting({ disabled, onAsk }: { disabled: boolean; onAsk: (prompt: string) => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center py-10">
      <h2 className="text-title text-ink">What can I help with?</h2>
      <ul className="mt-6 grid gap-2 wide:grid-cols-2" aria-label="Example questions">
        {EXAMPLE_PROMPTS.map((p) => (
          <li key={p}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAsk(p)}
              className={cn(
                'h-full w-full rounded-card border border-rule bg-surface px-4 py-3 text-left text-body text-ink',
                'transition-colors duration-200 hover:border-rule-strong',
                'disabled:cursor-not-allowed disabled:opacity-50',
                focusRing,
              )}
            >
              {p}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Reply({
  message,
  answering,
  canRegenerate,
  onRegenerate,
  usdPerLXC,
  fallbackModel,
}: {
  message: ChatMessage
  answering: boolean
  canRegenerate: boolean
  onRegenerate: () => void
  usdPerLXC: number | undefined
  fallbackModel: string | undefined
}) {
  return (
    <div>
      <span className="sr-only">{message.cost?.model ?? fallbackModel ?? 'Assistant'}: </span>
      {message.content === '' && answering ? (
        <p className="text-body text-muted">Answering…</p>
      ) : (
        <Markdown source={message.content} />
      )}
      {message.content !== '' && !answering ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <CopyButton text={message.content} label="Copy" className="-ml-2" />
          {canRegenerate ? (
            <button
              type="button"
              onClick={onRegenerate}
              className={cn(
                'rounded-control px-2 py-1 text-caption text-muted transition-colors duration-200 hover:text-ink',
                focusRing,
              )}
            >
              Regenerate
            </button>
          ) : null}
          {/* B1.4 — every answer carries its price and model: one quiet line, figures on the face. */}
          <p className="ml-1 font-figure text-caption text-faint" data-testid="turn-cost">
            {message.cost !== undefined
              ? `${formatAnswerCost(message.cost.usd, usdPerLXC)} · ${message.cost.model} · ` +
                `${message.cost.input_tokens.toLocaleString('en-US')} in / ` +
                `${message.cost.output_tokens.toLocaleString('en-US')} out tokens`
              : 'Price not known — the provider reported no token counts for this answer'}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function Composer({
  attachments,
  onAttach,
  onRemoveAttachment,
  attachError,
  draft,
  onDraft,
  onSend,
  onStop,
  pending,
  models,
  selected,
  onSelectModel,
}: {
  attachments: ChatAttachment[]
  onAttach: (files: File[]) => void
  onRemoveAttachment: (index: number) => void
  attachError: string | null
  draft: string
  onDraft: (text: string) => void
  onSend: () => void
  onStop: () => void
  pending: boolean
  models: ChatModel[]
  selected: ChatModel | undefined
  onSelectModel: (id: string) => void
}) {
  const boxRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // The box grows with what is typed, up to a limit, then scrolls.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (el === null) return
    el.style.height = 'auto'
    // No layout (a hidden tab, a test DOM) reports 0: leave the box at its natural one row.
    if (el.scrollHeight > 0) el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [draft])

  return (
    <form
      className={cn(
        'rounded-card border border-rule bg-surface transition-colors duration-200',
        'focus-within:border-rule-strong',
      )}
      onSubmit={(e) => {
        e.preventDefault()
        onSend()
      }}
    >
      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attached documents">
          {attachments.map((a, i) => (
            <li key={`${a.name}-${i}`} className="flex items-center gap-1 rounded-control border border-rule bg-canvas py-1 pl-2 pr-1 text-caption text-ink">
              <span className="max-w-48 truncate">{a.name}</span>
              <span className="font-figure text-faint">{formatSize(a.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                className={cn('rounded-control px-1 text-muted transition-colors duration-200 hover:text-ink', focusRing)}
                onClick={() => onRemoveAttachment(i)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor="chat-message" className="sr-only">
        Your message
      </label>
      <textarea
        ref={boxRef}
        id="chat-message"
        className={cn(
          'block max-h-60 w-full resize-none rounded-t-card bg-surface px-4 pt-3 text-body text-ink',
          'placeholder:text-faint',
          // ⚠ THE SAME CONTRACT Input.tsx GIVES EVERY OTHER TEXT FIELD. controlParity.test.ts
          // refused this field without it, correctly: a hand-rolled control that hovers,
          // disables or transitions differently from the shared one is a second opinion about
          // what a text field is.
          'transition-colors duration-200 hover:border-rule-strong',
          'disabled:cursor-not-allowed disabled:opacity-50',
          focusRing,
        )}
        rows={1}
        value={draft}
        disabled={selected === undefined}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          // ⚠ AN IME COMPOSITION USES ENTER TO CONFIRM CHARACTERS (Chinese, Japanese, Korean).
          // Safari reports that keydown with isComposing false, so keyCode 229 is checked too.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          // Shift+Enter is a new line; Enter, Cmd+Enter and Ctrl+Enter send.
          if (e.shiftKey && !e.metaKey && !e.ctrlKey) return
          e.preventDefault()
          // send() refuses an empty draft and a send while an answer is streaming, so Enter
          // mid-answer queues nothing.
          onSend()
        }}
        aria-describedby="chat-message-keys"
        placeholder={selected === undefined ? 'No model available' : 'Ask anything'}
      />
      <span id="chat-message-keys" className="sr-only">
        Enter sends. Shift+Enter adds a new line.
      </span>
      <div className="flex items-center gap-2 px-2 pb-2 pt-1">
        <FilePicker
          ref={fileRef}
          accept={Object.keys(ATTACHABLE)
            .map((ext) => `.${ext}`)
            .join(',')}
          onFiles={onAttach}
        />
        <button
          type="button"
          className={cn(railButtonClass, 'disabled:opacity-50')}
          disabled={pending || selected === undefined}
          onClick={() => fileRef.current?.click()}
        >
          Attach
        </button>
        {models.length > 0 ? (
          <>
            <label htmlFor="chat-model" className="sr-only">
              Model
            </label>
            <select
              id="chat-model"
              className={cn(
                'h-8 max-w-60 truncate rounded-control bg-surface px-2 text-caption text-muted',
                'transition-colors duration-200 hover:text-ink disabled:opacity-50',
                focusRing,
              )}
              value={selected?.id ?? ''}
              disabled={pending}
              onChange={(e) => onSelectModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <div className="flex-1" />
        {pending ? (
          // ⚠ KEYED APART FROM Send. Reusing one <button> and flipping its type lets the click on
          // Stop land on a submit button by the time the browser acts on it, which would send
          // whatever was typed meanwhile.
          <Button key="stop" type="button" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button key="send" type="submit" variant="primary" disabled={draft.trim() === '' || selected === undefined}>
            Send
          </Button>
        )}
      </div>
      {attachError !== null ? (
        <p className="px-4 pb-3 text-caption text-ink" role="alert">
          {attachError}
        </p>
      ) : null}
    </form>
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
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onRenameSave()
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Conversation name</span>
          <Input
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
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete">
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
    <div className="flex items-center gap-1">
      <h2 className="min-w-0 flex-1 truncate text-body font-medium text-ink">{conversation.title}</h2>
      <button type="button" className={railButtonClass} onClick={onRenameStart} disabled={disabled}>
        Rename
      </button>
      <button type="button" className={railButtonClass} onClick={onDeleteStart} disabled={disabled}>
        Delete
      </button>
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
      <p className="mt-10 text-body text-muted">
        This deployment&rsquo;s model catalog is empty, so there is nothing to chat with yet.
      </p>
    )
  }
  return (
    <p className="mt-10 text-body text-muted">
      This deployment serves <span className="font-figure">{total}</span> model(s), and none of them is on a provider
      whose stream this console can read yet. Chat reads two wire formats — OpenAI&rsquo;s and
      Anthropic&rsquo;s — because those are the two Lens streams.
    </p>
  )
}
