import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aiNotConfiguredCopy } from '../../lib/productState'
import { PageTranslation } from './PageTranslation'

// pageTranslation.test.tsx — the fourth AI control in the browser, and the second that spends
// money ON A DOCUMENT.
//
// ⚠⚠ THE ASSERTIONS THIS FILE EXISTS FOR ARE BOTH ABOUT A REQUEST THAT WOULD HAVE SUCCEEDED.
// talyvor-docs' translate route answers 200 and bills a real Lens completion for every one of
// these, measured against its own handler over a fake Lens that captures the SYSTEM PROMPT
// (tab-7c3e, docs 6aca7db, scratch export):
//
//	no language at all      → 200, 1 completion, "…to English…"
//	language: ""            → 200, 1 completion, "…to English…"
//	target_language:"French"→ 200, 1 completion, "…to English…"
//	text: ""                → 200, 1 completion, 0 user bytes
//
// None of those is distinguishable from a correct translation by looking at the response. So the
// two tests that matter are (1) that no request leaves when there is no language, and (2) that the
// request which DOES leave names the language under the key upstream actually binds. A test that
// asserted "the component rendered the translation" would pass in all four cases above.

type Call = { url: string; method: string; body: unknown }

/** A BFF that answers the translate route with whatever this test wants, and records every call. */
function mockBff(reply: { status: number; body: unknown }) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (/^\/api\/docs\/pages\/[^/]+\/translate$/.test(url) && method === 'POST') {
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

function renderTranslation(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function typeLanguage(value: string) {
  fireEvent.change(screen.getByLabelText(/translate into/i), { target: { value } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the page translation control', () => {
  // ⚠⚠ THE CENTRAL ASSERTION. It reads the body that LEFT THE BROWSER, keyed exactly as
  // talyvor-docs binds it. `target_language` — the name docs' own fixture uses — would leave this
  // assertion red and every rendered-output assertion green.
  it('sends the language under the key the upstream binds, at the address that names the page', async () => {
    const calls = mockBff({ status: 200, body: { text: 'Le manuel de restauration.' } })
    renderTranslation(<PageTranslation pageId="pg-7" text="The rollback runbook, in full." />)

    typeLanguage('French')
    fireEvent.click(screen.getByRole('button', { name: /translate this page/i }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/docs/pages/pg-7/translate')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ text: 'The rollback runbook, in full.', language: 'French' })
    // Named explicitly rather than left to toEqual, so the reason survives a refactor of the
    // matcher: this key is the finding.
    expect((calls[0].body as Record<string, unknown>).language).toBe('French')
    expect(calls[0].body as Record<string, unknown>).not.toHaveProperty('target_language')
    // page_id is the BFF's job, from the path — a body that named it would be the browser
    // choosing which document the charge lands on.
    expect(calls[0].body as Record<string, unknown>).not.toHaveProperty('page_id')

    expect(await screen.findByText('Le manuel de restauration.')).toBeInTheDocument()
  })

  // ⚠⚠ THE SECOND. Upstream this exact state is 200 + a billed completion in English.
  it('sends nothing at all until a language is named, and says why', async () => {
    const calls = mockBff({ status: 200, body: { text: 'should never be reached' } })
    renderTranslation(<PageTranslation pageId="pg-7" text="The rollback runbook." />)

    const button = screen.getByRole('button', { name: /translate this page/i })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(calls).toHaveLength(0)

    // The reason is on the screen, not just in the disabled attribute — a disabled control with no
    // explanation is the shape this codebase refuses elsewhere.
    expect(screen.getByText(/without one, Docs would translate this page into English/i)).toBeInTheDocument()
  })

  // Whitespace is blank. Upstream trims to "" and substitutes English exactly as an empty string does.
  it('treats a whitespace-only language as no language', async () => {
    const calls = mockBff({ status: 200, body: { text: 'should never be reached' } })
    renderTranslation(<PageTranslation pageId="pg-7" text="The rollback runbook." />)

    typeLanguage('   ')
    const button = screen.getByRole('button', { name: /translate this page/i })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(calls).toHaveLength(0)
  })

  // The companion that stops the language rule being a catch-all: this control owns no vocabulary,
  // because Docs owns none either — it interpolates the string into a prompt.
  it('accepts any non-blank language, including ones no list would contain', async () => {
    for (const language of ['fr', 'Français', 'Brazilian Portuguese', 'Middle English']) {
      const calls = mockBff({ status: 200, body: { text: 'ok' } })
      const { unmount } = renderTranslation(<PageTranslation pageId="pg-7" text="Body." />)
      typeLanguage(language)
      fireEvent.click(screen.getByRole('button', { name: /translate this page/i }))
      await waitFor(() => expect(calls).toHaveLength(1))
      expect((calls[0].body as Record<string, unknown>).language).toBe(language)
      unmount()
      vi.unstubAllGlobals()
    }
  })

  // A blank page is a billed completion on zero bytes upstream. No control is offered at all.
  it('offers no button on a page with no text, and explains instead of disabling silently', async () => {
    const calls = mockBff({ status: 200, body: { text: 'should never be reached' } })
    // ⚠ AN EXPRESSION, NOT A STRING ATTRIBUTE. `text="  \n  "` in JSX is a literal backslash and
    // an `n` — a NON-blank string — so the attribute form would render the button and this test
    // would be asserting the opposite of what it says. pageSummary.test.tsx records the same trap;
    // this file walked into it before copying the fix.
    renderTranslation(<PageTranslation pageId="pg-7" text={'   \n\t '} />)

    expect(screen.queryByRole('button', { name: /translate this page/i })).not.toBeInTheDocument()
    expect(screen.getByText(/nothing to translate/i)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  // The cost sentence names where the charge lands and shows no figure, because there is no
  // per-call figure to show.
  it('says where the charge lands, and shows no number', async () => {
    mockBff({ status: 200, body: { text: 'Le manuel.' } })
    renderTranslation(<PageTranslation pageId="pg-7" text="The runbook." />)
    typeLanguage('French')
    fireEvent.click(screen.getByRole('button', { name: /translate this page/i }))

    expect(await screen.findByText(/docs-ai-translate/)).toBeInTheDocument()
    expect(screen.getByText(/moves this page’s own AI cost/i)).toBeInTheDocument()
    expect(screen.getByText(/not saved to the page/i)).toBeInTheDocument()
  })

  // Docs' AI_UNAVAILABLE gets the product's own copy rather than a generic failure.
  it('renders the not-configured copy when Docs has no AI credential', async () => {
    mockBff({
      status: 503,
      body: { error: 'AI unavailable. Check Lens configuration.', code: 'AI_UNAVAILABLE' },
    })
    renderTranslation(<PageTranslation pageId="pg-7" text="The runbook." />)
    typeLanguage('French')
    fireEvent.click(screen.getByRole('button', { name: /translate this page/i }))

    expect(await screen.findByText(aiNotConfiguredCopy)).toBeInTheDocument()
  })

  // ⚠ A FAILURE MUST NEVER RENDER AS A SHORT TRANSLATION. One chain, failure first.
  it('shows a failure as a failure, and no translation text beside it', async () => {
    mockBff({ status: 500, body: { error: 'boom' } })
    renderTranslation(<PageTranslation pageId="pg-7" text="The runbook." />)
    typeLanguage('French')
    fireEvent.click(screen.getByRole('button', { name: /translate this page/i }))

    expect(await screen.findByText(/Couldn’t translate this page/i)).toBeInTheDocument()
    expect(screen.queryByText(/docs-ai-translate/)).not.toBeInTheDocument()
  })
})
