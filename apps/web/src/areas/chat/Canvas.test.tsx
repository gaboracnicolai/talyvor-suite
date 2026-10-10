import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { CANVAS_READY } from './Canvas'

// B28.120 — the canvas. The BFF is mocked at the wire with an answer that writes a page in an ```html block. That the
// page is drawn in a real browser, and an edit to it is drawn and still there after a reload, is the e2e scenario
// chat-canvas.

const page = '<!doctype html>\n<html><head><title>Launch plan</title></head><body><h1>Hello</h1></body></html>'
const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
const answer = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 12, output_tokens: 1 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Here it is:\n\n```html\n' + page + '\n```\n\nAnd in Python:\n\n```python\nprint(1)\n```' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } },
  { type: 'message_stop' },
)

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    if (url === '/api/ai/stream/anthropic/v1/messages') return new Response(answer, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
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

const frame = () => screen.getByTitle('Launch plan, drawn as a page') as HTMLIFrameElement

// What the canvas sends its page (the BFF's /canvas, which jsdom does not load) when the page says it is ready.
function drawn(): unknown {
  const page = frame().contentWindow!
  const post = vi.spyOn(page, 'postMessage').mockImplementation(() => {})
  window.dispatchEvent(new MessageEvent('message', { data: CANVAS_READY, source: page }))
  const sent = post.mock.calls.at(-1)?.[0]
  post.mockRestore()
  return sent
}

describe('the canvas (B28.120)', () => {
  it('draws an HTML block as a sandboxed page, keeps an edit to it after a reload, and restores the original', async () => {
    mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    fireEvent.change(screen.getByPlaceholderText('Ask anything'), { target: { value: 'Make me a launch page' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    // Only the HTML block opens in the canvas.
    const open = await screen.findByRole('button', { name: 'Open in canvas' })
    expect(screen.getAllByRole('button', { name: /Open in canvas/ })).toHaveLength(1)
    fireEvent.click(open)
    const canvas = screen.getByTestId('canvas')
    expect(within(canvas).getByTestId('canvas-title').textContent).toBe('Launch plan')
    // Its scripts may run; it gets no origin, so it cannot reach the console, its storage or its cookies.
    expect(frame().getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame().getAttribute('src')).toBe('/canvas')
    expect(drawn()).toBe(page)

    fireEvent.click(within(canvas).getByRole('button', { name: 'Code' }))
    const edited = page.replace('<h1>Hello</h1>', '<h1>Hello, edited</h1>')
    fireEvent.change(within(canvas).getByLabelText('HTML'), { target: { value: edited } })
    await waitFor(() => expect(within(canvas).getByTestId('canvas-saved').textContent).toBe('Edited · saved in this browser with the conversation'))
    fireEvent.click(within(canvas).getByRole('button', { name: 'Preview' }))
    expect(drawn()).toBe(edited)

    // Opened again, the conversation's answer is as it was written and its page as it was edited.
    cleanup()
    queryClient.clear()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open in canvas · edited' }))
    expect(drawn()).toBe(edited)
    expect(screen.getAllByTestId('turn-reply')[0].textContent).toContain('<h1>Hello</h1>')

    // Restored, it is the answer's own again, and so after another reload.
    fireEvent.click(screen.getByRole('button', { name: 'Restore the original' }))
    await waitFor(() => expect(drawn()).toBe(page))
    fireEvent.click(screen.getByRole('button', { name: 'Close canvas' }))
    expect(screen.queryByTestId('canvas')).toBeNull()
    cleanup()
    queryClient.clear()
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Open in canvas' })).toBeTruthy()
  })
})
