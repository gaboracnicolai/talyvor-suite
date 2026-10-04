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
    miningEnabled = true,
    featuresReads = Infinity,
    /** How the first reads of /api/features answer, in order, before Lens is back — B17.35. */
    restarting = [] as Array<'502' | 'no guardrails'>,
  } = {},
) {
  let tare = 'disabled'
  let distillPoolable = false
  let cachePoolable = true
  let guardrails = { injection: true, pii }
  let logging = 'metadata'
  let patternOptedIn = false
  let budget: { period: string; limit_usd: number; spent_usd: number; enforcement: string } | null = null
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
    if (url === '/api/features/guardrails' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { injection?: boolean; pii?: boolean }
      posts.push({ url, body })
      guardrails = { ...guardrails, ...body }
      return json(guardrails)
    }
    if (url === '/api/features/pattern-mining' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { opted_in: boolean }
      posts.push({ url, body })
      patternOptedIn = body.opted_in
      return json({ opted_in: patternOptedIn, enabled: miningEnabled })
    }
    if (url === '/api/features/logging' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { logging_policy: string }
      posts.push({ url, body })
      logging = body.logging_policy
      return json({ logging_policy: logging })
    }
    if (url === '/api/features/budget' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { limit_usd: number; enforcement: string }
      posts.push({ url, body })
      budget = { period: 'monthly', spent_usd: budget?.spent_usd ?? 12.5, ...body }
      return json({ budget, several: false })
    }
    if (url === '/api/features/budget') return json({ budget, several: false })
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
    if (url === '/api/features' && featuresReads-- <= 0) return new Response('{}', { status: 502 })
    const restart = url === '/api/features' && !init?.method ? restarting.shift() : undefined
    if (restart === '502') return new Response('{"error":"lens upstream unreachable"}', { status: 502 })
    if (url === '/api/features')
      return json({
        tare_policy: tare,
        distill_policy: 'always',
        compression_policy: 'disabled',
        logging_policy: logging,
        cache_poolable: cachePoolable,
        distill_poolable: distillPoolable,
        cost_optimize_routing: false,
        guardrails: restart === 'no guardrails' ? null : guardrails,
        pattern_mining: { opted_in: patternOptedIn, enabled: miningEnabled },
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
    expect(within(row('Answer cache')).queryByRole('switch')).toBeNull()
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
        /Paused — personal-data detection is off, so no new answer of yours is shared/,
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

  it('answer sharing has a switch: off writes the consent, and the row then says no new answer is shared', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts)
    window.history.pushState({}, '', '/features')
    render(<App />)
    const r = () => row('Answer sharing')
    await waitFor(() => expect(within(r()).getByRole('switch')).toBeInTheDocument())
    fireEvent.click(within(r()).getByRole('switch'))
    await waitFor(() => expect(within(r()).getByTestId('state-Answer sharing')).toHaveTextContent(/no new answer of yours is shared/))
    expect(posts).toEqual([{ url: '/api/pooling', body: { cache_poolable: false } }])
  })

  // B27.22 — the address sign-up, Terms and Privacy link to lands on the Answer sharing switch.
  it('/features#answer-sharing brings the Answer sharing row, with its switch, into view', async () => {
    mockBff([])
    // jsdom has no scrollIntoView; record what the screen asks to scroll to, and put it back after.
    const jsdomScroll = Element.prototype.scrollIntoView
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      window.history.pushState({}, '', '/features#answer-sharing')
      render(<App />)
      await waitFor(() => expect(scrolled).toEqual([row('Answer sharing')]))
      await waitFor(() => expect(within(row('Answer sharing')).getByRole('switch')).toBeInTheDocument())
    } finally {
      Element.prototype.scrollIntoView = jsdomScroll
    }
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

  // B18.55
  it('routing pattern sharing has a switch, read back from Lens; with mining off for the deployment it says so and offers none', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts)
    window.history.pushState({}, '', '/features')
    render(<App />)
    const r = () => row('Routing pattern sharing')
    const state = () => within(r()).getByTestId('state-Routing pattern sharing')
    await waitFor(() => expect(within(r()).getByRole('switch')).not.toBeChecked())
    expect(state()).toHaveTextContent('Off — switch it on here')
    fireEvent.click(within(r()).getByRole('switch'))
    await waitFor(() => expect(state()).toHaveTextContent('On — the shape of your requests is shared'))
    fireEvent.click(within(r()).getByRole('switch'))
    await waitFor(() => expect(state()).toHaveTextContent('Off — switch it on here'))
    expect(posts).toEqual([
      { url: '/api/features/pattern-mining', body: { opted_in: true } },
      { url: '/api/features/pattern-mining', body: { opted_in: false } },
    ])

    cleanup()
    queryClient.clear()
    vi.restoreAllMocks()
    mockBff([], { miningEnabled: false })
    render(<App />)
    await waitFor(() => expect(state()).toHaveTextContent('Off for this deployment'))
    expect(screen.getByTestId('evidence-Routing pattern sharing')).toHaveTextContent('(LENS_PATTERN_MINING_ENABLED)')
    expect(within(r()).queryByRole('switch')).toBeNull()
  })

  // B18.22
  it('prompt-injection and personal-data detection each have a switch, read back from Lens', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts, { pii: true })
    window.history.pushState({}, '', '/features')
    render(<App />)
    const r = () => row('Prompt-injection detection')
    await waitFor(() => expect(within(r()).getByRole('switch')).toBeChecked())
    fireEvent.click(within(r()).getByRole('switch'))
    await waitFor(() => expect(within(r()).getByTestId('state-Prompt-injection detection')).toHaveTextContent('Off'))
    fireEvent.click(within(row('Personal-data detection')).getByRole('switch'))
    await waitFor(() =>
      expect(within(row('Personal-data detection')).getByTestId('state-Personal-data detection')).toHaveTextContent('Off'),
    )
    expect(posts).toEqual([
      { url: '/api/features/guardrails', body: { injection: false } },
      { url: '/api/features/guardrails', body: { pii: false } },
    ])
  })

  it('request logging is one of Lens’s three policies, and the row reads back the one chosen', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts)
    window.history.pushState({}, '', '/features')
    render(<App />)
    const r = () => row('Request logging')
    await waitFor(() => expect(within(r()).getByRole('combobox', { name: 'Request logging' })).toHaveValue('metadata'))
    fireEvent.change(within(r()).getByRole('combobox', { name: 'Request logging' }), { target: { value: 'none' } })
    await waitFor(() => expect(within(r()).getByTestId('state-Request logging')).toHaveTextContent('Nothing is kept'))
    expect(posts).toEqual([{ url: '/api/features/logging', body: { logging_policy: 'none' } }])
    // B18.57 — under none Lens keeps no cached copy, so the workspace's own cache is paused.
    expect(within(row('Answer cache')).getByTestId('state-Answer cache')).toHaveTextContent(
      'Paused — request logging is none, so nothing is kept to answer from',
    )
  })

  it('a spending limit is set, then switched off, each read back from Lens', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts)
    window.history.pushState({}, '', '/features')
    render(<App />)
    const r = () => row('Spending limit')
    await waitFor(() => expect(within(r()).getByTestId('state-Spending limit')).toHaveTextContent('No limit'))
    fireEvent.change(within(r()).getByRole('textbox', { name: /Limit in dollars/ }), { target: { value: '50' } })
    fireEvent.click(within(r()).getByRole('button', { name: 'Set' }))
    await waitFor(() =>
      expect(within(r()).getByTestId('state-Spending limit')).toHaveTextContent('On — $50.00 a month; requests past it are refused'),
    )
    expect(within(r()).getByTestId('evidence-Spending limit')).toHaveTextContent('$12.50 spent of $50.00 a month')

    fireEvent.click(within(r()).getByRole('switch'))
    await waitFor(() =>
      expect(within(r()).getByTestId('state-Spending limit')).toHaveTextContent('Off — the limit of $50.00 a month is kept'),
    )
    expect(posts).toEqual([
      { url: '/api/features/budget', body: { limit_usd: 50, enforcement: 'hard_block' } },
      { url: '/api/features/budget', body: { limit_usd: 50, enforcement: 'off' } },
    ])
  })

  it('a spending limit under a cent reads as what it is, not $0.00', async () => {
    mockBff([])
    window.history.pushState({}, '', '/features')
    render(<App />)
    const r = () => row('Spending limit')
    await waitFor(() => expect(within(r()).getByTestId('state-Spending limit')).toHaveTextContent('No limit'))
    fireEvent.change(within(r()).getByRole('textbox', { name: /Limit in dollars/ }), { target: { value: '0.0005' } })
    fireEvent.click(within(r()).getByRole('button', { name: 'Set' }))
    await waitFor(() =>
      expect(within(r()).getByTestId('state-Spending limit')).toHaveTextContent('On — $0.0005 a month; requests past it are refused'),
    )
  })

  // B17.28 — under load the re-read after a write was slow or failed: the switch waited on it past
  // 15 s, and a failed re-read hid every control on the page. Lens's reply to the write says what it
  // recorded, so that is what shows; a failed re-read leaves the switches where they are.
  it('a switch shows what Lens recorded from its own reply, and switches back, while the re-read fails', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts, { featuresReads: 1 })
    window.history.pushState({}, '', '/features')
    render(<App />)

    await waitFor(() => expect(within(row('Tare')).getByTestId('state-Tare')).toHaveTextContent('Off'))
    fireEvent.click(screen.getByRole('switch', { name: 'Tare: turn on' }))
    await waitFor(() => expect(within(row('Tare')).getByTestId('state-Tare')).toHaveTextContent('On'))
    expect(screen.getByRole('switch', { name: 'Tare: turn off' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'Request logging' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Tare: turn off' }))
    await waitFor(() => expect(within(row('Tare')).getByTestId('state-Tare')).toHaveTextContent('Off'))
    expect(posts.map((p) => p.body)).toEqual([{ tare_policy: 'always' }, { tare_policy: 'disabled' }])
    expect(await screen.findByRole('status')).toHaveTextContent('Couldn’t re-read this workspace’s settings just now')
    expect(screen.getByRole('switch', { name: 'Tare: turn on' })).toBeEnabled()
  })

  // B17.35 — the e2e run of 2026-10-03 opened Features while Lens restarted: the read failed, then
  // came back without the guardrail policy, and the row read "Could not be read" with no switch.
  it('opened while Lens restarts, the screen keeps reading and the injection switch appears once Lens answers', async () => {
    mockBff([], { restarting: ['502', 'no guardrails'] })
    window.history.pushState({}, '', '/features')
    render(<App />)
    const state = () => screen.getByTestId('state-Prompt-injection detection')

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([u]) => u === '/api/features')).toHaveLength(2), { timeout: 4000 })
    expect(state()).toHaveTextContent('Checking…')
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Prompt-injection detection: turn off' })).toBeChecked(), { timeout: 4000 })
    expect(state()).toHaveTextContent('On')
  }, 10_000)
})
