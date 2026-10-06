import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Input, cn, focusRing, inlineLink } from '@talyvor/ui'

import { InlineFailure } from '../../components/SessionExpiredBar'
import { useAuthMeReader } from '../../lib/authMe'
import {
  type AnswerPayer,
  type ChatAttachment,
  type ChatMessage,
  type ChatModel,
  type DistillSaved,
  type PickerCatalog,
  type Refusal,
  type SpendLine,
  askChat,
  fetchChatTools,
  fetchModels,
  fetchUnconfiguredProviders,
  markAnswerWrong,
  pickerCatalog,
  statementLineHref,
  uploadDocument,
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
import { AlertNotices } from './AlertNotices'
import { ApprovalCards } from './ApprovalCards'
import { LAUNCH_COMMAND, LaunchAgentCard } from './LaunchAgent'
import { AskAboveCard, RuleCard, isAskAboveCommand, isRuleCommand } from './RuleCommand'
import { LiveStatement } from './LiveStatement'
import { MoneyCards } from './MoneyCards'
import { PaidBy, PayerLine, usePayers } from './PaidBy'
import { CopyButton } from './CopyButton'
import { FilePicker } from './FilePicker'
import { ModelPicker } from './ModelPicker'
import { useRevealedText } from './reveal'
import { cutOff } from './chatStream'
import { type AnswerCost, type AnswerSource, answerSourceLine, formatAnswerCost, formatUsdPer1M, pricedAnswer } from './price'
import { topupApi } from '../lens/topupApi'
import { formatWhen } from '../lens/format'
import { Lxc } from '../lens/money'
import { Card } from '../lens/walletBrand'

// THE CHAT SCREEN — W4.6.1 step 6. The first surface that puts Model 2 in front of a person.
//
// Steps 3 and 4 built the whole lane: `apps/bff/stream.go` relays POST
// /api/ai/stream/{provider}/{rest...} to Lens's streaming proxy, flushing after every chunk, on a
// client with no whole-exchange timeout, using a {proxy}-scoped SESSION key it mints and leases
// server-side. ⚠ SO THE BROWSER NEVER HOLDS A WORKSPACE KEY, which is the reason step 4 exists.
//
// ── WHAT THIS SCREEN CLAIMS, AND WHAT IT REFUSES TO CLAIM ────────────────────
//
// ⚠ EVERY PROVIDER LENS STREAMS, AND ONLY THE ONES THIS DEPLOYMENT HOLDS A KEY FOR (B18.58). Lens
// streams each provider through its own upstream (B18.7), so the picker offers every provider it
// proxies — minus those Lens answers 503 "not configured" for, which the BFF's /api/ai/providers
// names. The picker STATES how many catalog entries that hid. A count a reader can see is the
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
// B28.354 — a conversation can name an agent to pay for it ("Paid by", ./PaidBy.tsx). Its requests then carry
// that agent to Lens, and an answer says the agent paid only when Lens's answer names the agent it billed.
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
//
// ── B29.10: IN THE BRAND ─────────────────────────────────────────────────────
//
// As minimal as before, on the board's planes: the composer on `raised` with a line-strong border and
// the teal Send as the view's one primary action, the model picker in the eyebrow style, questions and
// replies in Space Grotesk 15/24 with code and numbers in IBM Plex Mono, and the wallet lines a spend
// answer reads in the wallet screens' raised card.

/**
 * B10.3 — the documents a question can carry: exactly the formats Lens's converter reads
 * (talyvor-lens internal/distill/orchestrator.go, FormatFromMediaType). Keyed by extension because
 * a browser often reports no type for .md or .csv. B18.24 — slide decks too, since Lens reads .pptx.
 */
export const ATTACHABLE: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
  md: 'text/markdown',
}

/**
 * B18.24 — 25 MB per document: Lens's upload cap (talyvor-lens internal/documents.MaxBytes). A document
 * is uploaded once (POST /api/documents) and each question references it by id, so the chat request's
 * own 4 MiB bound no longer limits it.
 */
export const ATTACH_LIMIT_BYTES = 25 << 20

