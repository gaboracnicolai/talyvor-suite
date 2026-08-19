import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aiNotConfiguredCopy } from '../../lib/productState'
import { PageTitleSuggestion } from './PageTitleSuggestion'

// pageTitleSuggestion.test.tsx — the sixth AI control in the browser, and the FIRST whose output is
// meant to be written back into the document.
//
// ⚠⚠ TWO ASSERTIONS HERE ARE ABOUT MONEY OR DATA RATHER THAN ABOUT RENDERING, AND BOTH COME FROM A
// MEASUREMENT AGAINST talyvor-docs' OWN HANDLER (tab-2f4d, docs f515db8, a `git archive` scratch
// export, its real router over a fake Lens that counts completions):
//
//   1. A BLANK PAGE IS A MONEY CASE. `{"content":""}`, `{"content":"  \n\t "}` and a body with no
//      content field at all are each 200 with a real billed completion — a title suggested for a
//      page the model never read. So the test that matters is that no request leaves.
//
//   2. AN EMPTY SUGGESTION IS REACHABLE. Engine.SuggestTitle trims ` \t\n"'` off the completion and
//      returns what is left, so a model answering `""`, `"''"` or `"\n\n"` yields `{"title":""}`
//      with a 200 — five completion shapes measured, all of them. This card must not offer to write
//      that over a real title, and must not pretend the call was free: by then it is bought.

type Call = { url: string; method: string; body: unknown }

