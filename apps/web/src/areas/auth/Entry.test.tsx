import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// Entry.test.tsx — THE TWO FRONT DOORS.
//
// Sign up and sign in are ONE mechanism (the same OIDC round-trip at /auth/login) and must not
// be one page. The person reading them wants opposite reassurances:
//
//   A STRANGER needs to know what this is, that they can start, and what they will have when
//   they finish. They have never heard of us; "You'll be sent to your organisation's identity
//   provider" tells them they need a company account, which is the single most effective way to
//   turn away someone who could have signed up in twenty seconds.
//
//   A RETURNING PERSON needs the shortest path back in. Explaining the product to them is
//   noise, and "create your workspace" is actively wrong — they have one.
//
// So: two pages, two sets of words, one destination. These tests assert the WORDS, because the
// words are the entire feature — the mechanism underneath was already built and already works.
//
// And they assert them against what the server says about the door (signup_open), never against
// a literal in the bundle. A page that hardcodes "closed trial, accounts set up by hand" keeps
// saying it after the trial opens, and a page that hardcodes "get started free" says it while
// the gate is still six addresses. Both are one deploy away at all times.
//
// ⚠ APOSTROPHES. The copy on these pages uses typographic ’ and a straight ' in a regex does
// NOT match it. The enterprise-SSO assertion below was written with `organisation'?s` and was
// VACUOUS: pasting the exact banned sentence back onto the page left the suite green. It was
// caught only by deliberately re-introducing the sentence and watching for a failure that never
// came. Every apostrophe in an assertion here is therefore a character class, and any new one
// must be positive-controlled the same way before it is believed.

type MeOverrides = {
  signup_open?: boolean
  authenticated?: boolean
  /** Simulate an unreachable/failed probe: the page must claim NOTHING either way. */
  fail?: boolean
}

