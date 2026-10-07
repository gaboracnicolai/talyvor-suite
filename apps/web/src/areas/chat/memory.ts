// MEMORY — B28.371 (B28.117's Chat side). Facts the person asked Chat to remember ("Remember that I run a design
// studio"), sent with every question in every chat once memory is turned on. Off until they turn it on; every fact is
// listed on /chat/memory and deleted there. Kept in this browser beside the conversations and custom instructions
// (history.ts, customInstructions.ts), under the same signed-in scope: they are the person's own words.

const KEY_PREFIX = 'talyvor.chat.memory.v1:'

export function memoryKey(scope: string): string {
  return KEY_PREFIX + scope
}

export interface RememberedFact {
  id: string
  text: string
  saved_at: number
}

/** What was read from storage. `error` set means UNREADABLE, which is not the same as nothing remembered. */
export interface Memory {
  on: boolean
  facts: RememberedFact[]
  error: string | null
}

export const NO_MEMORY: Memory = { on: false, facts: [], error: null }

function isFact(f: unknown): f is RememberedFact {
  if (typeof f !== 'object' || f === null) return false
  const { id, text, saved_at } = f as Record<string, unknown>
  return typeof id === 'string' && typeof text === 'string' && typeof saved_at === 'number'
}

export function loadMemory(scope: string): Memory {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(memoryKey(scope))
  } catch {
    return { ...NO_MEMORY, error: 'This browser refused to let the console read its storage.' }
  }
  if (raw === null) return NO_MEMORY
  try {
    const parsed: unknown = JSON.parse(raw)
    const { on, facts } = (parsed ?? {}) as { on?: unknown; facts?: unknown }
    if (typeof on !== 'boolean' || !Array.isArray(facts) || !facts.every(isFact)) throw new Error('not memory')
    return { on, facts, error: null }
  } catch {
    return { ...NO_MEMORY, error: 'What Chat remembers in this browser is unreadable.' }
  }
}

/** Returns false when the browser refused the write (quota, private mode) so the screen can say so. */
export function saveMemory(scope: string, memory: Pick<Memory, 'on' | 'facts'>): boolean {
  try {
    if (!memory.on && memory.facts.length === 0) window.localStorage.removeItem(memoryKey(scope))
    else window.localStorage.setItem(memoryKey(scope), JSON.stringify({ on: memory.on, facts: memory.facts }))
    return true
  } catch {
    return false
  }
}

/** The fact added, newest first; the same words twice are kept once. */
export function remember(memory: Memory, text: string, now: number): Memory {
  const fact = text.trim()
  if (fact === '') return memory
  const rest = memory.facts.filter((f) => f.text.toLowerCase() !== fact.toLowerCase())
  return { ...memory, facts: [{ id: `m-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, text: fact, saved_at: now }, ...rest] }
}

export function forget(memory: Memory, id: string): Memory {
  return { ...memory, facts: memory.facts.filter((f) => f.id !== id) }
}

/** What every question is sent with: '' while memory is off or holds nothing. */
export function memoryInstructions(memory: Memory): string {
  if (!memory.on || memory.facts.length === 0) return ''
  return ['What the person you are talking to asked you to remember about them:', ...memory.facts.map((f) => `- ${f.text}`)].join('\n')
}

const REMEMBER = /^\s*(?:please\s+)?remember(?:\s+that\b|\s+this\s*:|\s*:)\s*(.+?)\s*$/is

/**
 * The fact in "Remember that …", "Remember: …" or "Remember this: …", or null when the question is not one; anything
 * else ("Remember when …?", "Remember that time we …?") still goes to the model: a question is not a fact.
 */
export function parseRemember(question: string): string | null {
  const m = REMEMBER.exec(question)
  if (m === null || m[1].endsWith('?')) return null
  const fact = m[1].replace(/[.!]+$/, '').trim()
  return fact === '' ? null : fact
}

export const isRememberCommand = (question: string) => parseRemember(question) !== null
