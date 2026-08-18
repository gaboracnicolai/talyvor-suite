import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PageChangelog } from './PageChangelog'

// pageChangelog.test.tsx — the fifth W1.7 control in the browser, and the FIRST one that is not
// an AI call and does not spend money.
//
// ⚠⚠ WHAT THIS ONE LEAVES BEHIND IS A ROW, AND THAT IS WHY ITS ASSERTIONS ARE SHAPED DIFFERENTLY
// FROM THE OTHER FOUR. Ask, search, summarise and translate all buy a Lens completion, so their
// tests are about not spending. `GenerateFromIssues` reaches Lens NEVER — measured, it groups
// Track issues by label — and instead INSERTs a changelog_entries row that a later `…/publish`
// puts into the workspace's public RSS feed. So the thing that must not happen by accident here
// is not a charge; it is a durable, publishable release note that documents nothing.
//
// ⚠⚠ THE STATE THAT LOOKS LIKE SUCCESS AND IS NOT. MEASURED against talyvor-docs' own Generate
// route at ce997ff, real permission.Enforcer, real Postgres, real trackintegration.Client
// (tab-6d1a; that repo was held by tab-b9d7 and was never written to):
//
//	{"version":"v1.0.0","issue_ids":[]}             → 201 Created, one durable row
//	{"version":"v1.1.0"}                            → 201 Created, one durable row
//	{"version":"v1.2.0","issue_ids":null}           → 201 Created, one durable row
//	{"version":"v5.0.0","issue_ids":["","  ","\t"]} → 201 Created, "Generated from 3 issues"
//
// and the row the first wrote, read back with SQL: title "v1.0.0", summary "Generated from 0
// issues", body `…"text":"No issues."…`. The last is worse — it claims three issues over three
// EMPTY bullets. Every one of those is a 201, so a test asserting "the component rendered the
// entry it got back" would pass in all four cases. The test that matters is that NO REQUEST
// LEAVES when there is nothing to generate from.

type Call = { url: string; method: string; body: unknown }

