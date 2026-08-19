import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SearchIssues } from './SearchIssues'
import { readIssueSearch } from './issueSearch'

// searchIssues.test.tsx — Track's issue search, the fourth of the five Track AI features W1.7
// recorded as reachable only by curl.
//
// ⚠ THE ASSERTIONS THAT MATTER MOST ARE ABOUT SENTENCES THIS CARD IS NOT ALLOWED TO WRITE. Track's
// route is named `semantic-search`, its answer is a BARE ARRAY, and MEASURED against track
// `b6fec98` by running `ai.Handler.SemanticSearch` in a /tmp export, the AI-off answer and the
// AI-on-but-fell-back answer are byte-identical. So neither "this was semantic" nor "semantic is
// off here" is supportable by any response this screen can receive, and several tests below exist
// only to keep both off the screen.

const hit = (over: Record<string, unknown> = {}) => ({
  id: 'iss-1',
  identifier: 'ENG-42',
  title: 'auth token expiry is wrong',
  status: 'in_progress',
  priority: 2,
  ...over,
})

type Call = { url: string; method: string }

function mockBff(search: { status: number; body: unknown }) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (url.startsWith('/api/track/issues/search?') && method === 'GET') {
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

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SearchIssues />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function type(term: string) {
  fireEvent.change(screen.getByLabelText(/search/i), { target: { value: term } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SearchIssues', () => {
  it('asks the BFF search route with the typed query and nothing else invented', async () => {
    const calls = mockBff({ status: 200, body: [hit()] })
    renderCard()
    type('auth token')
    submit()

    await waitFor(() => expect(screen.getByText('auth token expiry is wrong')).toBeInTheDocument())
    const call = calls.find((c) => c.url.startsWith('/api/track/issues/search?'))
    expect(call).toBeDefined()
    const params = new URLSearchParams(call!.url.split('?')[1])
    expect(params.get('q')).toBe('auth token')
    // The BFF refuses any third parameter, and the card sends none — no `limit` either: the
    // default it would restate is Track's, and a value written here would be a second author.
    expect([...params.keys()]).toEqual(['q'])
  })

  it('links a hit into THIS app’s ticket route', async () => {
    mockBff({ status: 200, body: [hit()] })
    renderCard()
    type('auth')
    submit()

    const link = await screen.findByRole('link', { name: /auth token expiry is wrong/i })
    expect(link).toHaveAttribute('href', '/track/issues/iss-1')
  })

  // ⚠⚠ THE CENTRAL ASSERTION. No response this card receives can say which half served it, so no
  // wording about halves may appear — in EITHER direction. This is the test that would have to be
  // deleted, not edited, for someone to put "AI search" on this card.
  it('never claims the search was semantic, and never claims it was not', async () => {
    mockBff({ status: 200, body: [hit()] })
    const { container } = renderCard()
    type('auth')
    submit()

    await waitFor(() => expect(screen.getByText('auth token expiry is wrong')).toBeInTheDocument())
    const text = container.textContent ?? ''
    for (const banned of [/semantic/i, /\bAI\b/, /vector/i, /embedding/i, /full-text/i, /fulltext/i]) {
      expect(text).not.toMatch(banned)
    }
  })

  // The same rule on the empty path, which is where the temptation is strongest: an empty list is
  // exactly when a screen wants to explain itself, and it is exactly when it knows least.
  it('describes an empty answer as Track’s answer, not as a fact about the workspace', async () => {
    mockBff({ status: 200, body: [] })
    renderCard()
    type('auth')
    submit()

    await waitFor(() => expect(screen.getByText(/returned no issues/i)).toBeInTheDocument())
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/semantic/i)
    // "no issues match" would be a claim about the tracker; Track answers `[]` when no search
    // backend is wired at all, so the screen may only report what came back.
    expect(text).not.toMatch(/no (matching )?issues (exist|in this workspace)/i)
  })

  // ⚠ A FAULT IS NOT AN EMPTY LIST. An object where an array was expected is Track's error shape,
  // and reading it as "no results" would render a fault as a calm empty panel.
  it('draws an unreadable shape as a fault, not as nothing matched', async () => {
    mockBff({ status: 200, body: { error: 'nope', code: 'SEARCH_FAILED' } })
    renderCard()
    type('auth')
    submit()

    await waitFor(() => expect(screen.getByText(/shape this app does not recognise/i)).toBeInTheDocument())
    expect(screen.queryByText(/returned no issues/i)).not.toBeInTheDocument()
  })

  it('says Track is not configured when the BFF says so, rather than offering a retry', async () => {
    mockBff({ status: 503, body: { error: 'track upstream not configured on this BFF' } })
    renderCard()
    type('auth')
    submit()

    await waitFor(() => expect(screen.getByText(/not configured on this deployment/i)).toBeInTheDocument())
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument()
  })

  it('offers a retry for a genuine fault, which is a different sentence', async () => {
    mockBff({ status: 500, body: { error: 'boom' } })
    renderCard()
    type('auth')
    submit()

    await waitFor(() => expect(screen.getByText(/try again/i)).toBeInTheDocument())
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument()
  })

  // ⚠ THE BLANK-QUERY REFUSAL, ASSERTED THROUGH THE BUTTON'S DISABLED STATE AND A REAL FLUSH.
  // `waitFor(() => expect(calls).toHaveLength(0))` would pass on the FIRST TICK — "no request yet"
  // is true before any request could have been made — which is how #229's W2 control caught a test
  // that stayed green while the component fired. The positive control below is what says the
  // flush window is real.
  it('does not dial for a whitespace-only query', async () => {
    const calls = mockBff({ status: 200, body: [hit()] })
    renderCard()
    type('   ')
    expect(screen.getByRole('button', { name: /^search$/i })).toBeDisabled()
    submit()
    await new Promise((r) => setTimeout(r, 20))
    expect(calls.filter((c) => c.url.startsWith('/api/track/issues/search?'))).toHaveLength(0)
  })

  // THE IN-FILE POSITIVE CONTROL for the test above: a real query DOES dial inside the same window.
  // Without it, a flush that waited zero time would make the refusal test vacuous.
  it('fires within the same window when the query is real', async () => {
    const calls = mockBff({ status: 200, body: [hit()] })
    renderCard()
    type('auth')
    submit()
    await new Promise((r) => setTimeout(r, 20))
    expect(calls.filter((c) => c.url.startsWith('/api/track/issues/search?'))).toHaveLength(1)
  })

  it('counts a row it cannot draw instead of quietly serving a shorter list', async () => {
    mockBff({ status: 200, body: [hit(), hit({ id: 'iss-2', title: '' })] })
    renderCard()
    type('auth')
    submit()

    const note = await screen.findByText(/could not be drawn/i)
    // The count and the sentence are separate text nodes (see DroppedNote on why the prose is JSX
    // text and not a string), so the assertion reads the paragraph's own textContent.
    expect(note.textContent).toMatch(/^1 result arrived/)
    // The drawable row is still drawn — a dropped row must not empty the list.
    expect(screen.getByText('auth token expiry is wrong')).toBeInTheDocument()
  })

  // ⚠ AN UNRECOGNISED STATUS DRAWS NO PILL. A default hue would be a confident claim about a value
  // nobody classified — the tier-dot defect (#149) in another costume, and Track's own store
  // accepts an out-of-range priority (W1.7 records that upstream finding).
  it('draws no status pill and no priority for values it cannot classify', async () => {
    mockBff({ status: 200, body: [hit({ status: 'banana', priority: 99 })] })
    renderCard()
    type('auth')
    submit()

    await waitFor(() => expect(screen.getByText('auth token expiry is wrong')).toBeInTheDocument())
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/banana/)
    expect(text).not.toMatch(/\bNone\b/) // priorityLabel's `?? 'None'` must not be reached
    expect(text).not.toMatch(/\b99\b/)
  })

  it('draws the status and priority it CAN classify — the must-stay-green companion', async () => {
    mockBff({ status: 200, body: [hit()] })
    renderCard()
    type('auth')
    submit()

    await waitFor(() => expect(screen.getByText('In progress')).toBeInTheDocument())
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('ENG-42')).toBeInTheDocument()
  })
})

