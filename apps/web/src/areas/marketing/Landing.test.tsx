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

  it('wires every contact CTA to the one flagged address constant', () => {
    render(<Landing />)
    // ⚠ hello@ does not route yet (see the constant's comment in Landing.tsx —
    // the alias must exist before this page ships anywhere public). This test is
    // the "one place to check": every mailto on the page must be the constant,
    // so changing the address is one edit and one assertion.
    const mailtos = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('mailto:'))
    expect(mailtos.length).toBeGreaterThan(0)
    for (const a of mailtos) {
      expect(a).toHaveAttribute('href', `mailto:${CONTACT_EMAIL}`)
    }
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
