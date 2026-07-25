import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTACT_EMAIL, Landing } from './Landing'

// Area-owned test — replaces the deleted shared areas/scaffold.test.tsx (the
// deadlock: a shared test over per-area screens; see #7). The marketing tab
// owns this file with its screen. Kept from the scaffold contract: the landing
// renders with NO providers — no auth gate, no query client, no router —
// because it is a public page. Added on top: the page's honesty invariants
// (no unmeasured numbers) and the flagged contact wiring.

afterEach(cleanup)

describe('Landing', () => {
  it('renders standalone — no router, no providers — with exactly one Talyvor heading', () => {
    render(<Landing />)
    // One heading names the product; keeping it unique keeps every
    // getByRole('heading', { name: /talyvor/i }) consumer unambiguous.
    const headings = screen.getAllByRole('heading')
    expect(headings.filter((h) => /talyvor/i.test(h.textContent ?? ''))).toHaveLength(1)
  })

  it('keeps the single "Open the app" link pointing at the console', () => {
    render(<Landing />)
    expect(screen.getByRole('link', { name: /open the app/i })).toHaveAttribute('href', '/')
  })

  // THE DEAD-CTA GUARD. The page used to hardcode hello@talyvor.com as its only call to
  // action while a comment beside it said the alias did not route. A comment cannot fail a
  // build, so it shipped. Now the address is configuration, and the page renders its absence.
  it('draws NO mailto when no contact address is configured', () => {
    expect(CONTACT_EMAIL).toBe('') // the default in this build — no alias yet
    render(<Landing />)
    const mailtos = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('mailto:'))
    // A dead contact link is worse than none: better to offer no inbox than one that
    // silently drops a buyer's first message.
    expect(mailtos).toHaveLength(0)
    // and the page still has an action to take
    expect(screen.getByRole('link', { name: /see the suite/i })).toBeInTheDocument()
  })

  it('says plainly that there is no inbox yet, rather than implying one', () => {
    render(<Landing />)
    expect(screen.getByText(/no inbox to write to yet/)).toBeInTheDocument()
  })

  it('makes no quantitative marketing claims — no percentage anywhere on the page', () => {
    const { container } = render(<Landing />)
    // The brief's hard rule: no metrics we have not measured. There is no
    // cache-hit rate on this page because none has been measured yet; if a %
    // ever appears here, it must arrive together with the measurement — and
    // with this assertion consciously updated in the same change.
    expect(container.textContent).not.toMatch(/%/)
  })
})
