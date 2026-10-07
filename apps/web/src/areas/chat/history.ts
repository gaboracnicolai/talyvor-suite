import type { ChatMessage } from './chatApi'

// CONVERSATION HISTORY — B1.3. Conversations persist and reopen.
//
// ⚠ THEY PERSIST IN THIS BROWSER, NOT ON A SERVER, AND THAT IS THE DESIGN RATHER THAN A SHORTCUT.
// Lens stores no prompt or response text (its migration 0009: "intentionally NOT stored in DB
// (privacy)"), and a server-side history would reverse that decision for every workspace. Keeping
// the text in localStorage gives "close the tab, reopen it, the conversation is still there"
// without a byte of it leaving the browser except to the model that answers it. The screen says
// so, because "saved" alone would be read as "saved to my account".
//
// ⚠ THE KEY IS SCOPED TO THE SIGNED-IN IDENTITY. One browser, two accounts, one unscoped key is
// one person reading the other's conversations.

export interface Conversation {
  id: string
  /** Derived from the first question until the person renames it. */
  title: string
  /** True once renamed — a derived title never overwrites a chosen one. */
  renamed: boolean
  model_id: string
  /** B28.354 — the agent whose wallet pays for this conversation; absent, the workspace pays. */
  paid_by?: string
  /** B28.361 — the most this conversation may spend, in µLXC; absent, no budget. */
  budget_ulxc?: number
  /** B28.109 — the project it was started in, whose instructions every question in it is sent with; absent, none. */
  project_id?: string
  /** B28.370 — the named prompt from the library every question in it is sent with; absent, none. */
  prompt?: string
  created_at: number
  updated_at: number
  /** B28.365 — when this browser last saved a change to it (a rename too, which leaves updated_at); syncs merge by it. */
  changed_at?: number
  /** B28.110 — kept at the top of the rail until unpinned; absent, not pinned. */
  pinned?: true
  /** B28.110 — out of the rail's list, under Archived, until unarchived or asked in again; absent, not archived. */
  archived?: true
  messages: ChatMessage[]
}

const KEY_PREFIX = 'talyvor.chat.v1:'
const TITLE_MAX = 60

export function historyKey(scope: string): string {
  return KEY_PREFIX + scope
}

/** What was read from storage. `error` set means UNREADABLE, which is not the same as empty. */
export interface History {
  list: Conversation[]
  error: string | null
}

/** Newest activity first. */
export function loadConversations(scope: string): History {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(historyKey(scope))
  } catch {
    return { list: [], error: 'This browser refused to let the console read its storage.' }
  }
  if (raw === null) return { list: [], error: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('not a list')
    const list = (parsed as Conversation[])
      .filter((c) => typeof c?.id === 'string' && Array.isArray(c.messages))
      .sort((a, b) => b.updated_at - a.updated_at)
    return { list, error: null }
  } catch {
    return { list: [], error: 'The conversations saved in this browser are unreadable.' }
  }
}

