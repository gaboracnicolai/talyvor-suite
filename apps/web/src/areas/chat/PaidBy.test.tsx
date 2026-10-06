import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { historyKey } from './history'

// B28.354 — choosing which wallet pays for a conversation. The BFF is mocked at the wire: every request the
// conversation makes carries the agent chosen in X-Talyvor-Paid-By, and the answer says that agent paid only when
// Lens's answer names it. That the charge lands on the agent's statement and the workspace balance does not move
// is proven against Lens by the e2e scenario chat-paid-by.

const M = 1_000_000
const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
const ANSWER = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 12, output_tokens: 1 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Paris.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
  { type: 'message_stop' },
)

/** `bills` is whether Lens bills the agent asked for (and says so), as it will once it can. */
function mockBff(bills: boolean) {
  const sent: Array<string | null> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents') {
      const agent = (id: string, name: string) => ({ id, name, balance_ulxc: 2 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-06T04:00:00Z' })
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 4 * M, unallocated_ulxc: 96 * M, spent_ulxc: 0, agents: [agent('agt_1', 'Writer'), agent('agt_2', 'Researcher')] })
    }
    if (/^\/api\/agents\/agt_\d\/statement$/.test(url)) return json({ lines: [] })
    if (url === '/api/ai/stream/anthropic/v1/messages') {
      const payer = new Headers(init?.headers).get('X-Talyvor-Paid-By')
      sent.push(payer)
      return new Response(ANSWER, { status: 200, headers: { 'Content-Type': 'text/event-stream', ...(bills && payer !== null ? { 'X-Talyvor-Paid-By': payer } : {}) } })
    }
    return new Response('null', { status: 404 })
  })
  return { sent }
}

async function ask(question: string) {
  const before = screen.queryAllByTestId('turn-cost').length
  fireEvent.change(await screen.findByPlaceholderText('Ask anything'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(screen.getAllByTestId('turn-cost')).toHaveLength(before + 1))
  return screen.getAllByTestId('turn-assistant').at(-1)!
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('Paid by: which wallet pays for a conversation (B28.354)', () => {
  it('sends the agent chosen with every question, says it paid when Lens billed it, and keeps the choice', async () => {
    const bff = mockBff(true)
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })

    // The workspace pays until an agent is chosen: nothing is sent and nothing is said.
    const paidBy = await screen.findByLabelText('Paid by')
    expect(paidBy).toHaveValue('')
    expect(within(paidBy).getAllByRole('option').map((o) => o.textContent)).toEqual(['The workspace', 'Writer', 'Researcher'])
    const first = await ask('The capital of France?')
    expect(bff.sent).toEqual([null])
    expect(within(first).queryByTestId('turn-paid-by')).toBeNull()

    fireEvent.change(paidBy, { target: { value: 'agt_2' } })
    const second = await ask('And of Japan?')
    expect(bff.sent).toEqual([null, 'agt_2'])
    const line = within(second).getByTestId('turn-paid-by')
    expect(line).toHaveTextContent('Paid by Researcher’s wallet')
    expect(within(line).getByRole('link', { name: 'Researcher' })).toHaveAttribute('href', '/agents?agent=agt_2')
    // The statement beside the conversation follows the agent paying, so its charge shows there.
    expect(within(screen.getByTestId('chat-live-statement')).getByLabelText('Agent')).toHaveValue('agt_2')

    // Kept with the conversation: a new chat is the workspace's again, and reopening this one brings it back.
    const [saved] = JSON.parse(window.localStorage.getItem(historyKey('local'))!)
    expect(saved.paid_by).toBe('agt_2')
    fireEvent.click(screen.getAllByRole('button', { name: 'New chat' })[0])
    expect(screen.getByLabelText('Paid by')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: /^The capital of France\?/ }))
    await waitFor(() => expect(screen.getByLabelText('Paid by')).toHaveValue('agt_2'))
    expect(within(screen.getAllByTestId('turn-assistant').at(-1)!).getByTestId('turn-paid-by')).toHaveTextContent('Paid by Researcher’s wallet')
  })

  it('says the agent was not billed when Lens’s answer does not name it', async () => {
    const bff = mockBff(false)
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    fireEvent.change(await screen.findByLabelText('Paid by'), { target: { value: 'agt_2' } })
    const answer = await ask('The capital of France?')
    expect(bff.sent).toEqual(['agt_2'])
    expect(within(answer).getByTestId('turn-paid-by')).toHaveTextContent('Lens did not bill Researcher for this answer.')
    expect(within(answer).queryByText(/Paid by/)).toBeNull()
  })
})
