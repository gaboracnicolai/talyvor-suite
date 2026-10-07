import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { STORED_NOTICE } from './roomsApi'

// B32.53 — Chat becomes a list of open chats. The mock BFF plays Lens's rooms (B32.28–B32.29) for the signed-in
// workspace and does what Lens does: a room is opened with its owner as a member, GET /api/rooms answers the open
// public rooms, the rooms the workspace is in and its plan's room limits, joining takes the room's current terms
// version, and a Free workspace's fourth public room is refused 402 with Lens's rooms_plan_limits sentence.

const ME = 'ws_me'
const REFUSAL =
  'rooms_plan_limits (LENS_ROOMS_PLAN_LIMITS): your free plan allows 3 public rooms — the team plan allows 25'

type Rm = Record<string, unknown> & { id: string; owner_workspace_id: string; visibility: string; topic: string; members: string[] }

function room(id: string, owner: string, title: string, topic: string): Rm {
  return {
    id,
    owner_workspace_id: owner,
    title,
    topic,
    description: '',
    visibility: 'public',
    status: 'open',
    terms_version: 1,
    member_count: 1,
    created_at: '2026-10-06T09:00:00Z',
    last_activity_at: '2026-10-06T09:00:00Z',
    members: [owner],
  }
}

function mockBff(seed: Rm[] = []) {
  const rooms: Rm[] = [...seed]
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const view = ({ members, ...r }: Rm) => ({ ...r, member_count: members.length })
    const terms = { version: 1, split_rule: 'equal', remix_share_bps: 1000, default_price_usd_micros: 100_000, spend_policy: 'owner_only', created_at: '' }
    const detail = (r: Rm) => ({
      ...view(r),
      terms,
      members: r.members.map((ws) => ({ workspace_id: ws, role: ws === r.owner_workspace_id ? 'owner' : 'member', may_spend: false, terms_version: 1, terms_current: true, joined_at: '' })),
      agents: null,
      me: r.members.includes(ME) ? { workspace_id: ME, role: ME === r.owner_workspace_id ? 'owner' : 'member', may_spend: false, terms_version: 1, terms_current: true, joined_at: '' } : null,
    })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms' && method === 'POST') {
      const owned = rooms.filter((r) => r.owner_workspace_id === ME && r.visibility === 'public').length
      if (body.visibility === 'public' && owned >= 3)
        return json({ error: REFUSAL, setting: 'rooms_plan_limits', plan: 'free', limit: 'public_rooms', max: 3, allows: 'team' }, 402)
      const r = { ...room(`room_${rooms.length + 1}`, ME, String(body.title), String(body.topic)), visibility: String(body.visibility) }
      rooms.push(r)
      return json(detail(r), 201)
    }
    if (url === '/api/rooms' || url.startsWith('/api/rooms?')) {
      const topic = new URL(url, 'http://x').searchParams.get('topic') ?? ''
      const owned = rooms.filter((r) => r.owner_workspace_id === ME)
      return json({
        rooms: rooms.filter((r) => r.visibility === 'public' && (topic === '' || r.topic === topic)).map(view),
        joined: rooms.filter((r) => r.members.includes(ME)).map(view),
        invited: null,
        limits: {
          plan: 'free', limit_as: 'free', public_rooms: 3, private_rooms: 0, members_per_room: 50, agents_per_room: 10, room_budget_max_usd: 100,
          public_rooms_open: owned.filter((r) => r.visibility === 'public').length,
          private_rooms_open: owned.filter((r) => r.visibility === 'private').length,
        },
      })
    }
    const join = /^\/api\/rooms\/([^/]+)\/join$/.exec(url)
    const one = /^\/api\/rooms\/([^/]+)$/.exec(url)
    const r = rooms.find((x) => x.id === (join ?? one)?.[1])
    if (r && one) return json(detail(r))
    if (r && join && method === 'POST') {
      if (body.terms_version !== 1) return json({ error: 'rooms: conflict: the room’s terms are at version 1' }, 409)
      r.members.push(ME)
      return json(detail(r).me, 201)
    }
    return new Response('null', { status: 404 })
  })
}

async function at(path: string) {
  cleanup()
  queryClient.clear()
  window.history.pushState({}, '', path)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('rooms', () => {
  it('opens a room, which then shows under Rooms in the chat rail and in the directory', async () => {
    mockBff([room('room_x', 'ws_other', 'Open-source evals', 'evaluation')])

    await at('/rooms/new')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Agent pricing research' } })
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'research' } })
    fireEvent.change(screen.getByLabelText(/Default price per use/), { target: { value: '0.10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open room' }))
    expect(await screen.findByRole('heading', { name: 'Agent pricing research' })).toBeTruthy()
    // The room's first screen says where its messages are kept, before there is a first message.
    expect(screen.getByTestId('room-stored-notice').textContent).toBe(STORED_NOTICE)

    await at('/chat')
    const mine = await screen.findByRole('list', { name: 'Your rooms' })
    expect(within(mine).getByRole('link', { name: 'Agent pricing research' })).toBeTruthy()
    const openOnEvals = screen.getByRole('list', { name: 'Open rooms on evaluation' })
    expect(within(openOnEvals).getByRole('link', { name: 'Open-source evals' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'New room' }).getAttribute('href')).toBe('/rooms/new')

    await at('/rooms')
    const yours = await screen.findByRole('list', { name: 'Your rooms' })
    expect(within(yours).getByRole('link', { name: 'Agent pricing research' })).toBeTruthy()
    expect(screen.getByText('Your free plan: 1 of 3 public rooms and 0 of 0 private rooms open.')).toBeTruthy()
    // The topic filter asks Lens for one topic's rooms.
    fireEvent.click(within(screen.getByRole('group', { name: 'Topic' })).getByRole('button', { name: 'evaluation' }))
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Open rooms' })).queryByRole('link', { name: 'Agent pricing research' })).toBeNull(),
    )
    expect(within(screen.getByRole('list', { name: 'Open rooms' })).getByRole('link', { name: 'Open-source evals' })).toBeTruthy()
  })

  it('a Free workspace’s fourth public room shows Lens’s rooms_plan_limits refusal and opens nothing', async () => {
    mockBff([room('room_1', ME, 'One', 'a'), room('room_2', ME, 'Two', 'a'), room('room_3', ME, 'Three', 'a')])
    await at('/rooms/new')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Four' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open room' }))
    expect((await screen.findByRole('alert')).textContent).toBe(REFUSAL)
    expect(screen.getByRole('heading', { name: 'Open a room' })).toBeTruthy()
  })

  it('joining shows the room’s terms and joins only once they are accepted', async () => {
    mockBff([room('room_x', 'ws_other', 'Open-source evals', 'evaluation')])
    await at('/rooms/room_x')
    expect(await screen.findByRole('heading', { name: 'Open-source evals' })).toBeTruthy()
    expect(screen.getByText('$0.10')).toBeTruthy()
    expect(screen.getByText('Equal shares')).toBeTruthy()
    const joinButton = screen.getByRole('button', { name: 'Join room' })
    expect((joinButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(joinButton)
    expect((await screen.findByRole('status')).textContent).toBe('You are in this room as a member.')
  })
})
