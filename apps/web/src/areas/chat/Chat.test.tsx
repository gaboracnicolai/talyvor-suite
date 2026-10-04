import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ATTACH_LIMIT_BYTES, Chat, EXAMPLE_PROMPTS, savedLine } from './Chat'
import { type Conversation, historyKey, loadConversations } from './history'

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
  { id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10, release_date: '2024-05-13', tier: 'balanced' },
  { id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, release_date: '2026-07-24', tier: 'frontier' },
  // B18.58 — offered: Lens streams Google through its own upstream and sends OpenAI chunks.
  { id: 'gemini-2-pro', provider: 'google', display_name: 'Gemini 2 Pro', input_per_1m: 1, output_per_1m: 4, release_date: '2025-06-17', tier: 'frontier' },
  // Deprecated: in the catalog, retired at the provider.
  { id: 'gpt-4-old', provider: 'openai', display_name: 'GPT-4 (old)', input_per_1m: 30, output_per_1m: 60, deprecated: true },
]

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
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
  sessionCheckFails = 0,
  body,
  sub = 'user-a',
  usdPerLXC,
  converts = false,
  answerHeaders = {},
  unconfigured = [],
}: {
  catalog?: unknown
  catalogStatus?: number
  streamStatus?: number
  /** B27.5 — how many turns Lens answers 503 auth_unavailable (it could not check the session) first. */
  sessionCheckFails?: number
  body?: BodyInit | null
  /** Who /auth/me says is signed in — history is kept per identity. */
  sub?: string
  /** The credit peg /api/lxc/topup-options confirms. Absent ⇒ that read 404s, as on economy-off. */
  usdPerLXC?: number
  /** Whether Lens converts an opted-in document (answers X-Talyvor-Distill: applied). */
  converts?: boolean
  /** Headers Lens sends with the answer, e.g. X-Talyvor-Cache-Replay on a cached one (B15.6). */
  answerHeaders?: Record<string, string>
  /** B18.58 — the providers /api/ai/providers says Lens holds no key for. */
  unconfigured?: string[]
} = {}) {
  const posted = vi.fn()
  const uploaded = vi.fn()
  const feedback = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    // B23.12 — a thumbs-down: Lens removes the stored answer and says what went.
    if (url === '/api/ai/feedback' && init?.method === 'POST') {
      feedback(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ stored: true, served_from: 'pool', answers_removed: 1, exact_copies_removed: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // B18.24 — Lens stores an attached document and answers the id a question references.
    if (url.startsWith('/api/documents?') && init?.method === 'POST') {
      uploaded({ url, init })
      return new Response(JSON.stringify({ id: `tdoc_${uploaded.mock.calls.length}`, size_bytes: (init.body as File).size }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/auth/me') {
      return new Response(
        JSON.stringify({ mode: 'oidc', authenticated: true, user: { sub, email: `${sub}@example.com` } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url === '/api/lxc/topup-options' && usdPerLXC !== undefined) {
      return new Response(JSON.stringify({ amounts_cents: [1000], usd_per_lxc: usdPerLXC }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/ai/providers') {
      return new Response(JSON.stringify({ unconfigured }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/models') {
      if (catalogStatus !== 200) return new Response('nope', { status: catalogStatus })
      return new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.startsWith('/api/ai/stream/')) {
      posted({ url, init })
      if (posted.mock.calls.length <= sessionCheckFails) {
        return new Response(JSON.stringify({ error: 'your session could not be checked just now; try again', code: 'auth_unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
        })
      }
      if (streamStatus !== 200) return new Response('refused', { status: streamStatus })
      const optedIn = new Headers(init?.headers).get('X-Talyvor-Distill') === 'true'
      return new Response(body ?? '', {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          ...(converts && optedIn ? { 'X-Talyvor-Distill': 'applied' } : {}),
          ...answerHeaders,
        },
      })
    }
    return new Response('null', { status: 404 })
  })
  return { posted, uploaded, feedback }
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

/** Opens the picker and chooses a model — which also waits for the catalog to load. */
async function chooseModel(name: string) {
  const trigger = await screen.findByRole('button', { name: /^Model: / })
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(`^${name}\\b`) }))
  await screen.findByRole('button', { name: `Model: ${name}` })
}

async function ask(text: string) {
  const box = await screen.findByPlaceholderText('Ask anything')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('the model picker reads the deployment, not this file', () => {
  it('lists every priced chat model by provider, newest release first — one it cannot stream is shown, not offered', async () => {
    mockChat({
      catalog: [
        ...CATALOG,
        { id: 'gpt-5', provider: 'openai', display_name: 'GPT-5', input_per_1m: 1.25, output_per_1m: 10, release_date: '2025-08-07', tier: 'frontier' },
        // B18.60 — ordered by release date, not the number in the name: GPT-4.1 came out after GPT-4.5.
        { id: 'gpt-4.5', provider: 'openai', display_name: 'GPT-4.5', input_per_1m: 75, output_per_1m: 150, release_date: '2025-02-27', tier: 'frontier' },
        { id: 'gpt-4.1', provider: 'openai', display_name: 'GPT-4.1', input_per_1m: 2, output_per_1m: 8, release_date: '2025-04-14', tier: 'balanced' },
        // Not a chat model: an embedding has no output price.
        { id: 'text-embedding-3-small', provider: 'openai', display_name: 'Embedding 3 small', input_per_1m: 0.02, output_per_1m: 0 },
        // A provider Lens has no proxy route for.
        { id: 'command-r', provider: 'cohere', display_name: 'Command R', input_per_1m: 0.5, output_per_1m: 1.5 },
      ],
    })
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /^Model: / }))
    const listed = screen
      .getAllByRole('group')
      .map((g) => [g.getAttribute('aria-label'), within(g).getAllByRole('option').map((o) => o.querySelector('span')?.firstChild?.textContent)])
    expect(listed).toEqual([
      ['OpenAI', ['GPT-5', 'GPT-4.1', 'GPT-4.5', 'GPT-4o']],
      ['Anthropic', ['Claude Opus 5']],
      ['Google', ['Gemini 2 Pro']],
      // ⚠ LISTED, NOT OFFERED: Lens has no route to stream it through; shown disabled, with the reason.
      ['cohere', ['Command R']],
    ])
    expect(screen.getByRole('option', { name: /^Gemini 2 Pro/ }).getAttribute('aria-disabled')).toBe('false')
    expect(screen.getByRole('option', { name: /^Command R/ }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(/Lens has no streaming route for this provider/)).toBeTruthy()
    // The retired model and the embedding are COUNTED, never silently dropped.
    expect(screen.getByText(/retired or non-chat catalog entr/).textContent).toContain('2')
  })

  it('lists only the providers this deployment’s Lens holds a key for, and counts the models it hid (B18.58)', async () => {
    mockChat({ unconfigured: ['google', 'bedrock'] })
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /^Model: / }))
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['OpenAI', 'Anthropic'])
    expect(screen.queryByRole('option', { name: /^Gemini 2 Pro/ })).toBeNull()
    expect(screen.getByText(/on providers without a key not listed/).textContent).toContain('1 model on')
  })

  it('defaults to the newest frontier model in the catalog, and a model added to Lens appears — and leads — with no change here', async () => {
    // B18.60 — a newer model that is not frontier does not become the default.
    mockChat({ catalog: [...CATALOG, { id: 'claude-haiku-6', provider: 'anthropic', display_name: 'Claude Haiku 6', input_per_1m: 1, output_per_1m: 5, release_date: '2026-09-01', tier: 'fast' }] })
    const { unmount } = renderChat()
    // Claude Opus 5 is the fixture's newest frontier model.
    expect(await screen.findByRole('button', { name: 'Model: Claude Opus 5' })).toBeTruthy()
    unmount()

    vi.restoreAllMocks()
    mockChat({ catalog: [...CATALOG, { id: 'gpt-6', provider: 'openai', display_name: 'GPT-6', input_per_1m: 3, output_per_1m: 20, release_date: '2026-09-22', tier: 'frontier' }] })
    renderChat()
    expect(await screen.findByRole('button', { name: 'Model: GPT-6' })).toBeTruthy()
  })

  it('searches, and is driven from the keyboard: arrows move, Enter picks, Escape closes', async () => {
    mockChat()
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /^Model: / }))
    const search = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.change(search, { target: { value: 'gpt' } })
    expect(screen.getAllByRole('option').map((o) => o.querySelector('span')?.firstChild?.textContent)).toEqual(['GPT-4o'])
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: 'Model: GPT-4o' })).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Model: GPT-4o' }))
    const again = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.keyDown(again, { key: 'ArrowDown' }) // GPT-4o → Claude Opus 5
    fireEvent.keyDown(again, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: 'Model: Claude Opus 5' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Model: Claude Opus 5' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search models' }), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('scrolls inside a panel of fixed height, so it never covers the page', async () => {
    mockChat()
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /^Model: / }))
    const list = screen.getByRole('listbox')
    expect(list.className).toContain('overflow-y-auto')
    expect(list.parentElement?.className).toContain('h-80')
  })

  it('shows the LIST price of the chosen model and says what it is', async () => {
    mockChat()
    renderChat()
    await chooseModel('GPT-4o')
    const line = await screen.findByText(/List price/i)
    // ⚠ THE WHOLE RENDERED STRING, NOT A SUBSTRING. This assertion used to be
    // `toContain('2.5')`, which passes on `$2.50` AND on the bare `2.5` this screen actually
    // shipped — so it could not tell a priced figure from an unlabelled number.
    expect(line.textContent).toBe('List price · $2.50 in / $10.00 out per 1M tokens')
    expect(line.textContent).toMatch(/\$\d/)
    // ⚠ AND IT IS ON THE FIGURE FACE — this line is the one numeral a reader compares between models.
    expect(line.getAttribute('class')).toContain('font-figure')
    // The disclaimer that it is not the bill lives on /chat/help (ChatHelp.test.tsx asserts it).
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
    mockChat({ catalog: [CATALOG[2]], unconfigured: ['google'] }) // google only, and Lens has no Google key
    const second = renderChat()
    expect(await screen.findByText(/Lens holds no provider key for any of them/i)).toBeTruthy()
    second.unmount()

    vi.restoreAllMocks()
    mockChat({ catalog: [{ id: 'command-r', provider: 'cohere', display_name: 'Command R', input_per_1m: 0.5, output_per_1m: 1.5 }] })
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
    // ⚠ AND THE ANSWER IS NOT FINISHED — the button still reads Stop, so this is genuinely
    // mid-stream and not a completed response the test happened to read early.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()

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
    await chooseModel('Claude Opus 5')
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

describe('the keyboard sends (B10.2)', () => {
  it('Enter sends; Shift+Enter is a new line; an empty box sends nothing', async () => {
    const { posted } = mockChat({ body: 'data: [DONE]\n\n' })
    renderChat()
    const box = await screen.findByPlaceholderText('Ask anything')
    await chooseModel('GPT-4o')

    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.change(box, { target: { value: 'line one' } })
    // fireEvent returns false when the handler called preventDefault — the newline was suppressed.
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(posted).not.toHaveBeenCalled()

    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false)
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(posted.mock.calls[0][0].init.body)).messages).toEqual([
      { role: 'user', content: 'line one' },
    ])
  })

  it('Cmd+Enter and Ctrl+Enter send too', async () => {
    const { posted } = mockChat({ body: 'data: [DONE]\n\n' })
    renderChat()
    const box = await screen.findByPlaceholderText('Ask anything')
    await chooseModel('GPT-4o')
    fireEvent.change(box, { target: { value: 'one' } })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy())
    fireEvent.change(box, { target: { value: 'two' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(2))
  })

  it('never sends on the Enter that confirms an IME composition', async () => {
    const { posted } = mockChat({ body: 'data: [DONE]\n\n' })
    renderChat()
    const box = await screen.findByPlaceholderText('Ask anything')
    await chooseModel('GPT-4o')
    fireEvent.change(box, { target: { value: 'tokyo' } }) // mid-composition; the draft's script is irrelevant to the guard
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 }) // Safari's form of the same keydown
    expect(posted).not.toHaveBeenCalled()
  })

  it('while answering, Enter queues nothing and Stop ends the request', async () => {
    const s = controllableStream()
    const { posted } = mockChat({ body: s.stream })
    renderChat()
    await ask('hello')
    s.push('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n')
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('Hel'))

    const box = screen.getByPlaceholderText('Ask anything')
    fireEvent.change(box, { target: { value: 'next question' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(posted).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    // ⚠ THE SIGNAL THE REQUEST WAS MADE WITH IS ABORTED — that is what reaches the BFF and stops Lens
    // generating. A button that only flipped its label would pass the next assertion alone.
    expect((posted.mock.calls[0][0].init.signal as AbortSignal).aborted).toBe(true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy())
    // Stop did not send the draft typed meanwhile, and the part of the answer that arrived stays.
    expect(posted).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('turn-assistant').textContent).toContain('Hel')
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

  it('B27.5 — a session Lens could not check is retried quietly, not signed out', async () => {
    const { posted } = mockChat({
      sessionCheckFails: 2,
      body: 'data: {"choices":[{"delta":{"content":"still here"}}]}\n\ndata: [DONE]\n\n',
    })
    renderChat()
    await ask('hello')
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('still here'))
    expect(posted).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toMatch(/no longer signed in/i)
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
  it('says WHERE conversations are kept, so "saved" is not read as "saved to my account"', async () => {
    mockChat()
    renderChat()
    // One quiet fact in the rail; the full sentence is on /chat/help (asserted there).
    expect(await screen.findByText('Kept in this browser only.')).toBeTruthy()
  })
})

// B1.3 — conversations persist and reopen. Kept in localStorage, per signed-in identity.
function seed(sub: string, ...convs: Array<Pick<Conversation, 'id' | 'title' | 'updated_at'>>) {
  const full: Conversation[] = convs.map((c) => ({
    ...c,
    renamed: false,
    model_id: 'gpt-4o',
    created_at: c.updated_at,
    messages: [
      { role: 'user', content: c.title },
      { role: 'assistant', content: `answer to ${c.title}` },
    ],
  }))
  window.localStorage.setItem(historyKey(sub), JSON.stringify(full))
}

describe('conversation history', () => {
  it('survives a closed tab: reopening shows the conversation in the list AND on screen', async () => {
    mockChat({ body: 'data: {"choices":[{"delta":{"content":"Paris."}}]}\n\ndata: [DONE]\n\n' })
    const tab = renderChat()
    await ask('Capital of France?')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy())
    tab.unmount()

    // A fresh render with a fresh QueryClient is a fresh tab; only localStorage carries over.
    renderChat()
    expect(await screen.findByRole('button', { name: 'Capital of France?' })).toBeTruthy()
    expect(screen.getByTestId('turn-user').textContent).toContain('Capital of France?')
    expect(screen.getByTestId('turn-assistant').textContent).toContain('Paris.')
  })

  it('lists newest first, and opening one shows its turns', async () => {
    seed('user-a', { id: 'a', title: 'Older', updated_at: 1 }, { id: 'b', title: 'Newer', updated_at: 2 })
    mockChat()
    renderChat()
    const list = await screen.findByRole('list', { name: 'Saved conversations' })
    expect([...list.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Newer', 'Older'])
    fireEvent.click(screen.getByRole('button', { name: 'Older' }))
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('answer to Older'))
  })

  it('is not shown to a different account on the same browser', async () => {
    seed('user-a', { id: 'a', title: 'Private', updated_at: 1 })
    mockChat({ sub: 'user-b' })
    renderChat()
    expect(await screen.findByText(/No conversations yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Private' })).toBeNull()
  })

  it('renames, and the name is what storage keeps', async () => {
    seed('user-a', { id: 'a', title: 'Capital of France?', updated_at: 1 })
    mockChat()
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Conversation name'), { target: { value: 'Geography' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByRole('button', { name: 'Geography' })).toBeTruthy()
    expect(loadConversations('user-a').list[0]?.title).toBe('Geography')
  })

  it('deletes only after a confirm, and only the one asked for', async () => {
    seed('user-a', { id: 'a', title: 'Older', updated_at: 1 }, { id: 'b', title: 'Newer', updated_at: 2 })
    mockChat()
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(loadConversations('user-a').list).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Newer' })).toBeNull())
    expect(loadConversations('user-a').list.map((c) => c.title)).toEqual(['Older'])
  })
})

// B1.4 — every answer carries a visible price: the provider's token counts × the catalog rate,
// in credits at the deployment's peg.
const OPENAI_PRICED =
  'data: {"model":"gpt-4o-2024-08-06","choices":[{"delta":{"content":"Paris."}}]}\n\n' +
  'data: {"model":"gpt-4o-2024-08-06","choices":[],"usage":{"prompt_tokens":2000,"completion_tokens":1000}}\n\n' +
  'data: [DONE]\n\n'

describe('what each answer cost', () => {
  it('prices an OpenAI answer in credits at the deployment’s peg, and names the model', async () => {
    mockChat({ body: OPENAI_PRICED, usdPerLXC: 0.1 })
    renderChat()
    await chooseModel('GPT-4o')
    await ask('Capital of France?')
    // (2000 × $2.50 + 1000 × $10.00) / 1M = $0.015 = 0.15 LXC at $0.10. A dated variant of the
    // asked-for id keeps the catalog's name.
    expect((await screen.findByTestId('turn-cost')).textContent).toBe(
      '≈ 0.15 LXC · GPT-4o · 2,000 in / 1,000 out tokens',
    )
  })

  it('streams a Google and a Mistral answer through each provider’s own path, and prices the Mistral one (B18.58)', async () => {
    const mistral = { id: 'mistral-large-latest', provider: 'mistral', display_name: 'Mistral Large', input_per_1m: 2, output_per_1m: 6 }
    // Exactly what Lens sends the client for Google (talyvor-lens stream_providers.go openAIChunk):
    // text chunks, a finish chunk, [DONE] — and no usage frame yet (B18.59).
    const google =
      'data: {"object":"chat.completion.chunk","model":"gemini-2-pro","choices":[{"index":0,"delta":{"content":"Bonjour."},"finish_reason":null}]}\n\n' +
      'data: {"object":"chat.completion.chunk","model":"gemini-2-pro","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n'
    const first = mockChat({ catalog: [...CATALOG, mistral], body: google, usdPerLXC: 0.1 })
    const view = renderChat()
    await chooseModel('Gemini 2 Pro')
    await ask('Say hello in French')
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('Bonjour.'))
    const g = first.posted.mock.calls[0][0]
    expect(g.url).toBe('/api/ai/stream/google/v1/chat/completions')
    expect(JSON.parse(String(g.init.body))).toEqual({
      model: 'gemini-2-pro',
      stream: true,
      messages: [{ role: 'user', content: 'Say hello in French' }],
    })
    view.unmount()

    vi.restoreAllMocks()
    window.localStorage.clear()
    // Mistral's own OpenAI-compatible stream; Lens asks it for the usage frame (include_usage).
    const second = mockChat({
      catalog: [...CATALOG, mistral],
      body:
        'data: {"model":"mistral-large-latest","choices":[{"delta":{"content":"Bonjour."}}]}\n\n' +
        'data: {"model":"mistral-large-latest","choices":[],"usage":{"prompt_tokens":2000,"completion_tokens":1000}}\n\n' +
        'data: [DONE]\n\n',
      usdPerLXC: 0.1,
    })
    renderChat()
    await chooseModel('Mistral Large')
    await ask('Say hello in French')
    // (2000 × $2 + 1000 × $6) / 1M = $0.01 = 0.1 LXC at $0.10.
    expect((await screen.findByTestId('turn-cost')).textContent).toBe(
      '≈ 0.1 LXC · Mistral Large · 2,000 in / 1,000 out tokens',
    )
    expect(second.posted.mock.calls[0][0].url).toBe('/api/ai/stream/mistral/v1/chat/completions')
  })

  it('names and prices the model Lens routed the answer to, not the one asked (B15.3b)', async () => {
    const routed = OPENAI_PRICED.replaceAll('gpt-4o-2024-08-06', 'gpt-4o-mini-2024-07-18')
    const mini = { id: 'gpt-4o-mini', provider: 'openai', display_name: 'GPT-4o mini', input_per_1m: 0.15, output_per_1m: 0.6 }
    mockChat({ body: routed, usdPerLXC: 0.1, catalog: [...CATALOG, mini] })
    renderChat()
    // Not chooseModel('GPT-4o'): its /^GPT-4o\b/ also matches GPT-4o mini.
    fireEvent.click(await screen.findByRole('button', { name: /^Model: / }))
    fireEvent.click(await screen.findByRole('option', { name: /^GPT-4o(?! mini)/ }))
    await screen.findByRole('button', { name: 'Model: GPT-4o' })
    await ask('Capital of France?')
    // (2000 × $0.15 + 1000 × $0.60) / 1M = $0.0009 = 0.009 LXC — not GPT-4o's 0.15.
    expect((await screen.findByTestId('turn-cost')).textContent).toBe(
      '≈ 0.009 LXC · GPT-4o mini · 2,000 in / 1,000 out tokens',
    )
  })

  it('prices an Anthropic answer from message_start input and the LAST message_delta output', async () => {
    mockChat({
      usdPerLXC: 0.1,
      body:
        'data: {"type":"message_start","message":{"model":"claude-opus-5","usage":{"input_tokens":200,"output_tokens":1}}}\n\n' +
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi."}}\n\n' +
        'data: {"type":"message_delta","usage":{"output_tokens":400}}\n\n' +
        'data: {"type":"message_stop"}\n\n',
    })
    renderChat()
    await chooseModel('Claude Opus 5')
    await ask('hello')
    // (200 × $5 + 400 × $25) / 1M = $0.011 = 0.11 LXC.
    expect((await screen.findByTestId('turn-cost')).textContent).toBe(
      '≈ 0.11 LXC · Claude Opus 5 · 200 in / 400 out tokens',
    )
  })

  it('prices in dollars when the deployment confirms no peg — never a credit figure at a guess', async () => {
    mockChat({ body: OPENAI_PRICED })
    renderChat()
    await chooseModel('GPT-4o')
    await ask('Capital of France?')
    expect((await screen.findByTestId('turn-cost')).textContent).toMatch(/^≈ \$0\.015 · GPT-4o/)
  })

  it('keeps the price with the saved answer, and never sends it upstream', async () => {
    const { posted } = mockChat({ body: OPENAI_PRICED, usdPerLXC: 0.1 })
    const tab = renderChat()
    await chooseModel('GPT-4o')
    await ask('first')
    await screen.findByTestId('turn-cost')
    tab.unmount()

    renderChat()
    expect((await screen.findByTestId('turn-cost')).textContent).toContain('0.15 LXC')
    await ask('second')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(2))
    const sent = JSON.parse(String(posted.mock.calls[1][0].init.body))
    // Anthropic refuses a message field it does not know; the price is the screen's, not the wire's.
    for (const m of sent.messages) expect(Object.keys(m).sort()).toEqual(['content', 'role'])
  })
})

// B10.3 — a new chat greets and offers questions to click; clicking one asks it.
it('nothing asked yet: an example question is asked when clicked', async () => {
  const { posted } = mockChat({ body: 'data: [DONE]\n\n' })
  renderChat()
  expect(await screen.findByRole('heading', { name: 'What can I help with?' })).toBeTruthy()
  await chooseModel('GPT-4o')
  fireEvent.click(screen.getByRole('button', { name: EXAMPLE_PROMPTS[0] }))
  await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
  expect(JSON.parse(String(posted.mock.calls[0][0].init.body)).messages).toEqual([
    { role: 'user', content: EXAMPLE_PROMPTS[0] },
  ])
})

describe('the reading column (B10.3)', () => {
  it('renders a reply as Markdown — a heading, a list, a table, and code with its own Copy', async () => {
    const reply = '## Steps\n\n- one\n- **two**\n\n| a | b |\n|---|---|\n| x | y |\n\n```go\nfmt.Println("hi")\n```\n'
    mockChat({ body: `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n` })
    renderChat()
    await ask('show me')
    const turn = await screen.findByTestId('turn-assistant')
    // B16.3 — the answer is revealed over a few frames; its actions appear once all of it is shown.
    await screen.findByRole('button', { name: 'Regenerate' })
    expect(turn.querySelector('h4')?.textContent).toBe('Steps')
    expect(Array.from(turn.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['one', 'two'])
    expect(turn.querySelector('strong')?.textContent).toBe('two')
    expect(Array.from(turn.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['x', 'y'])
    expect(turn.querySelector('pre code')?.textContent).toBe('fmt.Println("hi")')
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy()
  })

  it('Regenerate asks the last question again and replaces the answer', async () => {
    const { posted } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"first"}}]}\n\ndata: [DONE]\n\n' })
    renderChat()
    await ask('question')
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(2))
    // The same question, without the answer being replaced.
    expect(JSON.parse(String(posted.mock.calls[1][0].init.body)).messages).toEqual([
      { role: 'user', content: 'question' },
    ])
    await waitFor(() => expect(screen.getAllByTestId('turn-assistant')).toHaveLength(1))
  })

  // B15.6 — the footer says where an answer came from when the model did not write it just now.
  it('an answer Lens replayed from the cache says it came from your earlier answer, at 0 LXC', async () => {
    mockChat({
      body: 'data: {"choices":[{"delta":{"content":"London."}}]}\n\ndata: [DONE]\n\n',
      answerHeaders: { 'X-Talyvor-Cache-Replay': 'true' },
    })
    renderChat()
    await ask('what is the capital of the UK?')
    expect((await screen.findByTestId('turn-cost')).textContent).toBe('from your earlier answer · 0 LXC')
  })

  it('an answer served from the shared pool says so, with its discount and what it cost', async () => {
    mockChat({
      body: 'data: {"choices":[{"delta":{"content":"London."}}]}\n\ndata: [DONE]\n\n',
      answerHeaders: {
        'X-Talyvor-Cache-Replay': 'true',
        'X-Talyvor-Pool-Charged-ULXC': '1519',
        'X-Talyvor-Pool-Discount-Rate': '0.3',
      },
    })
    renderChat()
    await ask('what is the capital of the UK?')
    expect((await screen.findByTestId('turn-cost')).textContent).toBe('shared answer · 30% off · ≈ 0.0015 LXC')
  })

  // B23.12
  it('Wrong answer on a shared answer tells Lens which request it was; the answer then says it won’t be served again and offers Regenerate', async () => {
    const { feedback } = mockChat({
      body: 'data: {"choices":[{"delta":{"content":"Paris."}}]}\n\ndata: [DONE]\n\n',
      answerHeaders: {
        'X-Talyvor-Cache-Replay': 'true',
        'X-Talyvor-Pool-Charged-ULXC': '1519',
        'X-Talyvor-Pool-Discount-Rate': '0.3',
        'X-Talyvor-Request-ID': 'req-42',
      },
    })
    renderChat()
    await ask('what is the capital of the UK?')
    fireEvent.click(await screen.findByRole('button', { name: 'Wrong answer' }))
    await waitFor(() =>
      expect(screen.getByTestId('turn-marked').textContent).toBe(
        'Marked wrong — this answer won’t be served again. Regenerate asks the model afresh.',
      ),
    )
    expect(feedback).toHaveBeenCalledWith({ request_id: 'req-42', signal: 'negative' })
    expect(screen.queryByRole('button', { name: 'Wrong answer' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy()
  })

  it('Regenerate asks Lens to bypass its cache; a question asked normally does not', async () => {
    const { posted } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"first"}}]}\n\ndata: [DONE]\n\n' })
    renderChat()
    await ask('question')
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(2))
    const bypass = (i: number) => new Headers(posted.mock.calls[i][0].init.headers).get('X-Talyvor-Cache')
    expect(bypass(0)).toBeNull()
    expect(bypass(1)).toBe('bypass')
  })

  it('links to the how-to page from the rail', async () => {
    mockChat()
    renderChat()
    const link = await screen.findByRole('link', { name: 'How to use Talyvor Chat' })
    expect(link.getAttribute('href')).toBe('/chat/help')
  })
})

