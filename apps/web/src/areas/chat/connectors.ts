// CONNECTORS — B28.122. The person's own MCP servers, whose tools Chat offers the model beside Talyvor's own. Added on
// /chat/connectors by address, with the token the server wants if any, and kept in this browser beside the
// conversations and custom instructions (history.ts, customInstructions.ts), under the same signed-in scope: they are
// the person's own. The BFF reaches each one for Chat (apps/bff/chat_connectors.go): it lists a connector's tools, and
// runs a call the model made with one. Every call is put to the person first (StreamHandlers.onConfirm), whatever the
// server says of its tool: its arguments are sent to a server outside Talyvor, and they could carry what the chat
// holds — the person's Lens, Track or Docs data, or a document they attached. Under the answer, each call is listed
// with what it cost: the request to the model that read its answer.

import { ApiError } from '../../lib/api'
import type { ChatTool, ToolCall, ToolResult } from './chatApi'
import type { Usage } from './chatStream'

const KEY_PREFIX = 'talyvor.chat.connectors.v1:'

export function connectorsKey(scope: string): string {
  return KEY_PREFIX + scope
}

export interface Connector {
  id: string
  name: string
  url: string
  /** What the server wants in `Authorization: Bearer …`; absent when it wants none. */
  token?: string
  added_at: number
}

/** What was read from storage. `error` set means UNREADABLE, which is not the same as none. */
export interface Connectors {
  list: Connector[]
  error: string | null
}

function isConnector(c: unknown): c is Connector {
  if (typeof c !== 'object' || c === null) return false
  const { id, name, url, token, added_at } = c as Record<string, unknown>
  return typeof id === 'string' && typeof name === 'string' && typeof url === 'string' && (token === undefined || typeof token === 'string') && typeof added_at === 'number'
}

export function loadConnectors(scope: string): Connectors {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(connectorsKey(scope))
  } catch {
    return { list: [], error: 'This browser refused to let the console read its storage.' }
  }
  if (raw === null) return { list: [], error: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  return Array.isArray(parsed) ? { list: parsed.filter(isConnector), error: null } : { list: [], error: 'The connectors saved in this browser are unreadable.' }
}