/** A BFF that answers the generate route with whatever this test wants, and records every call. */
function mockBff(reply: { status: number; body: unknown }) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (/^\/api\/docs\/spaces\/[^/]+\/pages\/[^/]+\/changelog\/generate$/.test(url) && method === 'POST') {
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'no such endpoint' }), { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

/** The same BFF, answering a DIFFERENT reply per call — the success-then-failure sequence is the
 *  only state in which the one-chain rule is falsifiable at all (see the last test). */
function mockBffSequence(replies: { status: number; body: unknown }[]) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (/^\/api\/docs\/spaces\/[^/]+\/pages\/[^/]+\/changelog\/generate$/.test(url) && method === 'POST') {
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)]
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'no such endpoint' }), { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderChangelog(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const created = {
  id: 'cl-1',
  page_id: 'p1',
  version: 'v2.0.0',
  title: 'v2.0.0',
  summary: 'Generated from 2 issues',
  type: 'feature',
  issue_ids: ['ENG-1', 'ENG-2'],
}

function typeVersion(value: string) {
  fireEvent.change(screen.getByLabelText(/version/i), { target: { value } })
}

function typeIssues(value: string) {
  fireEvent.change(screen.getByLabelText(/issues/i), { target: { value } })
}

/**
 * ⚠⚠ `await waitFor(() => expect(calls).toHaveLength(0))` IS A TEST THAT CANNOT FAIL, AND BOTH
 * no-request assertions below were written that way before control W2 refuted them. `waitFor`
 * returns the moment its callback stops throwing, and "no request has been made yet" is TRUE ON
 * THE FIRST TICK whatever the component does — so the assertion is satisfied before the mutation
 * it is about could ever have dialled. Measured: with `issueIdsFrom`'s blank filter deleted, the
 * blank-ids test STAYED GREEN while the component fired a real request.
 *
 * `flush` waits for macrotasks the mutation's fetch would have to have started within, so an
 * emptiness assertion after it is a claim about a window in which a request COULD have arrived.
 * `it fires within the same window` below is its positive control: the same flush, an input that
 * SHOULD dial, and a request that must be there. Without that, a flush that waited zero time
 * would make every "sent nothing" assertion vacuous again in exactly the same way.
 */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PageChangelog', () => {
  // ⚠⚠ THE ASSERTION THIS FILE EXISTS FOR. Upstream this exact state is 201 Created and a
  // durable, publishable row whose body is the words "No issues."
  it('sends nothing when no issues have been named', async () => {
    const calls = mockBff({ status: 201, body: created })
    renderChangelog(<PageChangelog spaceId="s1" pageId="p1" />)

    typeVersion('v2.0.0')
    const button = screen.getByRole('button', { name: /generate/i })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    await flush()
    expect(calls).toHaveLength(0)
  })

  // ⚠ THE POSITIVE CONTROL ON `flush`, AND IT IS IN THE FILE RATHER THAN IN THE HARNESS. Every
  // "sent nothing" assertion above and below is an emptiness claim, and an emptiness claim is
  // only as good as the window it is made over. This drives the SAME window with an input that
  // must dial: if `flush` ever stops waiting long enough, this reds instead of the refusals
  // silently becoming true-by-construction.
  it('fires within the same window when issues ARE named', async () => {
    const calls = mockBff({ status: 201, body: created })
    renderChangelog(<PageChangelog spaceId="s1" pageId="p1" />)

    typeVersion('v2.0.0')
    typeIssues('ENG-1')
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))
    await flush()
    expect(calls).toHaveLength(1)
  })

  // The same rule, one step further in: a list that LOOKS populated and contains nothing usable.
  // Measured, upstream answers this one 201 with "Generated from 3 issues" over three empty
  // bullets — a worse row than the empty case, because it claims a count it cannot support.
  it('treats a list of blank ids as no issues at all', async () => {
    const calls = mockBff({ status: 201, body: created })
    renderChangelog(<PageChangelog spaceId="s1" pageId="p1" />)

    typeVersion('v2.0.0')
    typeIssues('  ,  , ,\t')
    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))
    await flush()
    expect(calls).toHaveLength(0)
  })

  // The version is NOT judged here. Upstream has a real regexp and answers for itself (measured:
  // 400 with its own message for "", "   " and "banana"; 201 for v1.0.0 and 2026-08-18), so a
  // second rule in this component would be a screen authoring a vocabulary it does not own, and
  // it would drift the day Docs widens the pattern.
  it('sends a version this screen has no opinion about', async () => {
    const calls = mockBff({ status: 400, body: { error: 'changelog: invalid version "banana"' } })
    renderChangelog(<PageChangelog spaceId="s1" pageId="p1" />)

    typeVersion('banana')
    typeIssues('ENG-1')
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toEqual({ version: 'banana', issue_ids: ['ENG-1'] })
  })

  it('splits the issue list and drops the blanks around it', async () => {
    const calls = mockBff({ status: 201, body: created })
    renderChangelog(<PageChangelog spaceId="s1" pageId="p1" />)

    typeVersion('v2.0.0')
    typeIssues(' ENG-1 , ,ENG-2,  ')
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/docs/spaces/s1/pages/p1/changelog/generate')
    expect(calls[0].body).toEqual({ version: 'v2.0.0', issue_ids: ['ENG-1', 'ENG-2'] })
  })

  // ⚠ THE COST SENTENCE, AND IT IS THE OPPOSITE OF THE OTHER FOUR CONTROLS'. Measured: this
  // operation reaches Lens never. A screen that borrowed ask/summarise/translate's "this was a
  // metered Lens call" sentence would be stating a charge that does not exist.
  it('says what it left behind and does not claim a charge', async () => {
    mockBff({ status: 201, body: created })
    renderChangelog(<PageChangelog spaceId="s1" pageId="p1" />)

    typeVersion('v2.0.0')
    typeIssues('ENG-1,ENG-2')
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))

    await waitFor(() => expect(screen.getByText(/Generated from 2 issues/)).toBeInTheDocument())
    // It says a row was written and that publishing is a separate, later act.
    expect(screen.getByText(/saved to this page.s changelog/i)).toBeInTheDocument()
    expect(screen.getByText(/not published/i)).toBeInTheDocument()
    // And it does not invent a charge. These are the words the four metered controls use.
    expect(screen.queryByText(/metered Lens call/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/AI cost/i)).not.toBeInTheDocument()
  })

  // ⚠⚠ THIS TEST'S GREEN IS NOT EVIDENCE FOR THE ONE-CHAIN ORDERING, AND CONTROL W4 IS RECORDED
  // AS **NOT CAUGHT** RATHER THAN PAPERED OVER. Splitting the chain into two sibling containers —
  // the shape emptyVsFault.test.ts measured on IssueList.tsx, where a refused read renders as a
  // calm success — REDDENS NOTHING IN THIS REPO, and two re-cuts of this test failed to change
  // that:
  //
  //   first cut  — one failing generate. `data` is undefined, so siblings render identical DOM.
  //   second cut — success THEN failure, on the theory that react-query keeps the previous
  //                `data`. MEASURED: it does not. `useMutation` resets `data` when the next
  //                mutate starts, so on the failure there is still nothing for a sibling to
  //                print, and the split is again invisible.
  //
  // So there is no state this component can reach in which the ordering is observable, and no
  // assertion can be written that would fail if it were removed. The chain stays as defence in
  // depth — it costs nothing and it is the shape the rest of this app uses — but it is UNGUARDED
  // by construction, and this comment is the only thing that says so.
  //
  // What the test below DOES pin is worth keeping on its own terms: after a refusal, no
  // previously-created entry is on screen. That is true today because of react-query's reset, so
  // it is a regression guard on THAT behaviour — the day a `keepPreviousData`-shaped change lands,
  // this reds and the chain starts earning its place.
  it('never shows a previously created entry beside a later refusal', async () => {
    const calls = mockBffSequence([
      { status: 201, body: created },
      { status: 400, body: { error: 'changelog: invalid version "banana"' } },
    ])
    renderChangelog(<PageChangelog spaceId="s1" pageId="p1" />)

    typeVersion('v2.0.0')
    typeIssues('ENG-1')
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))
    await waitFor(() => expect(screen.getByText(/Generated from 2 issues/)).toBeInTheDocument())

    typeVersion('banana')
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))
    await waitFor(() => expect(screen.getByText(/couldn.t generate/i)).toBeInTheDocument())

    expect(calls).toHaveLength(2)
    // The stale success must be GONE, not merely further down the card.
    expect(screen.queryByText(/Generated from 2 issues/)).not.toBeInTheDocument()
    expect(screen.queryByText(/saved to this page.s changelog/i)).not.toBeInTheDocument()
  })
})
