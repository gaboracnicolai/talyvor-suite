import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function mockBff(cachePoolable: boolean, needsChoice = false, writes: unknown[] = []) {
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
    if (url === '/api/agents') {
      // A workspace this login just created: no agents, so Home opens its onboarding.
      return new Response(
        JSON.stringify({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url === '/api/pooling' && init?.method === 'POST') {
      writes.push(JSON.parse(String(init.body)))
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
      expect(screen.getByText(/Shared answers \(saves on repeated questions\)/i)).toBeInTheDocument()
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
    // The gain: repeated questions cost less — and, last, a small royalty (B28.10: savings first).
    const saving = screen.getByText(/Repeated questions are served instantly/i)
    const royalty = screen.getByText(/you earn a small royalty/i)
    expect(saving.compareDocumentPosition(royalty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(royalty.querySelector('a')).toHaveAttribute('href', '/statements/royalties')
    // The cost: content leaves the workspace.
    expect(screen.getByText(/leaves this workspace/i)).toBeInTheDocument()
    // The other side stated with equal weight, so neither reads as the recommendation.
    expect(screen.getByText(/If sharing is off/i)).toBeInTheDocument()
    expect(screen.getByText(/never served another company/i)).toBeInTheDocument()
  })

  // B28.8 — the full-screen disclosure is gone. A new workspace opens the app, and sharing is one line
  // on Home's onboarding: the box is what Lens recorded, and one click changes it.
  it('a new workspace is never blocked: the app renders, with sharing one line to untick', async () => {
    const writes: unknown[] = []
    mockBff(true, true, writes)
    render(<App />)
    const box = await screen.findByRole('checkbox', { name: /Share answers with other companies/i })
    expect(screen.getByRole('navigation', { name: /sections/i })).toBeInTheDocument()
    expect(screen.queryByText(/Share your answers, and earn from them/i)).not.toBeInTheDocument()
    expect(box).toBeChecked()
    expect(box.closest('label')).toHaveTextContent(/On now; untick to stop/)

    fireEvent.click(box)
    await waitFor(() => expect(writes).toEqual([{ cache_poolable: false }]))
  })
})