/** Returns false when the browser refused the write (quota, private mode) so the screen can say so. */
export function saveConversations(scope: string, list: Conversation[]): boolean {
  try {
    window.localStorage.setItem(historyKey(scope), JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/** The first question, on one line, cut to a sidebar's width. */
export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')?.content.replace(/\s+/g, ' ').trim() ?? ''
  if (first === '') return 'Untitled conversation'
  return first.length <= TITLE_MAX ? first : first.slice(0, TITLE_MAX - 1).trimEnd() + '…'
}

/** B28.112 — every version of the answer at `at`, oldest first, each the answer with the turns that followed it; the
 *  one shown is the thread from `at` on. */
function versionsAt(messages: readonly ChatMessage[], at: number): ChatMessage[][] {
  const shown = messages[at]
  if (shown === undefined) return []
  const { versions = [], version = versions.length, ...answer } = shown
  const all = [...versions]
  // A failed answer later in the thread is left out, as upsertConversation leaves it out of the saved thread.
  all.splice(version, 0, [answer, ...messages.slice(at + 1).filter((m) => !(m.role === 'assistant' && m.content === ''))])
  return all
}

/** B28.112 — what a new answer to the question before `at` carries: every version the answer at `at` had, so the new
 *  one is the last. An answer that said nothing is not a version. */
export function keptVersions(messages: readonly ChatMessage[], at: number): Pick<ChatMessage, 'versions' | 'version'> {
  const all = versionsAt(messages, at).filter((v) => (v[0]?.content.trim() ?? '') !== '')
  return all.length === 0 ? {} : { versions: all, version: all.length }
}

/** B28.112 — the thread with the answer at `at` switched to its version `to`, which brings back the turns that followed
 *  it; the version it leaves keeps its own. */
export function showVersion(messages: ChatMessage[], at: number, to: number): ChatMessage[] {
  const all = versionsAt(messages, at)
  const [answer, ...after] = all[to] ?? []
  if (answer === undefined) return messages
  return [...messages.slice(0, at), { ...answer, versions: all.filter((_, i) => i !== to), version: to }, ...after]
}

/** B28.112 — every turn in a thread, its answers' other versions too: each of them was asked for and paid for. */
export function everyTurn(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.flatMap((m) => [m, ...(m.versions ?? []).flatMap(everyTurn)])
}

/** B28.113 — what Continue asks the model after the answer it cut off. Every provider is asked the same way: a thread
 *  that ends on the answer itself is read as a prefill by some models and refused by others. */
export const CONTINUE_PROMPT =
  'Your answer above was cut off at the length limit. Continue it from exactly where it stops: do not repeat any of it, ' +
  'do not introduce or sum it up, and if it stops inside a list or a code block, carry on inside it.'

/** B28.113 — where a cut-off answer is continued from: up to its last space or line break, so a word the limit cut in two
 *  is written again whole rather than joined to a guess. An answer with no break in it is kept whole. */
export function continueFrom(answer: string): string {
  const cut = /\s\S*$/.exec(answer)
  const from = cut === null ? answer : answer.slice(0, cut.index + 1)
  return from.trim() === '' ? answer : from
}

/** B28.113 — an answer continued from `from` with `more`: after a break, the break `more` opens with is dropped. */
export function joinContinued(from: string, more: string): string {
  return /\s$/.test(from) ? from + more.replace(/^\s+/, '') : from + more
}

/** B28.113 — the thread Continue sends: the cut-off answer last, to where it is continued from, then CONTINUE_PROMPT. */
export function continuation(messages: readonly ChatMessage[]): ChatMessage[] {
  const answer = messages[messages.length - 1]
  if (answer?.role !== 'assistant') return [...messages]
  return [
    ...messages.slice(0, -1),
    { role: 'assistant', content: continueFrom(answer.content).trimEnd() },
    { role: 'user', content: CONTINUE_PROMPT },
  ]
}

/** B28.113 — a cut-off answer and what Continue wrote after it, as one answer: the text joined, and both requests in its
 *  price, its charge and its count, since each was paid for. A figure one of them lacks is not known for the whole.
 *  Whether it is still cut off is the continuation's to say. */
export function continuedAnswer(head: ChatMessage, more: ChatMessage): ChatMessage {
  const a = head.cost
  const b = more.cost
  return {
    ...head,
    content: joinContinued(continueFrom(head.content), more.content),
    cost:
      a === undefined || b === undefined
        ? undefined
        : { model: b.model, input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens, usd: a.usd + b.usd },
    charged_ulxc: head.charged_ulxc === undefined || more.charged_ulxc === undefined ? undefined : head.charged_ulxc + more.charged_ulxc,
    requests: (head.requests ?? 1) + (more.requests ?? 1),
    incomplete: more.incomplete,
    spend: head.spend === undefined && more.spend === undefined ? undefined : [...(head.spend ?? []), ...(more.spend ?? [])],
    payer: more.payer ?? head.payer,
    auto: head.auto || more.auto ? true : undefined,
    citations: head.citations ?? more.citations,
    code_runs: head.code_runs === undefined && more.code_runs === undefined ? undefined : [...(head.code_runs ?? []), ...(more.code_runs ?? [])],
  }
}

export function newConversationId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/**
 * Inserts or replaces one conversation and returns the list newest-first.
 *
 * An assistant turn that never received text (a refused or failed stream) is not stored: on reopen
 * it would render as an answer that said nothing.
 */
export function upsertConversation(
  list: Conversation[],
  id: string,
  modelId: string,
  messages: ChatMessage[],
  now: number,
  paidBy?: string,
  budgetULXC?: number,
  /** B28.109 — a conversation stays in the project it was started in. */
  projectId?: string,
  /** B28.370 — the named prompt it uses; '' is none. */
  prompt?: string,
): Conversation[] {
  const kept = messages
    .filter((m) => !(m.role === 'assistant' && m.content === ''))
    // B18.24 — an attached document is kept whole: it is Lens's id for the file, never the file's bytes,
    // so a reopened conversation still references it.
  const prior = list.find((c) => c.id === id)
  const next: Conversation = {
    id,
    title: prior?.renamed ? prior.title : titleFrom(kept),
    renamed: prior?.renamed ?? false,
    model_id: modelId,
    ...(paidBy !== undefined && paidBy !== '' ? { paid_by: paidBy } : {}),
    ...(budgetULXC !== undefined ? { budget_ulxc: budgetULXC } : {}),
    ...((projectId ?? prior?.project_id) !== undefined ? { project_id: projectId ?? prior?.project_id } : {}),
    ...(prompt !== undefined && prompt !== '' ? { prompt } : {}),
    // B28.110 — a pin outlasts new turns; a question asked in an archived conversation brings it back to the list.
    ...(prior?.pinned ? { pinned: true as const } : {}),
    created_at: prior?.created_at ?? now,
    updated_at: now,
    messages: kept,
  }
  return [next, ...list.filter((c) => c.id !== id)]
}

/** B28.110 — the rail's three groups, each newest first: pinned, the rest, and archived. */
export function railGroups(list: Conversation[]): { pinned: Conversation[]; recent: Conversation[]; archived: Conversation[] } {
  return {
    pinned: list.filter((c) => c.pinned && !c.archived),
    recent: list.filter((c) => !c.pinned && !c.archived),
    archived: list.filter((c) => c.archived),
  }
}

/** B28.110 — pins or unpins one conversation. Pinned and archived exclude each other: pinning unarchives. */
export function setPinned(list: Conversation[], id: string, pinned: boolean): Conversation[] {
  return list.map((c) => {
    if (c.id !== id) return c
    const { pinned: _p, archived: _a, ...rest } = c
    return pinned ? { ...rest, pinned: true } : rest
  })
}

/** B28.110 — archives or unarchives one conversation; archiving unpins it. */
export function setArchived(list: Conversation[], id: string, archived: boolean): Conversation[] {
  return list.map((c) => {
    if (c.id !== id) return c
    const { pinned: _p, archived: _a, ...rest } = c
    return archived ? { ...rest, archived: true } : rest
  })
}

/** B28.108 — one conversation a search found, and the words around where it was found. */
export interface SearchHit {
  conversation: Conversation
  /** The turn the first word was found in, cut to a line; null when only the title shows it. */
  excerpt: { before: string; match: string; after: string } | null
}

const EXCERPT_BEFORE = 30
const EXCERPT_AFTER = 70

/**
 * B28.108 — the conversations that contain every word of the query, in the title or in any question
 * or answer, in the list's own order (newest first). Case is ignored. It reads the list this browser
 * already holds, so nothing leaves the browser to search it.
 */
export function searchConversations(list: Conversation[], query: string): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== '')
  if (words.length === 0) return []
  const hits: SearchHit[] = []
  for (const c of list) {
    const turns = c.messages.map((m) => m.content.replace(/\s+/g, ' '))
    const lowered = turns.map((t) => t.toLowerCase())
    const title = c.title.toLowerCase()
    if (!words.every((w) => title.includes(w) || lowered.some((t) => t.includes(w)))) continue
    hits.push({ conversation: c, excerpt: excerptOf(turns, lowered, words, c.title) })
  }
  return hits
}

/** The first turn holding any of the words, earliest word first, with a little either side. A turn that is the
 *  title word for word is passed over: the title above the excerpt already shows it. */
function excerptOf(turns: string[], lowered: string[], words: string[], title: string): SearchHit['excerpt'] {
  for (const w of words) {
    for (const [i, turn] of turns.entries()) {
      const low = lowered[i] ?? ''
      const at = low.indexOf(w)
      if (at < 0 || turn.trim() === title) continue
      // Lower-casing can change a string's length (İ → i̇); then the lowered text is what is shown.
      const text = turn.length === low.length ? turn : low
      const from = Math.max(0, at - EXCERPT_BEFORE)
      const to = Math.min(text.length, at + w.length + EXCERPT_AFTER)
      return {
        before: (from > 0 ? '…' : '') + text.slice(from, at).trimStart(),
        match: text.slice(at, at + w.length),
        after: text.slice(at + w.length, to).trimEnd() + (to < text.length ? '…' : ''),
      }
    }
  }
  return null
}
