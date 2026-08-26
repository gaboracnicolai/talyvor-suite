import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Chat } from './Chat'

// /chat is LIVE — wired to the BFF's GET /api/models and POST /api/ai/stream/{provider}/{rest...}
// (apps/bff/lens.go, apps/bff/stream.go). These tests drive the real fetch surface, mocked at the
// wire, never a component fixture.
//
// ⚠⚠ THE ONE THAT MATTERS IS "renders text WHILE the response is still open". A buffering client
// and a streaming client produce BYTE-IDENTICAL finished DOM. Step 3's own record says a flush test
// passed against `io.Copy` and only a positive control found it. So the streaming proof here holds
// the response open, asserts partial text is on screen, and only then closes it. Every other
// assertion in this file would pass against a client that awaited `res.text()`.

const CATALOG = [
  { id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10 },
  { id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25 },
  // ⚠ NOT OFFERED, AND DELIBERATELY IN THE FIXTURE. Lens streams every non-openai provider through
  // ServeAnthropic, so a Google model would be parsed with the wrong wire format. If the picker
  // ever offers it, a test here reds rather than a person meeting an empty answer.
  { id: 'gemini-2-pro', provider: 'google', display_name: 'Gemini 2 Pro', input_per_1m: 1, output_per_1m: 4 },
  // Deprecated: in the catalog, retired at the provider.
  { id: 'gpt-4-old', provider: 'openai', display_name: 'GPT-4 (old)', input_per_1m: 30, output_per_1m: 60, deprecated: true },
]

afterEach(() => {
  vi.restoreAllMocks()
})

/** A ReadableStream the test drives by hand, so the response can be held open mid-answer. */
function controllableStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  const enc = new TextEncoder()
  return {
    stream,
    push: (s: string) => controller.enqueue(enc.encode(s)),
    close: () => controller.close(),
  }
}

/** Mocks GET /api/models and POST /api/ai/stream/*. `stream` is the SSE body. */
function mockChat({
  catalog = CATALOG,
  catalogStatus = 200,
  streamStatus = 200,
  body,
}: {
  catalog?: unknown
  catalogStatus?: number
  streamStatus?: number
  body?: BodyInit | null
} = {}) {
  const posted = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/api/models') {
      if (catalogStatus !== 200) return new Response('nope', { status: catalogStatus })
      return new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.startsWith('/api/ai/stream/')) {
      posted({ url, init })
      if (streamStatus !== 200) return new Response('refused', { status: streamStatus })
      return new Response(body ?? '', { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response('null', { status: 404 })
  })
  return { posted }
}

function renderChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function ask(text: string) {
  const box = await screen.findByPlaceholderText('Ask anything')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('the model picker reads the deployment, not this file', () => {
  it('offers the models whose stream this client can read, and NOT the others', async () => {
    mockChat()
    renderChat()
    expect(await screen.findByRole('option', { name: 'GPT-4o' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Claude Opus 5' })).toBeTruthy()
    // The measured limit, asserted rather than described in a comment.
    expect(screen.queryByRole('option', { name: 'Gemini 2 Pro' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'GPT-4 (old)' })).toBeNull()
  })

  it('SAYS how many catalog entries it hid, rather than silently showing a subset', async () => {
    mockChat()
    renderChat()
    // 4 in the catalog, 2 offered ⇒ 2 hidden. A screen that shows 2 of 4 without saying so is
    // making an unstated claim about the deployment.
    await waitFor(() => {
      expect(screen.getByText(/further catalog entr/i).textContent).toContain('2')
    })
  })

  it('shows the LIST price and says it is not the bill', async () => {
    mockChat()
    renderChat()
    const line = await screen.findByText(/List price/i)
    expect(line.textContent).toContain('2.5')
    // ⚠ AND IT IS ON THE FIGURE FACE. A price caption set in the body sans is the exact defect
    // figureAudit exists for, and this line is the one numeral a reader compares between models.
    expect(line.getAttribute('class')).toContain('font-figure')
    // ⚠ THE DISCLAIMER IS THE ASSERTION, AND IT IS ITS OWN SENTENCE. A session-key request moves no
    // LXC in the default configuration (measured in talyvor-lens, dd1bb44), so a price on this
    // screen that read as a charge would be a claim about a ledger that did not move.
    expect(screen.getByText(/catalog rate, not this conversation/i)).toBeTruthy()
  })

  it('a FAILED catalog read is not an empty deployment', async () => {
    mockChat({ catalogStatus: 500 })
    renderChat()
    expect(await screen.findByText(/Couldn’t read the model catalog/i)).toBeTruthy()
    // No picker at all — an empty <select> would read as "this deployment serves nothing".
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('an EMPTY catalog and an UNSTREAMABLE catalog are different sentences', async () => {
    mockChat({ catalog: [] })
    const { unmount } = renderChat()
    expect(await screen.findByText(/model catalog is empty/i)).toBeTruthy()
    unmount()

    vi.restoreAllMocks()
    mockChat({ catalog: [CATALOG[2]] }) // google only — in the catalog, not streamable here
    renderChat()
    expect(await screen.findByText(/none of them is on a provider/i)).toBeTruthy()
  })
})

describe('streaming', () => {
  it('renders text WHILE the response is still open — the assertion a buffering client fails', async () => {
    const s = controllableStream()
    mockChat({ body: s.stream })
    renderChat()
    await ask('hello')

    // FIRST HALF ONLY. The stream is deliberately NOT closed.
    s.push('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n')
    await waitFor(() => {
      expect(screen.getByTestId('turn-assistant').textContent).toContain('Hel')
    })
    // ⚠ AND THE ANSWER IS NOT FINISHED — the button still reads Answering…, so this is genuinely
    // mid-stream and not a completed response the test happened to read early.
    expect(screen.getByRole('button', { name: 'Answering…' })).toBeTruthy()

    // SECOND HALF, then the terminator.
    s.push('data: {"choices":[{"delta":{"content":"lo!"}}]}\n\n')
    await waitFor(() => {
      expect(screen.getByTestId('turn-assistant').textContent).toContain('Hello!')
    })
    s.push('data: [DONE]\n\n')
    s.close()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
    })
  })

  it('reassembles a delta split across two network reads', async () => {
    // The frame boundary lands mid-JSON, which is the ordinary case on a real socket.
    const s = controllableStream()
    mockChat({ body: s.stream })
    renderChat()
    await ask('hi')
    s.push('data: {"choices":[{"delta":{"cont')
    s.push('ent":"whole"}}]}\n\ndata: [DONE]\n\n')
    s.close()
    await waitFor(() => {
      expect(screen.getByTestId('turn-assistant').textContent).toContain('whole')
    })
  })

  it('posts the conversation to the SELECTED provider’s path, with the provider’s own body shape', async () => {
    const { posted } = mockChat({ body: 'data: [DONE]\n\n' })
    renderChat()
    await screen.findByRole('option', { name: 'Claude Opus 5' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'claude-opus-5' } })
    await ask('question')

    await waitFor(() => expect(posted).toHaveBeenCalled())
    const { url, init } = posted.mock.calls[0][0]
    expect(url).toBe('/api/ai/stream/anthropic/v1/messages')
    const sent = JSON.parse(String(init.body))
    expect(sent.model).toBe('claude-opus-5')
    expect(sent.stream).toBe(true)
    expect(sent.messages).toEqual([{ role: 'user', content: 'question' }])
    // ⚠ ANTHROPIC 400s WITHOUT max_tokens, and that failure arrives as a dead stream with no
    // frames — the hardest thing to read from a chat screen. OpenAI does not need it.
    expect(sent.max_tokens).toBe(4096)
  })

  it('carries the PRIOR turns, so it is a conversation and not a series of first messages', async () => {
    const { posted } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"one"}}]}\n\ndata: [DONE]\n\n' })
    renderChat()
    await ask('first')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy())
    await ask('second')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(2))
    const sent = JSON.parse(String(posted.mock.calls[1][0].init.body))
    expect(sent.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'one' },
      { role: 'user', content: 'second' },
    ])
  })
})

describe('failures are stated, never swallowed', () => {
  it('names the remedy on a 402 rather than saying something went wrong', async () => {
    mockChat({ streamStatus: 402 })
    renderChat()
    await ask('costly')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/cannot cover the estimated cost/i)
    // The screen that fixes it is linked, not merely named.
    expect(screen.getByRole('link', { name: 'Billing' }).getAttribute('href')).toBe('/billing')
  })

  it('reports a server error carried INSIDE the stream', async () => {
    mockChat({ body: 'data: {"error":{"message":"rate limited"}}\n\n' })
    renderChat()
    await ask('x')
    expect((await screen.findByRole('alert')).textContent).toContain('rate limited')
  })

  it('COUNTS frames it could not read instead of showing a confident empty answer', async () => {
    // ⚠ THE POINT: "the model answered nothing" and "I could not read what it sent" look identical
    // on screen and have completely different causes.
    mockChat({ body: 'data: {"a shape":"nobody here has seen"}\n\ndata: [DONE]\n\n' })
    renderChat()
    await ask('x')
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('1')
    expect(status.textContent).toMatch(/shape this client does not read/i)
  })

  it('does not warn on a healthy stream', async () => {
    // The must-stay-quiet companion: a counter that fires on a good response is noise nobody reads.
    mockChat({ body: 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n' })
    renderChat()
    await ask('x')
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('ok'))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('what this screen refuses to imply', () => {
  it('says the conversation is not saved, before anything is lost', async () => {
    mockChat()
    renderChat()
    expect(await screen.findByText(/it is not saved, and\s+reloading empties it/i)).toBeTruthy()
  })
})
