import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { parseRule } from './RuleCommand'

// B28.352 — an agent's rule set in plain words in Chat: the sentence opens a card, read as typed, and Save puts the
// agent's rules back with that one limit changed. The BFF is mocked at the wire; that Lens then refuses an over-limit
// call is proven against Lens by the e2e scenario chat-plain-rule.

const M = 1_000_000

function mockBff() {
  const saved: Array<Record<string, unknown>> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') {
      return json([
        { id: 'claude-opus-4-1', provider: 'anthropic', display_name: 'Claude Opus 4.1', input_per_1m: 15, output_per_1m: 75, tier: 'frontier', release_date: '2025-08-05' },
        { id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier', release_date: '2026-06-01' },
        { id: 'claude-haiku-4-5', provider: 'anthropic', display_name: 'Claude Haiku 4.5', input_per_1m: 1, output_per_1m: 5, tier: 'fast', release_date: '2025-10-01' },
      ])
    }
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents' && method === 'GET') {
      const agents = [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-06T05:00:00Z' }]
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 90 * M, spent_ulxc: 0, agents })
    }
    if (url === '/api/agents/agt_1/rules' && method === 'GET') {
      return json({
        max_per_request_ulxc: M,
        daily_limit_ulxc: 8 * M,
        monthly_limit_ulxc: 100 * M,
        approval_above_ulxc: 2 * M,
        model_daily_limits_ulxc: { 'claude-opus-5': 2 * M, 'claude-haiku-4-5': M },
        allowed_models: [],
        allowed_providers: [],
        active_from: '',
        active_until: '',
        timezone: 'UTC',
      })
    }
    if (url === '/api/agents/agt_1/rules' && method === 'PUT') {
      saved.push(body)
      return json(body)
    }
    return new Response('null', { status: 404 })
  })
  return { saved }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('Set an agent’s rule in plain words from Chat (B28.352)', () => {
  it('reads the agent, the amount, how often and the model; a sentence without LXC is a question', () => {
    expect(parseRule('Cap agent A at 5 LXC a day on Opus')).toEqual({ agent: 'A', amount: '5', period: 'day', model: 'Opus' })
    expect(parseRule('limit “Support bot” to 0.5 LXC per hour.')).toEqual({ agent: 'Support bot', amount: '0.5', period: 'hour', model: '' })
    expect(parseRule('Limit caffeine to 3 a day')).toBeNull()
  })

  it('saves the one limit the sentence names and keeps every other rule', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const box = await screen.findByRole('textbox', { name: /message/i })
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.change(box, { target: { value: 'Cap agent researcher at 5 LXC a day on Opus' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    const card = await screen.findByTestId('chat-rule')
    expect(box).toHaveValue('')
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0) // nothing went to the model
    await waitFor(() => expect(within(card).getByLabelText('Agent')).toHaveValue('agt_1'))
    expect(within(card).getByLabelText('At most, in LXC')).toHaveValue('5')
    expect(within(card).getByLabelText('How often')).toHaveValue('day')
    await waitFor(() => expect(within(card).getByLabelText('On which model')).toHaveValue('claude-opus-5')) // the newest Opus
    expect(await within(card).findByText('It is', { exact: false })).toHaveTextContent('It is 2 LXC now.')
    expect(within(card).getByTestId('chat-rule-change')).toHaveTextContent(/^Researcher may spend at most 5 LXC a day on Claude Opus 5\./)

    fireEvent.click(within(card).getByRole('button', { name: 'Save the rule' }))
    const done = await within(card).findByTestId('chat-rule-saved')
    expect(done).toHaveTextContent(/^Saved: Researcher may spend at most 5 LXC a day on Claude Opus 5\. Lens refuses a call that would take it past that\. See its rules on Agent Wallets$/)
    expect(within(done).getByRole('link')).toHaveAttribute('href', '/agents?agent=agt_1')
    expect(bff.saved).toEqual([
      {
        max_per_request_ulxc: M,
        daily_limit_ulxc: 8 * M,
        monthly_limit_ulxc: 100 * M,
        approval_above_ulxc: 2 * M,
        model_daily_limits_ulxc: { 'claude-haiku-4-5': M, 'claude-opus-5': 5 * M },
        allowed_models: [],
        allowed_providers: [],
        active_from: '',
        active_until: '',
        timezone: 'UTC',
      },
    ])
  })
})
