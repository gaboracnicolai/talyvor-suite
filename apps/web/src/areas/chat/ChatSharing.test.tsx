import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { POOL_HEADER } from './chatApi'

// B28.381 — a chat kept out of the shared pool. The BFF is mocked at the wire: what reaches it is what Lens is asked
// with (talyvor-lens B28.133 honours it). That another workspace is never served such a chat's answer is the e2e
// scenario chat-pool-off.

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
const answer = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 12, output_tokens: 1 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Paris.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
  { type: 'message_stop' },
)

function mockBff() {
  const asked: (string | null)[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    if (url === '/api/ai/stream/anthropic/v1/messages') {
      asked.push(new Headers(init?.headers).get(POOL_HEADER))
      return new Response(answer, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response('null', { status: 404 })
  })
  return asked
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

async function ask(question: string, replies: number) {
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(screen.getAllByTestId('turn-reply')).toHaveLength(replies))
  await waitFor(() => expect(screen.getAllByTestId('turn-reply')[replies - 1].textContent).toBe('Paris.'))
}

describe('Sharing (B28.381)', () => {
  it('a chat turned out of the shared pool asks Lens with X-Talyvor-Pool: off, keeps it after a reload, and a new chat shares', async () => {
    const asked = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    const sharing = screen.getByRole('switch', { name: 'Sharing' })
    expect(sharing.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sharing)
    expect(sharing.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('chat-sharing-state').textContent).toBe('Off — this chat’s answers are never shared with another workspace')
    await ask('What is the capital of France?', 1)
    expect(asked).toEqual(['off'])

    // Kept with the conversation: opened again, it is still out of the pool, and so is its next question.
    cleanup()
    queryClient.clear()
    render(<App />)
    await screen.findAllByTestId('turn-reply')
    expect(screen.getByRole('switch', { name: 'Sharing' }).getAttribute('aria-checked')).toBe('false')
    await ask('And of Italy?', 2)
    expect(asked).toEqual(['off', 'off'])

    // A new chat shares, as the workspace does: no header.
    fireEvent.click(screen.getAllByRole('button', { name: 'New chat' })[0])
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Sharing' }).getAttribute('aria-checked')).toBe('true'))
    await ask('And of Spain?', 1)
    expect(asked).toEqual(['off', 'off', null])
  })
})
