import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B20.3 — the marketplace, walked the way its DONE line reads: publish a prompt from one workspace,
// find it and use it from another — whose monthly bill then carries the use (B20.10) — and see the
// earnings on the first. The mock BFF plays Lens's
// B20.1–B20.2 routes for two workspaces — `as` says which one is signed in — and does what Lens does:
// a publish carrying a secret is refused with its sentence, every viewer is told what a use needs but
// only the owner sees the template (B20.8, used by B20.9), a prompt used without its variables is
// refused naming them, and a billed use shows up as the seller's pending earnings until the buyer's
// bill is paid.

function mockBff() {
  const state = { as: 'ws_seller' }
  const listings: Array<Record<string, unknown>> = []
  const uses: Array<{ seller: string; buyer: string; listing: string; title: string; price: number }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10 }])
    if (url === '/api/marketplace/listings' && method === 'POST') {
      const artifact = body.artifact as Record<string, string>
      if (/sk-live/.test(artifact.template ?? ''))
        return json({ error: 'market: the listing cannot be published: it carries a secret (an API key)' }, 422)
      const l = {
        id: `lst_${listings.length + 1}`,
        workspace_id: state.as,
        kind: body.kind,
        title: body.title,
        description: body.description,
        price_per_use_ulxc: body.price_per_use_ulxc,
        visibility: body.visibility,
        latest_version: 1,
        created_at: '2026-09-28T09:00:00Z',
        updated_at: '2026-09-28T09:00:00Z',
        artifact,
      }
      listings.push(l)
      return json(l, 201)
    }
    // B20.8: every viewer sees what a use needs — the prompt's variables and its model — never the template.
    const view = (l: Record<string, unknown>) => {
      const { artifact, ...rest } = l
      const a = artifact as Record<string, string>
      const needs = { input: false, variables: [...a.template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]), model: a.model ?? '' }
      return {
        ...rest,
        versions: [{ version: 1, artifact_sha256: 'abc', created_at: '2026-09-28T09:00:00Z', needs, ...(l.workspace_id === state.as ? { artifact } : {}) }],
      }
    }
    if (url.startsWith('/api/marketplace/listings?') || url === '/api/marketplace/listings')
      return json({ listings: listings.filter((l) => l.visibility === 'public').map(({ artifact: _a, ...l }) => l) })
    if (url === '/api/marketplace/mine')
      return json({ listings: listings.filter((l) => l.workspace_id === state.as).map(({ artifact: _a, ...l }) => l) })
    if (url === '/api/marketplace/earnings') {
      const mine = uses.filter((u) => u.seller === state.as)
      return json({
        pending_uses: mine.length,
        pending_usd_micros: mine.reduce((s, u) => s + u.price / 10, 0),
        payable_usd_micros: 0,
        in_holdback_usd_micros: 0,
        available_usd_micros: 0,
        lifetime_gross_usd_micros: 0,
        earnings: null,
      })
    }
    if (url.startsWith('/api/marketplace/bill?month=')) {
      const mine = uses.filter((u) => u.buyer === state.as)
      return json({
        month: url.slice(-7),
        total_ulxc: mine.reduce((s, u) => s + u.price, 0),
        total_usd_micros: mine.reduce((s, u) => s + u.price / 10, 0),
        lines: mine.map((u, i) => ({ use_id: `use_${i}`, listing_id: u.listing, title: u.title, price_ulxc: u.price, used_at: '2026-09-28T10:00:00Z' })),
      })
    }
    const use = /^\/api\/marketplace\/listings\/([^/]+)\/use$/.exec(url)
    const one = /^\/api\/marketplace\/listings\/([^/]+)$/.exec(url)
    const l = listings.find((x) => x.id === (use ?? one)?.[1])
    if (!l) return new Response('null', { status: 404 })
    if (one) return json(view(l))
    const template = (l.artifact as Record<string, string>).template
    const vars = body.variables as Record<string, string>
    const missing = [...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).filter((v) => !(v in vars))
    if (missing.length > 0)
      return json({ error: `market: invalid listing: the prompt needs the variables ${missing.join(', ')}` }, 400)
    const own = l.workspace_id === state.as
    if (!own) uses.push({ seller: String(l.workspace_id), buyer: state.as, listing: String(l.id), title: String(l.title), price: Number(l.price_per_use_ulxc) })
    return json({
      id: 'use_1', listing_id: l.id, version: 1, kind: 'prompt', model: body.model || 'gpt-4o',
      charge: own ? 'own' : 'billed', price_ulxc: own ? 0 : l.price_per_use_ulxc,
      output: `Bonjour — ${vars.text}`, used_at: '2026-09-28T10:00:00Z',
    })
  })
  return state
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

