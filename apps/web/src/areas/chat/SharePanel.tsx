import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, focusRing, inlineLink } from '@talyvor/ui'

import { ApiError } from '../../lib/api'
import { formatWhen } from '../lens/format'
import { CopyButton } from './CopyButton'
import type { Conversation } from './history'

// B28.127 — a chat shared as a link. Share, beside the open conversation's name, hands Lens a copy of its questions
// and answers and gives back a link anyone can open signed out (/share/{token}, areas/share/SharedChat.tsx). Turn off link deletes
// the copy, and the link then answers 404. The chat itself stays in this browser; the copy is the one thing of it a
// server keeps, and only while the link is on. The routes are apps/bff/chat_shares.go's.

/** One live link, as GET and POST /api/chat/shares answer it. The token is the whole credential.
 *  UPSTREAM-ONLY ChatShare: workspace_id, messages */
export interface ChatShare {
  id: string
  token: string
  conversation_id: string
  title: string
  created_at: string
}

/** What a share sends: the conversation it is of, its title, and each question and answer as shown. */
export interface ChatShareBody {
  conversation_id: string
  title: string
  messages: { role: 'user' | 'assistant'; content: string }[]
}

export const CHAT_SHARES_KEY = ['chat-shares'] as const

/** The address a stranger opens. */
export function shareURL(token: string): string {
  return `${window.location.origin}/share/${token}`
}

/** The copy a share sends: the thread as it is shown, each turn's words and nothing else of it — no costs, no
 *  attachments, no other versions. An answer that said nothing is left out. */
export function shareBody(c: Conversation): ChatShareBody {
  return {
    conversation_id: c.id,
    title: c.title,
    messages: c.messages.filter((m) => m.content.trim() !== '').map((m) => ({ role: m.role, content: m.content })),
  }
}

async function answer(res: Response, path: string): Promise<unknown> {
  if (!res.ok) throw new ApiError(res.status, path)
  return res.json()
}

export const chatSharesApi = {
  list: async (): Promise<ChatShare[]> => {
    const body = await answer(await fetch('/api/chat/shares', { headers: { Accept: 'application/json' } }), '/api/chat/shares')
    return Array.isArray(body) ? (body as ChatShare[]) : []
  },
  create: async (b: ChatShareBody): Promise<ChatShare> => {
    const res = await fetch('/api/chat/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(b),
    })
    return (await answer(res, '/api/chat/shares')) as ChatShare
  },
  revoke: async (id: string): Promise<void> => {
    const path = `/api/chat/shares/${encodeURIComponent(id)}`
    await answer(await fetch(path, { method: 'DELETE', headers: { Accept: 'application/json' } }), path)
  },
}

export function SharePanel({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const qc = useQueryClient()
  const links = useQuery({ queryKey: CHAT_SHARES_KEY, queryFn: chatSharesApi.list, retry: false })
  const create = useMutation({
    mutationFn: () => chatSharesApi.create(shareBody(conversation)),
    onSettled: () => qc.invalidateQueries({ queryKey: CHAT_SHARES_KEY }),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => chatSharesApi.revoke(id),
    onSettled: () => qc.invalidateQueries({ queryKey: CHAT_SHARES_KEY }),
  })
  const all = links.data ?? []
  const mine = all.find((l) => l.conversation_id === conversation.id)
  const others = all.filter((l) => l.conversation_id !== conversation.id)
  const unavailable = links.error instanceof ApiError && links.error.status === 404
  const asked = conversation.messages.some((m) => m.role === 'user' && m.content.trim() !== '')

  return (
    <section aria-label="Share this chat" className="mt-2 flex flex-col gap-3 rounded-card border border-rule bg-raised p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-body font-medium text-ink">Share this chat</h3>
        <button type="button" className={`text-caption text-muted transition-colors duration-200 hover:text-ink ${focusRing}`} onClick={onClose}>
          Done
        </button>
      </div>
      <p className="max-w-prose text-caption text-muted">
        Anyone with the link can read this chat as it is now, without signing in: its questions and answers, nothing else.
        Talyvor keeps that copy until you turn the link off. Questions you ask after sharing are not added.
      </p>

      {links.isPending ? (
        <p className="text-caption text-muted">Reading your shared links…</p>
      ) : unavailable ? (
        <p className="text-caption text-ink" role="alert">
          Sharing is not available here yet.
        </p>
      ) : links.isError ? (
        <p className="text-caption text-ink" role="alert">
          Your shared links could not be read just now, so none can be made or turned off. Try again in a moment.
        </p>
      ) : mine !== undefined ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            readOnly
            aria-label="Link to this chat"
            value={shareURL(mine.token)}
            onFocus={(e) => e.currentTarget.select()}
            className={`min-w-0 flex-1 basis-full rounded-control border border-rule bg-canvas px-2 py-1 font-mono text-caption text-ink transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 wide:basis-0 ${focusRing}`}
          />
          <CopyButton text={shareURL(mine.token)} label="Copy link" />
          <a className={`text-caption ${inlineLink}`} href={`/share/${mine.token}`} target="_blank" rel="noreferrer">
            Open
          </a>
          <Button disabled={revoke.isPending} onClick={() => revoke.mutate(mine.id)}>
            {revoke.isPending ? 'Turning off…' : 'Turn off link'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          {revoke.isSuccess ? (
            <p className="text-caption text-ink" role="status">
              The link is off. Anyone who opens it now finds nothing there.
            </p>
          ) : null}
          <Button variant="primary" disabled={create.isPending || !asked} onClick={() => create.mutate()}>
            {create.isPending ? 'Making the link…' : 'Create link'}
          </Button>
        </div>
      )}

      {create.isError ? (
        <p className="text-caption text-ink" role="alert">
          {create.error instanceof ApiError && create.error.status === 413
            ? 'This chat is too long to share — nothing was shared.'
            : 'The link wasn’t made — nothing was shared. Try again.'}
        </p>
      ) : null}
      {revoke.isError ? (
        <p className="text-caption text-ink" role="alert">
          The link wasn’t turned off — it still works. Try again.
        </p>
      ) : null}

      {others.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-rule pt-3">
          <p className="text-caption text-muted">Other chats shared from this workspace</p>
          <ul aria-label="Other shared chats" className="flex flex-col gap-2">
            {others.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 truncate text-caption text-ink">{l.title}</span>
                <span className="font-figure text-caption text-muted">{formatWhen(l.created_at)}</span>
                <a className={`text-caption ${inlineLink}`} href={`/share/${l.token}`} target="_blank" rel="noreferrer">
                  Open
                </a>
                <Button disabled={revoke.isPending} onClick={() => revoke.mutate(l.id)}>
                  Turn off
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