describe('attached documents (B10.3)', () => {
  const pdf = () => new File(['%PDF-1.7 quarterly report'], 'report.pdf', { type: 'application/pdf' })

  async function attach(files: File[]) {
    await chooseModel('GPT-4o')
    fireEvent.change(document.getElementById('chat-attach') as HTMLInputElement, { target: { files } })
  }

  it('uploads a 20 MB slide deck, asks about it by id, and the footer shows what conversion saved (B18.24)', async () => {
    const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    const { posted, uploaded } = mockChat({
      body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
      converts: true,
      answerHeaders: { 'X-Talyvor-Distill-Tokens-Saved': '1834', 'X-Talyvor-Distill-Bytes-Saved': '19800000' },
    })
    renderChat()
    await attach([new File([new Uint8Array(20_000_000)], 'Q3 deck.pptx')])
    expect(await screen.findByText('Q3 deck.pptx')).toBeTruthy()
    const { url, init: sent } = uploaded.mock.calls[0][0]
    expect(url).toBe('/api/documents?filename=Q3%20deck.pptx')
    expect(new Headers(sent.headers).get('Content-Type')).toBe(pptx)
    expect((sent.body as File).size).toBe(20_000_000)

    await ask('summarise this')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    const { init } = posted.mock.calls[0][0]
    expect(new Headers(init.headers).get('X-Talyvor-Distill')).toBe('true')
    const [message] = JSON.parse(String(init.body)).messages
    expect(message.content).toEqual([
      { type: 'text', text: 'summarise this' },
      { type: 'file', file: { file_id: 'tdoc_1' } },
    ])
    expect(String(init.body).length).toBeLessThan(1000)

    await waitFor(() =>
      expect(screen.getByTestId('documents-status').textContent).toBe('Converted to text before the model read it.'),
    )
    await waitFor(() =>
      expect(screen.getByTestId('turn-saved').textContent).toBe('Conversion saved 1,834 tokens · 19.8 MB smaller'),
    )
    // What is kept is Lens's id for the file, never its bytes, so a reopened conversation still references it.
    const kept = loadConversations('user-a').list[0].messages[0]
    expect(kept.attachments).toEqual([{ name: 'Q3 deck.pptx', media_type: pptx, size: 20_000_000, file_id: 'tdoc_1' }])
    expect(kept.converted).toBe(true)
  })

  it('shows the size conversion took off when Lens measured no tokens, and never a zero saving', () => {
    // Lens counts 0 tokens for a binary file such as a slide deck at the faithful tier (B18.13).
    expect(savedLine({ tokens: 0, bytes: 19_800_000 })).toBe('Converted to text, 19.8 MB smaller')
    expect(savedLine({ tokens: 0, bytes: 0 })).toBeUndefined()
  })

  it('says so when Lens sent the original file instead of converting it', async () => {
    mockChat({ body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', converts: false })
    renderChat()
    await attach([pdf()])
    await screen.findByText('report.pdf')
    await ask('summarise this')
    await waitFor(() => expect(screen.getByTestId('documents-status').textContent).toMatch(/^Sent as the original file/))
  })

  /** Holds every document upload until the returned function lets them through. */
  function holdUploads(): () => void {
    const wire = vi.mocked(globalThis.fetch).getMockImplementation()!
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (String(input).startsWith('/api/documents?')) await held
      return wire(input, init)
    })
    return release
  }

  it('a question sent while its document is still uploading waits for it, says so, then goes with it (B26.20)', async () => {
    const { posted } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n' })
    const release = holdUploads()
    renderChat()
    await attach([pdf()])
    await screen.findByTestId('attachment-uploading')
    const box = await screen.findByPlaceholderText('Ask anything')
    fireEvent.change(box, { target: { value: 'summarise this' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect((await screen.findByTestId('send-waiting')).textContent).toBe('Sends when report.pdf has uploaded.')
    expect(posted).not.toHaveBeenCalled()

    release()
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    const [message] = JSON.parse(String(posted.mock.calls[0][0].init.body)).messages
    expect(message.content).toEqual([
      { type: 'text', text: 'summarise this' },
      { type: 'file', file: { file_id: 'tdoc_1' } },
    ])
    expect(screen.queryByTestId('send-waiting')).toBeNull()
  })

  it('a waiting question is not sent when its document fails to upload; it stays in the box', async () => {
    const { posted } = mockChat()
    const wire = vi.mocked(globalThis.fetch).getMockImplementation()!
    let refuse!: () => void
    const held = new Promise<void>((r) => {
      refuse = r
    })
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (!String(input).startsWith('/api/documents?')) return wire(input, init)
      await held
      return new Response(JSON.stringify({ error: 'storage is full' }), { status: 507, headers: { 'Content-Type': 'application/json' } })
    })
    renderChat()
    await attach([pdf()])
    await screen.findByTestId('attachment-uploading')
    const box = await screen.findByPlaceholderText('Ask anything')
    fireEvent.change(box, { target: { value: 'summarise this' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByTestId('send-waiting')

    refuse()
    expect((await screen.findByRole('alert')).textContent).toMatch(/^report\.pdf couldn’t be uploaded/)
    expect(screen.queryByTestId('send-waiting')).toBeNull()
    expect((box as HTMLTextAreaElement).value).toBe('summarise this')
    expect(posted).not.toHaveBeenCalled()
  })

  it('refuses a format Lens cannot convert, and a document over the limit, in words', async () => {
    const { posted, uploaded } = mockChat()
    renderChat()
    await attach([new File(['x'], 'deck.key')])
    expect((await screen.findByRole('alert')).textContent).toMatch(/deck\.key can’t be converted/)
    await attach([new File([new Uint8Array(ATTACH_LIMIT_BYTES + 1)], 'huge.pdf', { type: 'application/pdf' })])
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/huge\.pdf is too large: a document can be at most 25 MB/))
    expect(screen.queryByRole('list', { name: 'Attached documents' })).toBeNull()
    expect(uploaded).not.toHaveBeenCalled()
    expect(posted).not.toHaveBeenCalled()
  })
})

describe('the sidebar hides and comes back (B15.5)', () => {
  const column = () => screen.queryByRole('button', { name: 'Hide sidebar' })

  it('hides from the top of the sidebar, stays hidden across a reload, and one click brings it back', async () => {
    mockChat()
    const first = renderChat()
    fireEvent.click(await screen.findByRole('button', { name: 'Hide sidebar' }))
    // The slim rail keeps a new chat and the way back; the conversation list is gone.
    const slim = screen.getByRole('complementary', { name: 'Conversations' })
    expect(within(slim).getByRole('button', { name: 'New chat' })).toBeInTheDocument()
    expect(within(slim).getByRole('button', { name: 'Show sidebar' }).getAttribute('title')).toMatch(/Shift/)
    expect(within(slim).queryByRole('link', { name: 'How to use Talyvor Chat' })).toBeNull()

    first.unmount()
    renderChat()
    expect(await screen.findByRole('button', { name: 'Show sidebar' })).toBeInTheDocument()
    expect(column()).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(column()).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'How to use Talyvor Chat' })).toBeInTheDocument()
  })

  it('Ctrl+Shift+S toggles it', async () => {
    mockChat()
    renderChat()
    await screen.findByRole('button', { name: 'Hide sidebar' })
    fireEvent.keyDown(document, { key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true })
    expect(await screen.findByRole('button', { name: 'Show sidebar' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true })
    expect(await screen.findByRole('button', { name: 'Hide sidebar' })).toBeInTheDocument()
  })
})

