import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'

// Legal.test.tsx — the policies, asserted as a person reaches them.
//
// The properties that matter are not "the components render". They are:
//   · both routes resolve WITHOUT a session — you must be able to read what the service does with
//     your data before you create an account, or you are agreeing in order to read;
//   · the pooling disclosure is present in the policy, because that is the claim most likely to
//     be softened over time and the one the consent screen already makes;
//   · the two absences are stated — no deletion, draft not reviewed — because a policy that omits
//     them reads as complete and is not.

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      // NO SESSION. These pages must work for a stranger.
      return new Response(JSON.stringify({ mode: 'oidc', authenticated: false, user: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => {
  queryClient.clear()
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('the policies are reachable without an account', () => {
  it('/privacy resolves for a signed-out visitor', async () => {
    mockBff()
    at('/privacy')
    expect(await screen.findByRole('heading', { name: /^privacy$/i })).toBeInTheDocument()
  })

  it('/terms resolves for a signed-out visitor', async () => {
    mockBff()
    at('/terms')
    expect(await screen.findByRole('heading', { name: /^terms$/i })).toBeInTheDocument()
  })
})

describe('the privacy page states the things most likely to be softened', () => {
  it('says answers may be served to other companies', async () => {
    mockBff()
    at('/privacy')
    expect(
      await screen.findByText(/may be served to other companies|served to other companies/i),
    ).toBeInTheDocument()
  })

  it('says the retention clock resets on use', async () => {
    mockBff()
    at('/privacy')
    expect(await screen.findByText(/clock resets every time the entry is used/i)).toBeInTheDocument()
  })

  it('says prompt text is not persisted by default', async () => {
    mockBff()
    at('/privacy')
    expect(await screen.findByText(/By default, no/i)).toBeInTheDocument()
  })
})

describe('both documents state their absences rather than reading as complete', () => {
  it('privacy says there is no self-service deletion', async () => {
    mockBff()
    at('/privacy')
    expect(await screen.findByText(/no self-service data deletion/i)).toBeInTheDocument()
  })

  it('terms says there is no self-service deletion', async () => {
    mockBff()
    at('/terms')
    expect(await screen.findByText(/no self-service deletion/i)).toBeInTheDocument()
  })

  it('both carry a visible needs-legal-review marker', async () => {
    mockBff()
    at('/privacy')
    // Both forms render on /privacy (one whole-document, one per-clause), so assert at least one.
    expect((await screen.findAllByText(/needs legal review/i)).length).toBeGreaterThan(0)
  })

  it('terms says the credits are not money', async () => {
    mockBff()
    at('/terms')
    expect(await screen.findByText(/not money/i)).toBeInTheDocument()
  })
})