function formatSize(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** "a.pdf", "a.pdf and b.pdf", "a.pdf, b.pdf and c.pdf". */
function andList(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * B18.24 — what converting a question's documents saved, for the answer's footer, in Lens's figures.
 * Lens counts tokens only where it can measure them (0 for a binary file such as a slide deck), so a
 * zero is not shown as a saving: the size the conversion took off is.
 */
export function savedLine(saved: DistillSaved | undefined): string | undefined {
  if (saved === undefined) return undefined
  const smaller = saved.bytes > 0 ? `${formatSize(saved.bytes)} smaller` : undefined
  if (saved.tokens > 0) {
    return `Conversion saved ${saved.tokens.toLocaleString('en-US')} tokens${smaller ? ` · ${smaller}` : ''}`
  }
  return smaller ? `Converted to text, ${smaller}` : undefined
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
  // B18.58 — the providers Lens holds no key for. Their models are not offered.
  const providers = useQuery({
    queryKey: ['chat-unconfigured-providers'],
    queryFn: fetchUnconfiguredProviders,
    retry: false,
    staleTime: 5 * 60_000,
  })
  // The credit peg, from the deployment. Absent ⇒ answers are priced in dollars, never at a guess.
  const peg = useQuery({ queryKey: ['topup-options'], queryFn: topupApi.options, retry: false })
  const usdPerLXC = peg.data?.usd_per_lxc
  const qc = useQueryClient()

  const [modelId, setModelId] = useState<string>('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  // B18.24 — documents on their way to Lens; a question waits for them.
  const [uploading, setUploading] = useState<string[]>([])
  // B26.20 — a question sent before its documents are up: it goes the moment they are.
  const [waiting, setWaiting] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Refusal | null>(null)
  const [unreadable, setUnreadable] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  // B28.350 — each /agent command typed here: a card that launches the agent, kept while the page is open.
  const [launches, setLaunches] = useState<{ id: number; command: string }[]>([])
  const launchSeq = useRef(0)
  // B28.352 — each rule typed here in plain words ("Cap Researcher at 5 LXC a day on Opus"): a card that saves it.
  // B28.353 — and each approval amount ("Ask me above 2 LXC"), on its own card in the same list.
  const [ruleCards, setRuleCards] = useState<{ id: number; command: string }[]>([])
  // B28.354 — the agent whose wallet pays for this conversation; '' is the workspace.
  const [paidBy, setPaidBy] = useState('')
  const { book: payersBook, payers } = usePayers()

  // History is scoped to who is signed in; until that is known there is nowhere to keep it.
  const me = useAuthMeReader()
  const scope =
    me.data?.user?.sub ?? me.data?.workspace_id ?? (me.data?.mode === 'disabled' ? 'local' : null)
  const [history, setHistory] = useState<History>({ list: [], error: null })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [storageRefused, setStorageRefused] = useState(false)

  // The rail: hidden on a wide screen by choice (remembered per browser), a drawer on a narrow one.
  const [railHidden, setRailHidden] = useState(readRailHidden)
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => writeRailHidden(railHidden), [railHidden])
  // B28.351 — the live statement: a column beside the conversation on a wide screen, a drawer on a narrower one.
  const statementBeside = useMediaQuery(STATEMENT_BESIDE)
  const [statementOpen, setStatementOpen] = useState(false)
  const closeStatement = useCallback(() => setStatementOpen(false), [])
  const toggleRail = useCallback(() => setRailHidden((h) => !h), [])

  // B15.5 — ⌘⇧S / Ctrl+Shift+S hides and shows the rail; on a narrow screen it opens the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.code !== 'KeyS') return
      e.preventDefault()
      const wide = typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 840px)').matches
      if (wide) toggleRail()
      else setDrawerOpen((o) => !o)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggleRail])

  const open = useCallback((c: Conversation | undefined) => {
    setActiveId(c?.id ?? null)
    setMessages(c?.messages ?? [])
    if (c !== undefined) setModelId(c.model_id)
    setPaidBy(c?.paid_by ?? '')
    setFailure(null)
    setUnreadable(0)
    setRenaming(null)
    setConfirmingDelete(false)
    setDrawerOpen(false)
    setWaiting(false)
  }, [])

  // B28.275 — a question can be sent before who is signed in is known. Until then its conversation
  // is held here, and run() reads the scope from a ref, because its closure is from before it was known.
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const unsavedRef = useRef<Conversation[]>([])

  // Reopening the tab lands on the most recent conversation — "it is still there", literally.
  // A conversation begun before the identity was known is saved under it now, and stays on screen.
  useEffect(() => {
    if (scope === null) return
    const read = loadConversations(scope)
    const unsaved = unsavedRef.current
    unsavedRef.current = []
    if (unsaved.length > 0) {
      const list = [...unsaved, ...read.list.filter((c) => !unsaved.some((u) => u.id === c.id))].sort(
        (a, b) => b.updated_at - a.updated_at,
      )
      setStorageRefused(!saveConversations(scope, list))
      setHistory({ list, error: null })
      if (activeRef.current === null) open(list[0])
      return
    }
    setHistory(read)
    open(read.list[0])
  }, [scope, open])

  // ⚠ READS STORAGE, NOT STATE. It runs after an await inside run(), where `history` from the
  // closure is a render old; merging into that would drop a rename made while it streamed.
  const store = useCallback((update: (list: Conversation[]) => Conversation[]) => {
    const owner = scopeRef.current
    if (owner === null) {
      unsavedRef.current = update(unsavedRef.current)
      setHistory({ list: unsavedRef.current, error: null })
      return
    }
    const next = update(loadConversations(owner).list)
    setStorageRefused(!saveConversations(owner, next))
    setHistory({ list: next, error: null })
  }, [])

  // ⚠ ABORT ON UNMOUNT. r.Context() in the BFF is the browser's connection, and cancelling it
  // cancels the upstream — which is what stops Lens generating, and being billed for, tokens
  // nobody will read. Navigating away from this screen must do that.
  useEffect(() => () => abortRef.current?.abort(), [])

  // B18.60 — the default is the newest frontier model the catalog offers, from its data, never a
  // model name typed into this file.
  const picker = pickerCatalog(catalog.data ?? [], providers.data ?? [])
  const models = picker.offered
  const selected: ChatModel | undefined =
    models.find((m) => m.id === modelId) ?? picker.defaultModel

  /** Streams an answer to `turn`, whose last message is the question. */
  const run = useCallback(
    async (turn: ChatMessage[], fresh = false) => {
      if (selected === undefined || pending) return
      const id = activeId ?? newConversationId()
      const model = selected.id
      // B28.354 — who pays is read once per question, as the person chose it when they asked.
      const payer = paidBy
      const payerName = payers.find((a) => a.id === payer)?.name ?? 'the agent'
      setActiveId(id)
      // The question is kept before the answer starts, so a tab closed mid-stream loses only the
      // answer.
      store((list) => upsertConversation(list, id, model, turn, Date.now(), payer))
      setMessages([...turn, { role: 'assistant', content: '' }])
      setPending(true)
      setFailure(null)
      setUnreadable(0)

      const controller = new AbortController()
      abortRef.current = controller
      let answer = ''
      let cost: AnswerCost | undefined
      let source: AnswerSource | undefined
      let saved: DistillSaved | undefined
      let requestId: string | undefined
      let incomplete: ChatMessage['incomplete']
      let spend: SpendLine[] | undefined
      let requests: number | undefined
      let answerPayer: AnswerPayer | undefined
      // B28.349 — Lens's read-only wallet tools, read once: a spend question is answered from the statements.
      const tools = await qc.ensureQueryData({ queryKey: ['chat-tools'], queryFn: fetchChatTools, retry: false }).catch(() => [])
      // B10.3 — whether Lens converted the documents this question carried, marked on the question.
      const asked = turn.length - 1
      const carriedDocs = turn[asked]?.attachments?.some((a) => a.file_id !== undefined) === true
      let sentTurn = turn

      await askChat(
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
          onDone: ({ unrecognised, usage, model: servedBy, converted, source: from, saved: conversion, requestId: rid, finish, spend: lines, requests: took, paidBy: billedTo }) => {
            if (carriedDocs) {
              sentTurn = turn.map((m, i) => (i === asked ? { ...m, converted } : m))
              setMessages((prev) => prev.map((m, i) => (i === asked ? { ...m, converted } : m)))
            }
            // B18.24 — what converting the documents saved, shown under the answer.
            if (conversion !== undefined) {
              saved = conversion
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last !== undefined && last.role === 'assistant') next[next.length - 1] = { ...last, saved: conversion }
                return next
              })
            }
            // B1.4 — every answer carries its price; see pricedAnswer() for which model names it.
            // B15.6 — except one the model did not write just now: a replayed or shared answer is
            // priced by where it came from, not by the tokens it once took.
            const priced = from === undefined ? pricedAnswer(usage, selected, servedBy, catalog.data ?? []) : undefined
            if (priced !== undefined || from !== undefined) {
              cost = priced
              source = from
              // B28.349 — an answer that called a tool first took more than one request, and each was charged.
              requests = took
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last !== undefined && last.role === 'assistant') next[next.length - 1] = { ...last, cost: priced, source: from, saved, requests: took }
                return next
              })
            }
            // B23.12 — the id a thumbs-down names this answer by.
            if (rid !== undefined) {
              requestId = rid
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last !== undefined && last.role === 'assistant') next[next.length - 1] = { ...last, request_id: rid }
                return next
              })
            }
            // B28.349 — the statement lines a spend answer was read from, linked under it.
            if (lines !== undefined) {
              spend = lines
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last !== undefined && last.role === 'assistant') next[next.length - 1] = { ...last, spend: lines }
                return next
              })
            }
            // B28.354 — in a conversation an agent pays for, whether Lens billed that agent for this answer.
            if (payer !== '') {
              const p: AnswerPayer = { agent_id: payer, name: payerName, billed: billedTo === payer }
              answerPayer = p
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last !== undefined && last.role === 'assistant') next[next.length - 1] = { ...last, payer: p }
                return next
              })
            }
            // B28.81 — an answer that finished having said nothing, or stopped at the length limit, says so
            // rather than looking like a whole answer.
            incomplete = answer.trim() === '' ? 'blank' : cutOff(finish) ? 'cut_off' : undefined
            if (incomplete !== undefined) {
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last !== undefined && last.role === 'assistant') next[next.length - 1] = { ...last, incomplete }
                return next
              })
            }
            setPending(false)
            setUnreadable(unrecognised)
          },
          onError: (message, remedy) => {
            setPending(false)
            setFailure({ text: message, remedy })
          },
        },
        controller.signal,
        fresh,
        tools,
        payer,
      )
      store((list) =>
        upsertConversation(
          list,
          id,
          model,
          [...sentTurn, { role: 'assistant', content: answer, cost, source, saved, request_id: requestId, incomplete, spend, requests, payer: answerPayer }],
          Date.now(),
          payer,
        ),
      )
    },
    [activeId, catalog.data, paidBy, payers, pending, qc, selected, store],
  )

  // B28.354 — a new payer is kept with the conversation at once, so reopening it keeps the choice.
  const choosePayer = useCallback(
    (agentID: string) => {
      setPaidBy(agentID)
      if (activeId !== null) store((list) => list.map((c) => (c.id === activeId ? { ...c, paid_by: agentID === '' ? undefined : agentID } : c)))
    },
    [activeId, store],
  )

  const send = useCallback(
    (text: string = draft) => {
      const question = text.trim()
      if (question === '') return
      if (LAUNCH_COMMAND.test(question)) {
        setDraft('')
        setLaunches((l) => [...l, { id: ++launchSeq.current, command: question }])
        return
      }
      if (isRuleCommand(question) || isAskAboveCommand(question)) {
        setDraft('')
        setRuleCards((l) => [...l, { id: ++launchSeq.current, command: question }])
        return
      }
      if (selected === undefined || pending) return
      if (uploading.length > 0) {
        setWaiting(true)
        return
      }
      setDraft('')
      const docs = attachments
      setAttachments([])
      setAttachError(null)
      void run([...messages, docs.length > 0 ? { role: 'user', content: question, attachments: docs } : { role: 'user', content: question }])
    },
    [attachments, draft, messages, pending, run, selected, uploading],
  )

  const attach = useCallback(
    async (files: File[]) => {
      setAttachError(null)
      for (const f of files) {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
        const mediaType = ATTACHABLE[ext]
        if (mediaType === undefined) {
          setAttachError(
            `${f.name} can’t be converted. PDF, Word, Excel, PowerPoint, CSV, HTML, JSON, XML, text and Markdown files can.`,
          )
          continue
        }
        if (f.size > ATTACH_LIMIT_BYTES) {
          setAttachError(`${f.name} is too large: a document can be at most 25 MB.`)
          continue
        }
        // B18.24 — stored in Lens once; each question then references it by id.
        setUploading((prev) => [...prev, f.name])
        try {
          const id = await uploadDocument(f, mediaType)
          setAttachments((prev) => [...prev, { name: f.name, media_type: mediaType, size: f.size, file_id: id }])
        } catch (e) {
          const why = e instanceof Error && e.message !== '' ? e.message : 'try again.'
          setAttachError(`${f.name} couldn’t be uploaded: ${why}${/[.!?]$/.test(why) ? '' : '.'}`)
        } finally {
          setUploading((prev) => {
            const i = prev.indexOf(f.name)
            return i < 0 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)]
          })
        }
      }
    },
    [],
  )

  // send() is a new function every render; the waiting question is sent once, when the uploads end.
  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => {
    if (!waiting || uploading.length > 0) return
    setWaiting(false)
    // A document that could not be uploaded leaves the question in the box, the reason beside it.
    if (attachError === null) sendRef.current()
  }, [attachError, uploading, waiting])

  // Regenerate answers the last question again: the previous answer is dropped, not kept beside it.
  // B15.6 — and it always asks the model: without the bypass Lens would replay the answer it has.
  const regenerate = useCallback(() => {
    const lastUser = messages.map((m) => m.role).lastIndexOf('user')
    if (lastUser < 0) return
    void run(messages.slice(0, lastUser + 1), true)
  }, [messages, run])

  // B23.12 — a thumbs-down: Lens removes the stored answer so nobody is served it again, and the answer
  // says so — in the saved conversation too, so it still says so when reopened.
  const markWrong = useCallback(
    async (requestId: string) => {
      await markAnswerWrong(requestId)
      const mark = (list: ChatMessage[]) => list.map((m) => (m.request_id === requestId ? { ...m, marked_wrong: true } : m))
      setMessages(mark)
      if (activeId !== null) store((list) => list.map((c) => (c.id === activeId ? { ...c, messages: mark(c.messages) } : c)))
    },
    [activeId, store],
  )

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
  const follow = useCallback(() => {
    const el = endRef.current
    if (el === null || typeof el.scrollIntoView !== 'function') return
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160
    if (nearBottom) el.scrollIntoView({ block: 'end' })
  }, [])
  useEffect(follow, [messages.length, lastContent, follow])

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
      {/* The rail on a wide screen: a column beside the conversation. Hidden, it leaves a slim
          rail that still starts a new chat and brings the column back. */}
      {railHidden ? (
        <aside
          aria-label="Conversations"
          className="hidden border-r border-rule bg-sidebar wide:sticky wide:top-12 wide:flex wide:h-below-header wide:w-12 wide:shrink-0 wide:flex-col wide:items-center wide:gap-1 wide:py-2"
        >
          <button
            type="button"
            className={railIconClass}
            onClick={toggleRail}
            aria-label="Show sidebar"
            aria-expanded={false}
            aria-keyshortcuts="Meta+Shift+S Control+Shift+S"
            title={`Show sidebar (${RAIL_SHORTCUT})`}
          >
            <SidebarGlyph />
          </button>
          <button
            type="button"
            className={railIconClass}
            onClick={() => open(undefined)}
            disabled={pending || activeId === null}
            aria-label="New chat"
            title="New chat"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </aside>
      ) : (
        <aside
          aria-label="Conversations"
          className="hidden border-r border-rule bg-sidebar wide:sticky wide:top-12 wide:flex wide:h-below-header wide:w-64 wide:shrink-0 wide:flex-col"
        >
          <div className="flex justify-end px-2 pt-2">
            <button
              type="button"
              className={railIconClass}
              onClick={toggleRail}
              aria-label="Hide sidebar"
              aria-expanded={true}
              aria-keyshortcuts="Meta+Shift+S Control+Shift+S"
              title={`Hide sidebar (${RAIL_SHORTCUT})`}
            >
              <SidebarGlyph />
            </button>
          </div>
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
          {!statementBeside ? (
            <button type="button" className={railButtonClass} onClick={() => setStatementOpen(true)}>
              Statement
            </button>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col px-gutter">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
            {catalog.isPending || providers.isPending ? (
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
              <NoStreamableModels total={catalog.data?.length ?? 0} unconfigured={picker.unconfigured} />
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
                      <div className="max-w-prose rounded-card border border-rule bg-raised px-4 py-3 text-reading text-ink">
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
                        onMarkWrong={m.request_id !== undefined ? () => markWrong(m.request_id!) : undefined}
                        onReveal={i === messages.length - 1 ? follow : undefined}
                        usdPerLXC={usdPerLXC}
                        fallbackModel={selected?.display_name}
                      />
                    )}
                  </li>
                ))}
              </ol>
            )}

            {/* B28.350 — /agent launches an agent with its budget, rules and key, on a card here instead of a question. */}
            {launches.length > 0 ? (
              <section aria-label="Launching agents" className="flex flex-col gap-3 pb-6">
                {launches.map((l) => (
                  <LaunchAgentCard key={l.id} command={l.command} onClose={() => setLaunches((ls) => ls.filter((x) => x.id !== l.id))} />
                ))}
              </section>
            ) : null}

            {/* B28.352 — a rule typed in plain words, on a card here to check and save instead of a question. */}
            {ruleCards.length > 0 ? (
              <section aria-label="Setting rules" className="flex flex-col gap-3 pb-6">
                {ruleCards.map((l) =>
                  isAskAboveCommand(l.command) ? (
                    <AskAboveCard key={l.id} command={l.command} onClose={() => setRuleCards((ls) => ls.filter((x) => x.id !== l.id))} />
                  ) : (
                    <RuleCard key={l.id} command={l.command} onClose={() => setRuleCards((ls) => ls.filter((x) => x.id !== l.id))} />
                  ),
                )}
              </section>
            ) : null}

            {/* B28.91 — low balance, a monthly limit near or reached, unusual spend: the wallets' alerts, here. */}
            <AlertNotices />

            {/* B28.84 — an agent's payment waiting for a person, approved with Face ID here in the conversation. */}
            <ApprovalCards />

            {/* B28.355 — another agent asking one of yours for credits, and escrow waiting on delivery: answered here. */}
            <MoneyCards />

            {failure !== null ? (
              <p className="mb-4 text-body text-ink" role="alert">
                {failure.text}{' '}
                {/* B28.348 — each refusal's own remedy: the screen that fixes it, or a fresh chat. */}
                {failure.remedy === undefined ? null : 'to' in failure.remedy ? (
                  <Link className={inlineLink} to={failure.remedy.to}>{failure.remedy.label}</Link>
                ) : (
                  <Button onClick={() => open(undefined)}>{failure.remedy.label}</Button>
                )}
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
              uploading={uploading}
              waiting={waiting}
              draft={draft}
              onDraft={setDraft}
              onSend={() => send()}
              onStop={stop}
              pending={pending}
              picker={picker}
              selected={selected}
              onSelectModel={setModelId}
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {/* B28.354 — which wallet pays for this conversation. */}
              <PaidBy book={payersBook} payers={payers} value={paidBy} onChange={choosePayer} disabled={pending} />
              {selected !== undefined ? (
                // ⚠ THE PRICE IS THE CATALOG'S LIST RATE AND IS LABELLED AS SUCH. A session-key
                // request moves no LXC in the default configuration (see this file's header), so a
                // "you spent" figure here would be a claim about a ledger that did not move. Figures
                // on the figure face.
                <p className="font-figure text-caption text-faint">
                  List price · {formatUsdPer1M(selected.input_per_1m)} in /{' '}
                  {formatUsdPer1M(selected.output_per_1m)} out per 1M tokens
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {statementBeside ? (
        <aside aria-label="Statement" className="sticky top-12 flex h-below-header w-80 shrink-0 flex-col border-l border-rule bg-sidebar">
          <LiveStatement follow={paidBy} />
        </aside>
      ) : statementOpen ? (
        <Drawer side="right" label="Statement" onClose={closeStatement}>
          <LiveStatement follow={paidBy} />
        </Drawer>
      ) : null}
    </div>
  )
}

/** B28.351 — wide enough for the conversations, the conversation and the statement side by side. */
const STATEMENT_BESIDE = '(min-width: 1280px)'

/** Whether the screen matches a media query, following it as the window is resized. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window.matchMedia !== 'function' || window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const m = window.matchMedia(query)
    const on = () => setMatches(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return matches
}

const railButtonClass = cn(
  'inline-flex h-8 items-center rounded-control px-2 text-caption text-muted transition-colors duration-200 hover:text-ink',
  focusRing,
)

const railIconClass = cn(
  'inline-flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors duration-200 hover:text-ink disabled:text-faint disabled:hover:text-faint',
  focusRing,
)

/** The rail-toggle shortcut as this platform writes it, for the button's tooltip. */
const RAIL_SHORTCUT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? '⌘⇧S'
    : 'Ctrl+Shift+S'

/** Per browser, like the conversations themselves. */
export const RAIL_HIDDEN_KEY = 'talyvor.chat.rail-hidden'

function readRailHidden(): boolean {
  try {
    return window.localStorage.getItem(RAIL_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeRailHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(RAIL_HIDDEN_KEY, '1')
    else window.localStorage.removeItem(RAIL_HIDDEN_KEY)
  } catch {
    // Storage refused: the choice lasts for this visit only.
  }
}

/** A panel with its left column marked — the sidebar, shown or hidden. */
function SidebarGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </svg>
  )
}

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
                    'block w-full truncate rounded-control px-2 py-2 text-left text-body',
                    'transition-colors duration-200 hover:bg-surface',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    // B29.10 — the open conversation as the app's sidebar marks the page you are on.
                    c.id === activeId ? 'bg-accent-tint text-accent-strong hover:bg-accent-tint' : 'text-ink',
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
        <Link className={`block text-caption text-ink ${inlineLink}`} to="/chat/help">
          How to use Talyvor Chat
        </Link>
        <p className="text-caption text-faint">Kept in this browser only.</p>
      </div>
    </div>
  )
}