// B16.4 — measured 27 Sep: "what is 2+2?" cost 76 input tokens as a chat's first question and 14
// elsewhere. Counted on claude-opus-5, 76 is that question with three earlier exchanges in front of
// it; alone it is 13. Every question carries its own conversation. A new chat must carry nothing.
describe('a new chat carries nothing from another (B16.4)', () => {
  it('every way to start a new chat sends the first question alone, byte-identical to the first chat', async () => {
    const { posted } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"London"}}]}\n\ndata: [DONE]\n\n' })
    renderChat()
    const answered = async (n: number) => {
      await waitFor(() => expect(posted).toHaveBeenCalledTimes(n))
      await screen.findByRole('button', { name: 'Regenerate' })
    }
    await ask('what is the capital of the UK?')
    await answered(1)
    await ask('and of France?')
    await answered(2)

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    await ask('what is the capital of the UK?')
    await answered(3)

    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    const slim = screen.getByRole('complementary', { name: 'Conversations' })
    fireEvent.click(within(slim).getByRole('button', { name: 'New chat' }))
    await ask('what is the capital of the UK?')
    await answered(4)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    await ask('what is the capital of the UK?')
    await answered(5)

    const bodies = posted.mock.calls.map((c) => String(c[0].init.body))
    // The control: a follow-up does carry its own conversation.
    expect(JSON.parse(bodies[1]).messages.map((m: { content: string }) => m.content)).toEqual(['what is the capital of the UK?', 'London', 'and of France?'])
    expect(JSON.parse(bodies[0]).messages).toEqual([{ role: 'user', content: 'what is the capital of the UK?' }])
    expect([bodies[2], bodies[3], bodies[4]]).toEqual([bodies[0], bodies[0], bodies[0]])
  })
})
