import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { REPORT_CHARGE_HEADER } from './chatApi'
import { CHARGE_FRAME } from './chatStream'

// B28.362 — the real charge, not the estimate. The BFF is mocked at the wire with the frame Lens adds to say what an
// answer was charged (chatStream.ts CHARGE_FRAME, talyvor-lens B28.102). Under the answer that figure replaces the
// estimate, the running total counts it, and a reload shows both again. That the figure is the ledger's on a real
// deployment is the e2e scenario chat-charged.

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
// 12 tokens in and 3 out at $5 / $25 per 1M is $0.000135: an estimate of 0.00135 LXC at $0.10 an LXC. Lens says it
// charged 1620 µLXC, and that is what the footer says.
const answer = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 12, output_tokens: 1 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Paris.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
  { type: CHARGE_FRAME, charged_ulxc: 1620 },
  { type: 'message_stop' },
)

const estimated = answer.replace(/data: \{"type":"talyvor\.charge"[^\n]*\n\n/, '')

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    // Lens says what it charged only when Chat asked.
    const asked = new Headers(init?.headers).get(REPORT_CHARGE_HEADER) === 'true'
    if (url === '/api/ai/stream/anthropic/v1/messages') return new Response(asked ? answer : estimated, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('the real charge under an answer (B28.362)', () => {
  it('replaces the estimate with what Lens charged, in the footer and the total, and after a reload', async () => {
    mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    fireEvent.change(screen.getByPlaceholderText('Ask anything'), { target: { value: 'The capital of France?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    const charged = '0.00162 LXC charged · Claude Opus 5 · 12 in / 3 out tokens'
    await waitFor(() => expect(screen.getByTestId('turn-cost').textContent).toBe(charged))
    expect(screen.getByTestId('chat-total').textContent).toBe('This chat so far ≈ 0.00162 LXC · 1 answer')

    cleanup()
    queryClient.clear()
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('turn-cost').textContent).toBe(charged))
    expect(screen.getByTestId('chat-total').textContent).toBe('This chat so far ≈ 0.00162 LXC · 1 answer')
  })
})
