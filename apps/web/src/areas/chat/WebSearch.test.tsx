import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { WEB_SEARCH_HEADER } from './chatApi'
import { CITATIONS_FRAME } from './chatStream'

// B28.372 — web search with citations. The BFF is mocked at the wire with the frame Lens adds to name the pages it
// searched and gave the model (chatStream.ts CITATIONS_FRAME, talyvor-lens B28.118), sent only when the question asked
// for it. That a deployment's answer cites pages that open is the e2e scenario chat-web-search.

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
const pages = [
  { n: 1, url: 'https://news.example.org/rates', title: 'Central bank holds rates' },
  { n: 2, url: 'https://wire.example.com/markets' },
  // Never a link: only web pages are.
  { n: 3, url: 'javascript:alert(1)', title: 'Not a page' },
]
const answer = (searched: boolean) =>
  sse(
    { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 12, output_tokens: 1 } } },
    ...(searched ? [{ type: CITATIONS_FRAME, citations: pages }] : []),
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: searched ? 'Rates held at 4% [1], and markets rose [2].' : 'Rates held.' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
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
      const search = new Headers(init?.headers).get(WEB_SEARCH_HEADER)
      asked.push(search)
      return new Response(answer(search === 'on'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
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

async function ask(question: string) {
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('Search the web (B28.372)', () => {
  it('asks Lens to search, lists the pages the answer cites as links, keeps them after a reload, and stops when off', async () => {
    const asked = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    const toggle = screen.getByRole('button', { name: 'Search the web' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    await ask('What did the central bank do today?')

    const sources = await screen.findByRole('navigation', { name: 'Sources this answer cites' })
    expect(asked).toEqual(['on'])
    const links = within(sources).getAllByRole('link')
    expect(links.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target')])).toEqual([
      ['Central bank holds rates', 'https://news.example.org/rates', '_blank'],
      ['wire.example.com', 'https://wire.example.com/markets', '_blank'],
    ])
    expect(sources.textContent).toContain('[1]')
    expect(sources.textContent).not.toContain('Not a page')

    // Kept with the conversation: opened again, the answer still lists them.
    cleanup()
    queryClient.clear()
    render(<App />)
    expect(within(await screen.findByRole('navigation', { name: 'Sources this answer cites' })).getAllByRole('link')).toHaveLength(2)

    // Off, the next question is not searched and its answer lists nothing.
    expect(screen.getByRole('button', { name: 'Search the web' }).getAttribute('aria-pressed')).toBe('false')
    await ask('And what does that mean for me?')
    await waitFor(() => expect(screen.getAllByTestId('turn-reply')).toHaveLength(2))
    await waitFor(() => expect(screen.getAllByTestId('turn-reply')[1].textContent).toBe('Rates held.'))
    expect(asked).toEqual(['on', null])
    expect(screen.getAllByRole('navigation', { name: 'Sources this answer cites' })).toHaveLength(1)
  })
})
