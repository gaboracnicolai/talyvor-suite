// CUSTOM INSTRUCTIONS — B28.115. What the person tells the model in every chat they start ("Answer in French"), set
// once. Kept in this browser beside the conversations and projects (history.ts, projects.ts), under the same
// signed-in scope, for the same reason: they are the person's own words and Lens stores none of them.

const KEY_PREFIX = 'talyvor.chat.instructions.v1:'

export function customInstructionsKey(scope: string): string {
  return KEY_PREFIX + scope
}

/** What was read from storage. `error` set means UNREADABLE, which is not the same as none. */
export interface CustomInstructions {
  text: string
  error: string | null
}

export function loadCustomInstructions(scope: string): CustomInstructions {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(customInstructionsKey(scope))
  } catch {
    return { text: '', error: 'This browser refused to let the console read its storage.' }
  }
  if (raw === null) return { text: '', error: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { text?: unknown }).text !== 'string') throw new Error('not instructions')
    return { text: (parsed as { text: string }).text, error: null }
  } catch {
    return { text: '', error: 'The custom instructions saved in this browser are unreadable.' }
  }
}

/** '' removes them. Returns false when the browser refused the write (quota, private mode) so the screen can say so. */
export function saveCustomInstructions(scope: string, text: string, now: number): boolean {
  const told = text.trim()
  try {
    if (told === '') window.localStorage.removeItem(customInstructionsKey(scope))
    else window.localStorage.setItem(customInstructionsKey(scope), JSON.stringify({ text: told, updated_at: now }))
    return true
  } catch {
    return false
  }
}

/** What a question is sent with: the person's own instructions first, then what Chat remembers about them (B28.371,
 *  memory.ts), then the project's; '' is none. */
export function instructionsFor(custom: string, project: string | undefined, remembered = ''): string {
  return [custom.trim(), remembered.trim(), (project ?? '').trim()].filter((t) => t !== '').join('\n\n')
}
