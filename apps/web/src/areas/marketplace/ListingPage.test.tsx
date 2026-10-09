import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B32.57 — listing page 2, walked the way its DONE line reads: a listing is rented from its page and then used, and the
// use adds no line to the bill; a trial use is labelled test money; the originals and the trust figures are shown. The
// mock BFF answers as Lens does: an offer read prices it in the buyer's currency (B32.51), a licence covers the
// workspace's uses (B32.19), a per-use offer's first uses are trials (B32.21), and the trust read is B32.49's.

const VERSIONS = [
  { version: 1, artifact_sha256: 'a1', created_at: '2026-09-01T09:00:00Z', needs: { input: true, variables: null, model: 'gpt-4o' } },
  { version: 2, artifact_sha256: 'a2', created_at: '2026-10-01T09:00:00Z', needs: { input: true, variables: null, model: 'gpt-4o' } },
]

// A $20.00 rent at 1 EUR = 1.10 USD = 0.85 GBP, as Lens's B32.51 test reads it: £18.55 incl. VAT for a GB consumer, €21.82 asked for in euros.
const DISPLAY: Record<string, Record<string, unknown>> = {
  '': { currency: 'GBP', amount_minor: 1855, includes_tax: true, tax_label: 'incl. VAT', rate: '0.7727', source: 'ecb' },
  EUR: { currency: 'EUR', amount_minor: 2182, includes_tax: true, tax_label: 'incl. VAT', rate: '0.9091', source: 'ecb' },
}

function listing(id: string, currency: string): Record<string, unknown> {
  const base = {
    workspace_id: 'ws_seller',
    kind: 'agent',
    description: '',
    visibility: 'public',
    latest_version: 2,
    created_at: '2026-09-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    review_status: 'approved',
    versions: VERSIONS,
    price_note: 'Charged in US dollars on your monthly marketplace bill.',
  }
  if (id === 'lst_rent')
    return {
      ...base,
      id,
      title: 'Contract checker',
      price_per_use_ulxc: 0,
      remix_policy: 'royalty',
      remix_share_bps: 1500,
      offers: [
        {
          id: 'ofr_rent',
          kind: 'rent',
          licence: 'commercial',
          price_usd_micros: 20_000_000,
          period_days: 30,
          included_uses: 0,
          terms: 'The buying workspace’s people and agents, inside its own products.',
          display: DISPLAY[currency],
        },
      ],
    }
  return {
    ...base,
    id,
    // B28.426 — a skill, which can be used in Chat.
    ...(id === 'lst_skill' ? { kind: 'skill' } : {}),
    title: 'Daily brief',
    price_per_use_ulxc: 5_000_000,
    remix_policy: 'none',
    remix_share_bps: 0,
    offers: [
      {
        id: 'ofr_use',
        kind: 'per_use',
        licence: 'commercial',
        price_usd_micros: 500_000,
        trial_uses: 3,
        terms: 'The buying workspace’s people and agents, inside its own products.',
        display: { currency: 'USD', amount_minor: 50, includes_tax: false, rate: '1', source: 'none' },
      },
    ],
  }
}

const TRUST = {
  listing_id: 'lst_rent',
  version: 2,
  publisher: { workspace_id: 'ws_seller', verified: true, payouts_enabled: true, upheld_claims_12_months: 0 },
  reviews: {
    count: 2,
    average: 4.5,
    stars: [0, 0, 0, 1, 1],
    recent: [{ id: 'mrv_1', rating: 5, text: 'Caught a missing indemnity.', reply: 'Thank you!', created_at: '2026-10-02T09:00:00Z' }],
  },
  eval: { version: 2, passed: 8, cases: 10, ran_at: '2026-10-03T09:00:00Z' },
  claims: { open: 1, upheld: 0, attributed: 0, rejected: 0 },
  originals: [
    { listing_id: 'lst_clause', version: 3, title: 'Clause finder', child_listing_id: 'lst_rent', child_version: 2, share_bps: 1000, source: 'remix', depth: 1 },
    { listing_id: 'lst_hidden', version: 1, hidden: true, child_listing_id: 'lst_clause', child_version: 3, share_bps: 500, source: 'remix', depth: 2 },
  ],
  remixes: 4,
}

