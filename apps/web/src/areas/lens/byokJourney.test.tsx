import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Plans } from './Plans'
import { BillingSuccess } from './BillingReturn'
import { Settings } from './Sharing'
import { Features } from './Features'
import { Chat } from '../chat/Chat'

// B27.27 — BYOK in the app, from the screens alone: a test user chooses BYOK on Plans, Stripe returns them,
// they add their OpenAI key in Settings, and Chat answers on it. Behind the BFF is one stateful fake — Stripe
// (the checkout, then the webhook Lens records), Lens's provider-key store and the provider the answer is
// sent to — and what is asserted is what it ended up holding: the subscription, the stored key, and the key
// the question was actually sent upstream on. Never a status code.

const KEY = 'sk-proj-test-0123456789wxyz'
const CHECKOUT = 'https://checkout.stripe.com/c/pay/cs_test_byok'

function fakeTalyvor() {
  const state = {
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
    if (url === '/api/billing/subscription')
      return json({
        capability: 'subscriptions',
        enabled: true,
        data: state.byok
          ? { subscribed: true, status: 'active', current_period_end: '2026-11-04T00:00:00Z', cancel_at_period_end: false, livemode: false, byok: true }
          : { subscribed: false, cancel_at_period_end: false, livemode: false },
      })
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

    // Plans: BYOK at $199 a month, with what it includes.
    const card = (await screen.findByText('BYOK — bring your own keys')).closest('section')!
    expect(card.textContent).toContain('$199')
    expect(card.textContent).toContain('No Talyvor token charge on a request sent on your key')
    fireEvent.click(await within(card).findByRole('button', { name: 'Choose BYOK' }))
    await waitFor(() => expect(toStripe).toHaveBeenCalledWith(CHECKOUT))
    expect(talyvor.subscribedTo).toBe('byok')

    // Stripe takes test card 4242, its webhook reaches Lens, and the browser comes back.
    talyvor.byok = true
    act(() => go('/billing/success'))
    expect(await screen.findByRole('heading', { name: 'You’re on BYOK.' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Add your provider keys' }))

    // Settings: the OpenAI key goes in once; afterwards only its last four are on the page.
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
    expect((await screen.findByTestId('provider-keys-plan')).textContent).toBe('Your own keys come with BYOK, $199 a month. See Plans.')
    expect(screen.queryByRole('button', { name: /^Add .* key$/ })).toBeNull()
  })
})
