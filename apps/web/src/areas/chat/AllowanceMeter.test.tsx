import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { CHARGE_FRAME } from './chatStream'

// B28.104 — the plan's allowance used and the prepaid balance, under the box in Chat. The BFF is mocked at the wire:
// once the answer is streamed, Lens's /api/billing/allowance (or, without a plan, /api/lxc/balance) reads 1620 µLXC
// lower — the charge — and the meter shows that read. That the drop is the answer's ledger row on a real deployment
// is the e2e scenario chat-meter.

const CHARGE = 1620
const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
const answer = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 12, output_tokens: 1 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Paris.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
  { type: CHARGE_FRAME, charged_ulxc: CHARGE },
  { type: 'message_stop' },
)

const period = (consumed: number) => ({
  period_start: '2026-10-01T00:00:00Z',
  period_end: '2026-11-01T00:00:00Z',
  granted_ulxc: 200_000_000,
  consumed_ulxc: consumed,
  remaining_ulxc: 200_000_000 - consumed,
  fee_usd_cents: 2000,
})

/** The BFF, with a plan or without: the allowance — or else the balance — is drawn by the charge once answered. */
function mockBff(subscribed: boolean) {
  let answered = false
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const drawn = answered ? CHARGE : 0
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    if (url === '/api/billing/allowance') {
      const allowance = subscribed ? period(50_000_000 + drawn) : null
      return json({ capability: 'subscriptions', enabled: true, data: { allowance, earned_ulens: 0, earned_held_ulens: 0, earned_usd_cents: 0, earned_back_usd_cents: 0 } })
    }
    if (url === '/api/lxc/balance') {
      const balance = 4_250_000 - (subscribed ? 0 : drawn)
      return json({ workspace_id: 'ws-1', balance_ulxc: balance, lifetime_minted_ulxc: 10_000_000, lifetime_spent_ulxc: 10_000_000 - balance, usd_value_uusd: balance / 10 })
    }
    if (url === '/api/ai/stream/anthropic/v1/messages') {
      answered = true
      return new Response(answer, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response('null', { status: 404 })
  })
}

async function ask() {
  window.history.pushState({}, '', '/chat')
  render(<App />)
  await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
  await screen.findByTestId('prepaid-balance')
}

function send() {
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), { target: { value: 'The capital of France?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('the allowance and balance meter in Chat (B28.104)', () => {
  it('shows the plan used and left, and the left drops by the charge, as /api/billing/allowance reads', async () => {
    mockBff(true)
    await ask()
    const meter = screen.getByTestId('allowance-meter')
    expect(meter.textContent).toBe('Plan 25% used · 150 LXC left Prepaid balance 4.25 LXC')
    expect(screen.getByRole('progressbar', { name: 'Plan allowance used this month' }).getAttribute('aria-valuenow')).toBe('25')

    send()
    await waitFor(() => expect(screen.getByTestId('allowance-left').textContent).toBe('149.99838 LXC'))
    expect(screen.getByTestId('prepaid-balance').textContent).toBe('4.25 LXC')
  })

  it('without a plan shows the prepaid balance alone, and it drops by the charge', async () => {
    mockBff(false)
    await ask()
    expect(screen.getByTestId('allowance-meter').textContent).toBe('Prepaid balance 4.25 LXC')
    expect(screen.queryByTestId('allowance-left')).toBeNull()

    send()
    await waitFor(() => expect(screen.getByTestId('prepaid-balance').textContent).toBe('4.24838 LXC'))
  })
})