function mockBff() {
  const bill: Array<{ use_id: string; listing_id: string; title: string; price_ulxc: number; used_at: string }> = []
  const licences: Array<Record<string, unknown>> = []
  const trials: Record<string, number> = { lst_trial: 3 }
  const sent: Array<{ url: string; key: string | null; body: string }> = []
  // B28.162 — the seller's own prompt: Lens shows its owner each version's artifact.
  const own: Array<Record<string, unknown>> = [
    { version: 1, artifact_sha256: 'o1', changelog: 'First version', created_at: '2026-09-01T09:00:00Z', artifact: { template: 'Summarise {{text}}' } },
  ]
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method !== 'GET') sent.push({ url, key: new Headers(init?.headers).get('Idempotency-Key'), body: String(init?.body ?? '') })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10 }])
    if (url === '/api/marketplace/licences') return json({ licences })
    const trust = /^\/api\/marketplace\/listings\/([^/?]+)\/trust$/.exec(url)
    if (trust) return json({ ...TRUST, listing_id: trust[1] })
    const lic = /^\/api\/marketplace\/listings\/([^/?]+)\/licences$/.exec(url)
    if (lic && method === 'POST') {
      // Lens B32.19: one billed rent row on the marketplace bill, and the licence.
      const l = {
        id: 'lic_1',
        listing_id: lic[1],
        title: 'Contract checker',
        offer_id: 'ofr_rent',
        licence: 'commercial',
        terms: '',
        kind: 'rent',
        pinned_version: null,
        starts_at: '2026-10-08T00:00:00Z',
        ends_at: '2026-11-07T00:00:00Z',
        auto_renew: false,
        status: 'active',
        included_uses: 0,
        uses_covered: 0,
        rent_paid_usd_micros: 0,
        source: 'offer',
        created_at: '2026-10-08T00:00:00Z',
        price_ulxc: 200_000_000,
      }
      licences.push(l)
      bill.push({ use_id: 'use_rent', listing_id: lic[1], title: 'Contract checker', price_ulxc: 200_000_000, used_at: '2026-10-08T00:00:00Z' })
      return json(l, 201)
    }
    const use = /^\/api\/marketplace\/listings\/([^/?]+)\/use$/.exec(url)
    if (use && method === 'POST') {
      const id = use[1]
      const base = { id: `use_${sent.length}`, listing_id: id, version: 2, kind: 'agent', model: 'gpt-4o', output: 'Looks fine.', used_at: '2026-10-08T10:00:00Z' }
      const covering = licences.find((l) => l.listing_id === id && l.status === 'active')
      if (covering) return json({ ...base, charge: 'licensed', price_ulxc: 0, licence_id: covering.id })
      if ((trials[id] ?? 0) > 0) {
        trials[id] -= 1
        return json({ ...base, charge: 'trial', price_ulxc: 0, trial: true, trial_uses_left: trials[id], would_have_cost_usd_micros: 500_000 })
      }
      bill.push({ use_id: base.id, listing_id: id, title: 'Daily brief', price_ulxc: 5_000_000, used_at: base.used_at })
      return json({ ...base, charge: 'billed', price_ulxc: 5_000_000 })
    }
    if (url === '/api/marketplace/listings/lst_own/versions' && method === 'POST') {
      const { artifact, changelog } = JSON.parse(String(init?.body)) as Record<string, unknown>
      const v = { version: own.length + 1, artifact_sha256: `o${own.length + 1}`, changelog, created_at: '2026-10-09T09:00:00Z', artifact }
      own.push(v)
      return json(v, 201)
    }
    const one = /^\/api\/marketplace\/listings\/([^/?]+)(?:\?currency=([A-Z]{3}))?$/.exec(url)
    if (one?.[1] === 'lst_own')
      return json({ ...listing('lst_own', ''), kind: 'prompt', title: 'Summariser', offers: [], latest_version: own.length, versions: own })
    if (one) return json(listing(one[1], one[2] ?? ''))
    if (url.startsWith('/api/marketplace/bill?month='))
      return json({
        month: url.slice(-7),
        total_ulxc: bill.reduce((s, l) => s + l.price_ulxc, 0),
        total_usd_micros: bill.reduce((s, l) => s + l.price_ulxc / 10, 0),
        lines: bill,
      })
    return json({ error: 'not found' }, 404)
  })
  return { bill, sent }
}

async function at(path: string) {
  cleanup()
  queryClient.clear()
  window.history.pushState({}, '', path)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
}