/** Returns false when the browser refused the write (quota, private mode) so the screen can say so. */
export function saveConnectors(scope: string, list: Connector[]): boolean {
  try {
    if (list.length === 0) window.localStorage.removeItem(connectorsKey(scope))
    else window.localStorage.setItem(connectorsKey(scope), JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/** Talyvor test tools: a connector to try connectors with, on this app's own origin (apps/bff testToolsPath). Its one
 *  tool, fingerprint, answers the first 12 hex digits of a text's SHA-256, which no model can work out without it. */
export const TEST_TOOLS_PATH = '/mcp/test-tools'
export const TEST_TOOLS_NAME = 'Talyvor test tools'

export function testToolsURL(origin: string = window.location.origin): string {
  return origin + TEST_TOOLS_PATH
}

/** One of a connector's tools, as the BFF lists it. */
export interface ConnectorTool {
  name: string
  description: string
  input_schema: unknown
}

/** A connector's name for itself and its tools. */
export interface ConnectorListing {
  server: string
  tools: ConnectorTool[]
}

const TOOLS_PATH = '/api/chat/connectors/tools'
const CALL_PATH = '/api/chat/connectors/call'

/** What the BFF said when it could not list a connector's tools, in its own sentence. */
export class ConnectorError extends ApiError {
  constructor(status: number, sentence: string) {
    super(status, TOOLS_PATH)
    this.message = sentence
  }
}

const SENT = { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' } } as const

/** The BFF's answer: its status, and its JSON body as an object (empty when it is not one). */
async function answered(res: Response): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const parsed: unknown = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body: typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {} }
}

/** The connector's tools. Throws a ConnectorError whose message says why it could not list them. */
export async function fetchConnectorTools(c: Pick<Connector, 'url' | 'token'>, signal?: AbortSignal): Promise<ConnectorListing> {
  const got = await answered(await fetch(TOOLS_PATH, { ...SENT, body: JSON.stringify({ url: c.url, ...(c.token !== undefined ? { token: c.token } : {}) }), signal }))
  if (!got.ok) throw new ConnectorError(got.status, typeof got.body.error === 'string' ? got.body.error : `The connector could not be read (${got.status}).`)
  const tools = Array.isArray(got.body.tools)
    ? got.body.tools.filter((t): t is ConnectorTool => typeof t?.name === 'string' && typeof t?.description === 'string' && typeof t?.input_schema === 'object')
    : []
  return { server: typeof got.body.server === 'string' ? got.body.server : '', tools }
}

/** Which connector a tool Chat offers is, and the tool's own name there. Only Chat reads it; the model never does. */
export interface ConnectorRef {
  name: string
  url: string
  token?: string
  tool: string
}

/** Runs one call the model made with a connector's tool. Every failure is a result the model is told, never a throw. */
export async function callConnectorTool(c: ConnectorRef, call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
  let args: unknown
  try {
    args = call.args.trim() === '' ? {} : JSON.parse(call.args)
  } catch {
    return { text: 'The arguments were not valid JSON.', is_error: true }
  }
  try {
    const got = await answered(
      await fetch(CALL_PATH, { ...SENT, body: JSON.stringify({ url: c.url, ...(c.token !== undefined ? { token: c.token } : {}), name: c.tool, arguments: args }), signal }),
    )
    if (!got.ok) return { text: typeof got.body.error === 'string' ? got.body.error : `The connector could not run it (${got.status}).`, is_error: true }
    return { text: typeof got.body.text === 'string' ? got.body.text : '', is_error: got.body.is_error === true }
  } catch {
    return { text: 'The connector could not be reached.', is_error: true }
  }
}

/** Letters, digits, `_` and `-`, at most 64: the tool names every provider Chat offers tools to takes. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tool'
}

/** The name the model calls a connector's tool by: the connector's and the tool's, unlike any name already `taken`. */
export function modelToolName(connector: string, tool: string, taken: ReadonlySet<string>): string {
  const base = `${slug(connector).slice(0, 24)}__${slug(tool)}`.slice(0, 60)
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
  return name
}

/** Every connector's tools as Chat offers them to the model. A connector that cannot list its tools just now offers none. */
export async function connectorChatTools(list: Connector[], taken: readonly string[] = [], signal?: AbortSignal): Promise<ChatTool[]> {
  const listed = await Promise.all(list.map((c) => fetchConnectorTools(c, signal).catch(() => undefined)))
  const names = new Set(taken)
  const offered: ChatTool[] = []
  list.forEach((c, i) => {
    for (const t of listed[i]?.tools ?? []) {
      const name = modelToolName(c.name, t.name, names)
      names.add(name)
      offered.push({
        name,
        description: `${t.description} (from the connector ${c.name})`.trim(),
        input_schema: t.input_schema,
        product: 'connector',
        // Asked first, always: a server's own readOnlyHint is not the person's consent to send it what the chat holds.
        writes: true,
        connector: { name: c.name, url: c.url, ...(c.token !== undefined ? { token: c.token } : {}), tool: t.name },
      })
    }
  })
  return offered
}

/** B28.122 — one call an answer made with a connector's tool, and what the request to the model that read its answer
 *  cost: Lens's charge when it said, else its tokens, priced as the answer is (Chat.tsx sets `usd`). */
export interface ConnectorCall {
  connector: string
  tool: string
  /** The tool answered; false when it refused, could not be reached, or the person said no. */
  ok: boolean
  charged_ulxc?: number
  usage?: Usage
  usd?: number
  /** How many calls that one request read the answers of, when more than one: the cost is theirs together. */
  shared?: number
}
