import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.22 — the Agent Bank downloads an auditable statement for any period, per agent and for the whole
// bank: last month by default, as CSV or JSON, straight from the BFF route that relays Lens B19.5's file.

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-09-28T09:00:00Z' }],
      })
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('downloading an auditable statement (B19.22)', () => {
  it('offers last month as CSV and JSON for one agent and for the whole bank, and follows the period chosen', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-28T12:00:00Z'), toFake: ['Date'] })
    mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const agentCSV = await screen.findAllByRole('link', { name: 'Download CSV' })
    expect(agentCSV.map((a) => a.getAttribute('href'))).toEqual([
      '/api/agents/statement/download?from=2026-08-01&to=2026-09-01&format=csv',
      '/api/agents/agt_1/statement/download?from=2026-08-01&to=2026-09-01&format=csv',
    ])
    fireEvent.change(screen.getByLabelText('Researcher’s statement from'), { target: { value: '2026-07-01' } })
    const json = screen.getAllByRole('link', { name: 'JSON' }).map((a) => a.getAttribute('href'))
    expect(json).toContain('/api/agents/agt_1/statement/download?from=2026-07-01&to=2026-09-01&format=json')
    expect(agentCSV[1].hasAttribute('download')).toBe(true)
  })
})