async function useIt(button: RegExp | string) {
  fireEvent.change(await screen.findByLabelText('Your message'), { target: { value: 'Check clause 4.' } })
  fireEvent.click(screen.getByRole('button', { name: button }))
  return screen.findByTestId('market-use-result')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('listing page 2', () => {
  it('rents a listing from its page in the buyer’s currency, then uses it with no new bill line', async () => {
    const { bill, sent } = mockBff()
    await at('/marketplace/listings/lst_rent')
    const offer = await screen.findByTestId('listing-offer')
    expect(offer.textContent).toContain('Rent · Commercial licence')
    expect(offer.textContent).toContain('inside its own products')
    expect(within(offer).getByTestId('offer-price').textContent).toBe('£18.55')
    expect(within(offer).getByTestId('offer-tax').textContent).toBe('incl. VAT')
    expect(within(offer).getByTestId('offer-usd').textContent).toBe('billed in US dollars: $20.00')

    fireEvent.change(screen.getByLabelText('Prices in'), { target: { value: 'EUR' } })
    await waitFor(() => expect(within(screen.getByTestId('listing-offer')).getByTestId('offer-price').textContent).toBe('€21.82'))

    fireEvent.click(within(screen.getByTestId('listing-offer')).getByRole('button', { name: 'Rent' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rent for $20.00' }))
    const held = await screen.findByTestId('listing-held')
    expect(held.textContent).toContain('You rent it under the commercial licence until 7 Nov 2026, following its latest version')
    expect(sent.filter((s) => s.url.endsWith('/licences'))).toEqual([
      { url: '/api/marketplace/listings/lst_rent/licences', key: expect.any(String), body: '{"offer_id":"ofr_rent","version":0}' },
    ])
    expect(bill.map((l) => l.use_id)).toEqual(['use_rent'])

    const result = await useIt('Use it')
    expect(result.textContent).toContain('Covered by your licence: nothing new goes on your bill.')
    expect(bill.map((l) => l.use_id)).toEqual(['use_rent'])

    await at('/marketplace/bill')
    await waitFor(() => expect(screen.getByTestId('market-bill-total').textContent).toBe('$20.00'))
  })

  it('runs a trial use, labelled test money and not billed', async () => {
    const { bill } = mockBff()
    await at('/marketplace/listings/lst_trial')
    const offer = await screen.findByTestId('listing-offer')
    expect(offer.textContent).toContain('Pay per use · Commercial licence')
    expect(offer.textContent).toContain('your first 3 uses are free trials — Trial — test money, not billed')
    expect(within(offer).queryByRole('button')).toBeNull()

    const result = await useIt('Try it')
    expect(within(result).getByTestId('market-use-trial').textContent).toBe('Trial — test money, not billed')
    expect(result.textContent).toContain('Billed, it would have cost $0.50.')
    expect(result.textContent).toContain('Trial uses left: 2.')
    expect(bill).toEqual([])
    expect(screen.queryByTestId('new-version')).toBeNull()
  })

  it('offers a skill, and only a skill, to use in Chat: a new chat attached to it (B28.426)', async () => {
    mockBff()
    await at('/marketplace/listings/lst_skill')
    // The listing goes in the navigation's state (Chat.test.tsx), so the address is Chat's own.
    expect((await screen.findByRole('link', { name: 'Use in Chat' })).getAttribute('href')).toBe('/chat')
    await at('/marketplace/listings/lst_trial')
    await screen.findByTestId('listing-offer')
    expect(screen.queryByRole('link', { name: 'Use in Chat' })).toBeNull()
  })

  it('shows the trust figures and the originals with their shares, and the remix terms', async () => {
    mockBff()
    await at('/marketplace/listings/lst_rent')
    const trust = await screen.findByTestId('listing-trust')
    expect(within(trust).getByText('Verified publisher')).toBeTruthy()
    expect(within(trust).getByTestId('trust-reviews').textContent).toBe('4.50 of 5 from 2 reviews')
    expect(within(trust).getByTestId('trust-eval').textContent).toBe('8 of 10 cases passed on version 2')
    expect(within(trust).getByTestId('trust-claims').textContent).toBe('1 open · 0 upheld · 0 rejected')
    expect(trust.textContent).toContain('The seller replied: Thank you!')

    const family = screen.getByTestId('listing-family')
    const originals = within(family).getByRole('list', { name: 'Originals' })
    expect(within(originals).getByRole('link', { name: 'Clause finder' }).getAttribute('href')).toBe('/marketplace/listings/lst_clause')
    expect(within(originals).getAllByTestId('original-share').map((n) => n.textContent)).toEqual(['10% of each sale', '5% of each sale'])
    expect(originals.textContent).toContain('A listing you cannot see')
    expect(within(family).getByTestId('family-remixes').textContent).toBe('4 remixes build on it')

    fireEvent.click(screen.getByRole('button', { name: 'Remix this' }))
    expect(screen.getByTestId('remix-terms').textContent).toContain('15% of each sale of your remix')
  })

  it('uploads a new version with a changelog from the seller’s own listing page', async () => {
    const { sent } = mockBff()
    await at('/marketplace/listings/lst_own')
    const form = await screen.findByTestId('new-version')
    expect(form.textContent).toContain('Publishing makes it version 2.')
    const template = within(form).getByLabelText(/^Template/)
    expect((template as HTMLTextAreaElement).value).toBe('Summarise {{text}}')
    fireEvent.change(template, { target: { value: 'Summarise {{text}} in three bullets' } })
    fireEvent.change(within(form).getByLabelText('What changed'), { target: { value: 'Three bullets' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Publish this version' }))
    await within(form).findByText('Version 2 is published.')
    expect(sent.filter((s) => s.url.endsWith('/versions'))).toEqual([
      {
        url: '/api/marketplace/listings/lst_own/versions',
        key: null,
        body: '{"artifact":{"template":"Summarise {{text}} in three bullets"},"changelog":"Three bullets","parents":[]}',
      },
    ])
    await waitFor(() => expect(form.textContent).toContain('Publishing makes it version 3.'))
    expect(screen.getByText('Three bullets')).toBeTruthy()
    expect(screen.getByText('First version')).toBeTruthy()
  })
})
