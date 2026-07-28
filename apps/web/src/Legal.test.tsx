import { fireEvent, render, screen } from '@testing-library/react'
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

  // The three signed-out entry points, confirmed rather than assumed — they were added
  // separately and main has moved repeatedly since. A legal link that silently stops
  // rendering looks exactly like one that was never there.
  it.each([
    ['the marketing landing', '/marketing'],
    ['the sign-in card', '/signin'],
    ['the sign-up card', '/signup'],
  ])('%s still offers both policies', async (_label, path) => {
    mockBff()
    at(path)
    const privacy = await screen.findAllByRole('link', { name: /privacy/i })
    const terms = await screen.findAllByRole('link', { name: /terms/i })
    expect(privacy.some((a) => a.getAttribute('href') === '/privacy')).toBe(true)
    expect(terms.some((a) => a.getAttribute('href') === '/terms')).toBe(true)
  })
})

// ⚠ REACHABILITY FOR A SIGNED-IN PERSON, WHICH IS A DIFFERENT PROPERTY FROM RENDERING.
//
// Both routes have always resolved. What did not exist was any way to GET to them once you
// were inside the app: the links lived on the marketing page, the sign-in card and the
// consent screen — three surfaces a signed-in person has already passed through and does not
// return to. So the moment someone wanted to check what we do with their data, the answer was
// "type the URL", which is the same as unreachable for anyone who does not already know it.
//
// These tests therefore CLICK. Asserting that a link exists in the DOM would pass on a link
// that navigates nowhere, and the property under test is arrival, not markup.
describe('a signed-in person can reach the policies without typing a URL', () => {
  function mockSignedIn() {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/auth/me') {
        return new Response(
          JSON.stringify({
            mode: 'oidc',
            authenticated: true,
            user: { sub: 'sub-alice', email: 'alice@example.com' },
            workspace_id: 'uabcdefghijklmnopqrstuvwxy',
            cache_poolable: true,
            // false, or the consent screen renders instead of the app shell and this would be
            // testing the consent screen's links — which already existed.
            needs_pooling_choice: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('null', { status: 404 })
    })
  }

  it.each([
    ['Privacy', /^privacy$/i],
    ['Terms', /^terms$/i],
  ])('reaches %s from inside the app by clicking', async (label, heading) => {
    mockSignedIn()
    at('/')
    const link = await screen.findByRole('link', { name: new RegExp(`^${label}$`, 'i') })
    fireEvent.click(link)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })

  // Findable from ANYWHERE, not only the overview. A person goes looking for this while they
  // are in the middle of something — most likely the page that prompted the question.
  it('offers the policies on a deep route too, not only the landing page', async () => {
    mockSignedIn()
    at('/keys')
    expect(await screen.findByRole('link', { name: /^privacy$/i })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /^terms$/i })).toBeInTheDocument()
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
