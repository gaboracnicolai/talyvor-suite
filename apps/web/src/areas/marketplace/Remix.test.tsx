import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B32.58 — remix and publish with parents, walked the way its DONE line reads: a remix licence is accepted, a remix is
// published with its parent and comes out approved; a near-copy is held naming its original and offers to declare it.
// The mock BFF answers as Lens does: Remix this records one grant with the share locked (B32.25); a parent that is
// someone else's needs that grant; a publish 92% or more like a listing it does not declare is held, its scan naming
// that listing, its score and whether it is remixable (B32.46); declared under a grant, the copy publishes approved.

const ORIGINAL_TEMPLATE = 'List every indemnity clause in {{contract}} and say who it protects.'

const ORIGINAL = {
  id: 'lst_orig',
  workspace_id: 'ws_other',
  kind: 'prompt',
  title: 'Clause finder',
  description: '',
  price_per_use_ulxc: 0,
  visibility: 'public',
  latest_version: 2,
  created_at: '2026-09-01T09:00:00Z',
  updated_at: '2026-10-01T09:00:00Z',
  review_status: 'approved',
  remix_policy: 'royalty',
  remix_share_bps: 1500,
  offers: [],
  versions: [{ version: 2, artifact_sha256: 'o2', created_at: '2026-10-01T09:00:00Z', needs: { input: false, variables: ['contract'], model: '' } }],
}

/** Lens's similarity, crudely: the share of the original's words the copy keeps. */
function similarity(template: string): number {
  const words = new Set(template.toLowerCase().split(/\s+/))
  const orig = ORIGINAL_TEMPLATE.toLowerCase().split(/\s+/)
  return orig.filter((w) => words.has(w)).length / orig.length
}

function mockBff(own: Array<Record<string, unknown>> = []) {
  const listings: Array<Record<string, unknown>> = [...own]
  const grants: Array<{ listing_id: string; version: number; share_bps: number }> = []
  const sent: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method !== 'GET') sent.push({ url, body })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([])
    if (url === '/api/marketplace/licences') return json({ licences: [] })
    if (url === '/api/marketplace/mine') return json({ listings: listings.map(({ versions: _v, ...l }) => l) })
    if (url === '/api/marketplace/listings?kind=' || url === '/api/marketplace/listings')
      if (method === 'GET') return json({ listings: [ORIGINAL] })
    if (url === '/api/marketplace/listings/lst_orig/remix' && method === 'POST') {
      const version = (body.version as number) || ORIGINAL.latest_version
      if (!grants.some((g) => g.listing_id === 'lst_orig' && g.version === version))
        grants.push({ listing_id: 'lst_orig', version, share_bps: ORIGINAL.remix_share_bps })
      return json({
        listing_id: 'lst_orig',
        version,
        kind: 'prompt',
        title: 'Clause finder',
        licence: 'docs/terms/remix.md',
        grant: { workspace_id: 'ws_me', listing_id: 'lst_orig', version, share_bps: 1500, accepted_at: '2026-10-08T10:00:00Z' },
        artifact: { template: ORIGINAL_TEMPLATE },
      })
    }
    if (url === '/api/marketplace/listings' && method === 'POST') {
      const parents = (body.parents as Array<{ listing_id: string; version: number }>) ?? []
      const edges = []
      for (const p of parents) {
        const g = grants.find((x) => x.listing_id === p.listing_id && x.version === p.version)
        if (!g) return json({ error: 'market: invalid listing: accept that listing’s remix licence before declaring it as a parent' }, 400)
        edges.push({ ...p, share_bps: g.share_bps, source: 'declared', created_at: '2026-10-08T10:00:00Z' })
      }
      const artifact = body.artifact as { template: string }
      const score = similarity(artifact.template)
      const copies = score >= 0.92 && !parents.some((p) => p.listing_id === 'lst_orig')
      const similar = copies ? { listing_id: 'lst_orig', title: 'Clause finder', score: 0.9714, remixable: true } : undefined
      const l = {
        ...body,
        id: `lst_new${listings.length + 1}`,
        workspace_id: 'ws_me',
        latest_version: 1,
        created_at: '2026-10-08T10:00:00Z',
        updated_at: '2026-10-08T10:00:00Z',
        review_status: copies ? 'held' : 'approved',
        review_reason: copies ? 'it is 97% similar to "Clause finder" (lst_orig), which it does not declare as a parent' : undefined,
        offers: [],
        versions: [
          {
            version: 1,
            artifact_sha256: 'n1',
            created_at: '2026-10-08T10:00:00Z',
            needs: { input: false, variables: ['contract'], model: '' },
            artifact,
            scan: { injection_risk: 0, ...(copies ? { held: 'held', similar } : {}) },
            parents: edges,
          },
        ],
      }
      listings.push(l)
      return json(l, 201)
    }
    const trust = /^\/api\/marketplace\/listings\/([^/?]+)\/trust$/.exec(url)
    if (trust) {
      const l = listings.find((x) => x.id === trust[1])
      const edges = ((l?.versions as Array<{ parents?: Array<Record<string, unknown>> }>)?.[0]?.parents ?? []).map((e) => ({
        ...e,
        title: 'Clause finder',
        child_listing_id: trust[1],
        child_version: 1,
        depth: 1,
      }))
      return json({
        listing_id: trust[1],
        version: 1,
        publisher: { workspace_id: 'ws_me', verified: false, not_verified_because: ['payouts are not enabled'] },
        reviews: { count: 0, average: 0, stars: [0, 0, 0, 0, 0], recent: [] },
        claims: { open: 0, upheld: 0, attributed: 0, rejected: 0 },
        originals: edges,
        remixes: 0,
      })
    }
    const one = /^\/api\/marketplace\/listings\/([^/?]+)$/.exec(url)
    if (one) {
      if (one[1] === 'lst_orig') return json(ORIGINAL)
      const l = listings.find((x) => x.id === one[1])
      return l ? json(l) : json({ error: 'not found' }, 404)
    }
    return json({ error: 'not found' }, 404)
  })
  return { sent, grants }
}

