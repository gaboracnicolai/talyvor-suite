import type { ChatMessage } from './chatApi'
import { type Conversation, titleFrom } from './history'
import { editedAt } from './historySync'

// B28.128 — EXPORT AND IMPORT. Conversations are kept in this browser (history.ts). Export hands the person a file of
// them, whole — every question and answer with its price, its charge, its statement lines and its other versions — and
// Import, in any browser, puts them in that browser's list, where they read and add up as they did. The file goes from
// the browser to the person's disk and back; nothing of it is sent anywhere.
//
// ⚠ AN IMPORTED FILE IS NOT TRUSTED. It may have come from someone else, so only the fields a conversation and its turns
// are kept with are read from it, each only when it is the shape the screen reads it as (a malformed price would break
// the screen every time the conversation opened), a turn only when it is a question or an answer in words, and a web
// source under an answer only when its address is http(s), since the screen links it.

export const EXPORT_FORMAT = 'talyvor.chat.conversations'
export const EXPORT_VERSION = 1

/** What Export writes and Import reads. */
export interface ConversationsFile {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exported_at: string
  conversations: Conversation[]
}

/** The file Export downloads: the conversations exactly as this browser keeps them. */
export function exportFile(list: Conversation[], now: number): string {
  const file: ConversationsFile = { format: EXPORT_FORMAT, version: EXPORT_VERSION, exported_at: new Date(now).toISOString(), conversations: list }
  return JSON.stringify(file, null, 2) + '\n'
}

/** "talyvor-chat-capital-of-japan-2026-10-08.json" for one conversation, "talyvor-chats-2026-10-08.json" for several. */
export function exportName(list: Conversation[], now: number): string {
  const day = new Date(now).toISOString().slice(0, 10)
  const only = list.length === 1 ? list[0] : undefined
  if (only === undefined) return `talyvor-chats-${day}.json`
  const slug = only.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return `talyvor-chat-${slug === '' ? 'conversation' : slug}-${day}.json`
}

const NOT_AN_EXPORT = 'That file is not a Talyvor Chat export.'

/** The conversations a file holds, each as this browser would keep it, or why it holds none: a sentence the screen shows. */
export function readExport(text: string, now: number): { conversations: Conversation[] } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: NOT_AN_EXPORT }
  }
  const file = parsed as Partial<ConversationsFile> | null
  if (file === null || typeof file !== 'object' || file.format !== EXPORT_FORMAT || !Array.isArray(file.conversations)) {
    return { error: NOT_AN_EXPORT }
  }
  if (file.version !== EXPORT_VERSION) return { error: 'That export was written by a version of Talyvor Chat this one cannot read.' }
  return {
    conversations: file.conversations.flatMap((c) => {
      const one = conversationOf(c, now)
      return one === undefined ? [] : [one]
    }),
  }
}

// What each kept field must be. A key ending in "?" may be absent; any field not named here is not kept, and a field that
// is not its shape is dropped, so nothing the screen reads as a number or a link arrives as anything else.
type Check = 'string' | 'number' | 'boolean' | ((v: unknown) => boolean)
type Shape = Record<string, Check>

function fits(v: unknown, shape: Shape): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.entries(shape).every(([key, check]) => {
    const optional = key.endsWith('?')
    const x = (v as Record<string, unknown>)[optional ? key.slice(0, -1) : key]
    if (x === undefined) return optional
    return typeof check === 'function' ? check(x) : typeof x === check && (check !== 'number' || Number.isFinite(x))
  })
}

const shaped = (shape: Shape) => (v: unknown) => fits(v, shape)
const listOf = (check: (v: unknown) => boolean) => (v: unknown) => Array.isArray(v) && v.every(check)
const oneOf = (...values: unknown[]) => (v: unknown) => values.includes(v)
const webAddress = (v: unknown) => typeof v === 'string' && /^https?:\/\//i.test(v)

