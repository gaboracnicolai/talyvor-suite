import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'

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

  it('shows the signup prompt before the app when the workspace was just created', async () => {
    mockBff(false, true)
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/One choice before you start/i)).toBeInTheDocument()
    })
    // Created declined: the screen must say so, since consent is never granted by inaction.
    expect(screen.getByText(/Nothing of yours has been shared/i)).toBeInTheDocument()
  })
})
