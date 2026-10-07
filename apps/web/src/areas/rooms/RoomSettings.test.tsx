import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B32.55 — room settings. The mock BFF plays Lens for a private room's owner on Free: a member who may not spend, the
// room wallet's rules — its monthly limit is the room's budget, refused above the plan's room_budget_max_usd with Lens's
// rooms_plan_limits sentence (B32.32) —, a live invite link (B32.29) and an open $50 prize (B32.35). Each change the
// screen makes is read back from the mock BFF's state, never from what the screen sent.

const ME = 'ws_me'
const OTHER = 'ws_other'
const PLAN_MAX_ULXC = 1_000_000_000 // Free's room_budget_max_usd, $100, at the peg

function mockBff() {
  const members = [
    { workspace_id: ME, role: 'owner', may_spend: true, terms_version: 1, terms_current: true, joined_at: '2026-10-01T09:00:00Z' },
    { workspace_id: OTHER, role: 'member', may_spend: false, terms_version: 1, terms_current: true, joined_at: '2026-10-02T09:00:00Z' },
  ]
  let rules = {
    max_per_request_ulxc: 0, hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 200_000_000,
    approval_above_ulxc: 0, requests_per_minute: 0, allowed_models: null, allowed_providers: null, allowed_listings: null,
    allowed_payees: null, blocked_payees: null, active_from: '', active_until: '', timezone: '',
  }
  const invites = [
    { id: 'rinv_1', room_id: 'room_1', kind: 'link', max_uses: 10, uses: 2, expires_at: '2026-10-14T09:00:00Z', live: true,
      created_by_workspace_id: ME, created_at: '2026-10-07T09:00:00Z' } as Record<string, unknown>,
  ]
  const prizes = [
    { id: 'rprz_1', room_id: 'room_1', poster_workspace_id: ME, title: 'Best pricing prompt', criteria: 'Wins the most deals',
      amount_usd_micros: 50_000_000, deadline: '2026-10-31T23:59:59Z', status: 'open', created_at: '2026-10-07T09:00:00Z' } as Record<string, unknown>,
  ]
  const sent: { method: string; url: string; body: Record<string, unknown> }[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      return json({
        id: 'room_1', owner_workspace_id: ME, title: 'Agent pricing', topic: 'research', description: '', visibility: 'private',
        status: 'open', terms_version: 1, member_count: members.length, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'equal', remix_share_bps: 1000, default_price_usd_micros: 100_000, spend_policy: 'members_with_spend', created_at: '' },
        members, agents: null, me: members[0],
        wallet: {
          agent_id: 'ag_room', name: 'Room: Agent pricing', balance_ulxc: 50_000_000, monthly_limit_ulxc: 200_000_000,
          spent_this_month_ulxc: 0, max_per_request_ulxc: 0, approval_above_ulxc: 0, budget_max_ulxc: PLAN_MAX_ULXC,
          spend_policy: 'members_with_spend', may_spend: true,
        },
      })
    }
    const member = /^\/api\/rooms\/room_1\/members\/([^/]+)$/.exec(url)
    if (member && method === 'PATCH') {
      const m = members.find((x) => x.workspace_id === decodeURIComponent(member[1]))!
      if (typeof body.may_spend === 'boolean') m.may_spend = body.may_spend
      return json(m)
    }
    if (url === '/api/agents/ag_room/rules') {
      if (method === 'PUT') {
        if (Number(body.monthly_limit_ulxc) > PLAN_MAX_ULXC) {
          return json({ error: 'a monthly limit of 2,000 LXC is above the room’s budget: rooms_plan_limits (LENS_ROOMS_PLAN_LIMITS): your free plan allows a room a budget of at most $100 (1,000 LXC) a month — the team plan allows $5000' }, 402)
        }
        rules = { ...rules, ...body } as typeof rules
      }
      return json(rules)
    }
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/rooms/room_1/invites') return json({ invites })
    const invite = /^\/api\/rooms\/room_1\/invites\/([^/]+)$/.exec(url)
    if (invite && method === 'DELETE') {
      const i = invites.find((x) => x.id === invite[1])!
      Object.assign(i, { live: false, revoked_at: '2026-10-07T11:00:00Z' })
      return json(i)
    }
    if (url === '/api/rooms/room_1/contributions') {
      return json({ contributions: [{ id: 'c_1', room_id: 'room_1', listing_id: 'l_1', version: 1, kind: 'prompt', title: 'Pricing prompt',
        author_workspace_id: OTHER, status: 'accepted', tally: 2, up: 2, down: 0, my_vote: 1, created_at: '2026-10-07T09:30:00Z' }] })
    }
    if (url === '/api/rooms/room_1/prizes') return json({ prizes })
    const award = /^\/api\/rooms\/room_1\/prizes\/([^/]+)\/award$/.exec(url)
    if (award && method === 'POST') {
      const p = prizes.find((x) => x.id === award[1])!
      Object.assign(p, { status: 'awarded', contribution_id: body.contribution_id, winner_workspace_id: OTHER, awarded_at: '2026-10-07T11:00:00Z' })
      return json({ prize: p, licence: { use_id: 'u_1' } })
    }
    if (url === '/api/room-invites/rinvtok_abc') {
      return json({
        room: { id: 'room_1', owner_workspace_id: ME, title: 'Agent pricing', topic: 'research', description: '', visibility: 'private',
          status: 'open', terms_version: 1, member_count: members.length, created_at: '', last_activity_at: '' },
        terms: { version: 1, split_rule: 'equal', remix_share_bps: 1000, default_price_usd_micros: 100_000, spend_policy: 'members_with_spend', created_at: '' },
        expires_at: '2026-10-14T09:00:00Z', uses_left: 8,
      })
    }
    if (url === '/api/room-invites/rinvtok_abc/join' && method === 'POST') {
      return json({ room_id: 'room_1', member: { workspace_id: OTHER, role: 'member', may_spend: false, terms_version: 1 } }, 201)
    }
    return new Response('null', { status: 404 })
  })
  return { sent }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('room settings', () => {
  it('gives a member may_spend and revokes an invite link, each read back from Lens', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)

    const spend = await screen.findByRole('button', { name: `${OTHER} may spend the room’s money` })
    expect(spend.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(spend)
    await waitFor(() => expect(screen.getByRole('button', { name: `${OTHER} may spend the room’s money` }).getAttribute('aria-pressed')).toBe('true'))
    expect(bff.sent.find((s) => s.method === 'PATCH')).toEqual({ method: 'PATCH', url: `/api/rooms/room_1/members/${OTHER}`, body: { may_spend: true } })

    const invites = await screen.findByRole('list', { name: 'Invites' })
    expect(within(invites).getByText('Live')).toBeTruthy()
    fireEvent.click(within(invites).getByRole('button', { name: /^Revoke invite/ }))
    expect(await within(invites).findByText('Revoked')).toBeTruthy()
    expect(within(invites).queryByRole('button', { name: /^Revoke invite/ })).toBeNull()
    expect(bff.sent.find((s) => s.method === 'DELETE')?.url).toBe('/api/rooms/room_1/invites/rinv_1')
  })

  it('sets the room’s monthly budget through the rules editor, showing Lens’s refusal above the plan’s maximum', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)

    const budget = await screen.findByTestId('room-budget')
    expect(within(budget).getByText('200 LXC')).toBeTruthy()
    const limit = await screen.findByLabelText('Monthly limit for Room: Agent pricing, in LXC')
    fireEvent.change(limit, { target: { value: '2000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    const refusal = await screen.findByText(/rooms_plan_limits/)
    expect(refusal.textContent).toBe(
      'A monthly limit of 2,000 LXC is above the room’s budget: rooms_plan_limits (LENS_ROOMS_PLAN_LIMITS): your free plan allows a room a budget of at most $100 (1,000 LXC) a month — the team plan allows $5000.',
    )
    expect(within(budget).getByText('200 LXC')).toBeTruthy()

    fireEvent.change(limit, { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    await waitFor(() => expect(within(screen.getByTestId('room-budget')).getByText('500 LXC')).toBeTruthy())
    expect(bff.sent.filter((s) => s.url === '/api/agents/ag_room/rules').map((s) => s.body.monthly_limit_ulxc)).toEqual([2_000_000_000, 500_000_000])
  })

  it('joins a private room through an invite link, accepting its terms, and opens the room', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/invite/rinvtok_abc')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Agent pricing' })).toBeTruthy()
    const join = screen.getByRole('button', { name: 'Join room' }) as HTMLButtonElement
    expect(join.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(join)
    await waitFor(() => expect(window.location.pathname).toBe('/rooms/room_1'))
    expect(bff.sent.find((s) => s.url === '/api/room-invites/rinvtok_abc/join')?.body).toEqual({ terms_version: 1 })
  })

  it('awards an open prize to a contribution, and the prize reads as awarded', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)

    const prizes = await screen.findByRole('list', { name: 'Prizes' })
    const winner = within(prizes).getByLabelText('Winner of Best pricing prompt')
    await within(winner).findByRole('option', { name: 'Pricing prompt' })
    fireEvent.change(winner, { target: { value: 'c_1' } })
    fireEvent.click(within(prizes).getByRole('button', { name: 'Award Best pricing prompt' }))
    expect(await within(prizes).findByText('Awarded to “Pricing prompt”')).toBeTruthy()
    expect(within(prizes).getByRole('status').textContent).toBe('Awarded. $50.00 is on your marketplace bill, and the winner is paid when it clears.')
    expect(bff.sent.find((s) => s.url.endsWith('/award'))).toEqual({
      method: 'POST', url: '/api/rooms/room_1/prizes/rprz_1/award', body: { contribution_id: 'c_1' },
    })
  })
})
