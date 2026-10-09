import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentCredentialCard } from './AgentCredential'

// B30.103 — an agent's credential on its card: what it says, the credential to copy, and Talyvor's check of it. The mock
// BFF answers as Lens B30.5 does: the credential, then verify's answer; and for a frozen agent, 409 with Lens's sentence.

const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' }
const TOKEN = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJhZ3RfMSJ9.c2ln'

function mockBff(frozen = false) {
  const verified: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/agents/agt_1/credential') {
      if (frozen) return json({ error: 'the agent is frozen, so its Know Your Agent credential is revoked until its owner resumes it' }, 409)
      return json({
        id: 'kya_1',
        credential: TOKEN,
        claims: {
          iss: 'talyvor', sub: 'agt_1', jti: 'kya_1', iat: 1, exp: 2,
          agent: { id: 'agt_1', name: 'Researcher' },
          owner: { workspace_id: 'ws_1', name: 'Ada Owner', level: 'L2', live_level: 'L0' },
          capabilities: [{ capability: 'spend_on_talyvor', money: 'live' }, { capability: 'fx', money: 'test' }],
          limits: { daily_limit_ulxc: 5_000_000 },
        },
        issued_at: '2026-10-09T09:00:00Z',
        expires_at: '2026-10-10T09:00:00Z',
        jwks_url: 'https://lens.example/.well-known/talyvor-kya/jwks.json',
        verify_url: 'https://lens.example/v1/kya/verify',
      })
    }
    if (url === '/api/kya/verify' && init?.method === 'POST') {
      verified.push(JSON.parse(String(init.body)))
      return json({ valid: true })
    }
    return json({ error: 'not found' }, 404)
  })
  return verified
}

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AgentCredentialCard agent={agent} />
    </QueryClientProvider>,
  )

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the agent’s Know Your Agent credential', () => {
  it('shows what it says, offers it to copy, and checks it with Talyvor', async () => {
    const verified = mockBff()
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Show its credential' }))

    expect((await screen.findByTestId('credential-token')).textContent).toBe(TOKEN)
    expect(screen.getByTestId('credential-owner').textContent).toBe('Ada Owner · level L2, live level L0')
    expect(screen.getByTestId('credential-capabilities').textContent).toContain('1 of 2 capabilities')
    expect(screen.getByTestId('credential-limits').textContent).toContain('Each day')
    expect(screen.getByRole('button', { name: 'Copy credential' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Check it with Talyvor' }))
    expect((await screen.findByTestId('credential-verdict')).textContent).toContain('Valid')
    expect(verified).toEqual([{ credential: TOKEN }])
  })

  it('says why a frozen agent has none', async () => {
    mockBff(true)
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Show its credential' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The agent is frozen, so its Know Your Agent credential is revoked until its owner resumes it.',
    )
  })
})
