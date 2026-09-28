import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.19 — the Agent Bank's rules editor names the marketplace listings an agent may use. The mock BFF
// keeps the rules the way Lens does (internal/economy/agent_rules.go): a save replaces them, except that
// allowed_listings left null keeps the listings it holds. The walk: allow one listing and save, then
// change another rule and save — the listing stays named, and the pause switch read from Lens goes back
// as it was.

function mockBff() {
  let rules: Record<string, unknown> = {
    max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0,
    allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '',
    timezone: 'UTC', pause_on_unusual_spend: true,
  }
  const puts: Array<Record<string, unknown>> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-09-28T09:00:00Z' }],
      })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
    if (url === '/api/marketplace/listings')
      return json({
        listings: [
          { id: 'lst_fr', workspace_id: 'ws_s', kind: 'prompt', title: 'Translate to French', description: '', price_per_use_ulxc: 500_000, visibility: 'public', latest_version: 1, created_at: '', updated_at: '' },
          { id: 'lst_rv', workspace_id: 'ws_s', kind: 'agent', title: 'Code reviewer', description: '', price_per_use_ulxc: 0, visibility: 'public', latest_version: 1, created_at: '', updated_at: '' },
        ],
      })
    if (url === '/api/agents/agt_1/rules') {
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        puts.push(body)
        rules = { ...body, allowed_listings: body.allowed_listings ?? rules.allowed_listings }
      }
      return json(rules)
    }
    return new Response('null', { status: 404 })
  })
  return puts
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the rules editor names the marketplace listings an agent may use', () => {
  it('allows one listing, and saving the other rules keeps it', async () => {
    const puts = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)
    const fr = await screen.findByRole('button', { name: 'Researcher may use Translate to French' })
    expect(screen.getByText('Any listing. Mark some Allowed to allow only those.')).toBeTruthy()
    fireEvent.click(fr)
    expect(screen.getByText('Only the listings marked Allowed — Lens refuses any other.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].allowed_listings).toEqual(['lst_fr'])
    expect(puts[0].pause_on_unusual_spend).toBe(true)

    fireEvent.change(screen.getByLabelText('Daily limit for Researcher, in LXC'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1]).toMatchObject({ daily_limit_ulxc: 5_000_000, allowed_listings: ['lst_fr'], pause_on_unusual_spend: true })
    expect(screen.getByRole('button', { name: 'Researcher may use Translate to French' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Researcher may use Code reviewer' }).getAttribute('aria-pressed')).toBe('false')
  })
})
