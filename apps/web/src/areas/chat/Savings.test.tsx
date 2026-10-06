import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Chat } from './Chat'

// B28.358 — "Saved in this chat", beside the conversation: what the cache, the shared pool, conversion and Tare
// saved, added up from the headers Lens sent with each answer. Driven through the real Chat screen, its fetch
// mocked at the wire, each answer with headers of its own.

const CATALOG = [
  { id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10, release_date: '2024-05-13', tier: 'balanced' },
]
const ANSWER = 'data: {"choices":[{"delta":{"content":"London."}}]}\n\ndata: [DONE]\n\n'

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

/** Lens answers the nth question with the nth set of headers. */
function mockLens(answers: Record<string, string>[]) {
  let asked = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'user-a', email: 'user-a@example.com' } })
    if (url === '/api/models') return json(CATALOG)
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url.startsWith('/api/ai/stream/')) {
      return new Response(ANSWER, { status: 200, headers: { 'Content-Type': 'text/event-stream', ...answers[asked++] } })
    }
    return new Response('null', { status: 404 })
  })
}

async function askAndWait(text: string, answered: number) {
  const box = await screen.findByPlaceholderText('Ask anything')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(screen.getAllByTestId('turn-cost')).toHaveLength(answered))
}

function renderChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const row = (id: string) => screen.getByTestId(`chat-savings-${id}`)

describe('Saved in this chat', () => {
  it('each total is the sum of what Lens said on the answers: the cache and the pool in µLXC, conversion and Tare in tokens', async () => {
    const headers: Record<string, string>[] = [
      { 'X-Talyvor-Cache-Replay': 'true', 'X-Talyvor-Cache-Saved-ULXC': '2170', 'X-Talyvor-Tare': 'applied', 'X-Talyvor-Tare-Tokens-Saved': '412' },
      { 'X-Talyvor-Cache-Replay': 'true', 'X-Talyvor-Pool-List-ULXC': '2170', 'X-Talyvor-Pool-Charged-ULXC': '1519', 'X-Talyvor-Pool-Saved-ULXC': '651', 'X-Talyvor-Pool-Discount-Rate': '0.3' },
      { 'X-Talyvor-Distill': 'applied', 'X-Talyvor-Distill-Tokens-Saved': '1834', 'X-Talyvor-Distill-Bytes-Saved': '19950000', 'X-Talyvor-Tare': 'applied', 'X-Talyvor-Tare-Tokens-Saved': '88' },
      { 'X-Talyvor-Cache-Replay': 'true', 'X-Talyvor-Cache-Saved-ULXC': '1000000' },
    ]
    mockLens(headers)
    renderChat()
    const panel = await screen.findByRole('region', { name: 'Saved in this chat' })
    expect(row('cache')).toHaveTextContent('None yet')
    for (let i = 0; i < headers.length; i++) await askAndWait(`question ${i + 1}`, i + 1)

    const sum = (name: string) => headers.reduce((n, h) => n + Number(h[name] ?? 0), 0)
    expect(row('cache').dataset).toMatchObject({ total: String(sum('X-Talyvor-Cache-Saved-ULXC')), answers: '2', unstated: '0' })
    expect(row('pool').dataset).toMatchObject({ total: String(sum('X-Talyvor-Pool-Saved-ULXC')), answers: '1', unstated: '0' })
    expect(row('conversion').dataset).toMatchObject({ total: String(sum('X-Talyvor-Distill-Tokens-Saved')), answers: '1', unstated: '0' })
    expect(row('tare').dataset).toMatchObject({ total: String(sum('X-Talyvor-Tare-Tokens-Saved')), answers: '2', unstated: '0' })
    // 1,002,170 + 651 µLXC; 1,834 + 500 tokens — on the screen, to the µLXC.
    expect(within(row('cache')).getByText('1.00217')).toBeInTheDocument()
    expect(row('cache')).toHaveTextContent('2 answers from your earlier ones')
    expect(row('tare')).toHaveTextContent('500 tokens')
    expect(within(panel).getByTestId('chat-savings-total')).toHaveTextContent('In all: 1.002821 LXC saved, and 2,334 tokens fewer sent to the model.')
  })

  it('an answer Lens replayed without saying what it saved is counted and said, and adds nothing', async () => {
    mockLens([{ 'X-Talyvor-Cache-Replay': 'true' }])
    renderChat()
    await askAndWait('what is the capital of the UK?', 1)
    expect(row('cache').dataset).toMatchObject({ total: '0', answers: '1', unstated: '1' })
    expect(row('cache')).toHaveTextContent('1 answer from your earlier ones · Lens did not say what it saved')
  })
})
