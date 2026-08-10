import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App, queryClient } from './App'

/**
 * THE CONSOLE COULD NOT BE READ ON A PHONE WITHOUT SCROLLING SIDEWAYS — ON EVERY SURFACE.
 *
 * ⚠ MEASURED IN REAL CHROME on the built artifact, signed in, ten console routes × four
 * viewports. `document.documentElement.scrollWidth - clientWidth`, deepest offenders reported:
 *
 *     320px   ALL TEN routes overflowed, by 24 to 61 px
 *     375px   2 of 10 (`/` and `/members`), by 5–6 px
 *     768px   none        1280px   none
 *
 * ⚠ AND THE NUMBER THAT NAMES THE CAUSE: `scrollWidth` was **380 at BOTH 320 and 375** — the same
 * value, so the layout had a hard floor of 380 CSS px and simply could not be narrower. The page
 * was not responding to the viewport at all below that width.
 *
 * The floor is the sticky header. Its actions block measured 274px wide starting at x=106, ending
 * at 380, and never shrank: a flex item defaults to `min-width: auto`, so it will not go below its
 * content's intrinsic width, and `operator@example.com` is one unbreakable token. The title, the
 * email, the Sign out button and the theme toggle simply added up.
 *
 * ⚠ WCAG 2.2 SC 1.4.10 REFLOW (AA) IS THE STANDARD THIS IS MEASURED AGAINST, and it is the one
 * this repo already holds itself to elsewhere — `contrast.test.ts` scores every text/plane pair
 * against the 4.5:1 AA body floor. Reflow names 320 CSS px and forbids scrolling in two
 * directions. So this is not a taste call about small screens; it is the same commitment, on a
 * property no test here could see.
 *
 * ⚠ THE FIX USES ONLY VOCABULARY THIS REPO ALREADY WRITES — `min-w-0` (Shell, App, Entry,
 * IssueList) and `truncate` (Row, NavItem). No new token, no new breakpoint, no arbitrary value,
 * and NO NUMBER CHOSEN BY ME: the title and the email may shrink and ellipsise, the two controls
 * may not. A `flex-wrap` on the header would also have made 320px fit TODAY — measured, the
 * actions block is 274px and the content box at 320px is 288px — but only because this fixture's
 * email is 20 characters. That is a fix shaped like the fixture, so it is not the one taken.
 *
 * ⚠ AFTER, same instrument, rebuilt artifact, 80 combinations — ten routes × four viewports ×
 * TWO email lengths, the second being 70 characters: ZERO overflow, and `scrollWidth` equal to the
 * viewport exactly at 320, 375, 768 and 1280. Instrument positive-controlled in that same
 * configuration by planting one element 40px too wide: 0 -> 40 -> 0.
 *
 * ⚠⚠ WHAT THIS FILE CAN AND CANNOT DO, SAID PLAINLY. jsdom HAS NO LAYOUT — every element is
 * 0×0 and `scrollWidth` is 0 — so no test in this repo can assert the measurement above. What it
 * asserts is that the four SHRINK ROLES are declared on the rendered DOM. That is the same
 * division `placeholderAudit` and `focusAudit` already make in this repo: the engine measurement
 * lives in the comment, the class that produces it is what CI holds. A reviewer who changes the
 * header's layout must re-run the Chrome measurement; this file will not do it for them.
 */

beforeEach(() => {
  queryClient.clear()
  window.history.pushState({}, '', '/')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/auth/me')) {
        return new Response(
          JSON.stringify({ mode: 'oidc', authenticated: true, user: { email: 'operator@example.com' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      throw new TypeError('Failed to fetch')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  queryClient.clear()
})

const header = () => document.querySelector('header')!

describe('the sticky header may narrow to the viewport', () => {
  it('lets the page title shrink and ellipsise rather than push', async () => {
    render(<App />)
    await waitFor(() => expect(document.body.textContent ?? '').toContain('Overview'))
    const title = [...header().children].find((el) => el.textContent?.trim() === 'Overview')
    const cls = title?.getAttribute('class') ?? ''
    expect(cls, 'the page title is a flex item with min-width:auto — it cannot go below its own text').toContain(
      'min-w-0',
    )
    expect(cls, 'and without truncate it keeps its full intrinsic width even when allowed to shrink').toContain(
      'truncate',
    )
  })

  it('lets the actions block shrink', async () => {
    render(<App />)
    await waitFor(() => expect(document.body.textContent ?? '').toContain('Overview'))
    const actions = [...header().children].find((el) => el.querySelector('button'))
    expect(
      actions?.getAttribute('class') ?? '',
      'the actions block measured 274px and never shrank — this is the flex item that set the ' +
        '380px floor the whole console could not go below',
    ).toContain('min-w-0')
  })

  it('lets the signed-in email ellipsise, and keeps it readable in full on hover', async () => {
    render(<App />)
    const email = await screen.findByText('operator@example.com')
    expect(
      email.getAttribute('class') ?? '',
      'the email is one unbreakable token — without truncate it is the intrinsic width nothing ' +
        'else can shrink past',
    ).toContain('truncate')
    expect(
      email.getAttribute('title'),
      'a truncated address that cannot be read in full anywhere is information removed, not laid out',
    ).toBe('operator@example.com')
  })

  it('does NOT let the sign-out control shrink — only the text may', async () => {
    render(<App />)
    const button = await screen.findByRole('button', { name: /sign out/i })
    expect(
      button.getAttribute('class') ?? '',
      'a squeezed hit target is a worse answer than an ellipsised address; the shrink belongs to ' +
        'the text, and this is the half that says which',
    ).toContain('shrink-0')
  })
})
