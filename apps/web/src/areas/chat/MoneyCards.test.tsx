import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.355 — another company's agent asks one of the workspace's agents for credits, and one of them holds credits in
// escrow: each is a card in Chat, answered there through the same BFF routes as Agent Wallets. The payment itself is
// proven against Lens's ledger by the e2e scenario chat-money-requests.

const M = 1_000_000

function mockBff() {
  const requests = [
    {
      id: 'req_1', from_workspace_id: 'ws_other', from_agent_id: 'agt_x', to_workspace_id: 'ws_1', to_agent_id: 'agt_1',
      amount_ulxc: 800_000, memo: 'invoice 12', status: 'pending', created_at: '2026-10-06T05:00:00Z',
    },
  ]
  const escrows = [
    {
      id: 'esc_1', payer_workspace_id: 'ws_1', payer_agent_id: 'agt_1', payee_workspace_id: 'ws_other', payee_agent_id: 'agt_x',
      amount_ulxc: 1 * M, memo: 'logo', class: 'AMBER', test_funded_ulxc: 0, release_at: '2026-10-13T00:00:00Z', status: 'held',
      created_at: '2026-10-06T05:01:00Z', events: [],
    },
  ]
  const posts: string[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 90 * M, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-06T04:00:00Z' }],
      })
    if (url === '/api/agents/agt_1/statement') return json({ lines: [] })
    if (url === '/api/wallets/requests') return json({ requests })
    if (url === '/api/wallets/escrows') return json({ escrows })
    if (url === '/api/wallets/address/agt_x') return json({ wallet_id: 'agt_x', name: 'Maker' })
    if (url === '/api/wallets/capabilities')
      return json({ capabilities: [{ capability: 'pay_another_owner', name: 'Paying another owner', class: 'AMBER', real_money: false }, { capability: 'escrow', name: 'Escrow', class: 'AMBER', real_money: false }] })
    const answer = /^\/api\/wallets\/requests\/req_1\/(accept|decline)$/.exec(url)
    if (answer && method === 'POST') {
      posts.push(url)
      requests[0].status = answer[1] === 'accept' ? 'accepted' : 'declined'
      return json({ ...requests[0], transfer_id: 'trf_1' })
    }
    if (url === '/api/wallets/escrows/esc_1/confirm' && method === 'POST') {
      posts.push(url)
      escrows[0].status = 'released'
      return json(escrows[0])
    }
    return new Response('null', { status: 404 })
  })
  return { posts }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

async function openChat() {
  window.history.pushState({}, '', '/chat')
  render(<App />)
  const card = await screen.findByTestId('chat-money-request')
  await waitFor(() => expect(within(card).getByTestId('chat-money-asks')).toHaveTextContent(/^Maker asks Researcher for 0\.8 LXC — invoice 12$/))
  return card
}

describe('Chat money requests and escrows (B28.355)', () => {
  it('accepts another agent’s request in Chat: paid once, the card says so and links the statement', async () => {
    const bff = mockBff()
    const card = await openChat()
    expect(screen.getByRole('region', { name: 'Money waiting for you' })).toHaveTextContent('Preview — test money only')
    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }))

    expect(await within(card).findByRole('status')).toHaveTextContent(/^Accepted\. Researcher paid Maker 0\.8 LXC\. See it on Researcher’s statement$/)
    expect(bff.posts).toEqual(['/api/wallets/requests/req_1/accept'])
    expect(within(card).getByRole('link', { name: 'See it on Researcher’s statement' })).toHaveAttribute('href', '/agents?agent=agt_1')
    expect(within(card).queryByRole('button', { name: 'Accept' })).toBeNull()
  })

  it('declines a request in Chat: nothing is paid', async () => {
    const bff = mockBff()
    const card = await openChat()
    fireEvent.click(within(card).getByRole('button', { name: 'Decline' }))

    expect(await within(card).findByRole('status')).toHaveTextContent(/^Declined\. Nothing was paid to Maker\.$/)
    expect(bff.posts).toEqual(['/api/wallets/requests/req_1/decline'])
  })

  it('confirms an escrow delivered in Chat: released to the payee', async () => {
    const bff = mockBff()
    await openChat()
    const card = await screen.findByTestId('chat-escrow')
    expect(within(card).getByTestId('chat-escrow-holds')).toHaveTextContent(/^Researcher holds 1 LXC for Maker — logo$/)
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm delivered' }))

    expect(await within(card).findByRole('status')).toHaveTextContent(/^Confirmed delivered\. Maker is paid 1 LXC from escrow\. See it on Researcher’s statement$/)
    expect(bff.posts).toEqual(['/api/wallets/escrows/esc_1/confirm'])
  })
})
