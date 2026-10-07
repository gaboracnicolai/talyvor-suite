import { ApiError, UnreadableError } from '../../lib/api'

// PROMPT LIBRARY — B28.370. The workspace's named prompts, kept in Lens and used from Chat by name:
//
//   GET  /api/chat/prompts                       the workspace's prompts, each at its active version
//   POST /api/chat/prompts {name, content, description}   saves a new one
//
// A chat that uses one sends, in place of the prompt's text, a system message of exactly "lens:prompt:<name>". Lens
// swaps in the prompt's active version before the model reads it and answers with X-Talyvor-Prompt-Resolved: true,
// so a prompt changed in Lens is what the next question is sent with, and the answer says it was used.

/** One prompt as the library lists it: its active version. */
export interface ChatPrompt {
  name: string
  version: number
  description: string
  content: string
  updated_at?: string
}

/** What Lens reads a system message as a named prompt by (talyvor-lens internal/prompts Resolve). */
export const PROMPT_REFERENCE_PREFIX = 'lens:prompt:'

/** Lens's answer saying it swapped the named prompt in. */
export const PROMPT_RESOLVED_HEADER = 'X-Talyvor-Prompt-Resolved'

/** The shape of a name the library saves; apps/bff/chat_prompts.go refuses any other. */
export const PROMPT_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

/** The system message a request names `name` by. */
export function promptReference(name: string): string {
  return PROMPT_REFERENCE_PREFIX + name
}

export const PROMPTS_KEY = ['chat-prompts'] as const

const PROMPTS_PATH = '/api/chat/prompts'

/** Why the library could not be read or a prompt saved, in a sentence the page shows as it is. */
export class PromptLibraryError extends ApiError {
  constructor(status: number, sentence: string) {
    super(status, PROMPTS_PATH)
    this.message = sentence
  }
}

/** The workspace's prompts, by name. Throws with what went wrong when they could not be read. */
export async function fetchPrompts(): Promise<ChatPrompt[]> {
  const res = await fetch(PROMPTS_PATH, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
  const body = (await res.json().catch(() => ({}))) as { prompts?: unknown }
  if (!res.ok) throw new PromptLibraryError(res.status, 'Your prompts could not be read just now.')
  if (!Array.isArray(body.prompts)) throw new UnreadableError(PROMPTS_PATH)
  return (body.prompts as ChatPrompt[])
    .filter((p) => typeof p?.name === 'string' && typeof p.content === 'string')
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Saves a new prompt and returns it as Lens stored it. Throws with Lens's or the BFF's words when it was not saved. */
export async function savePrompt(name: string, content: string, description: string): Promise<ChatPrompt> {
  const res = await fetch(PROMPTS_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name, content, description }),
  })
  const body = (await res.json().catch(() => ({}))) as Partial<ChatPrompt> & { error?: unknown }
  if (!res.ok) throw new PromptLibraryError(res.status, typeof body.error === 'string' && res.status < 500 ? body.error : 'Lens did not save the prompt just now.')
  if (body.name !== name) throw new UnreadableError(PROMPTS_PATH)
  return body as ChatPrompt
}
