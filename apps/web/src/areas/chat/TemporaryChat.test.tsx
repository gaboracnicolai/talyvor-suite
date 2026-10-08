import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { CACHE_STORE_HEADER } from './chatApi'
import { historyKey } from './history'

// B28.131 — temporary chat. The BFF is mocked at the wire; what each question asked Lens for is recorded. That a
// deployment neither serves a temporary chat's answer from the cache nor keeps it there is the e2e scenario chat-temporary.

const sse = (text: string) =>
  [
    { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 12, output_tokens: 1 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
    { type: 'message_stop' },
  ]
    .map((f) => `data: ${JSON.stringify(f)}\n\n`)
    .join('')

function mockBff() {
  const asked: { cache: string | null; store: string | null }[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    if (url === '/api/ai/stream/anthropic/v1/messages') {
      const h = new Headers(init?.headers)
      asked.push({ cache: h.get('X-Talyvor-Cache'), store: h.get(CACHE_STORE_HEADER) })
      return new Response(sse('Plum and walnut.'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
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

function ask(question: string) {
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

/** Everything this browser holds, as one string. */
function stored(): string {
  const all: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i) ?? ''
    all.push(`${k}=${window.localStorage.getItem(k)}`)
  }
  return all.join('\n')
}

describe('Temporary chat (B28.131)', () => {
  it('keeps nothing in this browser, asks Lens to serve no cached answer and keep none, and is gone once left', async () => {
    const asked = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    const toggle = screen.getByRole('button', { name: 'Temporary chat' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('temporary-chat-notice').textContent).toContain('Nothing in it is saved in this browser')

    ask('Which cake for a quince orchard picnic?')
    await waitFor(() => expect(screen.getByTestId('turn-reply').textContent).toBe('Plum and walnut.'))
    expect(asked).toEqual([{ cache: 'bypass', store: 'off' }])
    expect(stored()).not.toContain('quince')
    expect(window.localStorage.getItem(historyKey('local'))).toBeNull()
    // "Remember that …" is not kept either: the words stay in the box and nothing is stored.
    ask('Remember that I keep bees')
    expect(await screen.findByText(/A temporary chat keeps nothing, so Chat won’t remember this/)).toBeTruthy()
    expect(stored()).not.toContain('bees')

    // Off, a new chat that is kept: the temporary one is gone, and the next question asks for the cache as usual.
    fireEvent.click(screen.getByRole('button', { name: 'Temporary chat' }))
    expect(screen.queryByTestId('temporary-chat-notice')).toBeNull()
    expect(screen.queryByText('Which cake for a quince orchard picnic?')).toBeNull()
    ask('Which bread for a pear orchard picnic?')
    await waitFor(() => expect(stored()).toContain('pear orchard'))
    expect(asked).toEqual([{ cache: 'bypass', store: 'off' }, { cache: null, store: null }])
    expect(stored()).not.toContain('quince')
  })
})