/** A BFF that answers the suggest-title route and the page PATCH, and records every call. */
function mockBff(
  suggest: { status: number; body: unknown },
  patch: { status: number; body: unknown } = { status: 200, body: { id: 'pg-1', title: 'ok' } },
) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (/^\/api\/docs\/pages\/[^/]+\/suggest-title$/.test(url) && method === 'POST') {
      return new Response(JSON.stringify(suggest.body), {
        status: suggest.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (/^\/api\/docs\/spaces\/[^/]+\/pages\/[^/]+$/.test(url) && method === 'PATCH') {
      return new Response(JSON.stringify(patch.body), {
        status: patch.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (/^\/api\/docs\/spaces\/[^/]+\/pages\/[^/]+$/.test(url) && method === 'GET') {
      return new Response(JSON.stringify({ id: 'pg-1', title: 'The stored title' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'no such endpoint' }), { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderCard(node: React.ReactNode) {
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

describe('the page title suggestion control', () => {
  it('asks at the address that names this page, and sends the page text and nothing else', async () => {
    const calls = mockBff({ status: 200, body: { title: 'How Rollbacks Work' } })
    renderCard(
      <PageTitleSuggestion spaceId="spc-3" pageId="pg-7" text="The rollback runbook, in full." />,
    )

    fireEvent.click(screen.getByRole('button', { name: /suggest a title/i }))
    expect(await screen.findByText('How Rollbacks Work')).toBeInTheDocument()

    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe('/api/docs/pages/pg-7/suggest-title')
    // ⚠ THE BODY CARRIES THE TEXT AND NOTHING ELSE, AND THE FIELD IS `text` HERE ON PURPOSE.
    // Upstream binds `content`; the BFF renames it (docs_ai.go#docsSuggestTitleBody), because
    // `page_id` next to it is authority — it decides which document the charge lands on — and a
    // body this client wrote is a body this client chose.
    expect(posts[0].body).toEqual({ text: 'The rollback runbook, in full.' })
  })

  // ⚠⚠ MEASURED MONEY CASE. Upstream would answer this 200 and bill for it.
  it('spends nothing on a page with no text — no request at all, and it says why', () => {
    const calls = mockBff({ status: 200, body: { title: 'never reached' } })
    // ⚠ AN EXPRESSION, NOT A STRING ATTRIBUTE: `text="  \n  "` in JSX is a literal backslash and an
    // `n`, six visible characters rather than whitespace — the trap pageSummary.test.tsx recorded.
    renderCard(<PageTitleSuggestion spaceId="spc-1" pageId="pg-blank" text={'   \n\t  '} />)

    expect(screen.getByText(/no text yet, so there is nothing to suggest a title from/i)).toBeInTheDocument()
    // Not a disabled button: there is no button to press.
    expect(screen.queryByRole('button', { name: /suggest a title/i })).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
  })

  // The must-stay-green companion that keeps the refusal from being a catch-all: the rule is EMPTY,
  // not SHORT. "Too short to deserve a title" would be a product threshold invented in a component.
  it('offers the button for a page with only one character of text', () => {
    mockBff({ status: 200, body: { title: 'ok' } })
    renderCard(<PageTitleSuggestion spaceId="spc-1" pageId="pg-1" text="x" />)
    expect(screen.getByRole('button', { name: /suggest a title/i })).toBeInTheDocument()
    expect(screen.queryByText(/nothing to suggest a title from/i)).not.toBeInTheDocument()
  })

  // ⚠⚠ THE SECOND MEASURED CASE, AND THE ONE THAT PROTECTS A DOCUMENT RATHER THAN A BUDGET. A 200
  // carrying an empty title is a real upstream answer. Applying it would blank the page's title.
  it('refuses to apply an empty suggestion, and still says the call was billed', async () => {
    const calls = mockBff({ status: 200, body: { title: '' } })
    renderCard(<PageTitleSuggestion spaceId="spc-1" pageId="pg-1" text="Some real text." />)

    fireEvent.click(screen.getByRole('button', { name: /suggest a title/i }))
    expect(await screen.findByText(/the model returned no title/i)).toBeInTheDocument()
    // No way to write it. Not a disabled button — nothing to press at all.
    expect(screen.queryByRole('button', { name: /use this title/i })).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
    // ⚠ AND IT IS NOT REPORTED AS A FAILURE. The completion is bought either way; a screen that
    // called this an error would hide a charge the workspace has taken.
    expect(screen.queryByText(/couldn’t suggest a title/i)).not.toBeInTheDocument()
    expect(screen.getByText('docs-ai-title')).toBeInTheDocument()
  })

  // A whitespace-only title is the same fact wearing different bytes — upstream's trim set is
  // ` \t\n"'`, which does not include every space character a model can emit.
  it('treats a whitespace-only suggestion as no title', async () => {
    const calls = mockBff({ status: 200, body: { title: '  \r ' } })
    renderCard(<PageTitleSuggestion spaceId="spc-1" pageId="pg-1" text="Some real text." />)

    fireEvent.click(screen.getByRole('button', { name: /suggest a title/i }))
    expect(await screen.findByText(/the model returned no title/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use this title/i })).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
  })

  // ⚠⚠ SUGGESTING AND APPLYING ARE TWO DECISIONS. The suggestion arriving must not write anything;
  // the write happens on its own click, at the page's own PATCH route, carrying the title alone.
  it('writes nothing until the second click, and then writes only the title', async () => {
    const calls = mockBff({ status: 200, body: { title: 'How Rollbacks Work' } })
    renderCard(
      <PageTitleSuggestion spaceId="spc-3" pageId="pg-7" text="The rollback runbook, in full." />,
    )

    fireEvent.click(screen.getByRole('button', { name: /suggest a title/i }))
    expect(await screen.findByText('How Rollbacks Work')).toBeInTheDocument()
    // Nothing written yet — this is the assertion that a suggestion is not an edit.
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /use this title/i }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1))
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.url).toBe('/api/docs/spaces/spc-3/pages/pg-7')
    // ⚠ THE TITLE ALONE. Docs' Update decodes the body straight into its updates map, so any extra
    // key here is a column this click would set — `content_text` among them, which is the write
    // whose semantics are still an open product decision (W2.3).
    expect(patch.body).toEqual({ title: 'How Rollbacks Work' })
  })

  // ⚠ THE WRITE HAS TO REACH THE READER. PageView renders the title from its own page query, so an
  // applied title that does not invalidate that query leaves the header showing the old one — the
  // "optimistic echo" shape PageView.tsx's save mutation already records as refused everywhere else
  // in this app. Measured through a real query with the same key rather than by spying on a call.
  it('makes the page re-read after the title is applied', async () => {
    const calls = mockBff({ status: 200, body: { title: 'How Rollbacks Work' } })
    function Probe() {
      const page = useQuery({
        queryKey: ['docs-page', 'spc-3', 'pg-7'],
        queryFn: async () => {
          const r = await fetch('/api/docs/spaces/spc-3/pages/pg-7')
          return (await r.json()) as { title: string }
        },
      })
      return (
        <>
          <span>header:{page.data?.title ?? ''}</span>
          <PageTitleSuggestion spaceId="spc-3" pageId="pg-7" text="The rollback runbook." />
        </>
      )
    }
    renderCard(<Probe />)
    await screen.findByText('header:The stored title')
    const readsBefore = calls.filter((c) => c.method === 'GET').length

    fireEvent.click(screen.getByRole('button', { name: /suggest a title/i }))
    expect(await screen.findByText('How Rollbacks Work')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /use this title/i }))

    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(readsBefore),
    )
  })

  it('says the title is unchanged when the write is refused', async () => {
    mockBff(
      { status: 200, body: { title: 'How Rollbacks Work' } },
      { status: 403, body: { error: 'forbidden' } },
    )
    renderCard(<PageTitleSuggestion spaceId="spc-1" pageId="pg-1" text="Some real text." />)

    fireEvent.click(screen.getByRole('button', { name: /suggest a title/i }))
    expect(await screen.findByText('How Rollbacks Work')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /use this title/i }))

    expect(await screen.findByText(/couldn’t apply it — this page’s title is unchanged/i)).toBeInTheDocument()
  })

  // ⚠ THE MIDDLE STATE. Docs answers 503 + AI_UNAVAILABLE when its own Lens credential is missing;
  // the BFF answers a bare 503 when this deployment has no Docs at all. One status, two opposite
  // instructions to an operator — the misdiagnosis lib/productState.ts records as having cost a day.
  it('tells "Docs has no AI credential" apart from "there is no Docs here"', async () => {
    mockBff({
      status: 503,
      body: { error: 'AI unavailable. Check Lens configuration.', code: 'AI_UNAVAILABLE' },
    })
    renderCard(<PageTitleSuggestion spaceId="spc-1" pageId="pg-1" text="Some real text." />)

    fireEvent.click(screen.getByRole('button', { name: /suggest a title/i }))
    // ⚠ THE SHARED SENTENCE, VERBATIM — not a /AI/ match, which this card's cost line and its button
    // label both satisfy. Only the exact copy can tell the two 503s apart.
    expect(await screen.findByText(aiNotConfiguredCopy)).toBeInTheDocument()
    expect(screen.queryByText(/nothing was asked of the model/i)).not.toBeInTheDocument()
  })

  it('reports an ordinary failure as a fault, and never as a title', async () => {
    mockBff({ status: 502, body: { error: 'upstream said no', code: 'AI_FAILED' } })
    renderCard(<PageTitleSuggestion spaceId="spc-1" pageId="pg-1" text="Some real text." />)

    fireEvent.click(screen.getByRole('button', { name: /suggest a title/i }))
    expect(await screen.findByText(/nothing was asked of the model/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use this title/i })).not.toBeInTheDocument()
  })

  // ⚠ THE COST SENTENCE, under this route's own feature tag. W1.7's third instruction is "SHOW WHAT
  // IT COST"; a card offering this button while implying it was free would be that done backwards.
  it('says the charge lands on this page, under the feature tag, and shows no invented number', async () => {
    mockBff({ status: 200, body: { title: 'How Rollbacks Work' } })
    const { container } = renderCard(
      <PageTitleSuggestion spaceId="spc-1" pageId="pg-1" text="Some real text." />,
    )

    fireEvent.click(screen.getByRole('button', { name: /suggest a title/i }))
    expect(await screen.findByText('How Rollbacks Work')).toBeInTheDocument()

    expect(screen.getByText('docs-ai-title')).toBeInTheDocument()
    expect(screen.getByText(/moves this page’s own AI cost/i)).toBeInTheDocument()
    // NO FIGURE. The response carries no cost field and this app has no second source for one.
    expect(container.textContent ?? '').not.toMatch(/\$\s?\d/)
  })
})