/** The rail as a drawer on a narrow screen (and, B28.351, the statement from the right). Escape or the backdrop closes it. */
function Drawer({
  onClose,
  children,
  side = 'left',
  label = 'Conversations',
}: {
  onClose: () => void
  children: React.ReactNode
  side?: 'left' | 'right'
  label?: string
}) {
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
    <div className={cn('fixed inset-0 z-20', side === 'left' && 'wide:hidden')}>
      <button type="button" aria-label={`Close ${label.toLowerCase()}`} className="absolute inset-0 bg-canvas opacity-80" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'absolute inset-y-0 flex max-w-full flex-col bg-sidebar',
          side === 'left' ? 'left-0 w-72 border-r border-rule' : 'right-0 w-80 border-l border-rule',
        )}
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
  const kept = docs.every((d) => d.file_id !== undefined)
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
                'h-full w-full rounded-card border border-rule bg-raised px-4 py-3 text-left text-body text-ink',
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
  onMarkWrong,
  onReveal,
  usdPerLXC,
  fallbackModel,
}: {
  message: ChatMessage
  answering: boolean
  canRegenerate: boolean
  onRegenerate: () => void
  /** B23.12 — marks the answer wrong; absent when Lens gave no id to name it by. */
  onMarkWrong?: () => Promise<void>
  /** Called as the answer grows on screen, so the view can follow it. */
  onReveal?: () => void
  usdPerLXC: number | undefined
  fallbackModel: string | undefined
}) {
  // B16.3 — the answer grows at a steady pace however it arrives: bursts are spread out, and a
  // cached answer (which Lens sends in one piece) is revealed rather than dropped in as a block.
  const shown = useRevealedText(message.content, answering)
  useEffect(() => onReveal?.(), [shown.text, onReveal])
  const [marking, setMarking] = useState<'idle' | 'busy' | 'failed'>('idle')
  const markWrong = async () => {
    if (onMarkWrong === undefined) return
    setMarking('busy')
    try {
      await onMarkWrong()
      setMarking('idle')
    } catch {
      setMarking('failed')
    }
  }
  return (
    <div>
      <span className="sr-only">{message.cost?.model ?? fallbackModel ?? 'Assistant'}: </span>
      {message.content === '' && answering ? (
        <p className="text-body text-muted">Answering…</p>
      ) : message.incomplete === 'blank' && !answering ? (
        // B28.81 — a blank answer says so and offers to ask again, rather than leaving an empty space
        // that reads as an answer.
        <div role="alert" data-testid="turn-blank" className="flex flex-wrap items-center gap-3">
          <p className="text-body text-ink">No answer came back.</p>
          {canRegenerate ? <Button onClick={onRegenerate}>Retry</Button> : null}
        </div>
      ) : (
        <Markdown source={shown.text} />
      )}
      {message.spend !== undefined && message.spend.length > 0 && !answering && !shown.revealing ? <StatementLines lines={message.spend} /> : null}
      {message.content !== '' && message.incomplete !== 'blank' && !answering && !shown.revealing ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {message.incomplete === 'cut_off' ? (
            // B28.81 — the model stopped at its length limit: the answer ends mid-way, and says so.
            <p className="mb-1 w-full text-caption text-muted" data-testid="turn-cut-off">
              <span className="mr-1 rounded-control border border-rule px-1.5 py-0.5 text-ink">Cut off</span>{' '}
              The model reached its length limit before it finished this answer.
            </p>
          ) : null}
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
          {onMarkWrong !== undefined && !message.marked_wrong ? (
            <button
              type="button"
              onClick={() => void markWrong()}
              disabled={marking === 'busy'}
              className={cn(
                'rounded-control px-2 py-1 text-caption text-muted transition-colors duration-200 hover:text-ink',
                focusRing,
              )}
            >
              {marking === 'busy' ? 'Marking…' : 'Wrong answer'}
            </button>
          ) : null}
          {/* B1.4 — every answer carries its price and model: one quiet line, figures on the face.
              B15.6 — or, when the model did not write it just now, where it came from. */}
          <p className="ml-1 font-figure text-caption text-faint" data-testid="turn-cost">
            {message.source !== undefined
              ? answerSourceLine(message.source)
              : message.cost !== undefined
                ? `${formatAnswerCost(message.cost.usd, usdPerLXC)} · ${message.cost.model} · ` +
                  `${message.cost.input_tokens.toLocaleString('en-US')} in / ` +
                  `${message.cost.output_tokens.toLocaleString('en-US')} out tokens` +
                  (message.requests !== undefined && message.requests > 1 ? ` · ${message.requests} requests` : '')
                : 'Price not known — the provider reported no token counts for this answer'}
          </p>
          {message.marked_wrong ? (
            <p className="ml-1 w-full text-caption text-muted" data-testid="turn-marked">
              Marked wrong — this answer won’t be served again{canRegenerate ? '. Regenerate asks the model afresh.' : '.'}
            </p>
          ) : marking === 'failed' ? (
            <p role="status" className="ml-1 w-full text-caption text-muted">
              Couldn’t mark it wrong just now. Try again.
            </p>
          ) : null}
          {message.payer !== undefined ? <PayerLine payer={message.payer} /> : null}
          {savedLine(message.saved) !== undefined ? (
            <p className="ml-1 w-full font-figure text-caption text-faint" data-testid="turn-saved">
              {savedLine(message.saved)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** B28.349 — the statement lines a spend answer was read from, each a link to its row on Agent Wallets. */
function StatementLines({ lines }: { lines: SpendLine[] }) {
  const shown = lines.slice(0, 8)
  // B29.10 — the wallet lines in the wallet screens' own card: raised, an eyebrow, amounts in IBM Plex Mono.
  return (
    <Card className="mt-3 px-4 py-3">
      <nav aria-label="Statement lines this answer read" data-testid="turn-statement-lines">
        <p className="font-figure text-eyebrow uppercase text-label">From your agents’ statements</p>
        <ul className="mt-2 flex flex-col gap-1">
          {shown.map((l) => (
            <li key={`${l.agent_id}-${l.entry_id}`} className="text-caption text-muted">
              <Link className={inlineLink} to={statementLineHref(l)}>
                {l.agent}: {l.label !== undefined ? <span data-testid="statement-line-label">{l.label} </span> : null}
                <Lxc ulxc={Math.abs(l.amount_ulxc)} sign={l.amount_ulxc < 0 ? '−' : '+'} />
                {l.at !== undefined ? <> · <span className="font-figure">{formatWhen(l.at)}</span></> : null}
              </Link>
            </li>
          ))}
        </ul>
        {lines.length > shown.length ? (
          <p className="mt-1 text-caption text-muted">
            and <span className="font-figure">{lines.length - shown.length}</span> more on the agents’ statements
          </p>
        ) : null}
      </nav>
    </Card>
  )
}

function Composer({
  attachments,
  onAttach,
  onRemoveAttachment,
  attachError,
  uploading,
  waiting,
  draft,
  onDraft,
  onSend,
  onStop,
  pending,
  picker,
  selected,
  onSelectModel,
}: {
  attachments: ChatAttachment[]
  onAttach: (files: File[]) => void
  onRemoveAttachment: (index: number) => void
  attachError: string | null
  /** B18.24 — names of the documents still on their way to Lens. */
  uploading: string[]
  /** B26.20 — a question was sent and goes once `uploading` is empty. */
  waiting: boolean
  draft: string
  onDraft: (text: string) => void
  onSend: () => void
  onStop: () => void
  pending: boolean
  picker: PickerCatalog
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
        // `relative` so the model picker's panel opens above the whole composer.
        // B29.10 — on the board's raised plane, edged in line-strong.
        'relative rounded-card border border-rule-strong bg-raised transition-colors duration-200',
      )}
      onSubmit={(e) => {
        e.preventDefault()
        onSend()
      }}
    >
      {attachments.length > 0 || uploading.length > 0 ? (
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
          {uploading.map((name, i) => (
            <li
              key={`uploading-${name}-${i}`}
              className="flex items-center gap-1 rounded-control border border-rule bg-canvas px-2 py-1 text-caption text-muted"
              data-testid="attachment-uploading"
            >
              <span className="max-w-48 truncate">{name}</span> uploading…
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
          'block max-h-60 w-full resize-none rounded-t-card bg-raised px-4 pt-3 text-reading text-ink',
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
        <ModelPicker catalog={picker} selected={selected} onSelect={onSelectModel} disabled={pending} />
        <div className="flex-1" />
        {pending ? (
          // ⚠ KEYED APART FROM Send. Reusing one <button> and flipping its type lets the click on
          // Stop land on a submit button by the time the browser acts on it, which would send
          // whatever was typed meanwhile.
          <Button key="stop" type="button" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button
            key="send"
            type="submit"
            variant="primary"
            disabled={draft.trim() === '' || selected === undefined}
          >
            Send
          </Button>
        )}
      </div>
      {waiting && uploading.length > 0 ? (
        <p className="px-4 pb-3 text-caption text-muted" role="status" data-testid="send-waiting">
          Sends when {andList(uploading)} {uploading.length === 1 ? 'has' : 'have'} uploaded.
        </p>
      ) : null}
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
 * ⚠ THE WAYS TO HAVE NO PICKER ARE DIFFERENT STATES WITH DIFFERENT NEXT ACTIONS, so they are not one
 * apologetic sentence: a catalog that is empty, one whose providers Lens holds no key for (an
 * operator change), and one full of models this client cannot stream (a Lens change).
 */
function NoStreamableModels({ total, unconfigured }: { total: number; unconfigured: number }) {
  if (total === 0) {
    return (
      <p className="mt-10 text-body text-muted">
        This deployment&rsquo;s model catalog is empty, so there is nothing to chat with yet.
      </p>
    )
  }
  if (unconfigured > 0) {
    return (
      <p className="mt-10 text-body text-muted">
        This deployment&rsquo;s catalog lists <span className="font-figure">{unconfigured}</span> chat model(s), and
        Lens holds no provider key for any of them, so there is nothing to chat with yet.
      </p>
    )
  }
  return (
    <p className="mt-10 text-body text-muted">
      This deployment serves <span className="font-figure">{total}</span> model(s), and none of them is on a provider
      whose stream this console can read yet.
    </p>
  )
}
