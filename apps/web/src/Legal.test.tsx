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

describe('a signed-in person can reach the policies without typing a URL', () => {
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

// ⚠ THE WAY OUT, ASSERTED AS A ROUND TRIP — arrival, never the presence of an anchor.
//
// A test that finds a link and stops passes on a link that goes nowhere, and "there is a link"
// was never the complaint. The complaint was that the page is a DEAD END for a reader who
// arrived by typing the URL, following a link, or opening a new tab — someone with no history
// to go back through. So every case below starts COLD on the document, clicks the way out, and
// asserts what rendered next.
//
// ⚠ AND THE DESTINATION DEPENDS ON WHO IS READING, which is the whole difficulty: the policies
// are reachable signed-out (marketing, sign-in, sign-up, consent) and signed-in (the sidebar).
// Sending a stranger into the app puts them at a sign-in card they did not ask for; sending a
// signed-in person to the marketing page ejects them from their own session. Both are asserted,
// including the wrong-destination negatives — a fix that always went one way would pass a
// one-sided test.
describe('the policies are not a dead end', () => {
  function returnLink() {
    return screen.findByRole('link', { name: /back to talyvor/i })
  }

  it.each([
    ['/privacy', /^privacy$/i],
    ['/terms', /^terms$/i],
  ])('%s: a SIGNED-OUT reader who arrived cold gets back to marketing', async (path, heading) => {
    mockBff()
    at(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()

    fireEvent.click(await returnLink())

    // Arrived at the marketing page — not merely "left the document".
    expect(await screen.findByRole('link', { name: /see the suite/i })).toBeInTheDocument()
    // And NOT dropped at a sign-in card, which is where /  would have put a stranger.
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it.each([
    ['/privacy', /^privacy$/i],
    ['/terms', /^terms$/i],
  ])('%s: a SIGNED-IN reader who arrived cold gets back into the app', async (path, heading) => {
    mockSignedIn()
    at(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()

    fireEvent.click(await returnLink())

    // Arrived inside the shell — the sidebar is the thing only the app has.
    expect(await screen.findByRole('navigation', { name: /sections/i })).toBeInTheDocument()
    // And NOT ejected onto the marketing page mid-session.
    expect(screen.queryByRole('link', { name: /see the suite/i })).not.toBeInTheDocument()
  })

  // The full trip a signed-in person actually takes: deep in the app, out to the policy, back.
  // "Back where you started" is the app, with its navigation — not the one route they left.
  it('completes the round trip from a deep route and back into the app', async () => {
    mockSignedIn()
    at('/keys')

    fireEvent.click(await screen.findByRole('link', { name: /^privacy$/i }))
    expect(await screen.findByRole('heading', { name: /^privacy$/i })).toBeInTheDocument()

    fireEvent.click(await returnLink())
    expect(await screen.findByRole('navigation', { name: /sections/i })).toBeInTheDocument()
  })

  // The probe has not answered yet, or failed. The document must STILL offer a way out — a
  // reader whose network hiccuped is the one least able to guess a URL. `/` is the address that
  // resolves itself by auth state, so it is never a dead end in either direction.
  it('still offers a way out while /auth/me has not answered', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}) as unknown as Promise<Response>,
    )
    at('/privacy')
    expect(await screen.findByRole('heading', { name: /^privacy$/i })).toBeInTheDocument()
    expect(await returnLink()).toHaveAttribute('href', '/')
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
