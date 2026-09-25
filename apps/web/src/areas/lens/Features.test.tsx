import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B8.2 — the Features screen: the Tare switch writes Lens's policy and the row then reads what
// Lens recorded; a capability with no reachable control is shown without a switch.

function mockBff(
  posts: Array<{ url: string; body: unknown }>,
  { disabledGates = [] as string[], tareRequests = 4 } = {},
) {
  let tare = 'disabled'
  let distillPoolable = false
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/features/tare' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { tare_policy: string }
      posts.push({ url, body })
      tare = body.tare_policy
      return json({ tare_policy: tare })
    }
    if (url === '/api/features/distill-poolable' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { distill_poolable: boolean }
      posts.push({ url, body })
      distillPoolable = body.distill_poolable
      return json({ distill_poolable: distillPoolable })
    }
    if (url === '/api/features/tare-savings')
      return json({ requests: tareRequests, tokens_before: 10000, tokens_after: 3800, cost_saved_usd: 0.0155 })
    if (url === '/api/distill') return json({ distill_policy: 'always', converted: 12, vision_ocr: 1, days: 30 })
    if (url === '/api/usage?days=30')
      return json({
        period_days: 30,
        models: [],
        cache: { total_requests: 200, cache_hits: 40, misses: 160, hit_rate: 0.2, by_source: { upstream: 160, cache_hit_exact: 33, cache_hit_pooled: 7 } },
      })
    if (url === '/api/earnings')
      return json({
        disabled_gates: disabledGates,
        by_type: [{ type: 'pool_royalty', class: 'settled', kind: 'contribution', amount_ulens: 2_500_000, rows: 3, reason: '' }],
      })
    if (url === '/api/features')
      return json({
        tare_policy: tare,
        distill_policy: 'always',
        compression_policy: 'disabled',
        logging_policy: 'metadata',
        cache_poolable: true,
        distill_poolable: distillPoolable,
        cost_optimize_routing: false,
        guardrails: { injection: true, pii: false },
      })
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

function row(name: string): HTMLElement {
  return screen.getByRole('heading', { name, level: 3 }).closest('li') as HTMLElement
}

describe('the Features screen', () => {
  it('turning Tare on writes Lens’s policy and the row then reads On; off writes it back', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts)
    window.history.pushState({}, '', '/features')
    render(<App />)

    await waitFor(() => expect(within(row('Tare')).getByTestId('state-Tare')).toHaveTextContent('Off'))
    fireEvent.click(within(row('Tare')).getByRole('switch'))
    await waitFor(() => expect(within(row('Tare')).getByTestId('state-Tare')).toHaveTextContent('On'))
    expect(posts).toEqual([{ url: '/api/features/tare', body: { tare_policy: 'always' } }])

    fireEvent.click(within(row('Tare')).getByRole('switch'))
    await waitFor(() => expect(within(row('Tare')).getByTestId('state-Tare')).toHaveTextContent('Off'))
    expect(posts[1]).toEqual({ url: '/api/features/tare', body: { tare_policy: 'disabled' } })
  })

  it('a capability with no control this app can reach shows its state and no switch', async () => {
    mockBff([])
    window.history.pushState({}, '', '/features')
    render(<App />)
    await waitFor(() =>
      expect(within(row('Prompt-injection detection')).getByText('On')).toBeInTheDocument(),
    )
    for (const name of ['Answer cache', 'Prompt-injection detection', 'Request logging']) {
      expect(within(row(name)).queryByRole('switch'), name).toBeNull()
    }
  })

  // B11.2
  it('the retired prompt rewriter is not on the screen at all', async () => {
    mockBff([])
    window.history.pushState({}, '', '/features')
    render(<App />)
    await screen.findByRole('heading', { name: 'Tare', level: 3 })
    expect(screen.queryByRole('heading', { name: 'Prompt rewriter' })).toBeNull()
  })

  it('every row says where it works and what shows it working', async () => {
    mockBff([])
    window.history.pushState({}, '', '/features')
    render(<App />)
    await screen.findByRole('heading', { name: 'Tare', level: 3 })
    for (const li of screen.getAllByRole('listitem').filter((el) => el.querySelector('h3'))) {
      expect(li.textContent, li.querySelector('h3')?.textContent ?? '').toMatch(/Where it works:.+See it working:.+/)
    }
  })

  it('Tare shows what it saved, labelled estimated; with nothing reduced it says so', async () => {
    mockBff([])
    window.history.pushState({}, '', '/features')
    const { unmount } = render(<App />)
    await waitFor(() =>
      expect(screen.getByTestId('evidence-Tare').textContent).toBe(
        'See it working: 4 requests reduced from 10,000 to 3,800 tokens, about $0.02 saved — estimated, from Lens’s token estimates at each model’s input rate.',
      ),
    )
    unmount()
    queryClient.clear()
    vi.restoreAllMocks()

    mockBff([], { tareRequests: 0 })
    render(<App />)
    await waitFor(() =>
      expect(screen.getByTestId('evidence-Tare').textContent).toBe('See it working: No request has been reduced yet (measured).'),
    )
  })

  it('answer sharing shows pooled serves and royalties earned, measured', async () => {
    mockBff([])
    window.history.pushState({}, '', '/features')
    render(<App />)
    await waitFor(() =>
      expect(screen.getByTestId('evidence-Answer sharing').textContent).toMatch(
        /7 answers served from the shared pool in the last 30 days, and 2\.5 LENS earned from answers others reused \(measured\)/,
      ),
    )
  })

  it('shared document conversions has a switch that writes Lens’s own consent', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts)
    window.history.pushState({}, '', '/features')
    render(<App />)
    const r = () => row('Shared document conversions')
    await waitFor(() => expect(within(r()).getByRole('switch')).toBeInTheDocument())
    fireEvent.click(within(r()).getByRole('switch'))
    await waitFor(() => expect(within(r()).getByTestId('state-Shared document conversions')).toHaveTextContent('On'))
    expect(posts).toEqual([{ url: '/api/features/distill-poolable', body: { distill_poolable: true } }])
  })

  it('a capability the deployment has switched off says so, names the switch, and offers none', async () => {
    mockBff([], { disabledGates: ['LENS_DISTILL_POOLABLE_ENABLED'] })
    window.history.pushState({}, '', '/features')
    render(<App />)
    await waitFor(() =>
      expect(screen.getByTestId('evidence-Shared document conversions').textContent).toMatch(
        /Switched off for the whole deployment by its operator \(LENS_DISTILL_POOLABLE_ENABLED\)/,
      ),
    )
    expect(within(row('Shared document conversions')).queryByRole('switch')).toBeNull()
  })
})
