// B28.135 — how the command palette and the keyboard shortcuts reach into Chat from any screen: an address,
// /chat?action=new|search|model (and q, the words to search for). Chat does it once who is signed in is known,
// as it does ?prompt=, and drops it from the address, so a reload does not do it again.

export const CHAT_ACTIONS = ['new', 'search', 'model'] as const
export type ChatAction = (typeof CHAT_ACTIONS)[number]

export function chatActionHref(action: ChatAction, q = ''): string {
  const params = new URLSearchParams({ action })
  if (q !== '') params.set('q', q)
  return `/chat?${params.toString()}`
}

/** The action an address asks Chat for; anything else asks for nothing. */
export function readChatAction(params: URLSearchParams): ChatAction | null {
  const action = params.get('action')
  return (CHAT_ACTIONS as readonly string[]).includes(action ?? '') ? (action as ChatAction) : null
}
