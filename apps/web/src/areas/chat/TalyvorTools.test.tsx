import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { DECLINED_TOOL_TEXT } from './chatApi'

// B28.374 — Talyvor's own tools in Chat. The BFF is mocked at the wire: GET /api/chat/tools offers Track's create_issue
// (it writes) and Docs' search_docs, and the model files the bug it was told about. Nothing is filed until the person
// says yes on the card; a yes sends the call with "confirmed": true, and the answer links the issue Track filed. That
// a deployment's Chat files a real Track issue is the e2e scenario chat-file-bug.

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
const ARGS = { title: 'Export CSV downloads an empty file', description: 'Spend → Export CSV gives a 0-byte file.' }
const FILES_IT = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 100, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'create_issue', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(ARGS) } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
)
const says = (text: string) =>
  sse(
    { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 300, output_tokens: 1 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } },
    { type: 'message_stop' },
  )
const FILED = { id: 'iss-1', identifier: 'ENG-42', title: ARGS.title, status: 'todo', priority: 0, url: '/issues/ENG-42' }

function mockBff() {
  const streamed: { messages: { role: string; content: unknown }[] }[] = []
  const toolCalls: Record<string, unknown>[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/chat/tools')
      return json({
        tools: [
          { name: 'create_issue', description: 'Create an issue', input_schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }, product: 'track', writes: true },
          { name: 'search_docs', description: 'Search Docs', input_schema: { type: 'object', properties: { query: { type: 'string' } } }, product: 'docs' },
        ],
      })
    if (url === '/api/chat/tools/call') {
      toolCalls.push(JSON.parse(String(init?.body)))
      return json({ text: JSON.stringify(FILED), is_error: false })
    }
    if (url === '/api/ai/stream/anthropic/v1/messages') {
      const body = JSON.parse(String(init?.body))
      streamed.push(body)
      const told = JSON.stringify(body.messages[body.messages.length - 1])
      const reply = !told.includes('tool_result') ? FILES_IT : told.includes(DECLINED_TOOL_TEXT) ? says('OK, I did not file it.') : says('Filed as ENG-42.')
      return new Response(reply, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response('null', { status: 404 })
  })
  return { streamed, toolCalls }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

async function ask(question: string) {
  fireEvent.change(await screen.findByPlaceholderText('Ask anything'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('Talyvor’s own tools in Chat (B28.374)', () => {
  it('files a Track issue only once the person says yes, links it under the answer, and keeps it after a reload', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    await ask('Export CSV on Spend downloads an empty file. File this as a bug.')

    // Asked first: the card says what would be filed, and nothing has been sent to Track.
    const card = await screen.findByRole('region', { name: 'File this in Track?' }, { timeout: 5_000 })
    expect(within(card).getByTestId('tool-confirm-title').textContent).toBe(ARGS.title)
    expect(bff.toolCalls).toHaveLength(0)
    // The model is offered the tools by name, description and schema only.
    expect(JSON.stringify(bff.streamed[0])).not.toContain('"writes"')
    fireEvent.click(within(card).getByRole('button', { name: 'File it' }))

    const filed = await screen.findByRole('navigation', { name: 'Issues this answer filed' }, { timeout: 5_000 })
    expect(bff.toolCalls).toEqual([{ name: 'create_issue', arguments: ARGS, confirmed: true }])
    expect(screen.queryByRole('region', { name: 'File this in Track?' })).toBeNull()
    const link = within(filed).getByTestId('turn-filed-issue')
    expect(link.textContent).toBe(`ENG-42 · ${ARGS.title}`)
    expect(link.getAttribute('href')).toBe('/track/issues/iss-1')
    expect(screen.getByTestId('turn-tools-used').textContent).toBe('Filed an issue in Track')
    expect(screen.getAllByTestId('turn-reply')[0].textContent).toContain('ENG-42')

    // Kept with the conversation: opened again, the answer still links the issue.
    cleanup()
    queryClient.clear()
    render(<App />)
    const again = await screen.findByRole('navigation', { name: 'Issues this answer filed' })
    expect(within(again).getByTestId('turn-filed-issue').getAttribute('href')).toBe('/track/issues/iss-1')
  })

  it('files nothing when the person says no, and tells the model so', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    await ask('File this as a bug: Export CSV downloads an empty file.')
    const card = await screen.findByRole('region', { name: 'File this in Track?' }, { timeout: 5_000 })
    fireEvent.click(within(card).getByRole('button', { name: 'Don’t file' }))

    await waitFor(() => expect(screen.getAllByTestId('turn-reply')[0].textContent).toContain('did not file'))
    expect(bff.toolCalls).toHaveLength(0)
    expect(JSON.stringify(bff.streamed[1].messages)).toContain(DECLINED_TOOL_TEXT)
    expect(screen.queryByRole('navigation', { name: 'Issues this answer filed' })).toBeNull()
  })
})
