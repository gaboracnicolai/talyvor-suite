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
  created_at: number
  updated_at: number
  /** B28.365 — when this browser last saved a change to it (a rename too, which leaves updated_at); syncs merge by it. */
  changed_at?: number
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
    created_at: prior?.created_at ?? now,
    updated_at: now,
    messages: kept,
  }
  return [next, ...list.filter((c) => c.id !== id)]
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
