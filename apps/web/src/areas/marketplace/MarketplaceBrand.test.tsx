import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { populatedBff, settleQueries } from '../../populatedBff'

// B29.11 — the marketplace in the brand, read off the populated fixture: listings are raised cards with
// their kind's icon, their seller and their price in IBM Plex Mono; the publish form picks a kind by its
// icon and shows the card it will make, with Publish its one teal action; a seller's earnings are tiles.

const SELLING = {
  '/api/marketplace/mine': {
    listings: [
      { id: 'lst_mine', workspace_id: 'ws-fixture', kind: 'skill', title: 'Summarise a thread', description: 'Three lines.', price_per_use_ulxc: 250_000, visibility: 'public', latest_version: 1, created_at: '2026-09-27T09:00:00Z', updated_at: '2026-09-27T09:00:00Z' },
    ],
  },
  '/api/marketplace/earnings': {
    pending_uses: 2,
    pending_usd_micros: 50_000,
    payable_usd_micros: 1_200_000,
    in_holdback_usd_micros: 300_000,
    available_usd_micros: 900_000,
    lifetime_gross_usd_micros: 1_250_000,
    earnings: null,
  },
}

async function at(address: string, overrides: Record<string, unknown> = {}): Promise<HTMLElement> {
  populatedBff((impl) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
  }, overrides)
  window.history.pushState({}, '', address)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
  await settleQueries(queryClient, waitFor)
  return document.querySelector('main') as HTMLElement
}

const primaries = (main: HTMLElement) => Array.from(main.querySelectorAll('button.bg-accent, a.bg-accent')).map((b) => b.textContent?.trim())

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  queryClient.clear()
  document.body.replaceChildren()
})

describe('the marketplace in the brand', () => {
  it('shows each listing as a raised card with its kind icon, its seller and its price on the figure face', async () => {
    const main = await at('/marketplace')
    const cards = within(main).getAllByTestId('listing-card')
    expect(cards).toHaveLength(2)
    const [translate, review] = cards
    for (const c of cards) expect(c.className).toContain('bg-raised')
    expect(translate.querySelector('svg[data-icon]')?.getAttribute('data-icon')).toBe('prompt')
    expect(review.querySelector('svg[data-icon]')?.getAttribute('data-icon')).toBe('agent')
    expect(within(translate).getByText('ws-seller').className).toContain('font-figure')
    const price = within(translate).getByTestId('listing-price')
    expect(price.textContent).toBe('0.5 LXC')
    expect(price.className).toContain('font-figure')
    expect(within(review).getByTestId('listing-price').textContent).toBe('Free')
    expect(within(translate).getByRole('link', { name: 'Translate to French' }).getAttribute('href')).toBe('/marketplace/listings/lst_translate')
    expect(primaries(main), 'a kind filter is a toggle on the tint, not the teal fill').toEqual([])
  })

  it('picks a kind by its icon and previews the card the listing will make, with Publish the one teal action', async () => {
    const main = await at('/marketplace/publish')
    const preview = within(main).getByTestId('listing-preview')
    expect(preview.querySelector('svg[data-icon]')?.getAttribute('data-icon')).toBe('prompt')
    fireEvent.click(within(main).getByRole('button', { name: 'Evaluation' }))
    expect(within(main).getByRole('button', { name: 'Evaluation' }).getAttribute('aria-pressed')).toBe('true')
    expect(preview.querySelector('svg[data-icon]')?.getAttribute('data-icon')).toBe('prove')
    expect(within(main).getByLabelText(/^Cases/)).toBeTruthy()
    fireEvent.change(within(main).getByLabelText('Title'), { target: { value: 'Arithmetic check' } })
    fireEvent.change(within(main).getByLabelText(/Price per use/), { target: { value: '1.25' } })
    expect(within(preview).getByText('Arithmetic check')).toBeTruthy()
    expect(within(preview).getByText('You')).toBeTruthy()
    expect(within(preview).getByTestId('listing-price').textContent).toBe('1.25 LXC')
    expect(main.querySelector('form')?.closest('.rounded-card')?.className).toContain('bg-raised')
    expect(primaries(main)).toEqual(['Publish'])
  })

  it("shows a seller's earnings as figure tiles and their own listings as cards sold by them", async () => {
    const main = await at('/marketplace/selling', SELLING)
    const tiles = within(main).getByTestId('market-earnings')
    expect(tiles.closest('.rounded-card')?.className).toContain('bg-raised')
    expect(screen.getByTestId('market-pending').textContent).toBe('$0.05')
    for (const [label, figure] of [
      ['Earned', '$1.20'],
      ['In the holdback', '$0.30'],
      ['Available', '$0.90'],
      ['Lifetime sales', '$1.25'],
    ]) {
      const tile = within(tiles).getByText(label).parentElement as HTMLElement
      expect(within(tile).getByText(figure).closest('.font-figure'), `${label} is not on the figure face`).not.toBeNull()
    }
    const mine = within(main).getByTestId('listing-card')
    expect(mine.querySelector('svg[data-icon]')?.getAttribute('data-icon')).toBe('layers')
    expect(within(mine).getByText('You')).toBeTruthy()
    expect(within(mine).getByTestId('listing-price').textContent).toBe('0.25 LXC')
  })
})
