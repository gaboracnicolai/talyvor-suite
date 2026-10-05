import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { FIAT_KEY } from './money'

// B28.22 — the DONE line: 12.5 LXC renders with its dollar value, and the model field is a picker, not
// a text box. Also: the same amount in pounds at the ECB's rate, and the saved rules as plain sentences.

const M = 1_000_000

function mockBff() {
  const saved: Record<string, unknown>[] = []
  let rules: Record<string, unknown> = {
    max_per_request_ulxc: 0, daily_limit_ulxc: 20 * M, monthly_limit_ulxc: 0, approval_above_ulxc: 5 * M,
    allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '',
  }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 12.5 * M, unallocated_ulxc: 87.5 * M, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 12.5 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' }],
      })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 })
    if (url === '/api/fx') return json({ rate_date: '2026-10-02', usd_per_eur: 1.1672, gbp_per_eur: 0.8354 })
    if (url === '/api/models')
      return json([
        { id: 'claude-haiku-4-5', provider: 'anthropic', display_name: 'Claude Haiku 4.5', input_per_1m: 1, output_per_1m: 5 },
        { id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10 },
      ])
    if (url === '/api/agents/agt_1/rules') {
      if (init?.method === 'PUT') {
        rules = JSON.parse(String(init.body)) as Record<string, unknown>
        saved.push(rules)
      }
      return json(rules)
    }
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    return new Response('null', { status: 404 })
  })
  return { saved }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  window.localStorage.removeItem(FIAT_KEY)
  window.history.pushState({}, '', '/')
})

const balanceRow = () => screen.getByTestId('agent-balance-agt_1')

describe('amounts in your own currency and plain-English rules', () => {
  it('shows 12.5 LXC with its dollar value, and in pounds once pounds are chosen', async () => {
    mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    await waitFor(() => expect(balanceRow().textContent).toBe('12.5 LXC ($1.25)'))
    expect(within(balanceRow()).getByTestId('fiat').className).toContain('font-figure')

    fireEvent.change(screen.getByLabelText('Show amounts in'), { target: { value: 'GBP' } })
    // 1.25 USD ÷ 1.1672 USD per EUR × 0.8354 GBP per EUR = £0.8947
    await waitFor(() => expect(balanceRow().textContent).toBe('12.5 LXC (£0.89)'))
    expect(window.localStorage.getItem(FIAT_KEY)).toBe('GBP')
  })

  it('picks allowed models from the catalog instead of typing them, and states the rules as sentences', async () => {
    const { saved } = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const models = await screen.findByLabelText('Allowed models for Researcher')
    expect(models.tagName).toBe('SELECT')
    expect(screen.queryByRole('textbox', { name: /Allowed models/ })).toBeNull()
    expect(screen.getByLabelText('Allowed providers for Researcher').tagName).toBe('SELECT')
    expect(screen.getByLabelText('Time zone for Researcher').tagName).toBe('SELECT')
    expect((screen.getByLabelText('Active from for Researcher') as HTMLInputElement).type).toBe('time')

    const words = await screen.findByTestId('rules-in-words')
    await waitFor(() =>
      expect(words.textContent).toContain('Researcher may spend at most 20 LXC ($2.00) a day.'),
    )
    expect(words.textContent).toContain('A person must approve any request or payment above 5 LXC ($0.50).')
    expect(words.textContent).toContain('It may use any model from any provider.')

    await waitFor(() => expect(within(models).getByRole('option', { name: 'Claude Haiku 4.5' })).toBeTruthy())
    fireEvent.change(models, { target: { value: 'claude-haiku-4-5' } })
    expect(screen.getByRole('button', { name: 'Remove Claude Haiku 4.5 from allowed models for Researcher' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0].allowed_models).toEqual(['claude-haiku-4-5'])
    await waitFor(() => expect(words.textContent).toContain('It may use only Claude Haiku 4.5.'))
  })

  // B28.24 — the hourly and weekly caps are typed like the others, saved, and read back as one sentence.
  it('saves an hourly and a weekly cap and states them with the daily one', async () => {
    const { saved } = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    fireEvent.change(await screen.findByLabelText('Hourly limit for Researcher, in LXC'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Weekly limit for Researcher, in LXC'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ hourly_limit_ulxc: 1 * M, daily_limit_ulxc: 20 * M, weekly_limit_ulxc: 50 * M })
    const words = await screen.findByTestId('rules-in-words')
    await waitFor(() =>
      expect(words.textContent).toContain('Researcher may spend at most 1 LXC ($0.10) an hour, 20 LXC ($2.00) a day and 50 LXC ($5.00) a week.'),
    )
  })

  // B28.25 — a model is picked and given its own daily cap; the caps are saved as one map and stated.
  it('caps one model a day, saves the cap by the model, and states it', async () => {
    const { saved } = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const pick = await screen.findByLabelText('Cap a model a day for Researcher')
    expect(pick.tagName).toBe('SELECT')
    await waitFor(() => expect(within(pick).getByRole('option', { name: 'GPT-4o' })).toBeTruthy())
    fireEvent.change(pick, { target: { value: 'gpt-4o' } })
    fireEvent.change(screen.getByLabelText('Daily limit on GPT-4o for Researcher, in LXC'), { target: { value: '0.5' } })
    fireEvent.change(pick, { target: { value: 'claude-haiku-4-5' } })
    fireEvent.change(screen.getByLabelText('Daily limit on Claude Haiku 4.5 for Researcher, in LXC'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0].model_daily_limits_ulxc).toEqual({ 'gpt-4o': 0.5 * M, 'claude-haiku-4-5': 2 * M })
    const words = await screen.findByTestId('rules-in-words')
    await waitFor(() =>
      expect(words.textContent).toContain('On one model it may spend at most 0.5 LXC ($0.05) a day on GPT-4o and 2 LXC ($0.20) a day on Claude Haiku 4.5.'),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove the daily limit on GPT-4o for Researcher' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    await waitFor(() => expect(saved).toHaveLength(2))
    expect(saved[1].model_daily_limits_ulxc).toEqual({ 'claude-haiku-4-5': 2 * M })
  })
})
