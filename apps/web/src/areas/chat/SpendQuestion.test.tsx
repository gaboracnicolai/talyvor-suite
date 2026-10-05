import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'

// B28.349 — "what did my agents spend?" in Chat, answered through Lens's wallet MCP tools. The model calls
// wallet_agents_spend, the call goes through the BFF (POST /api/chat/tools/call → Lens /mcp), what Lens
// answers goes back to the model in the provider's own tool_result shape, and the answer says 1.23 and links
// the statement line it was read from. Following the link opens that agent on Agent Wallets with the line marked.

const M = 1_000_000
const SPENT = { agents: [{ agent_id: 'agt_1', name: 'Researcher', spent_ulxc: 1.23 * M, lines: [{ entry_id: 'ent_9', kind: 'pay', amount_ulxc: -1.23 * M, at: '2026-10-05T06:00:00Z' }] }] }

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
const CALLS_THE_TOOL = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 100, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'wallet_agents_spend', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"from":' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"2026-10-05"}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
)
const ANSWERS = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 300, output_tokens: 1 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Your agents spent 1.23 LXC today.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } },
  { type: 'message_stop' },
)

function mockBff() {
  const streamed: Record<string, unknown>[] = []
  const toolCalls: unknown[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models')
      return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, release_date: '2026-07-24', tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/chat/tools')
      return json({ tools: [{ name: 'wallet_agents_spend', description: 'What your agents spent', input_schema: { type: 'object', properties: { from: { type: 'string' } } } }] })
    if (url === '/api/chat/tools/call') {
      toolCalls.push(JSON.parse(String(init?.body)))
      return json({ text: JSON.stringify(SPENT), is_error: false })
    }
    if (url === '/api/ai/stream/anthropic/v1/messages') {
      streamed.push(JSON.parse(String(init?.body)))
      return new Response(streamed.length === 1 ? CALLS_THE_TOOL : ANSWERS, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (url === '/api/agents')
      return json({ workspace_balance_ulxc: 10 * M, allocated_ulxc: 0.77 * M, unallocated_ulxc: 9.23 * M, spent_ulxc: 1.23 * M,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 0.77 * M, spent_ulxc: 1.23 * M, keys: [], created_at: '2026-10-01T09:00:00Z' }] })
    if (url === '/api/agents/agt_1/statement')
      return json({ agent_id: 'agt_1', lines: [
        { entry_id: 'ent_9', kind: 'pay', amount_ulxc: -1.23 * M, counterparty: 'agent:agt_2', ref: 'research', balance_after_ulxc: 0.77 * M, at: '2026-10-05T06:00:00Z' },
        { entry_id: 'ent_8', kind: 'fund', amount_ulxc: 2 * M, counterparty: 'workspace', balance_after_ulxc: 2 * M, at: '2026-10-05T05:00:00Z' },
      ] })
    return new Response('null', { status: 404 })
  })
  return { streamed, toolCalls }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('asking what the agents spent (B28.349)', () => {
  it('answers through Lens’s wallet tool: says 1.23, links the statement row, and the link opens it marked', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    fireEvent.change(await screen.findByPlaceholderText('Ask anything'), { target: { value: 'What did my agents spend today?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    const lines = await screen.findByRole('navigation', { name: 'Statement lines this answer read' }, { timeout: 5_000 })
    const answer = screen.getAllByTestId('turn-assistant').at(-1)!
    expect(answer).toHaveTextContent('Your agents spent 1.23 LXC today.')
    // Both requests' tokens are the answer's price, and it says it took two: each is charged.
    expect(within(answer).getByTestId('turn-cost')).toHaveTextContent(/· Claude Opus 5 · 400 in \/ 50 out tokens · 2 requests$/)

    // The tool was offered in Anthropic's shape, the call went to the BFF with the model's arguments, and
    // Lens's answer went back to the model as the tool_result of that call.
    expect(bff.streamed[0].tools).toEqual([{ name: 'wallet_agents_spend', description: 'What your agents spent', input_schema: { type: 'object', properties: { from: { type: 'string' } } } }])
    expect(bff.toolCalls).toEqual([{ name: 'wallet_agents_spend', arguments: { from: '2026-10-05' } }])
    expect(bff.streamed[1].messages).toEqual([
      { role: 'user', content: 'What did my agents spend today?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'wallet_agents_spend', input: { from: '2026-10-05' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: JSON.stringify(SPENT) }] },
    ])

    const link = within(lines).getByRole('link', { name: /^Researcher: −1\.23 LXC/ })
    expect(link).toHaveAttribute('href', '/agents?agent=agt_1&entry=ent_9')
    fireEvent.click(link)
    const row = await screen.findByTestId('statement-line-linked')
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(row).toHaveTextContent('1.23 LXC')
    expect(screen.getByTestId('agent-open')).toHaveTextContent('Researcher')
  }, 15_000)
})
