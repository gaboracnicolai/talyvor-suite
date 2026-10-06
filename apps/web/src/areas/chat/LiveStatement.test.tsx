import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { LIVE_STATEMENT_AGENT_KEY, LIVE_STATEMENT_POLL_MS } from './LiveStatement'

// B28.351 — an agent's statement beside the conversation, live. The BFF is mocked at the wire: the panel reads
// GET /api/agents/{id}/statement (newest first) on its own, and a line Lens adds shows without a reload. That a real
// debit on Lens shows within 5 seconds is proven by the e2e scenario chat-live-statement.

const M = 1_000_000

function mockBff() {
  const lines: Record<string, Array<Record<string, unknown>>> = {
    agt_1: [{ entry_id: 'ent_1', kind: 'fund', amount_ulxc: 5 * M, counterparty: 'workspace', balance_after_ulxc: 5 * M, at: '2026-10-06T05:00:00Z' }],
    agt_2: [{ entry_id: 'ent_9', kind: 'fund', amount_ulxc: 3 * M, counterparty: 'workspace', balance_after_ulxc: 3 * M, at: '2026-10-06T05:00:00Z' }],
  }
  const reads: string[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents') {
      const agent = (id: string, name: string) => ({ id, name, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-06T04:00:00Z' })
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 8 * M, unallocated_ulxc: 92 * M, spent_ulxc: 0, agents: [agent('agt_1', 'Researcher'), agent('agt_2', 'Writer')] })
    }
    const m = /^\/api\/agents\/(agt_\d)\/statement$/.exec(url)
    if (m !== null) {
      reads.push(m[1])
      return json({ lines: [...lines[m[1]]].reverse() })
    }
    return new Response('null', { status: 404 })
  })
  return { lines, reads }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('The live statement beside Chat (B28.351)', () => {
  it('shows a new debit within 5 seconds without a reload, marked new and linked to its row', async () => {
    expect(LIVE_STATEMENT_POLL_MS).toBeLessThan(5_000)
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const panel = await screen.findByTestId('chat-live-statement')
    expect(await within(panel).findAllByTestId('live-statement-line')).toHaveLength(1)
    expect(within(panel).getByLabelText('Agent')).toHaveValue('agt_1')
    expect(within(panel).getByTestId('live-statement-line')).toHaveTextContent(/^Funded by the workspace\+5 LXC/)
    expect(within(panel).getByTestId('live-statement-line')).not.toHaveAttribute('data-new')

    // The agent makes a call: Lens adds the debit. Nothing on the page is touched.
    const started = Date.now()
    bff.lines.agt_1.push({ entry_id: 'ent_2', kind: 'spend', amount_ulxc: -12_345, counterparty: 'claude-opus-5', balance_after_ulxc: 5 * M - 12_345, at: '2026-10-06T05:01:00Z' })
    await waitFor(() => expect(within(panel).getAllByTestId('live-statement-line')).toHaveLength(2), { timeout: 5_000 })
    expect(Date.now() - started).toBeLessThan(5_000)

    const [debit, fund] = within(panel).getAllByTestId('live-statement-line')
    expect(debit).toHaveAttribute('data-new', 'true')
    expect(debit).toHaveAttribute('href', '/agents?agent=agt_1&entry=ent_2')
    expect(debit).toHaveTextContent(/^New: Spent on a request−0\.012345 LXC/)
    expect(debit).toHaveTextContent('Balance 4.987655 LXC')
    expect(fund).not.toHaveAttribute('data-new')
    expect(within(panel).getByRole('status')).toHaveTextContent('New on Researcher’s statement: Spent on a request')
  }, 10_000)

  it('follows the agent picked, and remembers it in this browser', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const panel = await screen.findByTestId('chat-live-statement')
    await within(panel).findAllByTestId('live-statement-line')
    fireEvent.change(within(panel).getByLabelText('Agent'), { target: { value: 'agt_2' } })
    await waitFor(() => expect(within(panel).getByTestId('live-statement-line')).toHaveAttribute('data-entry', 'ent_9'))
    expect(within(panel).getByRole('link', { name: 'Writer’s whole statement' })).toHaveAttribute('href', '/agents?agent=agt_2')
    expect(window.localStorage.getItem(LIVE_STATEMENT_AGENT_KEY)).toBe('agt_2')
    expect(bff.reads).toContain('agt_2')
  })
})
