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

// ── WHAT THE SEARCH COST ─────────────────────────────────────────────────────
//
// This card is the fifth metered Docs surface and the only one that printed no cost sentence at
// all — see meteredCostCensus.test.tsx for the population and how the omission was found. The
// census proves the sentence EXISTS. These four prove it is TRUE, which is a different claim and
// the one that can go wrong: the charge here is the semantic half, and the response has no field
// saying whether that half ran. A flat "this search was a metered Lens call" is therefore false on
// a deployment with no Lens — which, per this file's header, is this deployment.
//
// ⚠ THE PAST TENSE IS THE ASSERTION. `WAS_BILLED` is the claim that requires proof; every state
// without proof must not match it, and that is what these tests measure.
const WAS_BILLED = /embedding the query was a metered lens call/i
const ONLY_A_ROW_PROVES = /only a row from the semantic index proves it happened here/i
/** The PRICE — the branch that renders before any search and after a fault. It is the present
 *  tense and it is conditional, for the same measured reason the other two branches are: on a
 *  deployment with no Lens the semantic half returns an empty list silently and nothing is
 *  billed, so the only honest claim before the fact is what a configured deployment charges. */
const PRICE_BEFORE_CLICK = /where lens is configured, running this search buys a metered lens call/i

describe('what the search cost', () => {
  it('says nothing was PROVED billed when no row carries semantic evidence', async () => {
    // The deployment this app actually runs on: Docs merges an unconfigured semantic search in as
    // an empty list, so every row comes back `fulltext`. Nothing was spent, and a card claiming a
    // charge here would be inventing one.
    mockBff({ status: 200, body: { results: [hit()], total: 1, query: 'auth', took_ms: 3 } })
    renderIn(<SearchDocs />)
    await searchFor('auth')

    await waitFor(() => expect(screen.getByText('Auth flow')).toBeInTheDocument())
    expect(screen.queryByText(WAS_BILLED)).not.toBeInTheDocument()
    expect(screen.getByText(ONLY_A_ROW_PROVES)).toBeInTheDocument()
    // It still names the tag, so a reader who wants to find the line in the workspace's Lens
    // ledger knows what to look for — "cannot say" is about THIS answer, not about the feature.
    expect(screen.getByText('docs-search')).toBeInTheDocument()
  })

  it('says the charge happened when a drawn row proves the semantic half ran', async () => {
    mockBff({
      status: 200,
      body: { results: [hit({ source: 'semantic' })], total: 1, query: 'auth', took_ms: 3 },
    })
    renderIn(<SearchDocs />)
    await searchFor('auth')

    await waitFor(() => expect(screen.getByText('Auth flow')).toBeInTheDocument())
    expect(screen.getByText(WAS_BILLED)).toBeInTheDocument()
    expect(screen.queryByText(ONLY_A_ROW_PROVES)).not.toBeInTheDocument()
  })

  it('⚠ says the charge happened even when the proving row could NOT be drawn', async () => {
    // THE ASYMMETRY THIS TEST EXISTS FOR. The evidence sentence needs a DRAWN row because it says
    // "these"; the CHARGE needs only that the half ran, and an undrawable row proves that just as
    // well — search.ts records that both of talyvor-docs' real undrawable rows were semantic hits.
    // Keying the cost note on `semanticShown` would hedge about money already spent, on precisely
    // the rows most likely to carry the proof.
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
    // The row was dropped — so the evidence sentence must NOT say "these"…
    expect(screen.getByText(/arrived and could not be drawn/i)).toBeInTheDocument()
    expect(screen.queryByText(/at least one of these/i)).not.toBeInTheDocument()
    // …and the cost sentence must still be in the past tense.
    expect(screen.getByText(WAS_BILLED)).toBeInTheDocument()
  })

  it('⚠ an answer that matched NOTHING still ran the search, and still says what it cost', async () => {
    // FOUND BY A POSITIVE CONTROL, NOT BY READING. Deleting the cost note from the empty branch
    // alone left the whole `src/areas/docs` suite green: the census drives the results branch, and
    // all three tests above hold at least one row. An empty answer is the state a reader is MOST
    // likely to reach with a bad query and MOST likely to read as "nothing happened" — and the
    // embedding was bought before Docs knew the result set was empty. It is the branch where the
    // sentence matters most and it was the branch nothing covered.
    mockBff({ status: 200, body: { results: [], total: 0, query: 'zzz', took_ms: 1 } })
    renderIn(<SearchDocs />)
    await searchFor('zzz')

    await waitFor(() =>
      expect(screen.getByText(/nothing in this workspace matched/i)).toBeInTheDocument(),
    )
    expect(screen.getByText('docs-search')).toBeInTheDocument()
    // No row came back, so nothing proves the semantic half ran — the conditional branch, and it
    // must not claim a charge it cannot evidence.
    expect(screen.getByText(ONLY_A_ROW_PROVES)).toBeInTheDocument()
    expect(screen.queryByText(WAS_BILLED)).not.toBeInTheDocument()
  })

  it('makes NO claim about money on a fault — the response cannot say whether it spent', async () => {
    // A failed read may be the BFF failing to dial (nothing spent) or Docs failing after the
    // embedding was bought (something spent). FindDuplicates records the same rule for the same
    // reason: a sentence that cannot be supported is not printed, in either direction.
    mockBff({ status: 502, body: { error: 'upstream said no' } })
    renderIn(<SearchDocs />)
    await searchFor('auth')

    await waitFor(() => expect(screen.getByText(/couldn’t search/i)).toBeInTheDocument())
    expect(screen.queryByText(WAS_BILLED)).not.toBeInTheDocument()
    expect(screen.queryByText(ONLY_A_ROW_PROVES)).not.toBeInTheDocument()

    // ⚠⚠ THIS LINE USED TO BE `queryByText('docs-search')).not.toBeInTheDocument()` AND IT IS
    // NARROWED RATHER THAN DELETED, because the rule it enforces and the assertion it made had
    // drifted apart. The rule is that this card says nothing about whether THIS SEARCH was
    // billed — both past-tense sentences above, in either direction, and they are still banned.
    // The tag's absence was a proxy for that, and it was only a faithful proxy while the cost
    // sentence lived under the results.
    //
    // It now lives beside the button, where the price was owed to a reader BEFORE the click, so
    // it is on screen in every state including this one — and what it says here is the PRICE:
    // what pressing Search costs, a fact about the route that is true whether or not this attempt
    // spent. The button is still there and still clickable; a reader deciding whether to retry
    // needs that sentence more than in any other state, not less.
    //
    // ⚠ AND THE BAN IS ASSERTED POSITIVELY AS WELL AS NEGATIVELY: the price must be the branch on
    // screen, so a receipt cannot slip in here by simply changing which one renders.
    expect(screen.getByText(PRICE_BEFORE_CLICK)).toBeInTheDocument()
    expect(screen.getByText('docs-search')).toBeInTheDocument()
  })
})
