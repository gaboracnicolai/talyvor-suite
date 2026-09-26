import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B8.2 — the Features screen: the Tare switch writes Lens's policy and the row then reads what
// Lens recorded; a capability with no reachable control is shown without a switch.

function mockBff(
  posts: Array<{ url: string; body: unknown }>,
  {
    disabledGates = [] as string[],
    tareRequests = 4,
    waiting = [] as Array<{ provider: string; id: string; first_seen_at: string }>,
    pii = false,
  } = {},
) {
  let tare = 'disabled'
  let distillPoolable = false
  let cachePoolable = true
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
    if (url === '/api/pooling' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { cache_poolable: boolean }
      posts.push({ url, body })
      cachePoolable = body.cache_poolable
      return json({ cache_poolable: cachePoolable })
    }
    if (url === '/api/features/tare-savings')
      return json({ requests: tareRequests, tokens_before: 10000, tokens_after: 3800, cost_saved_usd: 0.0155 })
    if (url === '/api/models/waiting') return json(waiting)
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
        cache_poolable: cachePoolable,
        distill_poolable: distillPoolable,
        cost_optimize_routing: false,
        guardrails: { injection: true, pii },
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

  // B10.5 — the models a provider lists that Lens cannot price yet, until a person confirms a price.
  it('New models lists every model waiting for a price, and says when none is', async () => {
    mockBff([], {
      waiting: [
        { provider: 'anthropic', id: 'claude-nova-6', first_seen_at: '2026-09-26T01:00:00Z' },
        { provider: 'openai', id: 'gpt-6-nova', first_seen_at: '2026-09-25T09:00:00Z' },
      ],
    })
    window.history.pushState({}, '', '/features')
    const { unmount } = render(<App />)
    await waitFor(() =>
      expect(screen.getByTestId('evidence-New models').textContent).toContain(
        'See it working: 2 models are waiting for a price — not offered, and never charged at zero, until one is confirmed.',
      ),
    )
    expect(Array.from(within(screen.getByTestId('models-waiting')).getAllByRole('listitem')).map((li) => li.textContent)).toEqual([
      'anthropic · claude-nova-6 · first seen 2026-09-26',
      'openai · gpt-6-nova · first seen 2026-09-25',
    ])
    unmount()
    queryClient.clear()
    vi.restoreAllMocks()

    mockBff([])
    render(<App />)
    await waitFor(() =>
      expect(screen.getByTestId('evidence-New models').textContent).toBe(
        'See it working: No model is waiting for a price: everything the providers list is priced, in the chat’s model picker.',
      ),
    )
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

  it('answer sharing reads Paused while personal-data detection is off, and On once it is back on (B15.7)', async () => {
    mockBff([], { pii: false })
    window.history.pushState({}, '', '/features')
    render(<App />)
    await waitFor(() =>
      expect(within(row('Answer sharing')).getByTestId('state-Answer sharing')).toHaveTextContent(
        /Paused — personal-data detection is off, so nothing of yours is shared/,
      ),
    )
    expect(within(row('Answer sharing')).getByRole('switch')).toBeChecked()

    cleanup()
    queryClient.clear()
    vi.restoreAllMocks()
    mockBff([], { pii: true })
    render(<App />)
    await waitFor(() =>
      expect(within(row('Answer sharing')).getByTestId('state-Answer sharing')).toHaveTextContent(
        'On — your answers earn when someone else is served one',
      ),
    )
  })

  it('answer sharing has a switch: off writes the consent, and the row then says nothing earns', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts)
    window.history.pushState({}, '', '/features')
    render(<App />)
    const r = () => row('Answer sharing')
    await waitFor(() => expect(within(r()).getByRole('switch')).toBeInTheDocument())
    fireEvent.click(within(r()).getByRole('switch'))
    await waitFor(() => expect(within(r()).getByTestId('state-Answer sharing')).toHaveTextContent(/your answers earn nothing/))
    expect(posts).toEqual([{ url: '/api/pooling', body: { cache_poolable: false } }])
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
