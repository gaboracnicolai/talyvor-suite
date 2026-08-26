import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../lib/api'
import { isAIUnavailable, isUnconfigured } from '../../lib/productState'
import { AskAI, readerHref } from './AskAI'
import { SpaceList } from './SpaceList'

// askAI.test.tsx — the first AI control in the browser, and the one thing about it that is not
// an ordinary form.
//
// ⚠ THE STATE THAT NEEDS A TEST IS THE MIDDLE ONE. Docs answers 503 when its own Lens credential
// is missing, and the BFF answers 503 when this deployment has no Docs at all. One status, two
// opposite instructions to an operator. Every assertion below that mentions AI_UNAVAILABLE is
// about keeping those two apart — the mistake lib/productState.ts records as having cost a day is
// exactly this one, made about a different pair of causes.

const SPACES = [
  {
    id: 'sp-eng',
    workspace_id: 'default',
    name: 'Engineering',
    slug: 'engineering',
    description: 'How we build',
    icon: '📘',
    color: '#0B7A85',
    private: false,
    created_by: 'm-1',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  },
]

type Call = { url: string; method: string; body: unknown }

/** A BFF that answers the spaces read and whatever this test wants the ask route to answer. */
function mockBff(ask: { status: number; body: unknown }) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/docs/spaces' && method === 'GET') {
      return new Response(JSON.stringify(SPACES), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/docs/ai/ask' && method === 'POST') {
      return new Response(JSON.stringify(ask.body), {
        status: ask.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'no such endpoint' }), { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderAsk(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

async function submit(q: string) {
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: q } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the ask control sends the question and renders the answer', () => {
  it('POSTs the question to the BFF ask route and shows the answer with its sources', async () => {
    const calls = mockBff({
      status: 200,
      body: {
        answer: 'Roll back with `deploy rollback <sha>`.',
        sources: [{ title: 'Release runbook', url: '/spaces/sp-eng/pages/pg-1' }],
      },
    })
    renderAsk(<AskAI />)
    await submit('how do we roll back')

    await screen.findByText('Roll back with `deploy rollback <sha>`.')
    const posted = calls.filter((c) => c.method === 'POST')
    expect(posted).toHaveLength(1)
    expect(posted[0].url).toBe('/api/docs/ai/ask')
    // The question, and NOTHING ELSE. A workspace or page id from the browser is a workspace or
    // page the browser chose; both are the server's to decide.
    expect(posted[0].body).toEqual({ question: 'how do we roll back' })

    const link = screen.getByRole('link', { name: 'Release runbook' })
    expect(link.getAttribute('href')).toBe('/docs/spaces/sp-eng/pages/pg-1')
  })

  it('names where the charge lands and shows no per-answer number, because there is none', async () => {
    mockBff({ status: 200, body: { answer: 'yes', sources: [] } })
    renderAsk(<AskAI />)
    await submit('anything')
    await screen.findByText('yes')

    const cost = screen.getByText(/metered Lens call billed to this workspace/)
    expect(cost.textContent).toContain('docs-ai-ask')
    expect(cost.textContent).toContain('no single page')
    // No invented figure: upstream's answer carries no cost field and this screen has no second
    // source for one.
    expect(cost.textContent).not.toMatch(/\$|\d+\s*(µ|micro)/)
  })

  it('says an ungrounded answer is ungrounded rather than showing an empty Sources list', async () => {
    mockBff({ status: 200, body: { answer: 'I could not find that.', sources: [] } })
    renderAsk(<AskAI />)
    await submit('anything')
    await screen.findByText('I could not find that.')
    expect(screen.getByText(/No pages were cited/)).toBeTruthy()
  })
})

describe('AI unconfigured is not "this deployment has no Docs"', () => {
  it('renders the AI-specific instruction, and never the unwired-deployment one', async () => {
    mockBff({
      status: 503,
      body: { error: 'AI unavailable. Check Lens configuration.', code: 'AI_UNAVAILABLE' },
    })
    renderAsk(<AskAI />)
    await submit('anything')

    await screen.findByText(/its AI is not configured/)
    // THE FAILURE THIS GUARDS. The other sentence would send an operator to check DOCS_*
    // variables that are correct.
    expect(screen.queryByText(/no upstream is wired/)).toBeNull()
    expect(screen.queryByText(/not configured on this deployment/)).toBeNull()
  })

  it('a 503 WITHOUT the code is not the AI state — it is the unwired one', () => {
    const bare = new ApiError(503, '/api/docs/ai/ask')
    expect(isAIUnavailable(bare)).toBe(false)
    expect(isUnconfigured(bare)).toBe(true)

    const ai = new ApiError(503, '/api/docs/ai/ask', 'AI_UNAVAILABLE')
    expect(isAIUnavailable(ai)).toBe(true)
    // ⚠ DISJOINT, both directions. If isUnconfigured still claimed this one, the screen that asks
    // it first would print the wrong sentence no matter what the AI predicate says.
    expect(isUnconfigured(ai)).toBe(false)
  })

  it('AI_FAILED is a fault and stays one — 502, and neither calm state claims it', async () => {
    const failed = new ApiError(502, '/api/docs/ai/ask', 'AI_FAILED')
    expect(isAIUnavailable(failed)).toBe(false)
    expect(isUnconfigured(failed)).toBe(false)

    mockBff({
      status: 502,
      body: { error: 'AI unavailable. Check Lens configuration.', code: 'AI_FAILED' },
    })
    renderAsk(<AskAI />)
    await submit('anything')
    await screen.findByText(/Couldn’t get an answer/)
    expect(screen.queryByText(/its AI is not configured/)).toBeNull()
  })
})

describe('the source link is mapped, never the upstream path verbatim', () => {
  it('maps a Docs frontend path into this app’s reader route', () => {
    expect(readerHref('/spaces/s1/pages/p1')).toBe('/docs/spaces/s1/pages/p1')
  })

  it('refuses a shape it cannot map rather than guessing one', () => {
    // ⚠ EACH OF THESE WOULD RENDER AS A LINK THAT SILENTLY DOES NOTHING: this SPA answers its own
    // shell on any unrouted path, so a wrong href is a 200 and a blank screen, not a 404.
    expect(readerHref('')).toBeNull()
    expect(readerHref('/spaces/s1')).toBeNull()
    expect(readerHref('https://docs.example.com/spaces/s1/pages/p1')).toBeNull()
    expect(readerHref('/docs/spaces/s1/pages/p1')).toBeNull()
  })

  it('renders an unmappable source as text, so the citation is still named', async () => {
    mockBff({
      status: 200,
      body: { answer: 'ok', sources: [{ title: 'Untitled draft', url: '' }] },
    })
    renderAsk(<AskAI />)
    await submit('anything')
    await screen.findByText('ok')
    expect(screen.getByText('Untitled draft')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Untitled draft' })).toBeNull()
  })
})

describe('the control is only offered where it can work', () => {
  it('appears on the docs index once the spaces read succeeds', async () => {
    mockBff({ status: 200, body: { answer: 'ok', sources: [] } })
    renderAsk(<SpaceList />)
    await screen.findByText('Engineering')
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy()
  })

  it('is absent when the BFF has no Docs upstream — that state has its own sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'docs upstream not configured on this BFF' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    renderAsk(<SpaceList />)
    // ⚠ THE OFF SENTENCE MOVED IN W1.1.9 AND THIS IS THE SAME SIGNAL, NOT A WEAKER ONE. The
    // screen said the off state twice — a card body and a caption, two wordings of one fact —
    // and now says it once, in the sentence that names the variables an operator has to set.
    // What this test needs is a witness that the OFF state rendered before it asserts the ask
    // control is absent; without one it would pass on a screen that rendered nothing at all.
    await waitFor(() => expect(screen.getByText(/The BFF has no Docs upstream wired/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull()
  })
})