describe('the marketplace', () => {
  it('publishes a prompt from one workspace, is found and used from another, and the seller sees what it earned', async () => {
    const state = mockBff()

    await at('/marketplace/publish')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Translate to French' } })
    fireEvent.change(screen.getByLabelText(/Price per use/), { target: { value: '0.5' } })
    fireEvent.change(screen.getByLabelText(/^Template/), { target: { value: 'Translate into French: {{text}}' } })
    expect(screen.getByText('Whoever uses it fills in: text.')).toBeTruthy()
    await screen.findByRole('option', { name: 'GPT-4o' })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4o' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByRole('heading', { name: 'Translate to French' })).toBeTruthy()

    state.as = 'ws_buyer'
    await at('/marketplace')
    fireEvent.change(await screen.findByLabelText('Search listings'), { target: { value: 'french' } })
    fireEvent.click(await screen.findByRole('link', { name: 'Translate to French' }))
    expect(await screen.findByText(/Each use costs/)).toBeTruthy()
    // B20.9: the buyer cannot see the template, but Lens says what a use needs — so the prompt's variable
    // has its field and the model it runs on is named before anything is used.
    expect(screen.getByRole('option', { name: 'Its own: gpt-4o' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('text'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: /Use it/ }))
    const result = await screen.findByTestId('market-use-result')
    expect(within(result).getByText('Bonjour — Hello')).toBeTruthy()
    expect(result.textContent).toContain('0.5 LXC is on your marketplace bill for this month.')

    // B20.10 — the buyer's bill for this month carries that use, its price and the total.
    await at('/marketplace/bill')
    await waitFor(() => expect(screen.getByTestId('market-bill-total').textContent).toBe('0.5 LXC · $0.05'))
    expect(screen.getByRole('link', { name: 'Translate to French' })).toBeTruthy()

    state.as = 'ws_seller'
    await at('/marketplace/selling')
    await waitFor(() => expect(screen.getByTestId('market-pending').textContent).toBe('$0.05'))
    expect(screen.getByRole('link', { name: 'Translate to French' })).toBeTruthy()
  })

  it('a listing Lens refuses to publish says why, and stays unpublished', async () => {
    mockBff()
    await at('/marketplace/publish')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Leaky' } })
    fireEvent.change(screen.getByLabelText(/^Template/), { target: { value: 'use sk-live-123 for {{text}}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The listing cannot be published: it carries a secret (an API key).',
    )
    expect(screen.getByRole('heading', { name: 'Publish a listing' })).toBeTruthy()
  })

  // B26.27 — a payment to another company's agent (B19.15) has no listing, so its bill line is plain
  // text: it once linked to /marketplace/listings/, a page that is not there.
  it("a payment to an agent on the bill is plain text, not a link to a listing that isn't there", async () => {
    const state = mockBff()
    const rest = vi.mocked(globalThis.fetch).getMockImplementation()!
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (!String(input).startsWith('/api/marketplace/bill?month=')) return rest(input, init)
      const lines = [
        { use_id: 'use_1', listing_id: 'lst_1', title: 'Translate to French', price_ulxc: 500_000, used_at: '2026-09-28T10:00:00Z' },
        { use_id: 'use_2', listing_id: '', title: 'Payment to Bea', payee_agent_id: 'agt_bea', price_ulxc: 250_000, used_at: '2026-09-28T11:00:00Z' },
      ]
      return new Response(JSON.stringify({ month: '2026-09', total_ulxc: 750_000, total_usd_micros: 75_000, lines }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    state.as = 'ws_buyer'
    await at('/marketplace/bill')
    const payment = await screen.findByText('Payment to Bea')
    expect(payment.closest('a')).toBeNull()
    expect(screen.getByRole('link', { name: 'Translate to French' }).getAttribute('href')).toBe('/marketplace/listings/lst_1')
  })
})
