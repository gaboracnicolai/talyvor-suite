import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ATTACH_LIMIT_BYTES, Chat, EXAMPLE_PROMPTS } from './Chat'
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
  body,
  sub = 'user-a',
  usdPerLXC,
  converts = false,
}: {
  catalog?: unknown
  catalogStatus?: number
  streamStatus?: number
  body?: BodyInit | null
  /** Who /auth/me says is signed in — history is kept per identity. */
  sub?: string
  /** The credit peg /api/lxc/topup-options confirms. Absent ⇒ that read 404s, as on economy-off. */
  usdPerLXC?: number
  /** Whether Lens converts an opted-in document (answers X-Talyvor-Distill: applied). */
  converts?: boolean
} = {}) {
  const posted = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
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
      const optedIn = new Headers(init?.headers).get('X-Talyvor-Distill') === 'true'
      return new Response(body ?? '', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', ...(converts && optedIn ? { 'X-Talyvor-Distill': 'applied' } : {}) },
      })
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
  it('lists every priced chat model by provider, newest first — one it cannot stream is shown, not offered', async () => {
    mockChat({
      catalog: [
        ...CATALOG,
        { id: 'gpt-5', provider: 'openai', display_name: 'GPT-5', input_per_1m: 1.25, output_per_1m: 10 },
        // Not a chat model: an embedding has no output price.
        { id: 'text-embedding-3-small', provider: 'openai', display_name: 'Embedding 3 small', input_per_1m: 0.02, output_per_1m: 0 },
      ],
    })
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /^Model: / }))
    const listed = screen
      .getAllByRole('group')
      .map((g) => [g.getAttribute('aria-label'), within(g).getAllByRole('option').map((o) => o.querySelector('span')?.firstChild?.textContent)])
    expect(listed).toEqual([
      ['OpenAI', ['GPT-5', 'GPT-4o']],
      ['Anthropic', ['Claude Opus 5']],
      // ⚠ LISTED, NOT OFFERED. Lens streams every non-openai provider through ServeAnthropic, so a
      // Google model would be parsed with the wrong wire format; it is shown disabled, with the reason.
      ['Google', ['Gemini 2 Pro']],
    ])
    expect(screen.getByRole('option', { name: /^Gemini 2 Pro/ }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(/Lens streams OpenAI and Anthropic formats only/)).toBeTruthy()
    // The retired model and the embedding are COUNTED, never silently dropped.
    expect(screen.getByText(/retired or non-chat catalog entr/).textContent).toContain('2')
  })

  it('defaults to the newest flagship in the catalog, and a model added to Lens appears — and leads — with no change here', async () => {
    mockChat()
    const { unmount } = renderChat()
    // Claude Opus 5 is the fixture's newest generation.
    expect(await screen.findByRole('button', { name: 'Model: Claude Opus 5' })).toBeTruthy()
    unmount()

    vi.restoreAllMocks()
    mockChat({ catalog: [...CATALOG, { id: 'gpt-6', provider: 'openai', display_name: 'GPT-6', input_per_1m: 3, output_per_1m: 20 }] })
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
    await waitFor(() => expect(turn.querySelector('h4')?.textContent).toBe('Steps'))
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

  it('sends the document in the shape Lens converts, asks for conversion, and says it happened', async () => {
    const { posted } = mockChat({ body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', converts: true })
    renderChat()
    await attach([pdf()])
    expect(await screen.findByText('report.pdf')).toBeTruthy()
    await ask('summarise this')
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))

    const { init } = posted.mock.calls[0][0]
    expect(new Headers(init.headers).get('X-Talyvor-Distill')).toBe('true')
    const [message] = JSON.parse(String(init.body)).messages
    expect(message.content[0]).toEqual({ type: 'text', text: 'summarise this' })
    expect(message.content[1].type).toBe('file')
    expect(message.content[1].file.filename).toBe('report.pdf')
    expect(message.content[1].file.file_data).toBe(`data:application/pdf;base64,${btoa('%PDF-1.7 quarterly report')}`)

    await waitFor(() =>
      expect(screen.getByTestId('documents-status').textContent).toBe('Converted to text before the model read it.'),
    )
    // The bytes never reach storage; the name, size and outcome do.
    const kept = loadConversations('user-a').list[0].messages[0]
    expect(kept.attachments).toEqual([{ name: 'report.pdf', media_type: 'application/pdf', size: 25 }])
    expect(kept.converted).toBe(true)
  })

  it('says so when Lens sent the original file instead of converting it', async () => {
    mockChat({ body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', converts: false })
    renderChat()
    await attach([pdf()])
    await screen.findByText('report.pdf')
    await ask('summarise this')
    await waitFor(() => expect(screen.getByTestId('documents-status').textContent).toMatch(/^Sent as the original file/))
  })

  it('refuses a format Lens cannot convert, and a document over the limit, in words', async () => {
    const { posted } = mockChat()
    renderChat()
    await attach([new File(['x'], 'deck.pptx')])
    expect((await screen.findByRole('alert')).textContent).toMatch(/deck\.pptx can’t be converted/)
    await attach([new File([new Uint8Array(ATTACH_LIMIT_BYTES + 1)], 'huge.pdf', { type: 'application/pdf' })])
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/huge\.pdf is too large/))
    expect(screen.queryByRole('list', { name: 'Attached documents' })).toBeNull()
    expect(posted).not.toHaveBeenCalled()
  })
})