describe('readIssueSearch', () => {
  it('reads a bare array of issues', () => {
    const v = readIssueSearch([hit()])
    expect(v).toEqual({
      kind: 'results',
      dropped: 0,
      rows: [{ id: 'iss-1', identifier: 'ENG-42', title: 'auth token expiry is wrong', status: 'in_progress', priority: 2 }],
    })
  })

  // ⚠ NOT AN ARRAY IS `unrecognised`, NOT EMPTY — the whole reason this reader exists rather than
  // `Array.isArray(x) ? x : []`, which is what IssueList does for the LIST route and which would
  // turn every Track error shape into "nothing matched".
  it.each([
    ['an error object', { error: 'nope', code: 'SEARCH_FAILED' }],
    ['an ai_available refusal', { ai_available: false, reason: 'not configured' }],
    ['null', null],
    ['a string', 'nope'],
  ])('reads %s as unrecognised rather than empty', (_name, payload) => {
    expect(readIssueSearch(payload)).toEqual({ kind: 'unrecognised' })
  })

  it('reads an empty array as empty', () => {
    expect(readIssueSearch([])).toEqual({ kind: 'empty', dropped: 0 })
  })

  it('drops and counts rows with no id or no title', () => {
    const v = readIssueSearch([hit(), hit({ id: '' }), hit({ id: 'x', title: '' }), 'junk'])
    expect(v.kind).toBe('results')
    if (v.kind !== 'results') return
    expect(v.rows).toHaveLength(1)
    expect(v.dropped).toBe(3)
  })

  it('nulls a status or priority it cannot classify rather than defaulting one', () => {
    const v = readIssueSearch([hit({ status: 'banana', priority: 99 })])
    if (v.kind !== 'results') throw new Error('expected results')
    expect(v.rows[0].status).toBeNull()
    expect(v.rows[0].priority).toBeNull()
  })

  it('accepts priority 0, which is a real value and not an absent one', () => {
    const v = readIssueSearch([hit({ priority: 0 })])
    if (v.kind !== 'results') throw new Error('expected results')
    expect(v.rows[0].priority).toBe(0)
  })
})
