import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { b64u } from './passkeys'

// B19.10 — once the workspace has a passkey, every approve and deny is signed on this device over the
// challenge Lens issues for that one approval, and the BFF is sent the assertion; a denied payment is
// not sent. The authenticator is stubbed (jsdom has none); Lens's verification of what it signs is
// proven in talyvor-lens (TestAgentRoutes_ApprovalsAreSignedWithAPasskeyAndPushedToTheOwner).

const M = 1_000_000
const bytes = (s: string) => new TextEncoder().encode(s)

function mockBff() {
  const approvals = [
    {
      id: 'apr_1', agent_id: 'agt_1', amount_ulxc: 3 * M, model: '', reason: 'October hosting', status: 'pending', created_at: '2026-09-28T06:05:00Z',
      payee: { kind: 'company', id: 'ws_acme', name: 'Acme Hosting' }, memo: 'October invoice',
    },
    { id: 'apr_2', agent_id: 'agt_1', amount_ulxc: 1 * M, model: '', reason: 'A second invoice', status: 'pending', created_at: '2026-09-28T06:06:00Z' },
  ]
  const decisions: Array<{ id: string; decision: string; body: Record<string, unknown> }> = []
  const pays: string[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 90 * M, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-09-28T06:00:00Z' }],
      })
    if (url === '/api/agents/approvals') return json({ approvals })
    if (url === '/api/agents/passkeys') return json({ passkeys: [{ credential_id: b64u(bytes('cred1')), name: 'iPhone', created_at: '2026-09-28T06:00:00Z' }] })
    const challenge = /^\/api\/agents\/approvals\/([^/]+)\/challenge$/.exec(url)
    if (challenge) return json({ challenge: b64u(bytes(`challenge-${challenge[1]}`)), allow_credentials: [b64u(bytes('cred1'))] })
    const decision = /^\/api\/agents\/approvals\/([^/]+)\/(approve|deny)$/.exec(url)
    if (decision) {
      decisions.push({ id: decision[1], decision: decision[2], body })
      const a = approvals.find((x) => x.id === decision[1])!
      a.status = decision[2] === 'approve' ? 'approved' : 'denied'
      return json(a)
    }
    if (/\/pay$/.test(url)) pays.push(url)
    if (/\/(rules|statement)$/.test(url)) return json(url.endsWith('rules') ? { approval_above_ulxc: 2 * M } : { lines: [] })
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

describe('Agent Bank approvals with Face ID', () => {
  it('says who a payment pays, how much and what for (B23.10)', async () => {
    mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)
    const asks = await screen.findByText(/wants to pay/)
    expect(asks).toHaveTextContent(/^Researcher wants to pay Acme Hosting 3 LXC — October invoice$/)
  })

  it('signs each approve and deny with the passkey over that approval’s challenge', async () => {
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
    window.history.pushState({}, '', '/agents')
    render(<App />)

    expect(await screen.findByText(/October hosting/)).toBeInTheDocument()
    await screen.findByText(/Approvals are signed with a passkey \(1 registered\)/)
    const approveButtons = await screen.findAllByRole('button', { name: 'Approve with Face ID' })
    fireEvent.click(approveButtons[0])
    await waitFor(() => expect(bff.decisions).toHaveLength(1))

    const opts = get.mock.calls[0][0].publicKey!
    expect(new TextDecoder().decode(opts.challenge as Uint8Array)).toBe('challenge-apr_1')
    expect(opts.userVerification).toBe('required')
    expect(new TextDecoder().decode(opts.allowCredentials![0].id as Uint8Array)).toBe('cred1')
    expect(bff.decisions[0]).toEqual({
      id: 'apr_1', decision: 'approve',
      body: { assertion: {
        credential_id: b64u(bytes('cred1')),
        client_data_json: b64u(bytes('{"type":"webauthn.get","challenge":"challenge-apr_1"}')),
        authenticator_data: b64u(bytes('authdata')),
        signature: b64u(bytes('sig-over-challenge-apr_1')),
      } },
    })

    fireEvent.click((await screen.findAllByRole('button', { name: 'Deny' }))[0])
    await waitFor(() => expect(bff.decisions).toHaveLength(2))
    expect(bff.decisions[1].id).toBe('apr_2')
    expect(bff.decisions[1].decision).toBe('deny')
    expect((bff.decisions[1].body.assertion as Record<string, string>).signature).toBe(b64u(bytes('sig-over-challenge-apr_2')))
    expect(bff.pays).toEqual([])
  })
})
