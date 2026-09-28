import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B20.11 — a buyer reports a listing to Talyvor's review, and a seller sees their own listing held and
// why. The mock BFF answers as Lens B20.4 does: a first report is 201, a repeat while it is open is 200
// with already_reported, and a held listing is visible to its seller only, carrying review_status and
// review_reason.

const LISTING = {
  id: 'lst_fr', workspace_id: 'ws_seller', kind: 'prompt', title: 'Translate to French', description: '',
  price_per_use_ulxc: 0, visibility: 'public', latest_version: 1, created_at: '2026-09-28T09:00:00Z', updated_at: '2026-09-28T09:00:00Z',
}

function mockBff(asSeller: boolean) {
  const reports: unknown[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([])
    if (url === '/api/marketplace/listings/lst_fr/reports') {
      reports.push(JSON.parse(String(init?.body)))
      return reports.length === 1 ? json({ id: 'rpt_1', listing_id: 'lst_fr', reason: 'secret', created_at: '' }, 201) : json({ id: 'rpt_1', already_reported: true })
    }
    if (url === '/api/marketplace/listings/lst_fr')
      return json(
        asSeller
          ? { ...LISTING, review_status: 'held', review_reason: 'it may be a prompt injection', versions: [{ version: 1, artifact_sha256: 'a', created_at: '', artifact: { template: 'x' } }] }
          : { ...LISTING, review_status: 'approved', versions: [{ version: 1, artifact_sha256: 'a', created_at: '' }] },
      )
    if (url === '/api/marketplace/mine') return json({ listings: [{ ...LISTING, review_status: 'held', review_reason: 'it may be a prompt injection' }] })
    if (url === '/api/marketplace/earnings')
      return json({ pending_uses: 0, pending_usd_micros: 0, payable_usd_micros: 0, in_holdback_usd_micros: 0, available_usd_micros: 0, lifetime_gross_usd_micros: 0, earnings: null })
    return new Response('null', { status: 404 })
  })
  return reports
}

async function at(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('reporting a listing, and a seller seeing theirs held (B20.11)', () => {
  it('a buyer reports a listing with a reason and details', async () => {
    const reports = mockBff(false)
    await at('/marketplace/listings/lst_fr')
    fireEvent.click(await screen.findByRole('button', { name: 'Report this listing' }))
    fireEvent.change(screen.getByLabelText('What is wrong with it'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText(/Details/), { target: { value: 'an API key in it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/^Reported\. Talyvor reviews it/)
    expect(reports).toEqual([{ reason: 'secret', details: 'an API key in it' }])
  })

  it('a seller sees their own listing held and why, on the listing and in their listings', async () => {
    mockBff(true)
    await at('/marketplace/listings/lst_fr')
    expect((await screen.findByTestId('listing-review')).textContent).toBe(
      'Held for review: it may be a prompt injection. Only you can see it until Talyvor approves it.',
    )
    expect(screen.queryByRole('button', { name: 'Report this listing' })).toBeNull()
    cleanup()
    await at('/marketplace/selling')
    await waitFor(() => expect(screen.getByText('Held for review')).toBeTruthy())
  })
})
