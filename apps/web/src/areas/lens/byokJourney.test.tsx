import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Plans } from './Plans'
import { BillingSuccess } from './BillingReturn'
import { Settings } from './Sharing'
import { Features } from './Features'
import { Chat } from '../chat/Chat'

// B27.27 — BYOK in the app, from the screens alone. B32.14 — BYOK is Team's add-on (Lens B32.10): a test user
// chooses Team on Plans, Stripe returns them, they add BYOK to Team, add their OpenAI key in Settings, and Chat
// answers on it. Behind the BFF is one stateful fake — Stripe
// (the checkout, then the webhook Lens records), Lens's provider-key store and the provider the answer is
// sent to — and what is asserted is what it ended up holding: the subscription, the stored key, and the key
// the question was actually sent upstream on. Never a status code.

const KEY = 'sk-proj-test-0123456789wxyz'
const CHECKOUT = 'https://checkout.stripe.com/c/pay/cs_test_team'

/** The price card GET /api/pricing serves: figures for this test, never Nicolai's. */
const GATE = { live_money: true, slack_teams_approvals: true, sso: false, audit_export: false, edge: false }
const PRICING = {
  min_usd_cents: 1000,
  max_usd_cents: 1_000_000,
  preset_usd_cents: [1000],
  company_plans: [
    { id: 'team', usd_cents: 4400 },
    { id: 'business', usd_cents: 28800 },
  ],
  byok_add_on_usd_cents: 18800,
  plan_gates: {
    order: ['free', 'team', 'business', 'enterprise'],
    plans: {
      free: { ...GATE, agents: 3, seats: 1, own_provider_keys: 'none', live_money: false },
      team: { ...GATE, agents: 25, seats: 5, own_provider_keys: 'add_on' },
      business: { ...GATE, agents: -1, seats: 25, own_provider_keys: 'included' },
      enterprise: { ...GATE, agents: -1, seats: -1, own_provider_keys: 'included' },
    },
  },
}

function fakeTalyvor() {
  const state = {
    /** The plan Stripe's webhook recorded, and whether the subscription carries the BYOK add-on. */
    team: false,
    byok: false,
    subscribedTo: '' as string,
    keys: new Map<string, { key: string; last4: string; updated_at: string }>(),
    /** The provider key each question went upstream on: '' is Talyvor's own, charged. */
    sentOn: [] as string[],
  }
  const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'byok-user', email: 'byok@example.com' }, cache_poolable: true })
    if (url === '/api/billing/allowance')
      return json({ capability: 'subscriptions', enabled: true, data: { allowance: null, earned_ulens: 0, earned_held_ulens: 0, earned_usd_cents: 0, earned_back_usd_cents: 0 } })
    const live = () => ({ subscribed: true, status: 'active', current_period_end: '2026-11-04T00:00:00Z', cancel_at_period_end: false, livemode: false, plan: 'team', byok: state.byok })
    if (url === '/api/pricing') return json(PRICING)
    if (url === '/api/billing/subscription')
      return json({
        capability: 'subscriptions',
        enabled: true,
        data: state.team ? live() : { subscribed: false, cancel_at_period_end: false, livemode: false },
      })
    if (url === '/api/billing/subscription/byok' && method === 'POST') {
      // Lens B32.10: the add-on goes on a live Team subscription only.
      if (!state.team) return json({ error: "billing: the BYOK add-on is Team's" }, 409)
      state.byok = true
      return json(live())
    }
    if (url === '/api/billing/subscribe' && method === 'POST') {
      state.subscribedTo = JSON.parse(String(init?.body)).plan
      return json({ url: CHECKOUT })
    }
    if (url === '/api/provider-keys')
      return json({
        capability: 'provider_keys',
        enabled: true,
        data: {
          byok: state.byok,
          providers: ['anthropic', 'google', 'groq', 'mistral', 'openai'],
          keys: [...state.keys].map(([provider, k]) => ({ provider, last4: k.last4, updated_at: k.updated_at })),
        },
      })
    const put = url.match(/^\/api\/provider-keys\/(\w+)$/)
    if (put && method === 'PUT') {
      if (!state.byok) return json({ error: 'byok: subscribe to the BYOK plan to use your own provider keys' }, 402)
      const key = JSON.parse(String(init?.body)).key as string
      const stored = { key, last4: key.slice(-4), updated_at: '2026-10-04T10:00:00Z' }
      state.keys.set(put[1], stored)
      return json({ provider: put[1], last4: stored.last4, updated_at: stored.updated_at })
    }
    if (url === '/api/models')
      return json([{ id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10, release_date: '2024-05-13', tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url.startsWith('/api/ai/stream/')) {
      // Lens (B27.26): a BYOK workspace holding a key for the provider is served on that key, uncharged.
      const provider = url.split('/')[4]
      const own = state.byok ? (state.keys.get(provider)?.key ?? '') : ''
      state.sentOn.push(own)
      return new Response(
        'data: {"model":"gpt-4o","choices":[{"delta":{"content":"Paris."}}]}\n\n' +
          'data: {"model":"gpt-4o","choices":[],"usage":{"prompt_tokens":2000,"completion_tokens":1000}}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream', ...(own ? { 'X-Talyvor-BYOK': 'own-key' } : {}) } },
      )
    }
    return json(null, 404)
  })
  return state
}

