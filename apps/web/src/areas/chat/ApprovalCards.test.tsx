import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { b64u } from '../lens/passkeys'

// B28.84 — an agent's payment waiting for a person appears in Chat as a card; Approve with Face ID signs Lens's
// challenge for that approval, and the payment is then sent once and linked to its line on the payer's statement.
// The authenticator is stubbed (jsdom has none); the posting itself is proven against Lens by the e2e scenario
// chat-approval-face-id.

const M = 1_000_000
const bytes = (s: string) => new TextEncoder().encode(s)

function mockBff() {
  const approvals = [
    {
      id: 'apr_1', agent_id: 'agt_1', amount_ulxc: 2 * M, model: '', status: 'pending', created_at: '2026-10-06T05:00:00Z',
      payee: { kind: 'agent', id: 'agt_2', name: 'Writer' }, memo: 'October drafts',
    },
  ]
  const decisions: Array<{ id: string; body: Record<string, unknown> }> = []
  const pays: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 90 * M, spent_ulxc: 0,
        agents: [
          { id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-06T04:00:00Z' },
          { id: 'agt_2', name: 'Writer', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-06T04:00:00Z' },
        ],
      })
    if (url === '/api/agents/approvals') return json({ approvals })
    // B17.139 — the peg answers after the approvals, as on a loaded server: the card must wait for it.
    if (url === '/api/lxc/topup-options') {
      await new Promise((r) => setTimeout(r, 100))
      return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    }
    // B28.351 — the live statement beside the conversation reads the first agent's statement.
    if (url === '/api/agents/agt_1/statement') return json({ lines: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [{ credential_id: b64u(bytes('cred1')), name: 'iPhone', created_at: '2026-10-06T04:00:00Z' }] })
    const challenge = /^\/api\/agents\/approvals\/([^/]+)\/challenge$/.exec(url)
    if (challenge) return json({ challenge: b64u(bytes(`challenge-${challenge[1]}`)), allow_credentials: [b64u(bytes('cred1'))] })
    const decision = /^\/api\/agents\/approvals\/([^/]+)\/approve$/.exec(url)
    if (decision) {
      decisions.push({ id: decision[1], body })
      approvals[0].status = 'approved'
      return json(approvals[0])
    }
    if (url === '/api/agents/agt_1/pay' && method === 'POST') {
      pays.push({ url, body })
      approvals[0].status = 'used'
      return json({ entry_id: 'ent_9', from_agent_id: 'agt_1', to_agent_id: 'agt_2', amount_ulxc: 2 * M, from_balance_ulxc: 8 * M, to_balance_ulxc: 2 * M, memo: 'October drafts' })
    }
    return new Response('null', { status: 404 })
  })
  return { decisions, pays }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('Chat approval cards (B28.84)', () => {
  it('approves a waiting payment with Face ID in Chat and pays it once, linked to its statement line', async () => {
    const bff = mockBff()
    const get = vi.fn(async (opts: CredentialRequestOptions) => {
      const challenge = new TextDecoder().decode(opts.publicKey!.challenge as Uint8Array)
      return {
        rawId: bytes('cred1').buffer,
        response: {
          clientDataJSON: bytes(`{"type":"webauthn.get","challenge":"${challenge}"}`).buffer,
          authenticatorData: bytes('authdata').buffer,
          signature: bytes(`sig-over-${challenge}`).buffer,
        },
      }
    })
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/chat')
    render(<App />)

    // Read the moment the card first appears: its amount already carries its currency (B17.139).
    const card = (await screen.findAllByTestId('chat-approval'))[0]
    expect(within(card).getByTestId('chat-approval-asks')).toHaveTextContent(/^Researcher wants to pay Writer 2 LXC \(\$0\.20\) — October drafts$/)
    fireEvent.click(await within(card).findByRole('button', { name: 'Approve with Face ID' }))

    const said = await within(card).findByRole('status')
    expect(said).toHaveTextContent(/^Approved and paid 2 LXC \(\$0\.20\) from Researcher to Writer\. See it on Researcher’s statement$/)
    expect(within(said).getByRole('link')).toHaveAttribute('href', '/agents?agent=agt_1&entry=ent_9')
    expect(new TextDecoder().decode(get.mock.calls[0][0].publicKey!.challenge as Uint8Array)).toBe('challenge-apr_1')
    expect(bff.decisions).toEqual([
      { id: 'apr_1', body: { assertion: {
        credential_id: b64u(bytes('cred1')),
        client_data_json: b64u(bytes('{"type":"webauthn.get","challenge":"challenge-apr_1"}')),
        authenticator_data: b64u(bytes('authdata')),
        signature: b64u(bytes('sig-over-challenge-apr_1')),
      } } },
    ])
    expect(bff.pays).toEqual([{ url: '/api/agents/agt_1/pay', body: { to_agent_id: 'agt_2', amount_ulxc: 2 * M, memo: 'October drafts' } }])
    expect(within(card).queryByRole('button', { name: /Approve|Deny/ })).toBeNull()
  })
})
