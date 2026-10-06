import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { ALERT_POLL_MS, DISMISSED_ALERTS_KEY } from './AlertNotices'

// B28.91 — the wallets' alerts in Chat: unusual spend as Lens raised it, an agent that has run out, an agent at or
// near its monthly limit. The notices are read from the same Lens routes Agent Wallets reads; the e2e scenario
// chat-wallet-alerts proves one raised by a real payment appears in Chat within ten seconds.

const M = 1_000_000

function mockBff() {
  const now = new Date().toISOString()
  const state = {
    agents: [
      { id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-01T04:00:00Z' },
      { id: 'agt_2', name: 'Writer', balance_ulxc: 4 * M, spent_ulxc: 6 * M, keys: [], created_at: '2026-10-01T04:00:00Z', paused_at: now, paused_reason: 'unusual spend' },
      { id: 'agt_3', name: 'Coder', balance_ulxc: 5 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-01T04:00:00Z' },
    ],
    forecast: [
      { agent_id: 'agt_1', name: 'Researcher', spent_ulxc: 0, forecast_ulxc: 0 },
      { agent_id: 'agt_2', name: 'Writer', spent_ulxc: 6 * M, forecast_ulxc: 30 * M },
      { agent_id: 'agt_3', name: 'Coder', spent_ulxc: 2 * M, forecast_ulxc: 9 * M },
    ],
    alerts: [{ id: 'alr_1', agent_id: 'agt_2', last_hour_ulxc: 6 * M, usual_per_hour_ulxc: M / 2, paused: true, created_at: now }],
    rules: { agt_1: 0, agt_2: 0, agt_3: 8 * M } as Record<string, number>,
  }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') {
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 19 * M, unallocated_ulxc: 81 * M, spent_ulxc: 6 * M, agents: state.agents })
    }
    if (url === '/api/agents/alerts') return json({ alerts: state.alerts, rule: 'An alert is raised …' })
    if (url.startsWith('/api/agents/forecast')) {
      const sum = (k: 'spent_ulxc' | 'forecast_ulxc') => state.forecast.reduce((t, f) => t + f[k], 0)
      return json({ at: now, month_start: '2026-10-01T00:00:00Z', month_end: '2026-11-01T00:00:00Z', spent_ulxc: sum('spent_ulxc'), forecast_ulxc: sum('forecast_ulxc'), agents: state.forecast })
    }
    const rules = /^\/api\/agents\/([^/]+)\/rules$/.exec(url)
    if (rules) {
      return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: state.rules[rules[1]], approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], active_from: '', active_until: '', timezone: 'UTC' })
    }
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (/^\/api\/agents\/[^/]+\/statement$/.test(url)) return json({ lines: [] })
    return new Response('null', { status: 404 })
  })
  return state
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
  window.localStorage.clear()
  window.history.pushState({}, '', '/chat')
})

const texts = () => screen.queryAllByTestId('chat-alert').map((c) => within(c).getByTestId('chat-alert-text').textContent)

describe('Chat wallet alerts (B28.91)', () => {
  it('shows unusual spend, and an agent near its monthly limit, each linked to the agent', async () => {
    mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const unusual = await screen.findByText(/^Writer spent/)
    expect(unusual).toHaveTextContent(/^Writer spent 6 LXC.* in an hour; it usually spends 0\.5 LXC.* an hour\. Lens paused it, so it spends nothing until you resume it\.$/)
    const near = await screen.findByText(/^Coder is on course/)
    expect(near).toHaveTextContent(/^Coder is on course for its 8 LXC.* monthly limit: 2 LXC.* spent so far, and 9 LXC.* by the month’s end at this pace\.$/)
    const card = near.closest('[data-testid="chat-alert"]') as HTMLElement
    expect(within(card).getByRole('link', { name: 'Coder’s rules' })).toHaveAttribute('href', '/agents?agent=agt_3')
    // Researcher has spent nothing this month and holds 10 LXC: nothing to say about it.
    expect(texts().some((t) => t?.startsWith('Researcher'))).toBe(false)
  })

  it('an agent that runs out while Chat is open is on screen at the next read, inside ten seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByText(/^Writer spent/)
    expect(texts().some((t) => t?.startsWith('Researcher'))).toBe(false)

    // Researcher spends all it held: Lens's book and forecast say so on their next read.
    state.agents[0] = { ...state.agents[0], balance_ulxc: 0, spent_ulxc: 10 * M }
    state.forecast[0] = { ...state.forecast[0], spent_ulxc: 10 * M, forecast_ulxc: 50 * M }
    await act(() => vi.advanceTimersByTimeAsync(ALERT_POLL_MS))

    expect(await screen.findByText(/^Researcher has run out/)).toHaveTextContent(
      'Researcher has run out: it holds nothing, so Lens refuses its next request or payment until it is funded.',
    )
    expect(ALERT_POLL_MS).toBeLessThan(10_000)
  })

  it('Dismiss puts a notice away in this browser until what it says changes', async () => {
    const state = mockBff()
    window.history.pushState({}, '', '/chat')
    const first = render(<App />)
    const near = await screen.findByText(/^Coder is on course/)
    fireEvent.click(within(near.closest('[data-testid="chat-alert"]') as HTMLElement).getByRole('button', { name: 'Dismiss: Near its limit for Coder' }))
    expect(screen.queryByText(/^Coder is on course/)).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(DISMISSED_ALERTS_KEY) ?? '[]')).toEqual(['limit:agt_3:2026-10-01T00:00:00Z:8000000:near'])

    // Once Coder reaches the limit, that is news, and it is back.
    first.unmount()
    queryClient.clear()
    state.forecast[2] = { ...state.forecast[2], spent_ulxc: 8 * M, forecast_ulxc: 30 * M }
    render(<App />)
    await waitFor(() =>
      expect(texts()).toContain('Coder has reached its 8 LXC monthly limit: it has spent 8 LXC this month, and Lens refuses anything more until the month ends.'),
    )
  })
})
