import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aiNotConfiguredCopy } from '../../lib/productState'
import { PageSummary } from './PageSummary'

// pageSummary.test.tsx — the third AI control in the browser, and the first one that spends money
// ON A DOCUMENT.
//
// ⚠ THE ASSERTION THIS FILE EXISTS FOR IS THE ONE ABOUT A CLICK THAT NEVER HAPPENS. talyvor-docs'
// transform route answers an EMPTY text with 200 and a real, billed Lens completion attributed to
// the named page — measured against its own handler over a fake Lens that counts completions
// (tab-7b42, docs e70ff61, scratch copy). So "this page is blank" is a money case, not a cosmetic
// one, and the test that matters is that no request leaves.

type Call = { url: string; method: string; body: unknown }

/** A BFF that answers the summarise route with whatever this test wants, and records every call. */
function mockBff(summary: { status: number; body: unknown }) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (/^\/api\/docs\/pages\/[^/]+\/summarize$/.test(url) && method === 'POST') {
      return new Response(JSON.stringify(summary.body), {
        status: summary.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'no such endpoint' }), { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderSummary(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the page summary control', () => {
  it('summarises the page it was given, at the address that names that page', async () => {
    const calls = mockBff({ status: 200, body: { text: '• rolls back with one command' } })
    renderSummary(<PageSummary pageId="pg-7" text="The rollback runbook, in full." />)

    fireEvent.click(screen.getByRole('button', { name: /summarise this page/i }))
    expect(await screen.findByText('• rolls back with one command')).toBeInTheDocument()

    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe('/api/docs/pages/pg-7/summarize')
    // ⚠ THE BODY CARRIES THE TEXT AND NOTHING ELSE. `action` and `page_id` are the BFF's to write
    // — the action decides what the workspace pays for and the page id decides which document the
    // charge lands on, and a body this client wrote is a body this client chose.
    expect(posts[0].body).toEqual({ text: 'The rollback runbook, in full.' })
  })

  // ⚠⚠ THE POINT OF THE FILE. Upstream would answer this 200 and bill for it.
  it('spends nothing on a page with no text — no request at all, and it says why', () => {
    const calls = mockBff({ status: 200, body: { text: 'never reached' } })
    // ⚠ AN EXPRESSION, NOT A STRING ATTRIBUTE. `text="  \n  "` in JSX is a literal backslash and
    // an `n` — six visible characters, not whitespace — so this case passed through the "has
    // text" branch and the first run of this test accused an innocent component.
    renderSummary(<PageSummary pageId="pg-blank" text={'   \n\t  '} />)

    expect(screen.getByText(/nothing to summarise/i)).toBeInTheDocument()
    // Not a disabled button: there is no button to press.
    expect(screen.queryByRole('button', { name: /summarise/i })).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  // The must-stay-green companion that keeps the refusal from being a catch-all: the rule is
  // EMPTY, not SHORT, because "too short to be worth summarising" would be a product threshold
  // invented in a component.
  it('offers the button for a page with only one character of text', () => {
    mockBff({ status: 200, body: { text: 'ok' } })
    renderSummary(<PageSummary pageId="pg-1" text="x" />)
    expect(screen.getByRole('button', { name: /summarise this page/i })).toBeInTheDocument()
    expect(screen.queryByText(/nothing to summarise/i)).not.toBeInTheDocument()
  })

  // ⚠ THE MIDDLE STATE. Docs answers 503 + AI_UNAVAILABLE when its own Lens credential is missing;
  // the BFF answers a bare 503 when this deployment has no Docs at all. One status, two opposite
  // instructions to an operator — the misdiagnosis lib/productState.ts records as having cost a
  // day. Read off the status alone this would say "Docs is not configured", while Docs is running.
  it('tells "Docs has no AI credential" apart from "there is no Docs here"', async () => {
    mockBff({
      status: 503,
      body: { error: 'AI unavailable. Check Lens configuration.', code: 'AI_UNAVAILABLE' },
    })
    renderSummary(<PageSummary pageId="pg-1" text="Some real text." />)

    fireEvent.click(screen.getByRole('button', { name: /summarise this page/i }))
    // ⚠ THE SHARED SENTENCE, VERBATIM — not a /AI/ match, which this card's own cost line and its
    // button label both satisfy. The assertion has to be able to tell the two 503s apart, and only
    // the exact copy can: the generic fault arm is asserted absent in the same breath.
    expect(await screen.findByText(aiNotConfiguredCopy)).toBeInTheDocument()
    expect(screen.queryByText(/nothing was asked of the model/i)).not.toBeInTheDocument()
  })

  it('reports an ordinary failure as a fault, and never as a summary', async () => {
    mockBff({ status: 502, body: { error: 'upstream said no', code: 'AI_FAILED' } })
    renderSummary(<PageSummary pageId="pg-1" text="Some real text." />)

    fireEvent.click(screen.getByRole('button', { name: /summarise this page/i }))
    expect(await screen.findByText(/nothing was asked of the model/i)).toBeInTheDocument()
  })

  // ⚠ THE COST SENTENCE IS THE OPPOSITE OF THE ASK CARD'S, AND BOTH ARE TRUE. Ask passes an empty
  // page id upstream, so no page's cost moves; this one names the page, so the charge lands on it.
  // A screen that offered this button while implying it was free would be the one thing W1.7 asked
  // for ("SHOW WHAT IT COST") done backwards.
  it('says the charge lands on this page, under the feature tag, and shows no invented number', async () => {
    mockBff({ status: 200, body: { text: '• a summary' } })
    const { container } = renderSummary(<PageSummary pageId="pg-1" text="Some real text." />)

    fireEvent.click(screen.getByRole('button', { name: /summarise this page/i }))
    expect(await screen.findByText('• a summary')).toBeInTheDocument()

    expect(screen.getByText('docs-ai-summarize')).toBeInTheDocument()
    expect(screen.getByText(/moves this page’s own AI cost/i)).toBeInTheDocument()
    // NO FIGURE. The response carries no cost field and this app has no second source for one.
    expect(container.textContent ?? '').not.toMatch(/\$\s?\d/)
  })

  // A summary is not the document. Nothing here writes it back, and the screen says so — a box of
  // model-written text under a page editor is exactly the shape a reader expects to be editable.
  it('states that the summary is not saved to the page', async () => {
    mockBff({ status: 200, body: { text: '• a summary' } })
    renderSummary(<PageSummary pageId="pg-1" text="Some real text." />)

    fireEvent.click(screen.getByRole('button', { name: /summarise this page/i }))
    expect(await screen.findByText(/not saved to the page/i)).toBeInTheDocument()
    // And it is not offered as an editable field either.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