/** Every field a turn is kept with, as chatApi.ts's ChatMessage declares it; `versions` is read turn by turn. */
const TURN: Shape = {
  'cost?': shaped({ model: 'string', input_tokens: 'number', output_tokens: 'number', usd: 'number' }),
  'attachments?': listOf(
    shaped({
      name: 'string',
      media_type: 'string',
      size: 'number',
      'file_id?': 'string',
      'docs_page?': shaped({ space_id: 'string', page_id: 'string' }),
      'track_issue?': shaped({ id: 'string', identifier: 'string' }),
    }),
  ),
  'converted?': 'boolean',
  'source?': (v) =>
    fits(v, { kind: oneOf('cache', 'own_key'), 'saved_ulxc?': 'number' }) ||
    fits(v, { kind: oneOf('pool'), discount_rate: 'number', charged_ulxc: 'number', 'saved_ulxc?': 'number' }),
  'saved?': shaped({ tokens: 'number', bytes: 'number' }),
  'tare?': shaped({ 'tokens?': 'number' }),
  'request_id?': 'string',
  'marked_wrong?': 'boolean',
  'incomplete?': oneOf('blank', 'cut_off'),
  'spend?': listOf(shaped({ agent_id: 'string', agent: 'string', entry_id: 'string', amount_ulxc: 'number', 'at?': 'string', 'label?': 'string' })),
  'requests?': 'number',
  'payer?': shaped({ agent_id: 'string', name: 'string', billed: 'boolean' }),
  'charged_ulxc?': 'number',
  'auto?': 'boolean',
  'version?': 'number',
  'prompt?': shaped({ name: 'string', resolved: 'boolean' }),
  'code_runs?': listOf(shaped({ language: 'string', code: 'string', stdout: 'string', stderr: 'string', exit_code: 'number', 'timed_out?': 'boolean' })),
  'artifact_edits?': (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string'),
  'tools_used?': listOf((x) => typeof x === 'string'),
  'filed?': listOf(shaped({ id: 'string', identifier: 'string', title: 'string' })),
  'connector_calls?': listOf(
    shaped({
      connector: 'string',
      tool: 'string',
      ok: 'boolean',
      'charged_ulxc?': 'number',
      'usage?': shaped({ 'input_tokens?': 'number', 'output_tokens?': 'number' }),
      'usd?': 'number',
      'shared?': 'number',
    }),
  ),
}

/** Every field a conversation is kept with besides its id, title, turns and times, as history.ts declares them. */
const CONVERSATION: Shape = {
  'renamed?': 'boolean',
  'model_id?': 'string',
  'paid_by?': 'string',
  'budget_ulxc?': 'number',
  'project_id?': 'string',
  'prompt?': 'string',
  'pool_off?': oneOf(true),
  'pinned?': oneOf(true),
  'archived?': oneOf(true),
}

/** The fields of `v` `shape` names, each kept only when it is its shape. */
function kept(v: Record<string, unknown>, shape: Shape): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, check] of Object.entries(shape)) {
    const name = key.replace(/\?$/, '')
    if (v[name] !== undefined && fits({ [name]: v[name] }, { [name]: check })) out[name] = v[name]
  }
  return out
}

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

function conversationOf(v: unknown, now: number): Conversation | undefined {
  if (v === null || typeof v !== 'object') return undefined
  const c = v as Record<string, unknown>
  if (typeof c.id !== 'string' || c.id === '' || !Array.isArray(c.messages) || !isTime(c.created_at) || !isTime(c.updated_at)) return undefined
  const messages = turnsOf(c.messages)
  // A copy from the future would win every later merge; it is no later than now.
  const at = (t: number) => Math.min(t, now)
  return {
    ...(kept(c, CONVERSATION) as Partial<Conversation>),
    id: c.id,
    title: typeof c.title === 'string' && c.title.trim() !== '' ? c.title : titleFrom(messages),
    renamed: c.renamed === true,
    model_id: typeof c.model_id === 'string' ? c.model_id : '',
    created_at: at(c.created_at),
    updated_at: at(c.updated_at),
    ...(isTime(c.changed_at) ? { changed_at: at(c.changed_at) } : {}),
    messages,
  }
}

function turnsOf(list: readonly unknown[]): ChatMessage[] {
  return list.flatMap((v): ChatMessage[] => {
    if (v === null || typeof v !== 'object') return []
    const m = v as Record<string, unknown>
    if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return []
    const turn = { ...kept(m, TURN), role: m.role, content: m.content } as ChatMessage
    if (Array.isArray(m.versions)) turn.versions = m.versions.filter(Array.isArray).map(turnsOf)
    // One source the screen cannot link takes only itself away, not the answer's others.
    if (Array.isArray(m.citations)) turn.citations = m.citations.filter((x) => fits(x, { n: 'number', url: webAddress, 'title?': 'string' }))
    return [turn]
  })
}

/** What an import did to the list. */
export interface Imported {
  list: Conversation[]
  /** Not in this browser before. */
  added: number
  /** Here before, and the file's copy was edited later, so it replaced this browser's. */
  updated: number
  /** Here already, as edited or later; this browser's copy is kept. */
  already: number
}

/** `incoming` put into `list`, newest first. Per conversation the later edit wins, as a sync does; a tie keeps this
 *  browser's, so importing the same file twice changes nothing. */
export function importInto(list: Conversation[], incoming: readonly Conversation[]): Imported {
  const before = new Map(list.map((c) => [c.id, c]))
  const byId = new Map(before)
  for (const c of incoming) {
    const prior = byId.get(c.id)
    if (prior === undefined || editedAt(c) > editedAt(prior)) byId.set(c.id, c)
  }
  let added = 0
  let updated = 0
  let already = 0
  for (const id of new Set(incoming.map((c) => c.id))) {
    const was = before.get(id)
    if (was === undefined) added++
    else if (byId.get(id) !== was) updated++
    else already++
  }
  return { list: [...byId.values()].sort((a, b) => b.updated_at - a.updated_at), added, updated, already }
}
