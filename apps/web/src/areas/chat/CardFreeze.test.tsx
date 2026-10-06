import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { parseFreeze } from './CardFreeze'

// B28.360 — `/freeze Researcher` typed in Chat freezes the agent's card: the BFF relays it to Lens's card freeze
// (apps/bff/agent_bank.go, agent_bank_test.go), and the card says every purchase on it is refused; `/unfreeze`
// lets them through again. The BFF is mocked at the wire; that Lens refuses a purchase on the frozen card, and
// nothing leaves the wallet, is proven against Lens by e2e chat-card-freeze.

const M = 1_000_000

function mockBff(opts: { frozen?: boolean; noCard?: boolean } = {}) {
  const sent: string[] = []
  let frozen = opts.frozen ?? false
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const card = () => ({ id: 'ic_1', agent_id: 'agt_1', last4: '4242', exp_month: 12, exp_year: 2029, currency: 'gbp', livemode: false, created_at: '2026-10-06T05:00:00Z', frozen })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/wallets/capabilities') return json({ capabilities: [{ capability: 'agent_card', name: 'Agent cards', class: 'RED', real_money: false }] })
    if (url === '/api/agents' && method === 'GET') {
      const agents = [
        { id: 'agt_1', name: 'Researcher', balance_ulxc: 2 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-06T05:00:00Z' },
        { id: 'agt_2', name: 'Writer', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-06T05:00:00Z' },
      ]
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 2 * M, unallocated_ulxc: 98 * M, spent_ulxc: 0, agents })
    }
    if (url === '/api/agents/agt_1/card' && method === 'GET') {
      return opts.noCard ? json({ error: 'economy: the agent has no card' }, 404) : json({ card: card(), authorizations: [] })
    }
    if (url === '/api/agents/agt_1/card/freeze' || url === '/api/agents/agt_1/card/unfreeze') {
      sent.push(`${method} ${url}`)
      frozen = url.endsWith('/freeze')
      return json(card())
    }
    return new Response('null', { status: 404 })
  })
  return { sent }
}

async function typeInChat(command: string) {
  window.history.pushState({}, '', '/chat')
  render(<App />)
  const box = await screen.findByRole('textbox', { name: /message/i })
  await waitFor(() => expect(box).not.toBeDisabled())
  fireEvent.change(box, { target: { value: command } })
  fireEvent.keyDown(box, { key: 'Enter' })
  const card = await screen.findByTestId('chat-card-freeze')
  expect(box).toHaveValue('')
  expect(screen.queryAllByTestId('turn-user')).toHaveLength(0) // nothing went to the model
  return card
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('Freeze or unfreeze an agent’s card from Chat (B28.360)', () => {
  it('reads whether to freeze and the agent named', () => {
    expect(parseFreeze('/freeze Researcher')).toEqual({ freeze: true, agent: 'Researcher' })
    expect(parseFreeze('/unfreeze Researcher’s card')).toEqual({ freeze: false, agent: 'Researcher' })
    expect(parseFreeze('/freeze')).toEqual({ freeze: true, agent: '' })
  })

  it('freezes the agent’s card and says every purchase on it is refused', async () => {
    const bff = mockBff()
    const card = await typeInChat('/freeze Researcher')
    await waitFor(() => expect(within(card).getByLabelText('Agent')).toHaveValue('agt_1'))
    expect(await within(card).findByTestId('chat-card-freeze-state')).toHaveTextContent('Researcher’s card •••• 4242 takes purchases now')
    expect(within(card).getByText('Preview — test money only')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Freeze Researcher’s card' }))
    expect(await within(card).findByTestId('chat-card-freeze-done')).toHaveTextContent(
      'Frozen. Every purchase on Researcher’s card •••• 4242 is refused, and nothing leaves its wallet, until you unfreeze it.',
    )
    expect(bff.sent).toEqual(['POST /api/agents/agt_1/card/freeze'])
  })

  it('unfreezes a frozen card', async () => {
    const bff = mockBff({ frozen: true })
    const card = await typeInChat('/unfreeze Researcher')
    expect(await within(card).findByTestId('chat-card-freeze-state')).toHaveTextContent('is frozen: every purchase on it is refused')
    fireEvent.click(within(card).getByRole('button', { name: 'Unfreeze Researcher’s card' }))
    expect(await within(card).findByTestId('chat-card-freeze-done')).toHaveTextContent('Unfrozen. Researcher’s card •••• 4242 takes purchases again')
    expect(bff.sent).toEqual(['POST /api/agents/agt_1/card/unfreeze'])
  })

  it('says when the agent has no card, and sends nothing', async () => {
    const bff = mockBff({ noCard: true })
    const card = await typeInChat('/freeze Researcher')
    expect(await within(card).findByTestId('chat-card-freeze-none')).toHaveTextContent('Researcher has no card.')
    expect(within(card).queryByRole('button', { name: /^Freeze/ })).toBeDisabled()
    expect(bff.sent).toEqual([])
  })
})