/** Moves the app to another screen, as the nav or the browser's address bar would. */
let go: (to: string) => void = () => {}
function Navigator() {
  go = useNavigate()
  return null
}

function renderAt(path: string, routes: Record<string, React.ReactElement>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Navigator />
        <Routes>
          {Object.entries(routes).map(([p, el]) => (
            <Route key={p} path={p} element={el} />
          ))}
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe('BYOK in the app (B27.27)', () => {
  it('a test user subscribes to BYOK, adds a key and gets an answer on it, all from the screens', async () => {
    const talyvor = fakeTalyvor()
    const toStripe = vi.fn()
    renderAt('/plans', {
      '/plans': <Plans redirect={toStripe} />,
      '/billing/success': <BillingSuccess pollIntervalMs={20} timeoutMs={5000} />,
      '/settings': <Settings />,
      '/features': <Features />,
      '/chat': <Chat />,
    })

    // Plans: Team at the served price, chosen.
    const team = await screen.findByTestId('company-plan-team')
    expect(within(team).getByTestId('price-team').textContent).toBe('$44')
    fireEvent.click(within(team).getByRole('button', { name: 'Choose Team' }))
    await waitFor(() => expect(toStripe).toHaveBeenCalledWith(CHECKOUT))
    expect(talyvor.subscribedTo).toBe('team')

    // Stripe takes test card 4242, its webhook reaches Lens, and the browser comes back.
    talyvor.team = true
    act(() => go('/billing/success?session_id=cs_test_team'))
    expect(await screen.findByRole('heading', { name: 'You’re on Team.' })).toBeInTheDocument()

    // Plans again: BYOK, Team's add-on, at the served price — added to the live Team subscription.
    act(() => go('/plans'))
    const card = (await screen.findByText('BYOK — Team’s add-on')).closest('section')!
    expect(card.textContent).toContain('$188')
    expect(card.textContent).toContain('No Talyvor token charge on a request sent on your key')
    fireEvent.click(await within(card).findByRole('button', { name: 'Add BYOK to Team' }))
    expect(await within(card).findByText('On your Team plan.')).toBeInTheDocument()
    expect(talyvor.byok).toBe(true)

    // Settings: the OpenAI key goes in once; afterwards only its last four are on the page.
    act(() => go('/settings'))
    fireEvent.click(await screen.findByRole('button', { name: 'Add OpenAI key' }))
    fireEvent.change(screen.getByLabelText('OpenAI API key'), { target: { value: KEY } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect((await screen.findByTestId('provider-key-openai')).textContent).toContain('•••• wxyz')
    expect(talyvor.keys.get('openai')?.key).toBe(KEY)
    expect(document.body.innerHTML).not.toContain(KEY)
    expect(screen.getByRole('button', { name: 'Replace OpenAI key' })).toBeInTheDocument()

    // Features explains BYOK and sees the key.
    act(() => go('/features'))
    expect((await screen.findByTestId('state-Bring your own keys (BYOK)')).textContent).toBe('On — requests to OpenAI go on your keys')

    // Chat: the question goes upstream on the user's own key, and the answer says so — no token price.
    act(() => go('/chat'))
    const box = await screen.findByPlaceholderText('Ask anything')
    await screen.findByRole('button', { name: 'Model: GPT-4o' })
    fireEvent.change(box, { target: { value: 'Capital of France?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByTestId('turn-assistant').textContent).toContain('Paris.'))
    expect(talyvor.sentOn).toEqual([KEY])
    expect((await screen.findByTestId('turn-cost')).textContent).toBe('on your own key · no tokens charged')
  })

  it('a workspace not on BYOK is offered the plan in Settings, never a key field', async () => {
    fakeTalyvor()
    renderAt('/settings', { '/settings': <Settings /> })
    expect((await screen.findByTestId('provider-keys-plan')).textContent).toBe('Your own keys come with BYOK — Team’s add-on, included in Business. See Plans.')
    expect(screen.queryByRole('button', { name: /^Add .* key$/ })).toBeNull()
  })
})
