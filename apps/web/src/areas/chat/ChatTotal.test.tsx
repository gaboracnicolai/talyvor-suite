import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.101 — a running total for the conversation. The BFF is mocked at the wire; the total under the box is the
// prices under the answers added up, and a reload, which reads the conversation back from this browser, shows the
// same total. That it equals the footers on a real deployment is the e2e scenario chat-total.

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
// 12 tokens in and 3 out at $5 / $25 per 1M is $0.000135: 0.00135 LXC at $0.10 an LXC.
// 40 in and 20 out is $0.0007: 0.007 LXC.
const answer = (input: number, output: number) =>
  sse(
    { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: input, output_tokens: 1 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Paris.' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: output } },
    { type: 'message_stop' },
  )

function mockBff() {
  const answers = [answer(12, 3), answer(40, 20)]
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    if (url === '/api/ai/stream/anthropic/v1/messages') {
      return new Response(answers.shift(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response('null', { status: 404 })
  })
}

async function ask(question: string) {
  const before = screen.queryAllByTestId('turn-cost').length
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(screen.getAllByTestId('turn-cost')).toHaveLength(before + 1))
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('a running total for the conversation (B28.101)', () => {
  it('adds up the prices under the answers, and shows the same total after a reload', async () => {
    mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    expect(screen.queryByTestId('chat-total')).toBeNull()

    await ask('The capital of France?')
    expect(screen.getByTestId('chat-total').textContent).toBe('This chat so far ≈ 0.00135 LXC · 1 answer')
    await ask('And again, at more length?')
    // 0.00135 + 0.007: the two answers' prices, which their footers show to two figures.
    expect(screen.getAllByTestId('turn-cost').map((f) => f.textContent?.split(' · ')[0])).toEqual(['≈ 0.0013 LXC', '≈ 0.007 LXC'])
    expect(screen.getByTestId('chat-total').textContent).toBe('This chat so far ≈ 0.00835 LXC · 2 answers')

    cleanup()
    queryClient.clear()
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('chat-total').textContent).toBe('This chat so far ≈ 0.00835 LXC · 2 answers'))
  })
})
