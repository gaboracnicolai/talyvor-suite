import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.363 — Auto (cheapest good). The BFF is mocked at the wire. Chosen in the picker, a question is asked of model
// "auto" on the provider of the cheapest model offered, where Lens picks the model (talyvor-lens B28.103); the line
// under the answer names the model the stream says served it, priced at that model's rate. That Lens's spend row is
// that model's price on a real deployment is the e2e scenario chat-auto.

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n'
// Lens chose GPT-6 Luna: 12 tokens in and 3 out at $0.10 / $0.40 per 1M is $0.0000024, 0.000024 LXC at $0.10 an LXC.
const served = 'gpt-6-luna-2026-09-22'
const answer = sse(
  { model: served, choices: [{ index: 0, delta: { content: 'Paris.' } }] },
  { model: served, choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } },
)

function mockBff() {
  const asked: { url: string; model: unknown }[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') {
      return json([
        { id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' },
        { id: 'gpt-6', provider: 'openai', display_name: 'GPT-6', input_per_1m: 2, output_per_1m: 8, tier: 'balanced' },
        { id: 'gpt-6-luna', provider: 'openai', display_name: 'GPT-6 Luna', input_per_1m: 0.1, output_per_1m: 0.4, tier: 'fast' },
      ])
    }
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    if (url.startsWith('/api/ai/stream/')) {
      asked.push({ url, model: (JSON.parse(String(init?.body)) as { model?: unknown }).model })
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

describe('Auto (cheapest good) (B28.363)', () => {
  it('asks Lens to choose, and the answer names the model that served it, after a reload too', async () => {
    const asked = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Model: Claude Opus 5' }))
    const options = screen.getAllByRole('option')
    expect(options[0].textContent).toBe('Auto (cheapest good)$0.10 / $0.40 or moreThe cheapest model that answers each question well.')
    fireEvent.click(options[0])
    await screen.findByRole('button', { name: 'Model: Auto (cheapest good)' })

    fireEvent.change(screen.getByPlaceholderText('Ask anything'), { target: { value: 'The capital of France?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    const footer = '≈ 0.000024 LXC · GPT-6 Luna, chosen by Auto · 12 in / 3 out tokens'
    await waitFor(() => expect(screen.getByTestId('turn-cost').textContent).toBe(footer))
    expect(asked).toEqual([{ url: '/api/ai/stream/openai/v1/chat/completions', model: 'auto' }])

    cleanup()
    queryClient.clear()
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('turn-cost').textContent).toBe(footer))
    expect(screen.getByRole('button', { name: 'Model: Auto (cheapest good)' })).toBeTruthy()
  })
})
