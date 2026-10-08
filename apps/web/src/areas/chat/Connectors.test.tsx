import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { DECLINED_TOOL_TEXT } from './chatApi'
import { CHARGE_FRAME } from './chatStream'
import { TEST_TOOLS_NAME, connectorsKey, testToolsURL } from './connectors'

// B28.122 — external MCP connectors in Chat. The BFF is mocked at the wire: the person's connector lists one tool, the
// model calls it, Chat asks first, and on Allow the call goes to /api/chat/connectors/call with the connector's address
// and token — neither of which the model sees. Under the answer the call is listed with what the request that read its
// answer was charged. That a deployment's Chat calls a real connector's tool and shows that cost is the e2e scenario
// chat-connectors.

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
const TOOL = 'talyvor_test_tools__fingerprint'
const CALLS_IT = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 100, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: TOOL, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"text":"hello"}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
  { type: CHARGE_FRAME, charged_ulxc: 300 },
  { type: 'message_stop' },
)
const ANSWERS = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 300, output_tokens: 1 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The fingerprint of hello is 2cf24dba5fb0.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } },
  { type: CHARGE_FRAME, charged_ulxc: 420 },
  { type: 'message_stop' },
)
const LISTED = { server: TEST_TOOLS_NAME, tools: [{ name: 'fingerprint', description: 'The fingerprint of a text.', input_schema: { type: 'object', properties: { text: { type: 'string' } } } }] }

function mockBff(listing: () => Response = () => json(LISTED)) {
  const streamed: unknown[] = []
  const calls: Record<string, unknown>[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/chat/tools') return json({ tools: [] })
    if (url === '/api/chat/connectors/tools') return listing()
    if (url === '/api/chat/connectors/call') {
      calls.push(JSON.parse(String(init?.body)))
      return json({ text: '2cf24dba5fb0', is_error: false })
    }
    if (url === '/api/ai/stream/anthropic/v1/messages') {
      const body = JSON.parse(String(init?.body))
      streamed.push(body)
      return new Response(JSON.stringify(body.messages).includes('tool_result') ? ANSWERS : CALLS_IT, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response('null', { status: 404 })
  })
  return { streamed, calls }
}

function json(v: unknown, status = 200) {
  return new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('External MCP connectors in Chat (B28.122)', () => {
  it('calls a connector’s tool once the person allows it, and shows under the answer what the call cost, kept after a reload', async () => {
    window.localStorage.setItem(connectorsKey('local'), JSON.stringify([{ id: 'c-1', name: TEST_TOOLS_NAME, url: testToolsURL(), token: 'tok_secret', added_at: 1 }]))
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    fireEvent.change(await screen.findByPlaceholderText('Ask anything'), { target: { value: 'What is the fingerprint of hello?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    // Asked first, by the tool's own name on the connector; nothing has gone to it yet.
    const ask = await screen.findByRole('region', { name: 'Let Chat use fingerprint?' }, { timeout: 5_000 })
    expect(within(ask).getByRole('heading').textContent).toBe(`Let Chat use fingerprint in ${TEST_TOOLS_NAME}?`)
    expect(bff.calls).toHaveLength(0)
    fireEvent.click(within(ask).getByRole('button', { name: 'Allow' }))

    const card = await screen.findByRole('region', { name: 'Connectors this answer used' }, { timeout: 5_000 })
    // On the connector, by the tool's own name, with the person's token.
    expect(bff.calls).toEqual([{ url: testToolsURL(), token: 'tok_secret', name: 'fingerprint', arguments: { text: 'hello' } }])
    // The model was offered the tool by name, description and schema only: never the address or the token.
    const offered = JSON.stringify(bff.streamed[0])
    expect(offered).toContain(TOOL)
    expect(offered).not.toContain('tok_secret')
    expect(offered).not.toContain(testToolsURL())
    // The call, and what the request that read its answer was charged; the answer's footer counts both requests.
    expect(within(card).getByTestId('turn-connector-call').textContent).toContain(`fingerprint on ${TEST_TOOLS_NAME}`)
    expect(within(card).getByTestId('turn-connector-cost').textContent).toBe('0.00042 LXC charged')
    expect(screen.getByTestId('turn-cost').textContent).toContain('0.00072 LXC charged')
    expect(screen.getAllByTestId('turn-reply')[0].textContent).toContain('2cf24dba5fb0')

    cleanup()
    queryClient.clear()
    render(<App />)
    const again = await screen.findByRole('region', { name: 'Connectors this answer used' })
    expect(within(again).getByTestId('turn-connector-cost').textContent).toBe('0.00042 LXC charged')
  })

  it('sends the connector nothing when the person does not allow the call, and tells the model so', async () => {
    window.localStorage.setItem(connectorsKey('local'), JSON.stringify([{ id: 'c-1', name: TEST_TOOLS_NAME, url: testToolsURL(), added_at: 1 }]))
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    fireEvent.change(await screen.findByPlaceholderText('Ask anything'), { target: { value: 'What is the fingerprint of hello?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    const ask = await screen.findByRole('region', { name: 'Let Chat use fingerprint?' }, { timeout: 5_000 })
    fireEvent.click(within(ask).getByRole('button', { name: 'Don’t allow' }))
    await screen.findByRole('region', { name: 'Connectors this answer used' }, { timeout: 5_000 })
    expect(bff.calls).toHaveLength(0)
    expect(screen.getByTestId('turn-connector-call').textContent).toContain('did not answer')
    expect(JSON.stringify(bff.streamed[1])).toContain(DECLINED_TOOL_TEXT)
  })

  it('adds a connector only once its tools can be read, and says why one was not added', async () => {
    let refuse = true
    mockBff(() => (refuse ? json({ error: 'The connector refused the token.' }, 502) : json(LISTED)))
    window.history.pushState({}, '', '/chat/connectors')
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: `Add ${TEST_TOOLS_NAME}` }))
    await waitFor(() => expect(screen.getByTestId('connectors-said').textContent).toBe('Not added. The connector refused the token.'))
    expect(window.localStorage.getItem(connectorsKey('local'))).toBeNull()

    refuse = false
    fireEvent.click(screen.getByRole('button', { name: `Add ${TEST_TOOLS_NAME}` }))
    const added = await screen.findByTestId('connector-card')
    expect(within(added).getByText(TEST_TOOLS_NAME)).toBeTruthy()
    expect((await within(added).findByTestId('connector-tools')).textContent).toBe('fingerprint — The fingerprint of a text.')
    expect(JSON.parse(window.localStorage.getItem(connectorsKey('local')) ?? '[]')).toMatchObject([{ name: TEST_TOOLS_NAME, url: testToolsURL() }])
  })
})
