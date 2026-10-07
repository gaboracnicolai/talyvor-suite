import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B32.54 — the room screen. The mock BFF plays Lens's room (B32.30–B32.33) for a member under its current terms: the
// messages page and its event stream, which the test feeds as a second member posts; contributions proposed, forked
// with their original recorded, and voted on with the latest vote counting; and a run on the room's budget, whose run
// message carries its charge and who paid, and whose price the room wallet's month-to-date spend then counts.

const ME = 'ws_me'
const OTHER = 'ws_other'

type C = Record<string, unknown> & { id: string; title: string; my_vote: number; tally: number }

function mockBff() {
  let seq = 1
  let cursor = 1
  let spentULXC = 0
  const contributions: C[] = []
  const sent: { method: string; url: string; body: Record<string, unknown> }[] = []
  const stream: { push?: (frame: string) => void } = {}
  const message = (ws: string, body: string, kind = 'text', refs: unknown = {}) => ({
    id: `m_${++seq}`,
    cursor: ++cursor,
    room_id: 'room_1',
    author_workspace_id: ws,
    kind,
    body,
    refs,
    created_at: '2026-10-07T10:00:00Z',
  })
  const first = message(OTHER, 'Shall we build a pricing prompt?')
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
      const me = { workspace_id: ME, role: 'owner', may_spend: true, terms_version: 1, terms_current: true, joined_at: '' }
      return json({
        id: 'room_1', owner_workspace_id: ME, title: 'Agent pricing', topic: 'research', description: '', visibility: 'public',
        status: 'open', terms_version: 1, member_count: 2, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'equal', remix_share_bps: 1000, default_price_usd_micros: 100_000, spend_policy: 'owner_only', created_at: '' },
        members: [me, { ...me, workspace_id: OTHER, role: 'member', may_spend: false }],
        agents: null,
        me,
        wallet: {
          agent_id: 'ag_room', name: 'Room: Agent pricing', balance_ulxc: 50_000_000, monthly_limit_ulxc: 20_000_000,
          spent_this_month_ulxc: spentULXC, max_per_request_ulxc: 0, approval_above_ulxc: 0, budget_max_ulxc: -1,
          spend_policy: 'owner_only', may_spend: true,
        },
      })
    }
    if (url.startsWith('/api/rooms/room_1/messages')) {
      if (method === 'POST') return json(message(ME, String(body.body)), 201)
      return json({ messages: [first], more: false, events_cursor: cursor })
    }
    if (url.startsWith('/api/rooms/room_1/events')) {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(c) {
            stream.push = (frame) => c.enqueue(encoder.encode(frame))
            c.enqueue(encoder.encode('retry: 1000\n\n'))
            init?.signal?.addEventListener('abort', () => c.close())
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }
    if (url === '/api/rooms/room_1/contributions') {
      if (method === 'POST') {
        const c: C = { id: `c_${contributions.length + 1}`, room_id: 'room_1', listing_id: 'l_1', version: 1, kind: body.kind, title: String(body.title),
          author_workspace_id: ME, status: 'proposed', tally: 0, up: 0, down: 0, my_vote: 0, created_at: '2026-10-07T10:01:00Z', artifact: body.artifact }
        contributions.unshift(c)
        return json(c, 201)
      }
      return json({ contributions })
    }
    const fork = /^\/api\/rooms\/room_1\/contributions\/([^/]+)\/fork$/.exec(url)
    if (fork) {
      const src = contributions.find((x) => x.id === fork[1])!
      const c: C = { ...src, id: `c_${contributions.length + 1}`, title: String(body.title), author_workspace_id: ME, forked_from: src.id, tally: 0, up: 0, down: 0, my_vote: 0 }
      contributions.unshift(c)
      return json(c, 201)
    }
    const vote = /^\/api\/rooms\/room_1\/contributions\/([^/]+)\/vote$/.exec(url)
    if (vote && method === 'PUT') {
      const c = contributions.find((x) => x.id === vote[1])!
      c.my_vote = Number(body.value)
      c.tally = c.my_vote
      return json(c)
    }
    if (url === '/api/rooms/room_1/runs' && method === 'POST') {
      spentULXC += 1_000_000 // $0.10 at the peg
      const m = message(ME, 'ran a prompt “Pricing prompt” on the room’s budget — $0.10 on the marketplace bill\n\nCharge per seat.', 'run', {
        run: 'use', use_id: 'u_1', listing_id: 'l_1', version: 1, charge: 'billed', price_usd_micros: 100_000, pay: 'room', payer_workspace_id: ME,
        contribution_id: body.target, wallet_agent_id: 'ag_room',
      })
      return json({ use: { id: 'u_1' }, pay: 'room', payer_workspace_id: ME, message: m })
    }
    if (url.startsWith('/api/marketplace/listings')) return json({ listings: [] })
    return new Response('null', { status: 404 })
  })
  return { sent, stream, message, cursor: () => cursor }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the room screen', () => {
  it('shows a second member’s message as it is posted, and the member’s own', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    const list = await screen.findByRole('list', { name: 'Messages' })
    expect(within(list).getByText('Shall we build a pricing prompt?')).toBeTruthy()
    // The stream is asked for what comes after the first read's cursor.
    await waitFor(() => expect(bff.stream.push).toBeDefined())
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u) === `/api/rooms/room_1/events?after=${bff.cursor()}`)).toBe(true)

    const theirs = bff.message(OTHER, 'I have a first draft — proposing it now.')
    bff.stream.push!(`id: ${theirs.cursor}\ndata: ${JSON.stringify({ cursor: theirs.cursor, kind: 'message.posted', ref: theirs.id, at: '', message: theirs })}\n\n`)
    expect(await within(list).findByText('I have a first draft — proposing it now.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Great, go ahead.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await within(list).findByText('Great, go ahead.')).toBeTruthy()
    expect(bff.sent.find((s) => s.url === '/api/rooms/room_1/messages')?.body).toEqual({ body: 'Great, go ahead.' })
  })

  it('proposes, forks and votes on a contribution, and runs it on the room with its cost and who paid', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    expect((await screen.findByTestId('room-budget-spent')).textContent).toBe('0 LXC')

    fireEvent.click(await screen.findByRole('button', { name: 'Propose' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pricing prompt' } })
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'Price {{product}} per seat.' } })
    fireEvent.change(screen.getByLabelText(/Price per use/), { target: { value: '0.10' } })
    fireEvent.click(within(screen.getByLabelText('Template').closest('form')!).getByRole('button', { name: 'Propose' }))
    const board = await screen.findByRole('list', { name: 'Contributions' })
    expect(within(board).getByText('Pricing prompt')).toBeTruthy()
    expect(bff.sent.find((s) => s.url === '/api/rooms/room_1/contributions')?.body).toMatchObject({
      kind: 'prompt', title: 'Pricing prompt', artifact: { template: 'Price {{product}} per seat.' }, price_usd_micros: 100_000,
    })

    fireEvent.click(within(board).getByRole('button', { name: 'Fork' }))
    const forkForm = screen.getByRole('group', { name: 'Fork Pricing prompt' })
    fireEvent.click(within(forkForm).getByRole('button', { name: 'Fork it' }))
    expect(await within(board).findByText('Pricing prompt (fork)')).toBeTruthy()
    expect(within(board).getByTestId('contribution-original').textContent).toBe('Built on “Pricing prompt” by You')
    // A fork that leaves the work as it is sends no artifact: Lens keeps the original's.
    expect(bff.sent.find((s) => s.url.endsWith('/c_1/fork'))?.body).toEqual({ title: 'Pricing prompt (fork)', description: '', changelog: '' })

    fireEvent.click(screen.getByRole('button', { name: 'Vote for Pricing prompt' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vote for Pricing prompt' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByLabelText('Pricing prompt: 1 votes').textContent).toBe('+1')
    expect(bff.sent.find((s) => s.method === 'PUT')).toEqual({ method: 'PUT', url: '/api/rooms/room_1/contributions/c_1/vote', body: { value: 1 } })

    fireEvent.change(screen.getByLabelText('What to run'), { target: { value: 'c_1' } })
    fireEvent.change(screen.getByLabelText('Input'), { target: { value: 'a seat-based CRM' } })
    expect((screen.getByRole('radio', { name: 'On the room' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    const result = await screen.findByRole('list', { name: 'Run result' })
    const cost = within(result).getByTestId('run-cost')
    expect(cost.textContent).toBe('Cost$0.10Paid by the room')
    expect(bff.sent.find((s) => s.url === '/api/rooms/room_1/runs')?.body).toEqual({
      target: 'c_1', input: 'a seat-based CRM', variables: {}, model: '', pay: 'room',
    })
    // The run message is in the conversation too, and the room's budget now counts it.
    expect(within(screen.getByRole('list', { name: 'Messages' })).getAllByTestId('run-cost')[0].textContent).toBe('Cost$0.10Paid by the room')
    await waitFor(() => expect(screen.getByTestId('room-budget-spent').textContent).toBe('1 LXC'))
  })
})
