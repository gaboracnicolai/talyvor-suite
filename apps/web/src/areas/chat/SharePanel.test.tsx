import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import type { Conversation } from './history'
import { type ChatShare, SharePanel } from './SharePanel'

// B28.127 — a revocable share link. The BFF is mocked at the wire. Share sends the chat's words and nothing else of it,
// the link it gets back is shown to copy, and Turn off link deletes it; a stranger opening the link reads the chat, and
// once it is off, a page that says it is not there. That the link itself answers 404 once it is off is the BFF's
// TestChatShareLinkIsGoneOnceTurnedOff and the e2e scenario chat-share-link.

const TOKEN = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFi'

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })

const CONVERSATION: Conversation = {
  id: 'c-1',
  title: 'Capital of France',
  renamed: false,
  model_id: 'claude-opus-5',
  created_at: 1,
  updated_at: 2,
  messages: [
    { role: 'user', content: 'What is the capital of France?', attachments: [{ file_id: 'tdoc_1', name: 'notes.md', size: 10, media_type: 'text/markdown' }] },
    { role: 'assistant', content: 'Paris.', charged_ulxc: 420, request_id: 'req-1' },
    { role: 'user', content: 'And of Spain?' },
    { role: 'assistant', content: '', incomplete: 'blank' },
  ],
}

beforeEach(() => queryClient.clear())
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('Share in a conversation', () => {
  it('makes a link from the chat’s words alone, and Turn off link deletes it', async () => {
    let links: ChatShare[] = []
    const sent: { method: string; url: string; body?: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      sent.push({ method, url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
      if (url === '/api/chat/shares' && method === 'GET') return json(links)
      if (url === '/api/chat/shares' && method === 'POST') {
        const made = { id: 'sh-1', token: TOKEN, conversation_id: 'c-1', title: 'Capital of France', created_at: '2026-10-08T06:00:00Z' }
        links = [made]
        return json(made, 201)
      }
      if (url === '/api/chat/shares/sh-1' && method === 'DELETE') {
        links = []
        return json({ revoked: true })
      }
      return json({ error: 'not mocked' }, 404)
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SharePanel conversation={CONVERSATION} onClose={() => {}} />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Create link' }))
    const link = await screen.findByRole('textbox', { name: 'Link to this chat' })
    expect(link).toHaveValue(`${window.location.origin}/share/${TOKEN}`)
    expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
      conversation_id: 'c-1',
      title: 'Capital of France',
      messages: [
        { role: 'user', content: 'What is the capital of France?' },
        { role: 'assistant', content: 'Paris.' },
        { role: 'user', content: 'And of Spain?' },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Turn off link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('The link is off.')
    expect(sent.some((s) => s.method === 'DELETE' && s.url === '/api/chat/shares/sh-1')).toBe(true)
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Link to this chat' })).toBeNull())
  })
})

function strangerAt(path: string, chat: { status: number; body: unknown }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: false, user: null })
    if (url === `/api/public/chats/${TOKEN}`) return json(chat.body, chat.status)
    return new Response('null', { status: 401 })
  })
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('a shared chat’s link, signed out', () => {
  it('shows the chat, read-only', async () => {
    strangerAt(`/share/${TOKEN}`, {
      status: 200,
      body: { title: 'Capital of France', created_at: '2026-10-08T06:00:00Z', messages: [{ role: 'user', content: 'What is the capital of France?' }, { role: 'assistant', content: 'Paris.' }] },
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Capital of France' })).toBeInTheDocument()
    expect(screen.getByTestId('shared-turn-user')).toHaveTextContent('What is the capital of France?')
    expect(screen.getByTestId('shared-turn-assistant')).toHaveTextContent('Paris.')
    expect(screen.queryByText(/Sign in to Talyvor/i)).toBeNull()
  })

  it('says it is not there once the link is turned off', async () => {
    strangerAt(`/share/${TOKEN}`, { status: 404, body: { error: 'not found' } })
    expect(await screen.findByRole('heading', { level: 1, name: 'This chat isn’t available' })).toBeInTheDocument()
  })
})
