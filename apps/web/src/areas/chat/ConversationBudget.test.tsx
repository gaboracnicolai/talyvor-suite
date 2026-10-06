import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.361 — a budget per conversation. The BFF is mocked at the wire: every request the conversation makes carries
// its id and, once one is set, its budget in µLXC (what talyvor-lens B28.100 counts and refuses by); and a question
// that could take the conversation past its budget is refused in the browser — no request is made. That the refused
// question writes no spend row on Lens's ledger is proven against Lens by the e2e scenario chat-budget.

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
// 12 tokens in and 3 out at $5 / $25 per 1M is $0.000135: 0.00135 LXC at $0.10 an LXC.
const ANSWER = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 12, output_tokens: 1 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Paris.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
  { type: 'message_stop' },
)

function mockBff() {
  const sent: { conversation: string | null; budget: string | null }[] = []
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
      sent.push({ conversation: h.get('X-Talyvor-Conversation-ID'), budget: h.get('X-Talyvor-Conversation-Budget-ULXC') })
      return new Response(ANSWER, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response('null', { status: 404 })
  })
  return { sent }
}

async function setBudget(lxc: string) {
  const box = await screen.findByLabelText('Budget')
  fireEvent.change(box, { target: { value: lxc } })
  fireEvent.blur(box)
}

function type(question: string) {
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), { target: { value: question } })
}

async function ask(question: string) {
  const before = screen.queryAllByTestId('turn-cost').length
  type(question)
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

describe('a budget per conversation (B28.361)', () => {
  it('sends the conversation and its budget with every question, counts what it spent, and keeps the budget', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })

    await setBudget('5')
    await ask('The capital of France?')
    await ask('And of Japan?')
    expect(bff.sent).toHaveLength(2)
    expect(bff.sent[0].conversation).toMatch(/^[A-Za-z0-9-]{1,64}$/)
    expect(bff.sent).toEqual([
      { conversation: bff.sent[0].conversation, budget: '5000000' },
      { conversation: bff.sent[0].conversation, budget: '5000000' },
    ])
    expect(screen.getByTestId('chat-budget-spent').textContent).toBe('0.0027 spent')

    // Reopened, the conversation still has its budget.
    cleanup()
    queryClient.clear()
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Budget')).toHaveValue('5'))
  })

  it('refuses a question that could take the conversation past its budget, sends nothing, and sends it once the budget is raised', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })

    // A 4,096-token answer at $25 per 1M is over 1 LXC on its own.
    await setBudget('1')
    type('The capital of France?')
    expect((await screen.findByTestId('cost-over-budget')).textContent).toBe(' · over this chat’s budget')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/^This chat’s budget is 1 LXC and 0 LXC is spent\. Sending this could cost up to 1\.0\d+ LXC, so it was not sent\./)).toBeInTheDocument()
    expect(bff.sent).toEqual([])
    expect(screen.getByPlaceholderText('Ask anything')).toHaveValue('The capital of France?')

    await setBudget('2')
    expect(screen.queryByTestId('cost-over-budget')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getAllByTestId('turn-cost')).toHaveLength(1))
    expect(bff.sent).toEqual([{ conversation: expect.any(String), budget: '2000000' }])
  })
})
