import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { REPORT_CHARGE_HEADER } from './chatApi'
import { CHARGE_FRAME } from './chatStream'

// B28.369 — compare models side by side. The BFF is mocked at the wire: each column is its own streaming request,
// held open here after its first words, so all three are on screen before any finishes — they stream side by side,
// not one after another. Then each ends with Lens's charge frame (talyvor-lens B28.114 / B28.102) and its column
// states what that request was charged.

const frame = (f: unknown) => `data: ${JSON.stringify(f)}\n\n`

const MODELS = [
  { id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier', release_date: '2026-09-01' },
  { id: 'claude-haiku-4-5', provider: 'anthropic', display_name: 'Claude Haiku 4.5', input_per_1m: 1, output_per_1m: 5, tier: 'fast', release_date: '2025-10-01' },
  { id: 'gpt-5', provider: 'openai', display_name: 'GPT-5', input_per_1m: 1.25, output_per_1m: 10, tier: 'frontier', release_date: '2026-08-01' },
]

/** Each model's answer: its first words, then the rest with its usage and what Lens charged. */
const ANSWERS: Record<string, { first: string; rest: string }> = {
  'claude-opus-5': {
    first:
      frame({ type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 12, output_tokens: 1 } } }) +
      frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Paris is ' } }),
    rest:
      frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'the capital.' } }) +
      frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }) +
      frame({ type: CHARGE_FRAME, charged_ulxc: 1620 }) +
      frame({ type: 'message_stop' }),
  },
  'claude-haiku-4-5': {
    first:
      frame({ type: 'message_start', message: { model: 'claude-haiku-4-5', usage: { input_tokens: 12, output_tokens: 1 } } }) +
      frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'It is ' } }),
    rest:
      frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Paris.' } }) +
      frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }) +
      frame({ type: CHARGE_FRAME, charged_ulxc: 300 }) +
      frame({ type: 'message_stop' }),
  },
  'gpt-5': {
    first: frame({ model: 'gpt-5', choices: [{ index: 0, delta: { role: 'assistant', content: 'France: ' } }] }),
    rest:
      frame({ model: 'gpt-5', choices: [{ index: 0, delta: { content: 'Paris.' }, finish_reason: 'stop' }] }) +
      frame({ model: 'gpt-5', choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }) +
      frame({ type: CHARGE_FRAME, charged_ulxc: 900 }) +
      'data: [DONE]\n\n',
  },
}

function mockBff(refuseFirst?: string) {
  let refused = false
  const streams: { model: string; url: string; reportCharge: boolean; finish: () => void }[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json(MODELS)
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    if (url.startsWith('/api/ai/stream/')) {
      const model = (JSON.parse(String(init?.body)) as { model: string }).model
      if (model === refuseFirst && !refused) {
        refused = true
        return new Response(JSON.stringify({ error: 'provider overloaded', code: 'provider_overloaded' }), { status: 503 })
      }
      const answer = ANSWERS[model]
      const enc = new TextEncoder()
      let ctl!: ReadableStreamDefaultController<Uint8Array>
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          ctl = c
          c.enqueue(enc.encode(answer.first))
        },
      })
      streams.push({
        model,
        url,
        reportCharge: new Headers(init?.headers).get(REPORT_CHARGE_HEADER) === 'true',
        finish: () => {
          ctl.enqueue(enc.encode(answer.rest))
          ctl.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response('null', { status: 404 })
  })
  return streams
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

async function compare(question: string) {
  window.history.pushState({}, '', '/chat/compare')
  render(<App />)
  await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
  fireEvent.change(screen.getByLabelText('Your question for all three models'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
}

describe('compare models side by side (B28.369)', () => {
  it('streams three priced columns for one prompt, all at once', async () => {
    const streams = mockBff()
    await compare('The capital of France?')

    // All three requests are open and each column shows its first words before any has finished.
    await waitFor(() => expect(streams).toHaveLength(3))
    const columns = await screen.findAllByTestId('compare-column')
    await waitFor(() => {
      expect(within(columns[0]).getByTestId('turn-reply').textContent).toBe('Paris is')
      expect(within(columns[1]).getByTestId('turn-reply').textContent).toBe('It is')
      expect(within(columns[2]).getByTestId('turn-reply').textContent).toBe('France:')
    })
    expect(screen.queryAllByTestId('compare-cost')).toHaveLength(0)
    expect(streams.map((s) => [s.model, s.url, s.reportCharge])).toEqual([
      ['claude-opus-5', '/api/ai/stream/anthropic/v1/messages', true],
      ['claude-haiku-4-5', '/api/ai/stream/anthropic/v1/messages', true],
      ['gpt-5', '/api/ai/stream/openai/v1/chat/completions', true],
    ])

    for (const s of streams) s.finish()
    await waitFor(() => expect(screen.getAllByTestId('compare-cost')).toHaveLength(3))
    expect(screen.getAllByTestId('compare-cost').map((p) => p.textContent)).toEqual([
      '0.00162 LXC charged · Claude Opus 5 · 12 in / 3 out tokens',
      '0.0003 LXC charged · Claude Haiku 4.5 · 12 in / 3 out tokens',
      '0.0009 LXC charged · GPT-5 · 12 in / 3 out tokens',
    ])
    expect(columns.map((c) => within(c).getByTestId('turn-reply').textContent)).toEqual(['Paris is the capital.', 'It is Paris.', 'France: Paris.'])
  })

  it('carries one answer on in Chat, priced as it was', async () => {
    const streams = mockBff()
    await compare('The capital of France?')
    await waitFor(() => expect(streams).toHaveLength(3))
    for (const s of streams) s.finish()
    await waitFor(() => expect(screen.getAllByTestId('compare-cost')).toHaveLength(3))

    fireEvent.click(within(screen.getAllByTestId('compare-column')[2]).getByRole('button', { name: 'Continue in Chat' }))
    await waitFor(() => expect(window.location.pathname).toBe('/chat'))
    await waitFor(() => expect(screen.getByTestId('turn-cost').textContent).toBe('0.0009 LXC charged · GPT-5 · 12 in / 3 out tokens'))
    expect(screen.getByTestId('turn-user').textContent).toContain('The capital of France?')
    expect(screen.getByRole('button', { name: 'Model: GPT-5' })).toBeTruthy()
  })

  it('asks a refused column again with Retry, leaving the others as they are', async () => {
    const streams = mockBff('gpt-5')
    await compare('The capital of France?')
    await waitFor(() => expect(streams).toHaveLength(2))
    for (const s of streams) s.finish()
    const column = (await screen.findAllByTestId('compare-column'))[2]
    await within(column).findByTestId('compare-failure')
    await waitFor(() => expect(screen.getAllByTestId('compare-cost')).toHaveLength(2))

    fireEvent.click(within(column).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(streams).toHaveLength(3))
    expect(streams[2].model).toBe('gpt-5')
    streams[2].finish()
    await waitFor(() => expect(within(column).getByTestId('compare-cost').textContent).toBe('0.0009 LXC charged · GPT-5 · 12 in / 3 out tokens'))
    expect(screen.getAllByTestId('compare-cost')).toHaveLength(3)
  })
})
