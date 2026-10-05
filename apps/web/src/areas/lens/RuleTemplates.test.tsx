import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { RULE_TEMPLATES } from './ruleTemplates'

// B28.305 — rule templates: a new agent created from one has the template saved as its rules in the same
// click, and an agent's Rules card filled from one saves exactly the template — every list, cap and window
// it held before replaced, not merged.

const M = 1_000_000
const template = (id: string) => RULE_TEMPLATES.find((t) => t.id === id)!.rules

function mockBff(existing?: { name: string; rules: Record<string, unknown> }) {
  const agents: Array<{ id: string; name: string; balance_ulxc: number; spent_ulxc: number; keys: string[]; created_at: string }> = []
  const rules: Record<string, Record<string, unknown>> = {}
  const calls: string[] = []
  const saved: Record<string, unknown>[] = []
  if (existing) {
    agents.push({ id: 'agt_1', name: existing.name, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' })
    rules.agt_1 = existing.rules
  }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents' && method === 'GET')
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 0, unallocated_ulxc: 100 * M, spent_ulxc: 0, agents })
    if (url === '/api/agents' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { name: string }
      const a = { id: `agt_${agents.length + 1}`, name: body.name, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-05T06:00:00Z' }
      agents.push(a)
      calls.push(`POST /api/agents ${a.name}`)
      return json(a, 201)
    }
    if (url === '/api/models')
      return json([{ id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10 }])
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    const m = /^\/api\/agents\/([^/]+)\/rules$/.exec(url)
    if (m) {
      if (method === 'PUT') {
        rules[m[1]] = JSON.parse(String(init?.body)) as Record<string, unknown>
        saved.push(rules[m[1]])
        calls.push(`PUT ${url}`)
      }
      return json(rules[m[1]] ?? { max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], active_from: '', active_until: '', timezone: 'UTC' })
    }
    return new Response('null', { status: 404 })
  })
  return { calls, saved }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  window.history.pushState({}, '', '/')
})

describe('rule templates', () => {
  it('creates a new agent from the Support bot template in one click: its rules are saved as the template', async () => {
    const { calls, saved } = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const start = await screen.findByRole('group', { name: 'Rules to start from' })
    fireEvent.click(within(start).getByRole('button', { name: 'Support bot' }))
    expect(within(start).getByRole('button', { name: 'Support bot' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByLabelText('New agent name'), { target: { value: 'Helpdesk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    await waitFor(() => expect(screen.getByTestId('agent-open')).toHaveTextContent('Helpdesk'))
    expect(calls).toEqual(['POST /api/agents Helpdesk', 'PUT /api/agents/agt_1/rules'])
    expect(saved[0]).toEqual(template('support-bot'))
    expect(await screen.findByLabelText('Limit per request for Helpdesk, in LXC')).toHaveValue('0.5')
    expect(screen.getByLabelText('Hourly limit for Helpdesk, in LXC')).toHaveValue('20')
  })

  it('fills an agent’s Rules card from the Coder template and saves exactly the template, replacing what it held', async () => {
    const { saved } = mockBff({
      name: 'Builder',
      rules: {
        max_per_request_ulxc: 1 * M, hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 9 * M, monthly_limit_ulxc: 0,
        approval_above_ulxc: 0, model_daily_limits_ulxc: { 'gpt-4o': 2 * M }, allowed_models: ['gpt-4o'], allowed_providers: ['openai'],
        allowed_listings: ['lst_1'], active_from: '09:00', active_until: '17:00', timezone: 'Europe/London', pause_on_unusual_spend: false,
      },
    })
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const templates = await screen.findByRole('group', { name: 'Rule templates for Builder' })
    fireEvent.click(within(templates).getByRole('button', { name: 'Coder' }))
    expect(screen.getByLabelText('Weekly limit for Builder, in LXC')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))

    await screen.findByText(/Saved\. Lens applies these rules/)
    expect(saved).toEqual([template('coder')])
  })
})
