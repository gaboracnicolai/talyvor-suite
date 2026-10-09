import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ATTACH_LIMIT_BYTES, Chat, EXAMPLE_PROMPTS, IMAGE_LIMIT_BYTES, savedLine } from './Chat'
import { CONTINUE_PROMPT, type Conversation, historyKey, loadConversations } from './history'
import { InstructionsPage } from './InstructionsPage'
import { PromptsPage } from './PromptsPage'
import { MemoryPage } from './MemoryPage'

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
  refusedWith = 'refused',
  sessionCheckFails = 0,
  body,
  bodies,
  sub = 'user-a',
  usdPerLXC,
  converts = false,
  answerHeaders = {},
  unconfigured = [],
  identityAfter,
  prompts,
  listings = {},
}: {
  catalog?: unknown
  catalogStatus?: number
  streamStatus?: number
  /** B28.348 — the body Lens refuses with when streamStatus is not 200. */
  refusedWith?: string
  /** B27.5 — how many turns Lens answers 503 auth_unavailable (it could not check the session) first. */
  sessionCheckFails?: number
  body?: BodyInit | null
  /** B28.81 — the SSE body of each answer in turn, when they differ; `body` is every answer's otherwise. */
  bodies?: string[]
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
  /** B28.275 — /auth/me answers only once this settles, so a question can be sent before it does. */
  identityAfter?: Promise<void>
  /** B28.370 — the workspace's prompt library as Lens holds it; a prompt saved is added to it. */
  prompts?: Array<{ name: string; version: number; description: string; content: string }>
  /** B28.426 — the marketplace listings Lens shows this person, by id. */
  listings?: Record<string, { id: string; title: string; kind: string; price_per_use_ulxc: number }>
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
      await identityAfter
      return new Response(
        JSON.stringify({ mode: 'oidc', authenticated: true, user: { sub, email: `${sub}@example.com` } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url === '/api/lxc/topup-options' && usdPerLXC !== undefined) {
      return new Response(JSON.stringify({ allowed_usd_cents: [1000], usd_per_lxc: usdPerLXC }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/chat/prompts' && prompts !== undefined) {
      if (init?.method === 'POST') {
        const saved = { ...(JSON.parse(String(init.body)) as { name: string; content: string; description: string }), version: 1 }
        prompts.push(saved)
        return new Response(JSON.stringify(saved), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ prompts }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const listing = /^\/api\/marketplace\/listings\/([^/?]+)$/.exec(url)
    if (listing !== null && listings[decodeURIComponent(listing[1])] !== undefined) {
      return new Response(JSON.stringify(listings[decodeURIComponent(listing[1])]), { status: 200, headers: { 'Content-Type': 'application/json' } })
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
      if (streamStatus !== 200) return new Response(refusedWith, { status: streamStatus })
      const optedIn = new Headers(init?.headers).get('X-Talyvor-Distill') === 'true'
      return new Response(bodies?.[posted.mock.calls.length - 1 - sessionCheckFails] ?? body ?? '', {
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

  it('B28.78 — an answer stopped before it said anything is not sent with the next question, which still answers', async () => {
    const s = controllableStream()
    mockChat({ body: s.stream })
    renderChat()
    await chooseModel('Claude Opus 5')
    await ask('first')
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy())

    const { posted } = mockChat({
      body: 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answered"}}\n\ndata: {"type":"message_stop"}\n\n',
    })
    await ask('second')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    // ⚠ NO EMPTY ASSISTANT TURN BETWEEN THEM: Anthropic refuses the whole request over one.
    expect(JSON.parse(String(posted.mock.calls[0][0].init.body)).messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ])
    await waitFor(() => expect(screen.getAllByTestId('turn-assistant').at(-1)?.textContent).toContain('answered'))
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

  it('B28.348 — a chat at its spending limit says so and offers a new chat, not a top-up', async () => {
    mockChat({ streamStatus: 402, refusedWith: JSON.stringify({ error: 'refused', code: 'session_limit' }) })
    renderChat()
    await ask('one more')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/This chat has spent the most one chat may/)
    expect(alert.textContent).not.toMatch(/top up/i)
    fireEvent.click(within(alert).getByRole('button', { name: 'Start a new chat' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.queryByTestId('turn-user')).toBeNull()
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

  it('B28.275 — a question sent before the browser knows who is signed in is kept, and still there after a reload', async () => {
    let known!: () => void
    const identity = new Promise<void>((resolve) => (known = resolve))
    const s = controllableStream()
    mockChat({ body: s.stream, identityAfter: identity })
    const tab = renderChat()
    expect(await screen.findByText('Reading who is signed in…')).toBeTruthy()
    await ask('Capital of France?')
    s.push('data: {"choices":[{"delta":{"content":"Par"}}]}\n\n')
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('Par'))

    // Who is signed in becomes known mid-answer: the thread stays on screen and goes into the list.
    known()
    expect(await screen.findByRole('button', { name: 'Capital of France?' })).toBeTruthy()
    expect(screen.getByTestId('turn-user').textContent).toContain('Capital of France?')
    s.push('data: {"choices":[{"delta":{"content":"is."}}]}\n\ndata: [DONE]\n\n')
    s.close()
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('Paris.'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy())
    tab.unmount()

    renderChat()
    expect(await screen.findByRole('button', { name: 'Capital of France?' })).toBeTruthy()
    expect(screen.queryByText(/No conversations yet/)).toBeNull()
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

  it('B28.110 — a pinned chat stays at the top, above newer ones, after a reload; unpinned it goes back to its place', async () => {
    seed('user-a', { id: 'a', title: 'Older', updated_at: 1 }, { id: 'b', title: 'Newer', updated_at: 2 })
    mockChat()
    const tab = renderChat()
    fireEvent.click(await screen.findByRole('button', { name: 'Older' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pin' }))
    tab.unmount()
    expect(loadConversations('user-a').list.find((c) => c.id === 'a')?.pinned).toBe(true)

    renderChat()
    const pinned = await screen.findByRole('list', { name: 'Pinned conversations' })
    const rest = screen.getByRole('list', { name: 'Saved conversations' })
    expect(within(pinned).getAllByRole('button').map((b) => b.textContent)).toEqual(['Older'])
    expect(within(rest).getAllByRole('button').map((b) => b.textContent)).toEqual(['Newer'])
    expect(pinned.compareDocumentPosition(rest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(within(pinned).getByRole('button', { name: 'Older' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Unpin' }))
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Pinned conversations' })).toBeNull())
    expect(within(screen.getByRole('list', { name: 'Saved conversations' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Newer', 'Older'])
  })

  it('B28.110 — an archived chat leaves the list and is not reopened by a reload; unarchived, or asked in again, it is back', async () => {
    seed('user-a', { id: 'a', title: 'Older', updated_at: 1 }, { id: 'b', title: 'Newer', updated_at: 2 })
    mockChat({ body: 'data: {"choices":[{"delta":{"content":"Again."}}]}\n\ndata: [DONE]\n\n' })
    const tab = renderChat()
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('answer to Newer'))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(await screen.findByTestId('conversation-archived')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Saved conversations' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Older'])
    tab.unmount()

    // A reload opens the newest conversation that is not archived.
    renderChat()
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('answer to Older'))
    const toggle = screen.getByRole('button', { name: 'Archived 1' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    fireEvent.click(within(screen.getByRole('list', { name: 'Archived conversations' })).getByRole('button', { name: 'Newer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Unarchive' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Archived/ })).toBeNull())
    expect(within(screen.getByRole('list', { name: 'Saved conversations' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Newer', 'Older'])

    // Archived again, a question asked in it brings it back to the list.
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await ask('One more?')
    await screen.findByRole('button', { name: 'Regenerate' })
    expect(loadConversations('user-a').list.find((c) => c.id === 'b')?.archived).toBeUndefined()
    expect(screen.queryByRole('button', { name: /^Archived/ })).toBeNull()
  })

  it('B28.108 — a word from an old answer finds its conversation among 500, and opens it', async () => {
    const convs: Conversation[] = Array.from({ length: 500 }, (_, i) => ({
      id: `c${i}`,
      title: `Question ${i}`,
      renamed: false,
      model_id: 'gpt-4o',
      created_at: i + 1,
      updated_at: i + 1,
      messages: [
        { role: 'user', content: `Question ${i}` },
        { role: 'assistant', content: i === 0 ? 'The ferry to the island leaves at dawn from Pier 9.' : `An answer about topic ${i}.` },
      ],
    }))
    window.localStorage.setItem(historyKey('user-a'), JSON.stringify(convs))
    mockChat()
    renderChat()
    // The oldest of the 500 is last in the list; its title does not hold the word, only its answer does.
    const box = await screen.findByRole('searchbox', { name: 'Search conversations' })
    fireEvent.change(box, { target: { value: 'FERRY' } })
    const found = await screen.findByRole('list', { name: 'Conversations found' })
    expect(within(found).getAllByRole('button').map((b) => b.querySelector('span')?.textContent)).toEqual(['Question 0'])
    expect(found.previousElementSibling?.textContent).toBe('1 of 500 conversations')
    expect(within(found).getByTestId('search-excerpt').textContent).toBe('The ferry to the island leaves at dawn from Pier 9.')
    expect(found.querySelector('mark')?.textContent).toBe('ferry')

    fireEvent.click(within(found).getByRole('button'))
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('The ferry to the island'))

    // Every word must be there; a word that is nowhere says so rather than showing an empty list.
    fireEvent.change(box, { target: { value: 'ferry submarine' } })
    expect(await screen.findByText('No conversation mentions “ferry submarine”.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Conversations found' })).toBeNull()
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

  it('B28.99 — shows a price range while a question is typed, none for a command, and the answer’s price lands inside it', async () => {
    mockChat({
      usdPerLXC: 0.1,
      body:
        'data: {"type":"message_start","message":{"model":"claude-opus-5","usage":{"input_tokens":22,"output_tokens":1}}}\n\n' +
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Paris."}}\n\n' +
        'data: {"type":"message_delta","usage":{"output_tokens":4}}\n\n' +
        'data: {"type":"message_stop"}\n\n',
    })
    renderChat()
    await chooseModel('Claude Opus 5')
    const box = await screen.findByPlaceholderText('Ask anything')
    expect(screen.queryByTestId('cost-preview')).toBeNull()
    fireEvent.change(box, { target: { value: '/agent Researcher' } })
    expect(screen.queryByTestId('cost-preview')).toBeNull()
    fireEvent.change(box, { target: { value: 'What is the capital of France?' } })
    // 30 bytes. Low: 3 tokens in + 1 out = $0.00004 = 0.0004 LXC. High: 15 + 64 + 8 in + 4,096 out = $0.102835, up to 1.03 LXC.
    expect(screen.getByTestId('cost-preview').textContent).toBe('Sending this ≈ 0.0004–1.03 LXC · answer up to 4,096 tokens')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    // (22 × $5 + 4 × $25) / 1M = $0.00021 = 0.0021 LXC: inside 0.0004–1.03.
    expect((await screen.findByTestId('turn-cost')).textContent).toBe('≈ 0.0021 LXC · Claude Opus 5 · 22 in / 4 out tokens')
    expect(screen.queryByTestId('cost-preview')).toBeNull()
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

  // B28.366 — what B28.111's Lens side receives: the turns before the edited question, then the question as edited.
  it('B28.111 — a question edited and sent again re-runs the thread from that turn; the turns after it are gone, after a reload too', async () => {
    const said = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
    const { posted } = mockChat({ bodies: [said('12.'), said('24.'), said('48.'), said('36.')] })
    const tab = renderChat()
    for (const q of ['What is 5 + 7?', 'Multiply that by 2.', 'And by 2 again.']) {
      await ask(q)
      await screen.findByRole('button', { name: 'Regenerate' })
    }
    fireEvent.click(within(screen.getAllByTestId('turn-user')[1]!).getByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('form', { name: 'Edit question' })
    expect(within(form).getByTestId('edit-replaces').textContent).toBe('Sending replaces its answer and the 1 question after it.')
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Multiply that by 3.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(posted).toHaveBeenCalledTimes(4))
    const sent = posted.mock.calls[3][0].init
    expect(JSON.parse(String(sent.body)).messages).toEqual([
      { role: 'user', content: 'What is 5 + 7?' },
      { role: 'assistant', content: '12.' },
      { role: 'user', content: 'Multiply that by 3.' },
    ])
    // A changed question is a new one: Lens may serve it as it would any question.
    expect(new Headers(sent.headers).get('X-Talyvor-Cache')).toBeNull()
    await screen.findByRole('button', { name: 'Regenerate' })
    expect(screen.queryByRole('form', { name: 'Edit question' })).toBeNull()
    expect(screen.getAllByTestId('turn-user').map((t) => t.querySelector('p')?.textContent)).toEqual(['What is 5 + 7?', 'Multiply that by 3.'])
    expect(screen.getAllByTestId('turn-assistant').map((t) => t.querySelector('p')?.textContent)).toEqual(['12.', '36.'])
    tab.unmount()
    expect(loadConversations('user-a').list[0]?.messages.map((m) => m.content)).toEqual(['What is 5 + 7?', '12.', 'Multiply that by 3.', '36.'])
  })

  it('B28.111 — a question sent again unchanged is asked of the model afresh, as Regenerate does; Escape leaves it as it was', async () => {
    const { posted } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"first"}}]}\n\ndata: [DONE]\n\n' })
    renderChat()
    await ask('question')
    await screen.findByRole('button', { name: 'Regenerate' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: 'something else' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your question' }), { key: 'Escape' })
    expect(screen.queryByRole('form', { name: 'Edit question' })).toBeNull()
    expect(screen.getByTestId('turn-user').querySelector('p')?.textContent).toBe('question')
    expect(posted).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByTestId('edit-replaces').textContent).toBe('Sending replaces its answer.')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your question' }), { key: 'Enter' })
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(2))
    expect(new Headers(posted.mock.calls[1][0].init.headers).get('X-Talyvor-Cache')).toBe('bypass')
    expect(JSON.parse(String(posted.mock.calls[1][0].init.body)).messages).toEqual([{ role: 'user', content: 'question' }])
  })

  // B28.367 — what B28.112's Lens side receives: Regenerate asks afresh, and a question after a version is sent with the
  // thread as that version left it. Both versions, each with the turns that followed it, are kept with the conversation.
  it('B28.112 — Regenerate keeps the earlier answer as a version; each version keeps its own thread, after a reload too', async () => {
    const said = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
    const { posted } = mockChat({ bodies: [said('Paris.'), said('It is Paris.'), said('About 2.1 million.')] })
    const answers = () => screen.getAllByTestId('turn-assistant').map((t) => t.querySelector('p')?.textContent)
    const tab = renderChat()
    await ask('Capital of France?')
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(screen.getByTestId('turn-version').textContent).toBe('2 / 2'))
    expect(new Headers(posted.mock.calls[1][0].init.headers).get('X-Talyvor-Cache')).toBe('bypass')
    expect(answers()).toEqual(['It is Paris.'])

    await ask('How many people live there?')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(3))
    expect(JSON.parse(String(posted.mock.calls[2][0].init.body)).messages).toEqual([
      { role: 'user', content: 'Capital of France?' },
      { role: 'assistant', content: 'It is Paris.' },
      { role: 'user', content: 'How many people live there?' },
    ])
    await waitFor(() => expect(answers()).toEqual(['It is Paris.', 'About 2.1 million.']))
    await screen.findAllByRole('button', { name: 'Copy' })
    // The first version has no follow-up: showing it shows the thread as it was then.
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    expect(screen.getByTestId('turn-version').textContent).toBe('1 / 2')
    expect(answers()).toEqual(['Paris.'])
    expect(screen.getAllByTestId('turn-user')).toHaveLength(1)
    tab.unmount()

    renderChat()
    await waitFor(() => expect(screen.getByTestId('turn-version').textContent).toBe('1 / 2'))
    expect(answers()).toEqual(['Paris.'])
    fireEvent.click(screen.getByRole('button', { name: 'Next version' }))
    expect(screen.getByTestId('turn-version').textContent).toBe('2 / 2')
    expect(answers()).toEqual(['It is Paris.', 'About 2.1 million.'])
    expect(screen.getAllByTestId('turn-user').map((t) => t.querySelector('p')?.textContent)).toEqual(['Capital of France?', 'How many people live there?'])
    expect(posted).toHaveBeenCalledTimes(3)
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

  // B28.81
  it('an answer that came back blank says so, and Retry asks the model again', async () => {
    const { posted } = mockChat({
      bodies: [
        'data: {"type":"message_start","message":{"model":"claude-opus-5"}}\n\n' +
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":0}}\n\n' +
          'data: {"type":"message_stop"}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Paris."}}\n\n' +
          'data: {"type":"message_stop"}\n\n',
      ],
    })
    renderChat()
    await ask('Capital of France?')
    expect((await screen.findByTestId('turn-blank')).textContent).toContain('No answer came back.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('Paris.'))
    expect(screen.queryByTestId('turn-blank')).toBeNull()
    // The same question, asked of the model afresh rather than replayed.
    expect(JSON.parse(String(posted.mock.calls[1][0].init.body)).messages).toEqual([{ role: 'user', content: 'Capital of France?' }])
    expect(new Headers(posted.mock.calls[1][0].init.headers).get('X-Talyvor-Cache')).toBe('bypass')
  })

  it('an answer the model stopped at its length limit is marked cut off', async () => {
    mockChat({
      body:
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"The first of many"}}\n\n' +
        'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":4096}}\n\n' +
        'data: {"type":"message_stop"}\n\n',
    })
    renderChat()
    await ask('Write me a long story')
    expect((await screen.findByTestId('turn-cut-off')).textContent).toBe(
      'Cut off The model reached its length limit before it finished this answer.',
    )
    expect(screen.getByTestId('turn-assistant').textContent).toContain('The first of many')
  })

  // B28.368 — what B28.113's Lens side receives: Continue sends the thread with the cut-off answer, to its last whole
  // word, and then CONTINUE_PROMPT, asked afresh. What comes back is added to the answer, which is priced and saved whole.
  it('B28.113 — Continue on a cut-off answer asks the model to go on, and adds what it writes to the answer', async () => {
    const said = (text: string, stop: string, out: number) =>
      'data: {"type":"message_start","message":{"model":"claude-opus-5","usage":{"input_tokens":10}}}\n\n' +
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n` +
      `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: out } })}\n\n` +
      'data: {"type":"message_stop"}\n\n'
    const { posted } = mockChat({ bodies: [said('Once upon a time, far aw', 'max_tokens', 16), said('away, there lived a fox.', 'end_turn', 8)] })
    renderChat()
    await chooseModel('Claude Opus 5')
    await ask('Tell me a story')
    await screen.findByTestId('turn-cut-off')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(screen.getByTestId('turn-assistant').querySelector('p')?.textContent).toBe('Once upon a time, far away, there lived a fox.'))
    expect(JSON.parse(String(posted.mock.calls[1][0].init.body)).messages).toEqual([
      { role: 'user', content: 'Tell me a story' },
      { role: 'assistant', content: 'Once upon a time, far' },
      { role: 'user', content: CONTINUE_PROMPT },
    ])
    expect(new Headers(posted.mock.calls[1][0].init.headers).get('X-Talyvor-Cache')).toBe('bypass')
    // Whole now: no mark, no Continue; and its price is both requests'.
    expect(screen.queryByTestId('turn-cut-off')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect((await screen.findByTestId('turn-cost')).textContent).toMatch(/ · Claude Opus 5 · 20 in \/ 24 out tokens · 2 requests$/)
    const saved = loadConversations('user-a').list[0].messages
    expect(saved).toHaveLength(2)
    expect(saved[1]).toMatchObject({ content: 'Once upon a time, far away, there lived a fox.', requests: 2, cost: { input_tokens: 20, output_tokens: 24 } })
    expect(saved[1].incomplete).toBeUndefined()
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

  it('a PDF dragged onto the chat shows where to drop it; dropped, it is uploaded, asked about by id and converted (B28.130)', async () => {
    const { posted, uploaded } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', converts: true })
    renderChat()
    await chooseModel('GPT-4o')
    const box = await screen.findByPlaceholderText('Ask anything')
    // Words dragged from the page are the browser's to drop into the box: no overlay, nothing refused.
    expect(fireEvent.dragEnter(box, { dataTransfer: { types: ['text/plain'], files: [] } })).toBe(true)
    expect(screen.queryByTestId('drop-overlay')).toBeNull()
    const dataTransfer = { types: ['Files'], files: [pdf()], dropEffect: 'none' }
    fireEvent.dragEnter(box, { dataTransfer })
    fireEvent.dragOver(box, { dataTransfer })
    expect(screen.getByTestId('drop-overlay').textContent).toMatch(/^Drop to attach to your question/)
    expect(dataTransfer.dropEffect).toBe('copy')
    // Dropped, the browser does not open the file in place of the chat.
    expect(fireEvent.drop(box, { dataTransfer })).toBe(false)
    expect(screen.queryByTestId('drop-overlay')).toBeNull()
    expect(await screen.findByText('report.pdf')).toBeTruthy()
    expect(uploaded.mock.calls[0][0].url).toBe('/api/documents?filename=report.pdf')

    await ask('summarise this')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    const [message] = JSON.parse(String(posted.mock.calls[0][0].init.body)).messages
    expect(message.content).toEqual([
      { type: 'text', text: 'summarise this' },
      { type: 'file', file: { file_id: 'tdoc_1' } },
    ])
    await waitFor(() =>
      expect(screen.getByTestId('documents-status').textContent).toBe('Converted to text before the model read it.'),
    )
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

  it('attaches a Docs page as it is stored: its text goes to Lens as Markdown, the question references it, and links the page (B28.375)', async () => {
    const { posted, uploaded } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', converts: true })
    const wire = vi.mocked(globalThis.fetch).getMockImplementation()!
    const docs: Record<string, unknown> = {
      '/api/docs/spaces': [{ id: 'sp1', name: 'Handbook' }],
      '/api/docs/spaces/sp1/pages': [{ id: 'pg1', title: 'Release checklist' }],
      '/api/docs/spaces/sp1/pages/pg1': { id: 'pg1', title: 'Release checklist', content_text: 'The release team meets in room 42 on Thursday.' },
    }
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const said = docs[String(input)]
      return said === undefined ? wire(input, init) : new Response(JSON.stringify(said), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    renderChat()
    await chooseModel('GPT-4o')
    fireEvent.click(screen.getByRole('button', { name: 'Docs page' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Release checklist' }))
    const chip = await screen.findByRole('list', { name: 'Attached documents' })
    await waitFor(() => expect(within(chip).getByText('Release checklist')).toBeTruthy())
    const { url, init: sent } = uploaded.mock.calls[0][0]
    expect(url).toBe('/api/documents?filename=Release%20checklist.md')
    expect(new Headers(sent.headers).get('Content-Type')).toBe('text/markdown')
    // jsdom's File has no text(); its FileReader reads one.
    const read = await new Promise<unknown>((done) => {
      const r = new FileReader()
      r.onload = () => done(r.result)
      r.readAsText(sent.body as File)
    })
    expect(read).toBe('# Release checklist\n\nThe release team meets in room 42 on Thursday.\n')

    await ask('Where does the release team meet? Quote the page.')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    const [message] = JSON.parse(String(posted.mock.calls[0][0].init.body)).messages
    expect(message.content).toEqual([
      { type: 'text', text: 'Where does the release team meet? Quote the page.' },
      { type: 'file', file: { file_id: 'tdoc_1' } },
    ])
    expect((await screen.findByTestId('sent-docs-page')).getAttribute('href')).toBe('/docs/spaces/sp1/pages/pg1')
    await waitFor(() => expect(loadConversations('user-a').list[0]?.messages[0].attachments?.[0].docs_page).toEqual({ space_id: 'sp1', page_id: 'pg1' }))
  })

  it('attaches a Track issue: it goes to Lens as Markdown, the question links it, and the request names it so its cost is the issue’s (B28.376)', async () => {
    const { posted, uploaded } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', converts: true })
    const wire = vi.mocked(globalThis.fetch).getMockImplementation()!
    const issue = { id: 'iss-7', identifier: 'ENG-7', title: 'Export times out', status: 'in_progress', description: 'Exports over 10k rows time out after 30s.' }
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) =>
      String(input) === '/api/track/issues?limit=100'
        ? new Response(JSON.stringify([issue]), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : wire(input, init),
    )
    renderChat()
    await chooseModel('GPT-4o')
    fireEvent.click(screen.getByRole('button', { name: 'Track issue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'ENG-7 Export times out' }))
    const chip = await screen.findByRole('list', { name: 'Attached documents' })
    await waitFor(() => expect(within(chip).getByText('Export times out')).toBeTruthy())
    const { url, init: sent } = uploaded.mock.calls[0][0]
    expect(url).toBe('/api/documents?filename=ENG-7.md')
    const read = await new Promise<unknown>((done) => {
      const r = new FileReader()
      r.onload = () => done(r.result)
      r.readAsText(sent.body as File)
    })
    expect(read).toBe('# ENG-7 Export times out\n\nStatus: In progress\n\nExports over 10k rows time out after 30s.\n')

    await ask('Why might the export time out?')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    expect(new Headers(posted.mock.calls[0][0].init.headers).get('X-Talyvor-Issue')).toBe('ENG-7')
    const [message] = JSON.parse(String(posted.mock.calls[0][0].init.body)).messages
    expect(message.content).toContainEqual({ type: 'file', file: { file_id: 'tdoc_1' } })
    expect((await screen.findByTestId('sent-track-issue')).getAttribute('href')).toBe('/track/issues/iss-7')
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

describe('projects (B28.109)', () => {
  it('a new chat in a project is sent with its instructions, in each provider’s shape; a chat outside it is not', async () => {
    const { posted } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"Noted."}}]}\n\ndata: [DONE]\n\n' })
    const view = renderChat()
    const answered = async (n: number) => {
      await waitFor(() => expect(posted).toHaveBeenCalledTimes(n))
      await screen.findByRole('button', { name: 'Regenerate' })
    }
    const sent = (n: number) => JSON.parse(String(posted.mock.calls[n][0].init.body))
    const told = 'Answer as our finance lead. Use pounds.'

    fireEvent.click(await screen.findByRole('button', { name: 'New project' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Finance' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    // A new project opens on its page with its instructions being written.
    fireEvent.change(await screen.findByRole('textbox', { name: 'Instructions' }), { target: { value: told } })
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }))
    expect((await screen.findByTestId('project-instructions')).textContent).toBe(told)

    // Anthropic: its own system field.
    await chooseModel('Claude Opus 5')
    await ask('What did we spend?')
    await answered(1)
    expect(sent(0).system).toBe(told)
    expect(sent(0).messages).toEqual([{ role: 'user', content: 'What did we spend?' }])
    expect(screen.getByTestId('conversation-project').textContent).toBe('In Finance · sent with its instructions')

    // A second new chat in the project, on OpenAI: a system message first. And the follow-up in it carries them too.
    fireEvent.click(within(screen.getByRole('list', { name: 'Your projects' })).getByRole('button', { name: 'Finance' }))
    expect(within(screen.getByRole('region', { name: 'Chats in this project' })).getByRole('button', { name: 'What did we spend?' })).toBeTruthy()
    await chooseModel('GPT-4o')
    await ask('And last month?')
    await answered(2)
    expect(sent(1).messages).toEqual([{ role: 'system', content: told }, { role: 'user', content: 'And last month?' }])
    await ask('Per agent?')
    await answered(3)
    expect(sent(2).messages[0]).toEqual({ role: 'system', content: told })

    // New chat, outside any project: nothing of the project is sent.
    fireEvent.click(screen.getAllByRole('button', { name: 'New chat' })[0])
    await ask('What is the capital of France?')
    await answered(4)
    expect(sent(3).messages).toEqual([{ role: 'user', content: 'What is the capital of France?' }])
    expect(sent(3).system).toBeUndefined()

    // Kept in this browser: after a reload the project is listed and its chats still carry it.
    view.unmount()
    expect(loadConversations('user-a').list.filter((c) => c.project_id !== undefined).map((c) => c.title).sort()).toEqual(['And last month?', 'What did we spend?'])
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: 'Finance' }))
    expect((await screen.findByTestId('project-instructions')).textContent).toBe(told)
  })
})

describe('custom instructions (B28.115)', () => {
  it('"Answer in French" saved once is sent with the first question of every new chat, before a project’s own', async () => {
    const { posted } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"D’accord."}}]}\n\ndata: [DONE]\n\n' })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route path="/chat" element={<Chat />} />
            <Route path="/chat/instructions" element={<InstructionsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const answered = async (n: number) => {
      await waitFor(() => expect(posted).toHaveBeenCalledTimes(n))
      await screen.findByRole('button', { name: 'Regenerate' })
    }
    const sent = (n: number) => JSON.parse(String(posted.mock.calls[n][0].init.body))

    // Written once, on the page Chat's rail links to.
    fireEvent.click((await screen.findAllByRole('link', { name: 'Custom instructions' }))[0])
    fireEvent.change(await screen.findByRole('textbox', { name: 'Custom instructions' }), { target: { value: '  Answer in French.  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }))
    expect((await screen.findByRole('status')).textContent).toBe('Saved. Every new chat is sent with them.')
    fireEvent.click(screen.getByRole('link', { name: 'Back to Chat' }))

    // A new chat says what it is sent with, and Anthropic gets them in its own system field.
    expect((await screen.findByTestId('custom-instructions-line')).textContent).toContain('Answer in French.')
    await chooseModel('Claude Opus 5')
    await ask('What is a wallet?')
    await answered(1)
    expect(sent(0).system).toBe('Answer in French.')

    // Another new chat, on OpenAI: a system message first, with nothing set again.
    fireEvent.click(screen.getAllByRole('button', { name: 'New chat' })[0])
    await chooseModel('GPT-4o')
    await ask('And a card?')
    await answered(2)
    expect(sent(1).messages).toEqual([{ role: 'system', content: 'Answer in French.' }, { role: 'user', content: 'And a card?' }])

    // In a project, the person's own come first and the project's after them.
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Finance' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Instructions' }), { target: { value: 'Use pounds.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }))
    await ask('What did we spend?')
    await answered(3)
    expect(sent(2).messages[0]).toEqual({ role: 'system', content: 'Answer in French.\n\nUse pounds.' })
  })
})

describe('prompt library (B28.370)', () => {
  it('a prompt saved in the library is used in a new chat by name, and the answer says Lens swapped it in', async () => {
    const { posted } = mockChat({
      body: 'data: {"choices":[{"delta":{"content":"Happy to help."}}]}\n\ndata: [DONE]\n\n',
      prompts: [],
      answerHeaders: { 'X-Talyvor-Prompt-Resolved': 'true' },
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route path="/chat" element={<Chat />} />
            <Route path="/chat/prompts" element={<PromptsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const sent = (n: number) => JSON.parse(String(posted.mock.calls[n][0].init.body))

    // Saved on the page Chat's rail links to, and opened from its card in a new chat.
    fireEvent.click((await screen.findAllByRole('link', { name: 'Prompt library' }))[0])
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'support-tone' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'Answer as a calm support agent.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }))
    expect((await screen.findByRole('status')).textContent).toContain('Saved support-tone.')
    fireEvent.click(await screen.findByRole('link', { name: 'Use in a new chat' }))
    await waitFor(() => expect((screen.getByRole('combobox', { name: /^Prompt/ }) as HTMLSelectElement).value).toBe('support-tone'))

    // Anthropic gets the prompt's name in its system field, for Lens to swap in; the answer says it was.
    await chooseModel('Claude Opus 5')
    await ask('My card was declined.')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    expect(sent(0).system).toBe('lens:prompt:support-tone')
    const line = await screen.findByTestId('turn-prompt')
    expect(line.dataset.resolved).toBe('true')
    expect(line.textContent).toBe('Asked with the prompt support-tone from your library')

    // The next question in that chat, on OpenAI: the same name, as a system message first.
    await chooseModel('GPT-4o')
    await ask('And now?')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(2))
    expect(sent(1).messages[0]).toEqual({ role: 'system', content: 'lens:prompt:support-tone' })
  })
})

describe('a listing in Chat (B28.426)', () => {
  it('Use in Chat attaches a paid skill: each question names it to Lens, the answer says how Lens charged it, and Remove stops it', async () => {
    const { posted } = mockChat({
      body: 'data: {"choices":[{"delta":{"content":"Happy to help."}}]}\n\ndata: [DONE]\n\n',
      listings: { lst_tone: { id: 'lst_tone', title: 'Support tone', kind: 'skill', price_per_use_ulxc: 20_000 } },
      answerHeaders: { 'X-Talyvor-Listing-Charge': 'billed' },
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/chat?listing=lst_tone']}>
          <Routes>
            <Route path="/chat" element={<Chat />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const named = (n: number) => new Headers(posted.mock.calls[n][0].init.headers).get('X-Talyvor-Listing')
    const answered = async (n: number) => {
      await waitFor(() => expect(posted).toHaveBeenCalledTimes(n))
      await waitFor(() => expect(screen.getAllByRole('button', { name: 'Regenerate' })).toHaveLength(1))
    }

    const chip = await screen.findByTestId('chat-listing')
    expect(chip.textContent).toBe('ListingSupport tone· 0.02 LXC a question, on your marketplace billRemove')
    await chooseModel('Claude Opus 5')

    // Two questions: each request names the listing, so Lens bills two uses, and each answer says how Lens charged it.
    await ask('My card was declined.')
    await answered(1)
    await ask('And now?')
    await answered(2)
    expect([named(0), named(1)]).toEqual(['lst_tone', 'lst_tone'])
    const lines = screen.getAllByTestId('turn-listing')
    expect(lines.map((l) => l.textContent)).toEqual(Array(2).fill('Asked through Support tone · its use is on your marketplace bill for this month'))
    // Kept with the conversation, so reopened it is asked through the listing still.
    expect(loadConversations('user-a').list[0].listing).toEqual({ id: 'lst_tone', title: 'Support tone', price_per_use_ulxc: 20_000 })

    // Removed: the next question is asked as any other, and the conversation no longer keeps it.
    fireEvent.click(within(chip).getByRole('button', { name: 'Remove' }))
    expect(screen.queryByTestId('chat-listing')).toBeNull()
    await ask('Thanks.')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(3))
    expect(named(2)).toBeNull()
    await waitFor(() => expect(loadConversations('user-a').list[0].listing).toBeUndefined())
  })
})

describe('memory (B28.371)', () => {
  it('off until turned on; a remembered fact is sent with a new chat, and deleted it is sent no more', async () => {
    const { posted } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"Noted."}}]}\n\ndata: [DONE]\n\n' })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route path="/chat" element={<Chat />} />
            <Route path="/chat/memory" element={<MemoryPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const answered = async (n: number) => {
      await waitFor(() => expect(posted).toHaveBeenCalledTimes(n))
      await screen.findByRole('button', { name: 'Regenerate' })
    }
    const sent = (n: number) => JSON.parse(String(posted.mock.calls[n][0].init.body))
    const fact = 'my studio is called Heron Works'

    // Off by default: "Remember that …" is not sent to the model, and nothing is kept until the card is asked to.
    await chooseModel('Claude Opus 5')
    await ask(`Remember that ${fact}.`)
    expect((await screen.findByTestId('chat-card-remember-state')).textContent).toBe(`Memory is off, so “${fact}” was not kept.`)
    fireEvent.click(screen.getByRole('button', { name: 'Turn memory on and remember it' }))
    expect(screen.getByTestId('chat-card-remember-state').textContent).toContain(`Remembered: “${fact}”.`)
    expect(posted).not.toHaveBeenCalled()

    // A new chat says what it is sent with, and Anthropic gets the fact in its own system field.
    fireEvent.click(screen.getAllByRole('button', { name: 'New chat' })[0])
    expect((await screen.findByTestId('memory-line')).textContent).toContain(fact)
    await ask('What should I call my newsletter?')
    await answered(1)
    expect(sent(0).system).toBe(`What the person you are talking to asked you to remember about them:\n- ${fact}`)

    // Listed on the Memory page, and deleted there.
    fireEvent.click((await screen.findAllByRole('link', { name: 'Memory' }))[0])
    expect((await screen.findByTestId('memory-facts')).textContent).toContain(fact)
    fireEvent.click(screen.getByRole('button', { name: `Delete “${fact}”` }))
    expect((await screen.findByRole('status')).textContent).toBe('Deleted. No question is sent with it again.')
    expect(screen.getByTestId('memory-empty')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Back to Chat' }))

    // The next new chat is sent without it.
    fireEvent.click((await screen.findAllByRole('button', { name: 'New chat' }))[0])
    await chooseModel('Claude Opus 5')
    await ask('And a name for my podcast?')
    await answered(2)
    expect(screen.queryByTestId('memory-line')).toBeNull()
    expect(sent(1).system).toBeUndefined()
    expect(JSON.stringify(sent(1))).not.toContain('Heron Works')
  })
})

describe('images for models that read them (B28.379)', () => {
  // A 1×1 PNG; the catalog marks which models read images, as Lens's does (capabilities.vision).
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const png = (name = 'chart.png') => new File([Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0))], name)
  const SEEING = [
    { ...CATALOG[0], capabilities: { vision: true } },
    { ...CATALOG[1], capabilities: { vision: true } },
    { ...CATALOG[2], capabilities: { vision: false } },
  ]
  const OK = 'data: {"choices":[{"delta":{"content":"42"}}]}\n\ndata: [DONE]\n\n'

  async function attach(model: string, files: File[]) {
    await chooseModel(model)
    fireEvent.change(document.getElementById('chat-attach') as HTMLInputElement, { target: { files } })
  }
  const sentMessages = (posted: ReturnType<typeof vi.fn>, n: number) => JSON.parse(String(posted.mock.calls[n][0].init.body)).messages

  it('a screenshot pasted into the box is attached, named by its type; pasted words with a picture of them paste the words (B28.130)', async () => {
    const { uploaded } = mockChat({ catalog: SEEING, body: OK })
    renderChat()
    await chooseModel('GPT-4o')
    const box = await screen.findByPlaceholderText('Ask anything')
    const shot = new File([Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0))], '', { type: 'image/png' })
    // Copied from a document: the words and a picture of them. The words are pasted; nothing is attached.
    expect(fireEvent.paste(box, { clipboardData: { files: [shot], getData: () => 'Q3 revenue rose 12%' } })).toBe(true)
    expect(fireEvent.paste(box, { clipboardData: { files: [shot], getData: () => '' } })).toBe(false)
    expect((await screen.findByTestId('attached-image')).getAttribute('src')).toBe(`data:image/png;base64,${PNG}`)
    expect(screen.getAllByText('pasted.png')).toHaveLength(1)
    expect(uploaded).not.toHaveBeenCalled()
  })

  it('sends an image inside the question as OpenAI’s image_url part, shows it, sends it again with the next question, and keeps only its name', async () => {
    const { posted, uploaded } = mockChat({ catalog: SEEING, body: OK })
    renderChat()
    await attach('GPT-4o', [png()])
    expect((await screen.findByTestId('attached-image')).getAttribute('src')).toBe(`data:image/png;base64,${PNG}`)
    await ask('What number is shown?')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    const asked = [
      { type: 'text', text: 'What number is shown?' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
    ]
    expect(sentMessages(posted, 0)[0].content).toEqual(asked)
    // Not a document: nothing is stored in Lens and nothing asks Lens to convert it.
    expect(uploaded).not.toHaveBeenCalled()
    expect(new Headers(posted.mock.calls[0][0].init.headers).get('X-Talyvor-Distill')).toBeNull()
    expect((await screen.findByRole('img', { name: 'chart.png' })).getAttribute('src')).toBe(`data:image/png;base64,${PNG}`)

    await screen.findByText('42')
    await ask('And doubled?')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(2))
    expect(sentMessages(posted, 1)[0].content).toEqual(asked)
    await waitFor(() => expect(loadConversations('user-a').list[0]?.messages).toHaveLength(4))
    expect(loadConversations('user-a').list[0].messages[0].attachments).toEqual([{ name: 'chart.png', media_type: 'image/png', size: 68 }])
  })

  it('sends it to Anthropic as an image block with a base64 source, ahead of the words', async () => {
    const { posted } = mockChat({ catalog: SEEING, body: 'event: message_stop\ndata: {"type":"message_stop"}\n\n' })
    renderChat()
    // The bytes decide the type: a PNG named .jpg goes as a PNG.
    await attach('Claude Opus 5', [png('scan.jpg')])
    await screen.findByTestId('attached-image')
    await ask('What number is shown?')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    expect(posted.mock.calls[0][0].url).toBe('/api/ai/stream/anthropic/v1/messages')
    expect(sentMessages(posted, 0)[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
      { type: 'text', text: 'What number is shown?' },
    ])
  })

  it('refuses, in words, an image for a model that cannot read one, a file that is not an image, and one over the limit', async () => {
    const { posted } = mockChat({ catalog: SEEING })
    renderChat()
    await attach('Gemini 2 Pro', [png()])
    expect((await screen.findByRole('alert')).textContent).toBe('Gemini 2 Pro can’t read images — pick one that can, such as GPT-4o.')
    await attach('GPT-4o', [new File(['not a picture'], 'fake.png')])
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('fake.png couldn’t be read as a PNG, JPEG, GIF or WebP image.'))
    await attach('GPT-4o', [new File([new Uint8Array(IMAGE_LIMIT_BYTES + 1)], 'huge.png')])
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('huge.png is too large: an image can be at most 3 MB.'))
    expect(screen.queryByTestId('attached-image')).toBeNull()
    expect(posted).not.toHaveBeenCalled()
  })

  it('does not send a conversation’s images to a model that cannot read them, nor images past the 4 MB a request may be', async () => {
    const { posted } = mockChat({ catalog: SEEING, body: OK })
    renderChat()
    await attach('GPT-4o', [png()])
    await screen.findByTestId('attached-image')
    await chooseModel('Gemini 2 Pro')
    await ask('What number is shown?')
    expect((await screen.findByRole('alert')).textContent).toBe('Gemini 2 Pro can’t read images. Pick a model that can, or start a new chat.')
    expect(posted).not.toHaveBeenCalled()

    // Two images that fit one at a time do not fit together.
    const big = (name: string) => new File([Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0)), new Uint8Array(2_900_000)], name)
    await attach('GPT-4o', [big('a.png'), big('b.png')])
    await waitFor(() => expect(screen.getAllByTestId('attached-image')).toHaveLength(3))
    await ask('Compare them')
    await screen.findByText(/^The images in this conversation are too large to send together — at most 4 MB in all\./)
    expect(posted).not.toHaveBeenCalled()
  })
})
