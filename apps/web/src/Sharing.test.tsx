import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { App, queryClient } from './App'
import { PoolingConsent } from './components/PoolingConsent'
import { UNPAID_NOTICE_HEADLINE } from './areas/lens/unpaidNotice'

// Sharing.test.tsx — the consent surface.
//
// TWO THINGS ARE PINNED, and the first is why this file exists.
//
//  1. THE PROMISE IS BACKED. The signup screen tells people they can change this later in
//     Settings. The first draft said that while no settings route existed — a stale claim in a
//     brand-new file, about consent. So the route is asserted here: if /settings stops resolving
//     to the sharing control, this fails, and the sentence cannot quietly become false again.
//  2. THE SCREEN SHOWS WHAT IS STORED. The BFF returns the consent Lens RECORDED, and the screen
//     must render that rather than an optimistic echo of a click. A screen that shows the choice
//     you made rather than the one that took effect is the failure this whole path avoids.
//
// It also checks the copy states BOTH sides. Pre-declining means sharing only ever fires for
// people who actively opt in, so a screen that lists only the risk would quietly end the earning
// half of the product — and a screen that lists only the benefit would be selling. Both must be
// present, which is a property worth a test even though it is words.

function mockBff(cachePoolable: boolean, needsChoice = false) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/auth/me') {
      return new Response(
        JSON.stringify({
          mode: 'oidc',
          authenticated: true,
          user: { sub: 'sub-alice', email: 'alice@example.com' },
          workspace_id: 'uabcdefghijklmnopqrstuvwxy',
          cache_poolable: cachePoolable,
          needs_pooling_choice: needsChoice,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url === '/api/pooling' && init?.method === 'POST') {
      return new Response(JSON.stringify({ cache_poolable: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

describe('sharing consent', () => {
  beforeEach(() => {
    // Each case seeds a different /auth/me answer; a cached probe from the previous one would
    // silently be the thing asserted against.
    queryClient.clear()
    window.history.pushState({}, '', '/')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('/settings resolves to the sharing control, so the signup promise is not stale', async () => {
    mockBff(false)
    window.history.pushState({}, '', '/settings')
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/Sharing answers with other companies/i)).toBeInTheDocument()
    })
    // And it offers both directions, not just an off switch.
    expect(screen.getByRole('button', { name: /^Share my answers$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Do not share my answers$/i })).toBeInTheDocument()
  })

  it('renders the RECORDED state, not a requested one', async () => {
    mockBff(true)
    window.history.pushState({}, '', '/settings')
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/Sharing is currently/i)).toBeInTheDocument()
    })
    // The stored value is rendered in a <strong> inside the sentence.
    expect(screen.getByText(/Sharing is currently/i).closest('p')?.textContent).toMatch(/currently on/i)
  })

  it('states both sides of the trade — the gain and the disclosure', async () => {
    mockBff(false)
    window.history.pushState({}, '', '/settings')
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/If sharing is on/i)).toBeInTheDocument()
    })
    // The gain: reuse earns, and buys instant answers back.
    expect(screen.getByText(/earn you LENS/i)).toBeInTheDocument()
    // The cost: content leaves the workspace.
    expect(screen.getByText(/leaves this workspace/i)).toBeInTheDocument()
    // The other side stated with equal weight, so neither reads as the recommendation.
    expect(screen.getByText(/If sharing is off/i)).toBeInTheDocument()
    expect(screen.getByText(/never served another company/i)).toBeInTheDocument()
  })

  // ⚠ THE DISCLOSURE IS THE ONLY THING BETWEEN A PERSON AND SHARING, now that a new workspace is
  // created with it ON. So these pin the properties that make an on-by-default defensible, not
  // just that a screen exists.
  it('BLOCKS the app — the product is not reachable around it', async () => {
    mockBff(true, true)
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/Your answers are being shared/i)).toBeInTheDocument()
    })
    // The app shell must NOT be behind it. If any nav landmark renders, the disclosure is an
    // overlay someone can navigate past rather than a gate.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('says the state plainly and first — on, and what that means', async () => {
    mockBff(true, true)
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/Sharing is on for this workspace right now/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/may be served\s+to other companies/i)).toBeInTheDocument()
  })

  it('declining is one click of equal prominence to continuing', async () => {
    mockBff(true, true)
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Do not share my answers$/i })).toBeInTheDocument()
    })
    const decline = screen.getByRole('button', { name: /^Do not share my answers$/i })
    const share = screen.getByRole('button', { name: /^Share my answers$/i })
    // Same element type and same classes ⇒ same visual weight. A decline rendered as a link, or
    // with a quieter variant, is not an equal choice.
    expect(decline.tagName).toBe(share.tagName)
    expect(decline.className).toBe(share.className)
  })
})

// ── The unpaid-contribution notice on the DISCLOSURE screen ──────────────────
//
// This screen is the primary home for it: it BLOCKS (AuthGate renders it instead of the app), so
// nobody generates a contribution before reading it, and it is already in the register of "here is
// what happens to what you make" rather than asking permission. The wording itself is pinned in
// areas/lens/unpaidNotice.test.ts; what is checked here is that it REACHES this surface.
describe('PoolingConsent — the unpaid-contribution notice', () => {
  it('shows the notice, from the shared source', async () => {
    renderConsent()
    expect(screen.getByText(new RegExp(escapeRe(UNPAID_NOTICE_HEADLINE)))).toBeTruthy()
    // A distinctive fragment of the body, so a truncated or reworded copy fails here too.
    expect(screen.getByText(/never credited/i)).toBeTruthy()
  })

  it('does not bury it below the sharing choice', () => {
    const { container } = renderConsent()
    const text = container.textContent ?? ''
    // The notice must appear before the decline/accept buttons in document order: a tester who
    // reads to the first control and clicks must already have passed it.
    const notice = text.indexOf(UNPAID_NOTICE_HEADLINE)
    const buttons = container.querySelectorAll('button')
    expect(notice).toBeGreaterThanOrEqual(0)
    expect(buttons.length).toBeGreaterThan(0)
    const firstButtonText = buttons[0].textContent ?? ''
    expect(text.indexOf(notice >= 0 ? UNPAID_NOTICE_HEADLINE : '')).toBeLessThan(
      text.indexOf(firstButtonText),
    )
  })
})

// SharingChoice inside PoolingConsent uses useQuery, so a provider is required.
function renderConsent() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PoolingConsent onDone={() => {}} />
    </QueryClientProvider>,
  )
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
