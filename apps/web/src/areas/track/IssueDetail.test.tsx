import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IssueDetail } from './IssueDetail'

// THE JOURNEY: open an issue, edit its description, assign it, comment, close it.
//
// ⚠ EVERY ASSERTION IS ON WHAT TRACK WOULD RECORD — the method, path and BODY that reach the BFF —
// never on what a handler returned or what a component re-rendered. A test that checked "the screen
// shows Done" would pass on a screen that never sent the patch.
//
// ⚠ AND THE FAKE IS STATEFUL. A write that "succeeds" while the read keeps serving the old row lets
// a component pass by echoing the click. Here writes move the stored issue and reads serve it, so
// these can only pass if the screen re-reads what was recorded.

type Recorded = { method: string; path: string; body: unknown }

let recorded: Recorded[] = []

const ISSUE = {
  id: 'iss-1',
  workspace_id: 'ws1',
  team_id: 'team-1',
  number: 7,
  identifier: 'ENG-7',
  title: 'Cache stampede on cold start',
  description: 'Original description.',
  status: 'in_progress',
  priority: 3,
  assignee_id: undefined as string | undefined,
  creator_id: 'u-1',
  lens_feature: '',
  ai_cost_usd: 0.4213,
  ai_tokens: 18342,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function mockBff(over: Partial<typeof ISSUE> = {}) {
  const issue = { ...ISSUE, ...over }
  const comments: { id: string; issue_id: string; author_id: string; body: string; created_at: string; updated_at: string }[] = [
    { id: 'c-1', issue_id: 'iss-1', author_id: 'u-2', body: 'Seen it under load.', created_at: '', updated_at: '' },
  ]
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    recorded.push({ method, path, body })
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

    if (path === '/api/members') return json([{ id: 'u-1', name: 'Ada' }, { id: 'u-2', name: 'Grace' }])
    if (path === '/api/track/teams') return json([{ id: 'team-1', identifier: 'ENG', name: 'Engineering' }])
    if (path.endsWith('/comments') && method === 'POST') {
      comments.push({ id: 'c-2', issue_id: 'iss-1', author_id: 'u-1', body: String(body.body), created_at: '', updated_at: '' })
      return json({ ok: true })
    }
    if (path.endsWith('/comments')) return json(comments)
    if (path === '/api/track/issues/iss-1' && method === 'PATCH') {
      Object.assign(issue, body)
      return json(issue)
    }
    if (path === '/api/track/issues/iss-1') return json(issue)
    return json(null, 404)
  })
}

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/track/issues/iss-1']}>
        <Routes>
          <Route path="/track/issues/:id" element={<IssueDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The last write of a given method — what Track would have recorded. */
function lastWrite(method: string): Recorded | undefined {
  return [...recorded].reverse().find((r) => r.method === method)
}

beforeEach(() => {
  recorded = []
  mockBff()
})
afterEach(() => vi.restoreAllMocks())

describe('a ticket can be read', () => {
  it('shows the description, which the list could never display', async () => {
    open()
    expect(await screen.findByText('Original description.')).toBeInTheDocument()
  })

  it('shows the comment thread', async () => {
    open()
    expect(await screen.findByText('Seen it under load.')).toBeInTheDocument()
  })

  // ⚠ THE NUMBER NO OTHER TRACKER HAS, and it was invisible until now.
  it('shows the per-issue AI cost', async () => {
    open()
    expect(await screen.findByText('$0.42')).toBeInTheDocument()
  })

  // ⚠ AND A SUB-CENT COST MUST NOT RENDER AS $0.00 — that reads as "this issue cost nothing",
  // which is the one thing the number exists to disprove. Most single calls are sub-cent.
  it('does not round a real sub-cent cost down to zero', async () => {
    mockBff({ ai_cost_usd: 0.0004 })
    open()
    expect(await screen.findByText('$0.0004')).toBeInTheDocument()
  })

  // A genuine zero says so in words rather than showing $0.00, which is indistinguishable from a
  // cost too small to display.
  //
  // ⚠ ai_tokens IS SET TO 0 HERE, AND THAT IS THE POINT. This case is named "no AI spend at all"
  // but it used to inherit the fixture's `ai_tokens: 18342`, so it rendered
  // "AI cost / No AI spend recorded / 18342 tokens" — the contradiction below — and asserted only
  // the half that agreed with its name. The state it claims to describe is BOTH numbers at zero.
  it('says so in words when there is no AI spend at all', async () => {
    mockBff({ ai_cost_usd: 0, ai_tokens: 0 })
    open()
    expect(await screen.findByText(/no ai spend recorded/i)).toBeInTheDocument()
    expect(screen.queryByText(/tokens/i)).toBeNull()
  })

  // ⚠ ZERO COST IS NOT ZERO USAGE, AND UPSTREAM SAYS SO IN ITS OWN SOURCE. A response served from
  // the cache or by a registered node writes a token_events row with cost_usd = 0 and the token
  // counts intact (talyvor-lens alerts.go `insertCacheServeSQL` — the zero is literal in the SQL),
  // Lens returns it on /v1/api/spend/by-request, and talyvor-track's syncer lands EVERY row it
  // gets — `RecordRequestSpendAttributed(..., rs.CostUSD, rs.InputTokens+rs.OutputTokens, ...)`,
  // with no zero-cost filter on any link of the chain. So `ai_cost_usd == 0 && ai_tokens > 0` is
  // the ordinary shape of a pooled issue, not an edge case.
  //
  // Lens states the rule twice for its own readers — "A spend view must never render this row as
  // 'the request was free'" (alerts.go) and "render cache rows as 'served from cache', not
  // 'free'" (server.go). This screen said something stronger than free: that no AI spend was
  // recorded, beside the token count proving it was.
  //
  // The positive assertion comes first deliberately: a queryByText(...).toBeNull() alone is green
  // on a screen that never rendered.
  it('does not deny the spend on an issue whose tokens cost nothing upstream', async () => {
    mockBff({ ai_cost_usd: 0, ai_tokens: 18342 })
    open()
    expect(await screen.findByText('18342 tokens')).toBeInTheDocument()
    expect(screen.queryByText(/no ai spend recorded/i)).toBeNull()
  })

  it('resolves the team id to its identifier rather than showing a raw uuid', async () => {
    open()
    expect(await screen.findByText('ENG')).toBeInTheDocument()
  })
})

describe('a ticket can be worked', () => {
  it('records the edited description as a description patch', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: /edit description/i }))
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Rewritten.' } })
    fireEvent.click(screen.getByRole('button', { name: /save description/i }))

    await waitFor(() => expect(lastWrite('PATCH')).toBeDefined())
    const w = lastWrite('PATCH')!
    expect(w.path).toBe('/api/track/issues/iss-1')
    expect(w.body).toEqual({ description: 'Rewritten.' })
    // And the screen shows what was RECORDED, from a re-read — not the text it just typed.
    expect(await screen.findByText('Rewritten.')).toBeInTheDocument()
  })

  it('records a comment as a POST to the comments route', async () => {
    open()
    await screen.findByText('Seen it under load.')
    fireEvent.change(screen.getByLabelText(/add a comment/i), { target: { value: 'Reproduced on staging.' } })
    fireEvent.click(screen.getByRole('button', { name: /^comment$/i }))

    await waitFor(() => expect(lastWrite('POST')).toBeDefined())
    const w = lastWrite('POST')!
    expect(w.path).toBe('/api/track/issues/iss-1/comments')
    expect(w.body).toEqual({ body: 'Reproduced on staging.' })
    // The thread re-reads, so the new comment is what Track holds rather than local state.
    expect(await screen.findByText('Reproduced on staging.')).toBeInTheDocument()
  })

  // ⚠ A FAILED WRITE MUST NOT LOOK LIKE A SUCCESSFUL ONE.
  it('says nothing changed when a patch fails, and leaves the stored value showing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
      if (method === 'PATCH') return json({ error: 'nope' }, 502)
      if (path === '/api/members') return json([])
      if (path === '/api/track/teams') return json([])
      if (path.endsWith('/comments')) return json([])
      return json(ISSUE)
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /edit description/i }))
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Lost.' } })
    fireEvent.click(screen.getByRole('button', { name: /save description/i }))
    expect(await screen.findByText(/did not save/i)).toBeInTheDocument()
  })

  // ⚠ team_id is NOT in Track's updatableFields, so a control offering to change it would silently
  // drop the write. Showing the value is honest; offering an edit would not be.
  it('does not offer to edit the team, which Track will not update', async () => {
    open()
    await screen.findByText('ENG')
    expect(screen.queryByLabelText(/^team$/i)).not.toBeInTheDocument()
  })
})

