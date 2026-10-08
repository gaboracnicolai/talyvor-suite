import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { useDocumentTitle } from '../../documentTitle'
import { ApiError } from '../../lib/api'
import { SiteFooter, SiteHeader } from '../../components/SiteChrome'
import { TealRule } from '../marketing/Landing'
import { formatWhen } from '../lens/format'
import { Markdown } from '../chat/Markdown'

// B28.127 — a chat its person shared as a link, opened by anyone who has it, signed out. OUTSIDE the AuthGate (App.tsx)
// for the same reason as a published board: the reader has no account. Read-only by construction — the turns are text,
// and the BFF route it reads answers GET alone. Once the link is turned off the BFF answers this address 404 and the
// page says the chat is not there.

/** GET /api/public/chats/{token}: the copy Lens keeps, answered signed out.
 *  UPSTREAM-ONLY SharedChatView: none */
export interface SharedChatView {
  title: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  created_at: string
}

async function readChat(token: string): Promise<SharedChatView> {
  const path = `/api/public/chats/${encodeURIComponent(token)}`
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as SharedChatView
}

function Body({ token }: { token: string }) {
  const chat = useQuery({ queryKey: ['shared-chat', token], queryFn: () => readChat(token), retry: false })

  if (chat.isLoading) {
    // No heading until the chat has answered: the page's one h1 names the chat, not a spinner.
    return <p className="text-body text-muted">Reading the chat…</p>
  }
  if (chat.isError || !chat.data) {
    const gone = chat.error instanceof ApiError && chat.error.status === 404
    return (
      <>
        <h1 className="text-display-3 text-ink">{gone ? 'This chat isn’t available' : 'The chat couldn’t be read'}</h1>
        <TealRule className="mt-5" />
        <p className="mt-5 max-w-lg text-reading text-muted">
          {gone
            ? 'The link may be mistyped, or whoever shared it has turned it off. Ask them for a new one.'
            : 'Talyvor didn’t answer just now, so nothing is shown rather than something stale. Try again in a moment.'}
        </p>
      </>
    )
  }

  const c = chat.data
  return (
    <>
      <p className="text-eyebrow uppercase text-label">Shared chat · read-only</p>
      <h1 className="mt-4 text-display-3 text-ink">{c.title}</h1>
      <TealRule className="mt-5" />
      <p className="mt-5 max-w-lg text-reading text-muted">
        Shared from Talyvor Chat on <span className="font-figure">{formatWhen(c.created_at)}</span>, as it was then. Whoever
        shared it can turn the link off at any time.
      </p>
      <ol aria-label="The conversation" className="mt-10 max-w-3xl space-y-8">
        {c.messages.map((m, i) => (
          // The index is the identity: the copy is fixed, and two turns can carry the same words.
          <li key={i} data-testid={m.role === 'user' ? 'shared-turn-user' : 'shared-turn-assistant'} className={m.role === 'user' ? 'flex flex-col items-end' : undefined}>
            {m.role === 'user' ? (
              <div className="max-w-prose rounded-card border border-rule bg-raised px-4 py-3 text-reading text-ink">
                <span className="sr-only">Question: </span>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ) : (
              <div>
                <span className="sr-only">Answer: </span>
                <Markdown source={m.content} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </>
  )
}

const FOOTER_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
]

export function SharedChat() {
  useDocumentTitle('Shared chat')
  const { token = '' } = useParams()
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      <SiteHeader product="Chat" />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-gutter py-12">
          <Body token={token} />
        </div>
      </main>

      <SiteFooter links={FOOTER_LINKS} />
    </div>
  )
}
