import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.364 — the cheaper-model hint. The BFF is mocked at the wire. GPT-6 answers; the hint under the answer names the
// model GET /api/routing/recommendation says (Lens's /routing/recommendation, for the answer's provider and input size),
// priced on the answer's own tokens; one click asks the question again of that model. That Lens's recommendation and
// its spend row for the re-ask agree on a real deployment is the e2e scenario chat-cheaper.

const sse = (model: string, text: string) =>
  [
    { model, choices: [{ index: 0, delta: { content: text } }] },
    { model, choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } },
  ]
    .map((f) => `data: ${JSON.stringify(f)}\n\n`)
    .join('') + 'data: [DONE]\n\n'

function mockBff() {
  const asked: { model: unknown; fresh: boolean }[] = []
  const recommended: string[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') {
      return json([
        { id: 'gpt-6', provider: 'openai', display_name: 'GPT-6', input_per_1m: 2, output_per_1m: 8, tier: 'frontier' },
        { id: 'gpt-6-luna', provider: 'openai', display_name: 'GPT-6 Luna', input_per_1m: 0.1, output_per_1m: 0.4, tier: 'fast' },
      ])
    }
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    if (url.startsWith('/api/routing/recommendation?')) {
      recommended.push(url)
      return json({ model: 'gpt-6-luna', provider: 'openai', basis: 'quality_per_dollar', confidence: 'high' })
    }
    if (url.startsWith('/api/ai/stream/')) {
      const model = (JSON.parse(String(init?.body)) as { model: string }).model
      asked.push({ model, fresh: new Headers(init?.headers).get('X-Talyvor-Cache') === 'bypass' })
      return new Response(sse(model, model === 'gpt-6' ? 'Paris, France.' : 'Paris.'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response('null', { status: 404 })
  })
  return { asked, recommended }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('a cheaper-model hint (B28.364)', () => {
  it("offers Lens's recommended model under the answer, and one click asks again of it", async () => {
    const { asked, recommended } = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: GPT-6' })
    fireEvent.change(screen.getByPlaceholderText('Ask anything'), { target: { value: 'The capital of France?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    // 12 in and 3 out: $0.000048 on GPT-6, $0.0000024 on GPT-6 Luna, at $0.10 an LXC.
    const hint = await screen.findByTestId('cheaper-hint')
    expect(hint.textContent).toBe('GPT-6 Luna would likely do for a question like this: ≈ 0.000024 LXC instead of ≈ 0.00048 LXC.Re-ask with GPT-6 Luna')
    expect(recommended).toEqual(['/api/routing/recommendation?provider=openai&input_range=small'])

    fireEvent.click(screen.getByRole('button', { name: 'Re-ask with GPT-6 Luna' }))
    await waitFor(() => expect(screen.getByTestId('turn-cost').textContent).toBe('≈ 0.000024 LXC · GPT-6 Luna · 12 in / 3 out tokens'))
    expect(asked).toEqual([{ model: 'gpt-6', fresh: false }, { model: 'gpt-6-luna', fresh: true }])
    expect(screen.getAllByTestId('turn-assistant')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Model: GPT-6 Luna' })).toBeTruthy()
    expect(screen.queryByTestId('cheaper-hint')).toBeNull()
  })
})
