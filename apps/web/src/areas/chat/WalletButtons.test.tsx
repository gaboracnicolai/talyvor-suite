import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.87 — fund, withdraw, pause and pause-all from Chat, each asked once more before anything is sent. The BFF is
// mocked at the wire: nothing is posted until the question is answered Yes. That the next agent call is refused after
// Pause all is proven against Lens by the e2e scenario chat-wallet-buttons.

const M = 1_000_000

function mockBff() {
  const state = { balance: 5 * M, free: 92 * M, paused: false, allPaused: false }
  const posts: Array<{ path: string; body: unknown; key: string | null }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/agt_1/statement') return json({ lines: [] })
    if (init?.method === 'POST') {
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      posts.push({ path: url, body, key: new Headers(init.headers).get('Idempotency-Key') })
      const amount = (body as { amount_ulxc?: number } | undefined)?.amount_ulxc ?? 0
      if (url === '/api/agents/agt_1/fund') return (state.balance += amount), (state.free -= amount), json({ balance_ulxc: state.balance })
      if (url === '/api/agents/agt_1/withdraw') return (state.balance -= amount), (state.free += amount), json({ balance_ulxc: state.balance })
      if (url === '/api/agents/agt_1/pause') return (state.paused = true), json({ paused: true })
      if (url === '/api/agents/agt_1/resume') return (state.paused = false), json({ paused: false })
      if (url === '/api/agents/pause-all') return (state.allPaused = true), json({ all_paused: true })
      if (url === '/api/agents/resume-all') return (state.allPaused = false), json({ all_paused: false })
    }
    if (url === '/api/agents') {
      return json({
        workspace_balance_ulxc: 100 * M,
        allocated_ulxc: state.balance,
        unallocated_ulxc: state.free,
        spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: state.balance, spent_ulxc: 0, keys: [], created_at: '2026-10-06T04:00:00Z', ...(state.paused ? { paused_at: '2026-10-06T05:00:00Z', paused_reason: 'paused from Chat' } : {}) }],
        ...(state.allPaused ? { all_paused_at: '2026-10-06T05:00:00Z', all_paused_reason: 'paused from Chat' } : {}),
      })
    }
    return new Response('null', { status: 404 })
  })
  return { state, posts }
}

async function openPanel() {
  window.history.pushState({}, '', '/chat')
  render(<App />)
  return within(await screen.findByTestId('chat-wallet-buttons'))
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('The wallet buttons beside Chat (B28.87)', () => {
  it('funds and withdraws only once the question is answered Yes, under one Idempotency-Key each', async () => {
    const bff = mockBff()
    const panel = await openPanel()

    fireEvent.change(panel.getByLabelText('Amount in LXC for Researcher'), { target: { value: '2.5' } })
    fireEvent.click(panel.getByRole('button', { name: 'Fund' }))
    expect(panel.getByRole('group', { name: 'Confirm' })).toHaveTextContent('Move 2.5 LXC from the workspace into Researcher’s wallet?')
    fireEvent.click(panel.getByRole('button', { name: 'Cancel' }))
    expect(panel.queryByRole('group', { name: 'Confirm' })).toBeNull()
    expect(bff.posts).toEqual([])

    fireEvent.click(panel.getByRole('button', { name: 'Fund' }))
    fireEvent.click(panel.getByRole('button', { name: 'Yes, fund' }))
    expect(await panel.findByRole('status')).toHaveTextContent('Researcher now holds 7.5 LXC.')

    fireEvent.change(panel.getByLabelText('Amount in LXC for Researcher'), { target: { value: '1' } })
    fireEvent.click(panel.getByRole('button', { name: 'Withdraw' }))
    expect(panel.getByRole('group', { name: 'Confirm' })).toHaveTextContent('Take 1 LXC out of Researcher’s wallet, back to the workspace?')
    fireEvent.click(panel.getByRole('button', { name: 'Yes, withdraw' }))
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent('Researcher now holds 6.5 LXC.'))

    expect(bff.posts.map((p) => [p.path, p.body])).toEqual([
      ['/api/agents/agt_1/fund', { amount_ulxc: 2_500_000 }],
      ['/api/agents/agt_1/withdraw', { amount_ulxc: 1_000_000 }],
    ])
    expect(bff.posts[0].key).toBeTruthy()
    expect(bff.posts[1].key).toBeTruthy()
    expect(bff.posts[0].key).not.toBe(bff.posts[1].key)
  })

  it('pauses the agent and then every agent only once each is answered Yes, and says so', async () => {
    const bff = mockBff()
    const panel = await openPanel()

    fireEvent.click(panel.getByRole('button', { name: 'Pause Researcher' }))
    expect(panel.getByRole('group', { name: 'Confirm' })).toHaveTextContent('Pause Researcher? Lens refuses its next request or payment until you resume it.')
    expect(bff.posts).toEqual([])
    fireEvent.click(panel.getByRole('button', { name: 'Yes, pause Researcher' }))
    expect(await panel.findByTestId('chat-agent-paused')).toHaveTextContent('Researcher is paused — paused from Chat.')
    expect(panel.getByRole('button', { name: 'Resume Researcher' })).toBeInTheDocument()

    fireEvent.click(panel.getByRole('button', { name: 'Pause all' }))
    expect(panel.getByRole('group', { name: 'Confirm' })).toHaveTextContent('Pause every agent?')
    expect(bff.posts).toHaveLength(1)
    fireEvent.click(panel.getByRole('button', { name: 'Yes, pause all' }))
    expect(await panel.findByTestId('chat-all-paused')).toHaveTextContent('Every agent is paused — paused from Chat.')
    expect(panel.getByRole('button', { name: 'Start all again' })).toBeInTheDocument()

    expect(bff.posts.map((p) => [p.path, p.body])).toEqual([
      ['/api/agents/agt_1/pause', { reason: 'paused from Chat' }],
      ['/api/agents/pause-all', { reason: 'paused from Chat' }],
    ])
  })
})