function mockMe(o: MeOverrides = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      if (o.fail) throw new Error('probe unreachable')
      return new Response(
        JSON.stringify({
          mode: 'oidc',
          authenticated: o.authenticated ?? false,
          user: o.authenticated ? { sub: 's', email: 'someone@example.com' } : null,
          ...(o.signup_open === undefined ? {} : { signup_open: o.signup_open }),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
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
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

// ─── the routes exist, and are PUBLIC ───────────────────────────────────────

describe('/signup and /signin are public routes', () => {
  it('/signup renders for someone with no session — it is not behind the gate', async () => {
    mockMe({ signup_open: true })
    at('/signup')
    // The gate's card would be the failure: a signup page you must already be signed in to
    // read is not a signup page.
    expect(
      await screen.findByRole('heading', { name: /create your (talyvor )?workspace/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/this workspace requires authentication/i)).toBeNull()
  })

  it('/signin renders for someone with no session', async () => {
    mockMe({ signup_open: true })
    at('/signin')
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
  })

  it('they are DIFFERENT pages, not one page behind two paths', async () => {
    mockMe({ signup_open: true })
    at('/signup')
    const signupHeading = (await screen.findByRole('heading', { level: 1 })).textContent
    cleanup()
    queryClient.clear()
    mockMe({ signup_open: true })
    at('/signin')
    const signinHeading = (await screen.findByRole('heading', { level: 1 })).textContent
    expect(signupHeading).not.toEqual(signinHeading)
  })

  it('both end at the SAME mechanism — /auth/login', async () => {
    // Each page's PRIMARY action, by its own exact label. (The pages also cross-link to each
    // other, which is why a loose /sign in/i matches two elements on the signup page.)
    for (const [path, label] of [
      ['/signup', /^continue$/i],
      ['/signin', /^sign in$/i],
    ] as const) {
      mockMe({ signup_open: true })
      at(path)
      const action = await screen.findByRole('link', { name: label })
      expect(action.getAttribute('href')).toMatch(/^\/auth\/login/)
      cleanup()
      queryClient.clear()
      vi.restoreAllMocks()
    }
  })
})

// ─── the words a stranger reads ─────────────────────────────────────────────

describe('the signup page is written for someone who has never heard of us', () => {
  it('says what Talyvor is, what happens next, and what they get', async () => {
    mockMe({ signup_open: true })
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    const text = document.body.textContent ?? ''

    // 1. what it is — in one line, on the page, before they commit to anything.
    expect(text).toMatch(/inference gateway|AI development suite/i)
    // 2. what happens when they continue — no surprise redirect.
    expect(text).toMatch(/you[’']ll be (sent|taken)/i)
    // 3. what they get — the thing on the other side.
    expect(text).toMatch(/your own workspace/i)
  })

  it('does NOT use enterprise-SSO language', async () => {
    mockMe({ signup_open: true })
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    const text = document.body.textContent ?? ''
    // The exact sentence the old card used. A stranger from the internet reads
    // "your organisation's identity provider" as "you need a company account".
    // Both apostrophe forms, both spellings — see the apostrophe warning at the top.
    expect(text).not.toMatch(/organi[sz]ation[’']?s identity provider/i)
    expect(text).not.toMatch(/\bSSO\b/)
  })

  it('promises no new password, because there is none', async () => {
    mockMe({ signup_open: true })
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    expect(document.body.textContent ?? '').toMatch(/no (new )?password/i)
  })
})

// ─── the promise is DERIVED, never hardcoded ────────────────────────────────

describe('what the page promises tracks the actual gate', () => {
  it('OPEN: says a stranger can start, with no invitation', async () => {
    mockMe({ signup_open: true })
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/no invitation|anyone can|open to anyone/i)
    expect(text).not.toMatch(/closed trial|invitation only|invite only|by hand/i)
  })

  it('CLOSED: does not write a cheque the gate will bounce', async () => {
    mockMe({ signup_open: false })
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    const text = document.body.textContent ?? ''
    // The refusal happens at OUR denied page and is explained there — but sending someone
    // into a refusal you could have predicted is still a page lying to a reader.
    expect(text).toMatch(/closed trial|invitation|invite/i)
    expect(text).not.toMatch(/no invitation needed|anyone can start/i)
  })

  it('UNKNOWN (probe failed): claims NOTHING either way, and still offers the action', async () => {
    mockMe({ fail: true })
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    const text = document.body.textContent ?? ''
    // Absence of knowledge must render as absence of claim. Guessing "closed" turns away a
    // stranger who could have signed up; guessing "open" walks them into a refusal. Neither
    // sentence is available, so neither is printed.
    expect(text).not.toMatch(/no invitation needed|anyone can start/i)
    expect(text).not.toMatch(/closed trial|invitation only/i)
    expect(screen.getByRole('link', { name: /^continue$/i })).toBeInTheDocument()
  })

  it('an OLDER BFF that does not report signup_open is treated as unknown, not as open', async () => {
    // signup_open omitted entirely. Silence must not manufacture a promise — the same rule
    // docs_shared follows.
    mockMe({})
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    expect(document.body.textContent ?? '').not.toMatch(/no invitation needed|anyone can start/i)
  })
})

// ─── someone already signed in ──────────────────────────────────────────────

describe('an already-signed-in person is not asked to sign up again', () => {
  it('/signup tells them they are in, and points at the app', async () => {
    mockMe({ signup_open: true, authenticated: true })
    at('/signup')
    await waitFor(() =>
      expect(screen.getByText(/already signed in|you[’']re signed in/i)).toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: /open (the )?(app|talyvor)/i })).toHaveAttribute(
      'href',
      '/',
    )
  })
})

// ─── the returning person's page ────────────────────────────────────────────

describe('the sign-in page is written for someone who already has a workspace', () => {
  it('does not tell a returning person to create a workspace', async () => {
    mockMe({ signup_open: true })
    at('/signin')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('heading', { name: /create your/i })).toBeNull()
  })

  it('offers the stranger a way across, so a wrong landing is not a dead end', async () => {
    mockMe({ signup_open: true })
    at('/signin')
    const cross = await screen.findByRole('link', {
      name: /new (here|to talyvor)|create a workspace|sign up/i,
    })
    expect(cross.getAttribute('href')).toBe('/signup')
  })
})