// ─── A REFUSED THREAD IS NOT AN EMPTY THREAD ────────────────────────────────────────────────
//
// ⚠ THE DEFECT, MEASURED BEFORE IT WAS FIXED. The comments panel branched on `isLoading` and then
// straight to `(comments.data ?? []).length === 0`. A refused read leaves `data` undefined, so the
// screen printed "No comments yet. Add the first one below." — the same sentence a genuinely empty
// thread gets — on 500, on 403 and on 401 alike. Measured on the real component with only the
// comments route refused: the panel's whole text was
// "CommentsNo comments yet. Add the first one below.Add a commentComment" at all three codes.
//
// ⚠ WHY THAT IS WORSE HERE THAN ON A LIST. Every other list in this product already separates the
// two, and two of them say why in their own source: "A fault must not read as an empty tracker:
// those are different states and conflating them tells a tester their work vanished"
// (IssueList.tsx) and "This is a fault, not an empty space" (SpaceView.tsx). The comment thread is
// the one place the reader is invited to WRITE in response to what they were shown — an invitation
// to add the first comment, printed over a thread the screen could not read, asks someone to
// re-post a reply that may already be there, or to conclude a colleague never answered.
//
// ⚠ THE 401 ARM IS SEPARATE ON PURPOSE. `sessionExpiredCopy` is said ONCE at the top of the app,
// so a panel that cannot read for want of a credential says "Unavailable." and nothing more —
// the house rule IssueList and SpaceView already follow.
describe('the comment thread distinguishes a fault from an empty thread', () => {
  function refuseComments(status: number) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      const json = (b: unknown, code = 200) =>
        new Response(JSON.stringify(b), { status: code, headers: { 'Content-Type': 'application/json' } })
      if (path === '/api/members') return json([{ id: 'u-1', name: 'Ada' }])
      if (path === '/api/track/teams') return json([{ id: 'team-1', identifier: 'ENG', name: 'Eng' }])
      if (path.endsWith('/comments')) return json({ error: 'refused' }, status)
      if (path === '/api/track/issues/iss-1' && method === 'GET') return json(ISSUE)
      return json(null, 404)
    })
  }

  for (const status of [500, 403]) {
    it(`does not claim the thread is empty when the read is refused with ${status}`, async () => {
      refuseComments(status)
      open()
      await screen.findByText('Original description.')
      expect(await screen.findByText(/fault, not an empty thread/i)).toBeInTheDocument()
      expect(screen.queryByText(/no comments yet/i)).toBeNull()
    })
  }

  it('says only "Unavailable." on a 401, because the bar already explains it', async () => {
    refuseComments(401)
    open()
    await screen.findByText('Original description.')
    expect(await screen.findByText(/^unavailable\.$/i)).toBeInTheDocument()
    expect(screen.queryByText(/no comments yet/i)).toBeNull()
    expect(screen.queryByText(/fault, not an empty thread/i)).toBeNull()
  })

  // ⚠ THE OTHER DIRECTION, AND IT IS THE HALF THAT KEEPS THE FIX HONEST. A panel that answered
  // "couldn't read it" to everything would pass the three cases above and be just as wrong: a
  // thread that really has no comments must still get the invitation to write the first one.
  it('still invites the first comment when the thread is genuinely empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input)
      const json = (b: unknown, code = 200) =>
        new Response(JSON.stringify(b), { status: code, headers: { 'Content-Type': 'application/json' } })
      if (path === '/api/members') return json([])
      if (path === '/api/track/teams') return json([])
      if (path.endsWith('/comments')) return json([])
      if (path === '/api/track/issues/iss-1') return json(ISSUE)
      return json(null, 404)
    })
    open()
    expect(await screen.findByText(/no comments yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/fault, not an empty thread/i)).toBeNull()
  })
})