async function at(path: string) {
  cleanup()
  queryClient.clear()
  window.history.pushState({}, '', path)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

const publishes = (sent: Array<{ url: string; body: Record<string, unknown> }>) =>
  sent.filter((s) => s.url === '/api/marketplace/listings').map((s) => s.body.parents)

describe('remix and publish with parents', () => {
  it('accepts a remix licence, publishes a remix with its parent and sees it approved', async () => {
    const { sent, grants } = mockBff()
    await at('/marketplace/listings/lst_orig')
    fireEvent.click(await screen.findByRole('button', { name: 'Remix this' }))
    expect(screen.getByTestId('remix-terms').textContent).toContain('15% of each sale of your remix')
    fireEvent.click(screen.getByRole('button', { name: 'Accept the remix licence' }))

    await screen.findByRole('heading', { name: 'Publish a listing' })
    expect(grants).toEqual([{ listing_id: 'lst_orig', version: 2, share_bps: 1500 }])
    expect((screen.getByLabelText(/^Template/) as HTMLTextAreaElement).value).toBe(ORIGINAL_TEMPLATE)
    const parent = screen.getByTestId('publish-parent')
    expect(parent.textContent).toContain('Clause finder')
    expect(parent.textContent).toContain('Version 2 · 15% of each sale')

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Indemnity finder, plain English' } })
    fireEvent.change(screen.getByLabelText(/^Template/), {
      target: { value: 'Find each indemnity in {{contract}}, then explain it in plain English for a founder.' },
    })
    fireEvent.change(screen.getByLabelText('Remixes'), { target: { value: 'royalty' } })
    fireEvent.change(screen.getByLabelText(/Your share of each remix/), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await screen.findByRole('heading', { name: 'Indemnity finder, plain English' })
    expect(sent.find((s) => s.url === '/api/marketplace/listings')?.body).toMatchObject({
      remix_policy: 'royalty',
      remix_share_bps: 1000,
      parents: [{ listing_id: 'lst_orig', version: 2 }],
    })
    expect(screen.queryByTestId('listing-review')).toBeNull()
    expect(screen.queryByTestId('similar-hold')).toBeNull()
    const originals = within(await screen.findByTestId('listing-family')).getByRole('list', { name: 'Originals' })
    expect(within(originals).getByRole('link', { name: 'Clause finder' })).toBeTruthy()
    expect(within(originals).getByTestId('original-share').textContent).toBe('15% of each sale')
  })

  it('a near-copy is held naming its original, and declaring it as a parent publishes it approved', async () => {
    const { sent } = mockBff()
    await at('/marketplace/publish')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Indemnity finder' } })
    fireEvent.change(screen.getByLabelText(/^Template/), { target: { value: ORIGINAL_TEMPLATE } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    const hold = await screen.findByTestId('similar-hold')
    expect(hold.textContent).toContain('Held for review: it is 97% similar to Clause finder, which it does not declare as a parent.')
    expect(within(hold).getByRole('link', { name: 'Clause finder' }).getAttribute('href')).toBe('/marketplace/listings/lst_orig')
    expect(screen.getByRole('link', { name: 'See the held listing' }).getAttribute('href')).toBe('/marketplace/listings/lst_new1')

    fireEvent.click(within(hold).getByRole('button', { name: 'Declare it as a parent' }))
    await waitFor(() => expect(within(hold).getByTestId('remix-terms').textContent).toContain('15% of each sale of your remix'))
    fireEvent.click(within(hold).getByRole('button', { name: 'Accept and publish again' }))

    await screen.findByRole('heading', { name: 'Indemnity finder' })
    expect(window.location.pathname).toBe('/marketplace/listings/lst_new2')
    expect(publishes(sent)).toEqual([[], [{ listing_id: 'lst_orig', version: 2 }]])
    expect(screen.queryByTestId('similar-hold')).toBeNull()
  })

  it('a held listing of your own names its original, and declaring it opens Publish with that parent', async () => {
    mockBff([
      {
        id: 'lst_held',
        workspace_id: 'ws_me',
        kind: 'prompt',
        title: 'Indemnity finder',
        description: 'Finds indemnities.',
        price_per_use_ulxc: 0,
        visibility: 'public',
        latest_version: 1,
        created_at: '2026-10-08T09:00:00Z',
        updated_at: '2026-10-08T09:00:00Z',
        review_status: 'held',
        review_reason: 'version 1: it is 97% similar to "Clause finder" (lst_orig)',
        remix_policy: 'none',
        remix_share_bps: 0,
        offers: [],
        versions: [
          {
            version: 1,
            artifact_sha256: 'h1',
            created_at: '2026-10-08T09:00:00Z',
            needs: { input: false, variables: ['contract'], model: '' },
            artifact: { template: ORIGINAL_TEMPLATE },
            scan: { injection_risk: 0, held: 'held', similar: { listing_id: 'lst_orig', title: 'Clause finder', score: 0.9714, remixable: true } },
          },
        ],
      },
    ])
    await at('/marketplace/listings/lst_held')
    const hold = await screen.findByTestId('similar-hold')
    expect(hold.textContent).toContain('97% similar to Clause finder')
    fireEvent.click(within(hold).getByRole('button', { name: 'Declare it as a parent' }))
    fireEvent.click(await within(hold).findByRole('button', { name: 'Accept and open Publish' }))

    await screen.findByRole('heading', { name: 'Publish a listing' })
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Indemnity finder')
    expect((screen.getByLabelText(/^Template/) as HTMLTextAreaElement).value).toBe(ORIGINAL_TEMPLATE)
    expect(screen.getByTestId('publish-parent').textContent).toContain('Clause finder')
  })
})
