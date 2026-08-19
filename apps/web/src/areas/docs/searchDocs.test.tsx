import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SearchDocs } from './SearchDocs'
import { SpaceList } from './SpaceList'

// searchDocs.test.tsx — semantic page search, the other W1.7 AI feature that needs no editor.
//
// ⚠ THE ASSERTIONS THAT MATTER ARE ABOUT A SENTENCE THIS CARD IS NOT ALLOWED TO WRITE. Docs'
// search envelope has no field saying whether its semantic half ran, and on a deployment with no
// Lens the half returns an empty list that merges in silently — MEASURED against docs `7bfa1cf`
// by running the handler. So "semantic search is off here" is unsupported by any response this
// screen can receive, and several tests below exist only to keep it off the screen.

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

const hit = (over: Record<string, unknown> = {}) => ({
  page_id: 'pg-1',
  page_title: 'Auth flow',
  space_name: 'Engineering',
  headline: 'an <mark>auth</mark> excerpt',
  source: 'fulltext',
  url: '/spaces/sp-1/pages/pg-1',
  ...over,
})

type Call = { url: string; method: string }

/** A BFF that answers the spaces read and whatever this test wants the search route to answer. */
function mockBff(search: { status: number; body: unknown }) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (url === '/api/docs/spaces' && method === 'GET') {
      return new Response(JSON.stringify(SPACES), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.startsWith('/api/docs/search?') && method === 'GET') {
      return new Response(JSON.stringify(search.body), {
        status: search.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'no such endpoint' }), { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderIn(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

async function searchFor(term: string) {
  fireEvent.change(screen.getByLabelText(/search/i), { target: { value: term } })
  fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SearchDocs', () => {
  it('asks the BFF search route with the typed query and nothing else invented', async () => {
    const calls = mockBff({ status: 200, body: { results: [hit()], total: 1, query: 'auth', took_ms: 3 } })
    renderIn(<SearchDocs />)
    await searchFor('auth flow')

    await waitFor(() => expect(screen.getByText('Auth flow')).toBeInTheDocument())
    const call = calls.find((c) => c.url.startsWith('/api/docs/search?'))
    expect(call).toBeDefined()
    const params = new URLSearchParams(call!.url.split('?')[1])
    expect(params.get('q')).toBe('auth flow')
    // ⚠ NO `type`. The BFF accepts all three and this screen sends none: an absent type is
    // upstream's own default, and a value written here would be a second author of it. The
    // reason there is no TOGGLE is in SearchDocs.tsx and is a different argument again.
    expect(params.has('type')).toBe(false)
    // No paging: the card asks for one page, so it never reaches the window the BFF refuses.
    expect(params.has('offset')).toBe(false)
  })

  it('links a hit into THIS app’s reader, not to Docs’ own origin', async () => {
    mockBff({ status: 200, body: { results: [hit()], total: 1, query: 'auth', took_ms: 3 } })
    renderIn(<SearchDocs />)
    await searchFor('auth')

    const link = await screen.findByRole('link', { name: /Auth flow/ })
    // Upstream's `/spaces/{s}/pages/{p}` is an address in DOCS' frontend; this SPA routes the
    // same path under /docs. Rendered verbatim it would land on NotFoundView.
    expect(link).toHaveAttribute('href', '/docs/spaces/sp-1/pages/pg-1')
  })

  it('says the semantic half RAN only when a row proves it', async () => {
    mockBff({
      status: 200,
      body: { results: [hit(), hit({ page_id: 'pg-2', page_title: 'Session cookies', source: 'both' })], total: 2, query: 'auth', took_ms: 3 },
    })
    renderIn(<SearchDocs />)
    await searchFor('auth')

    await waitFor(() => expect(screen.getByText('Session cookies')).toBeInTheDocument())
    expect(screen.getByText(/semantic index/i)).toBeInTheDocument()
    // With proof in hand it must NOT also hedge — the hedge is for the case with no proof.
    expect(screen.queryByText(/cannot say whether/i)).not.toBeInTheDocument()
  })

  it('⚠ hedges rather than claiming the semantic half is off, when nothing proves either way', async () => {
    mockBff({ status: 200, body: { results: [hit()], total: 1, query: 'auth', took_ms: 3 } })
    renderIn(<SearchDocs />)
    await searchFor('auth')

    await waitFor(() => expect(screen.getByText('Auth flow')).toBeInTheDocument())
    expect(screen.getByText(/cannot say whether/i)).toBeInTheDocument()
    // THE SENTENCES THIS RESPONSE DOES NOT SUPPORT. Every one of these was available to write and
    // would have been wrong: the same bytes arrive when the half ran and matched nothing.
    for (const forbidden of [/semantic search is off/i, /not configured/i, /disabled/i, /full-text only/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument()
    }
  })

  it('distinguishes a genuinely empty answer from a shape it does not recognise', async () => {
    mockBff({ status: 200, body: { results: [], total: 0, query: 'zzz', took_ms: 1 } })
    const { unmount } = renderIn(<SearchDocs />)
    await searchFor('zzz')
    await waitFor(() => expect(screen.getByText(/nothing in this workspace matched/i)).toBeInTheDocument())
    // An empty answer still cannot say whether the semantic half ran.
    expect(screen.getByText(/cannot say whether/i)).toBeInTheDocument()
    unmount()

    // A renamed `results` is a FAULT, not an empty list. This app has drawn an empty list over a
    // failed read twice under other names; the third time is guarded here.
    mockBff({ status: 200, body: { hits: [], total: 0 } })
    renderIn(<SearchDocs />)
    await searchFor('zzz')
    await waitFor(() => expect(screen.getByText(/shape this app does not recognise/i)).toBeInTheDocument())
    expect(screen.queryByText(/nothing in this workspace matched/i)).not.toBeInTheDocument()
  })

  // ── THE TWO SENTENCES THAT WERE ABOUT THE WRONG ROWS ────────────────────────
  //
  // `dropped`'s own note records that talyvor-docs has shipped an undrawable hit twice and BOTH
  // were on the semantic half — a hit whose url was a route its SPA does not register, and a hit
  // with no title. So "the row proving the semantic half ran is the row this app could not draw"
  // is the shape upstream has actually produced, twice, and it is the shape both sentences below
  // got wrong: one hedged over proof it was holding, the other credited proof to rows that did
  // not carry it.

  it('⚠ says the half RAN when the only row proving it could not be drawn', async () => {
    mockBff({
      status: 200,
      body: { results: [hit({ page_title: '', source: 'semantic' })], total: 1, query: 'auth', took_ms: 3 },
    })
    renderIn(<SearchDocs />)
    await searchFor('auth')

    await waitFor(() => expect(screen.getByText(/nothing in this workspace matched/i)).toBeInTheDocument())
    expect(screen.getByText(/result arrived and could not be drawn/i)).toBeInTheDocument()
    // The response DID establish it. Hedging here tells an operator checking whether embeddings
    // are wired that nothing can be known, while holding the proof that they are.
    expect(screen.getByText(/could not be drawn\.$/i)).toBeInTheDocument()
    expect(screen.queryByText(/cannot say whether/i)).not.toBeInTheDocument()
  })

  it('⚠ does not tell the reader one of the rows ON SCREEN came from the semantic index', async () => {
    // A full-text row is drawn; the semantic row was not. "The half ran" is true and is said.
    // "At least one of these came from the semantic index" points at a list where none did.
    mockBff({
      status: 200,
      body: {
        results: [hit(), hit({ page_id: 'pg-2', page_title: '', source: 'semantic' })],
        total: 2,
        query: 'auth',
        took_ms: 3,
      },
    })
    renderIn(<SearchDocs />)
    await searchFor('auth')

    await waitFor(() => expect(screen.getByText('Auth flow')).toBeInTheDocument())
    expect(screen.queryByText(/one of these came from the semantic index/i)).not.toBeInTheDocument()
    expect(screen.getByText(/could not be drawn\.$/i)).toBeInTheDocument()
    expect(screen.queryByText(/cannot say whether/i)).not.toBeInTheDocument()
  })

  it('says when a row arrived and could not be drawn', async () => {
    mockBff({
      status: 200,
      body: { results: [hit(), hit({ page_id: 'pg-2', page_title: '' })], total: 2, query: 'auth', took_ms: 3 },
    })
    renderIn(<SearchDocs />)
    await searchFor('auth')

    await waitFor(() => expect(screen.getByText('Auth flow')).toBeInTheDocument())
    expect(screen.getByText(/result arrived and could not be drawn/i)).toBeInTheDocument()
  })

  it('a failed search is a failure, never an empty result list', async () => {
    mockBff({ status: 502, body: { error: 'docs upstream unreachable' } })
    renderIn(<SearchDocs />)
    await searchFor('auth')

    await waitFor(() => expect(screen.getByText(/couldn’t search/i)).toBeInTheDocument())
    expect(screen.queryByText(/nothing in this workspace matched/i)).not.toBeInTheDocument()
  })

  it('surfaces the BFF’s own refusal instead of reporting an empty corpus', async () => {
    // The two parameters docs_search.go refuses locally answer 400 with a sentence naming the
    // upstream fact. A screen that swallowed it would show "nothing matched" for a request that
    // was never made.
    mockBff({ status: 400, body: { error: 'type must be one of all, fulltext, semantic — …' } })
    renderIn(<SearchDocs />)
    await searchFor('auth')

    await waitFor(() => expect(screen.getByText(/couldn’t search/i)).toBeInTheDocument())
  })

  it('is offered only where it can work — the same gate the ask card is on', async () => {
    // An unwired Docs upstream answers 503 on the spaces read; a search box over it is a control
    // that cannot do anything, and W1.7's whole complaint is buttons that 502.
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: 'docs upstream not configured on this BFF' }), { status: 503 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderIn(<SpaceList />)
    await waitFor(() => expect(screen.getByText(/not configured on this BFF/i)).toBeInTheDocument())
    expect(screen.queryByLabelText(/search/i)).not.toBeInTheDocument()
  })

  it('is offered when the spaces read succeeded', async () => {
    mockBff({ status: 200, body: { results: [], total: 0, query: 'x', took_ms: 1 } })
    renderIn(<SpaceList />)
    await waitFor(() => expect(screen.getByText('Engineering')).toBeInTheDocument())
    expect(screen.getByLabelText(/search/i)).toBeInTheDocument()
  })

  it('does not search on an empty or whitespace query — Docs’ two-character rule is not spent on', async () => {
    const calls = mockBff({ status: 200, body: { results: [], total: 0 } })
    renderIn(<SearchDocs />)
    await searchFor('   ')
    await new Promise((r) => setTimeout(r, 20))
    expect(calls.some((c) => c.url.startsWith('/api/docs/search?'))).toBe(false)
  })
})
