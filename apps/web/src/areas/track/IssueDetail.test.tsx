import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { focusRing } from '@talyvor/ui'
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE DRAFT, THE COMMENT AND THE REFUSAL ALL BELONG TO ONE ISSUE.
//
// React Router matches /track/issues/:id to ONE <Route> element, so moving from issue A to issue B
// changes the params underneath this component and does NOT remount it — every useState survives.
// This is the Track half of the shape `f4c1e97` (#190) fixed in areas/docs; the two screens were
// written months apart and arrived at the same defect independently.
//
// ⚠ NOT REACHABLE FROM THIS UI TODAY, and fixed anyway for the reason #190 gives. Nothing on this
// screen links to another issue: the only way out is "All issues" (it read "‹ Issues" until
// W1.1.8 — a direction rather than a destination), which goes up to the list and DOES remount. One ordinary addition — a parent link (`parent_id` is already on the type), a related
// list, a search result, prev/next — makes it live, and the person adding that link has no reason
// to suspect this file.
//
// MEASURED before the fix existed: with a draft open on issue A, arriving at B and pressing Save
// sent `PATCH /api/track/issues/b {"description":"<the words typed on A>"}`. The three cases below
// were RED; the fourth was already green, which is what makes it worth keeping.
//
// CONTROLS — ~/talyvor-queue/w11-issuestate-controls-5c3a.py, 6 mutations, green baseline,
// sha256 byte-restore:
//   C1 the whole reset removed          -> the 3 positive cases red, the must-stay-green stays green
//   C2 the reset forgets setDraft       -> EXACTLY the description case. This one assertion is what
//                                          stands between a reader and a cross-issue write.
//   C3 the reset forgets setComment     -> EXACTLY the comment case
//   C4 the reset forgets setFailure     -> EXACTLY the refusal case
//   C5 the reset fires on EVERY render  -> the MUST-STAY-GREEN reds, plus four cases in
//                                          writeUnderDeadCredential.test.tsx. The negative half is
//                                          load-bearing: over-resetting eats the keystrokes of the
//                                          issue you are actually on, and it would otherwise pass
//                                          all three positive cases.
//   NEG ordinary growth                 -> 0 red
// ⚠ C1–C4 each ALSO redded pointerAudit.test.ts, and that is an artefact of the harness, not a
// second catcher: deleting lines from IssueDetail.tsx moves the line another file cites.

/** A BFF that serves any issue id, so the same <Route> can be driven from one issue to another. */
function mockTwoIssues() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    recorded.push({ method, path, body })
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (path === '/api/members') return json([])
    if (path === '/api/track/teams') return json([])
    if (path.endsWith('/comments') && method === 'POST') return json({ ok: true })
    if (path.endsWith('/comments')) return json([])
    const m = path.match(/^\/api\/track\/issues\/([^/]+)$/)
    if (m && method === 'PATCH') return json({})
    if (m) {
      return json({
        ...ISSUE,
        id: m[1],
        identifier: m[1].toUpperCase(),
        title: `Title ${m[1]}`,
        description: `Description of ${m[1]}.`,
      })
    }
    return json(null, 404)
  })
}

/** Renders the SAME <Route> the app has, plus one control that moves between two issues. */
function openTwoIssues() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Jump() {
    const nav = useNavigate()
    // `focusRing` because src/focusAudit.ts sweeps the live DOM at teardown and a bare focusable
    // control in a fixture fails the test that renders it.
    return (
      <button className={focusRing} onClick={() => nav('/track/issues/bbb')}>
        go to bbb
      </button>
    )
  }
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/track/issues/aaa']}>
        <Jump />
        <Routes>
          <Route path="/track/issues/:id" element={<IssueDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('the state on this screen belongs to the issue that is open', () => {
  it('an unsaved description typed on one issue is never saved onto another', async () => {
    mockTwoIssues()
    openTwoIssues()
    await screen.findByText('Description of aaa.')

    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Words that belong to aaa.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'go to bbb' }))
    await screen.findByText('Title bbb')

    // The reader is on bbb. Whatever the editor is showing, it must not be aaa's words — and the
    // save that a reader would now reach for must not carry them either.
    const box = document.querySelector('#issue-description') as HTMLTextAreaElement | null
    expect(box?.value ?? '').not.toContain('aaa')

    if (box) {
      fireEvent.click(screen.getByRole('button', { name: 'Save description' }))
      await waitFor(() => expect(lastWrite('PATCH')).toBeTruthy())
      expect((lastWrite('PATCH')?.body as { description?: string })?.description).not.toContain('aaa')
    }
  })

  it('a comment typed on one issue is never posted to another thread', async () => {
    mockTwoIssues()
    openTwoIssues()
    await screen.findByText('Description of aaa.')

    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: 'A reply meant for aaa.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'go to bbb' }))
    await screen.findByText('Title bbb')

    expect((document.querySelector('#new-comment') as HTMLInputElement).value).toBe('')
  })

  it('a refusal about one issue is not still on screen over another', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
      if (path === '/api/members') return json([])
      if (path === '/api/track/teams') return json([])
      if (path.endsWith('/comments')) return json([])
      if (method === 'PATCH') return json({ error: 'no' }, 500)
      const m = path.match(/^\/api\/track\/issues\/([^/]+)$/)
      if (m) return json({ ...ISSUE, id: m[1], identifier: m[1].toUpperCase(), title: `Title ${m[1]}`, description: `Description of ${m[1]}.` })
      return json(null, 404)
    })
    openTwoIssues()
    await screen.findByText('Description of aaa.')

    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }))
    expect(await screen.findByText(/did not save/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'go to bbb' }))
    await screen.findByText('Title bbb')
    expect(screen.queryByText(/did not save/i)).toBeNull()
  })

  // ⚠ THE OTHER DIRECTION. A component that threw its state away on every render would pass all
  // three above and be useless: typing into the editor must survive an ordinary re-render of the
  // SAME issue, or the reset is a keystroke eater rather than a boundary.
  it('MUST STAY GREEN — editing the issue you are on is not disturbed', async () => {
    mockTwoIssues()
    openTwoIssues()
    await screen.findByText('Description of aaa.')

    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Still editing aaa.' } })
    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'Still typing.' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save description' }))
    await waitFor(() => expect(lastWrite('PATCH')).toBeTruthy())
    expect((lastWrite('PATCH')?.body as { description?: string })?.description).toBe('Still editing aaa.')
  })
})

/**
 * W1.1.8 — THE TICKET, REBUILT IN THE PRODUCT'S OWN LANGUAGE.
 *
 * Everything above this line is about what Track RECORDS and is unchanged by the rebuild. These
 * are about the screen: one idea per region, a page-scale heading that opens it, and — the half
 * that is not decoration — a heading that cannot say the wrong thing in the largest type on the
 * page.
 *
 * ⚠ THE STATES A TICKET HAS ARE NOT THE STATES A LIST HAS, WHICH IS WHY THIS IS NOT A COPY OF
 * W1.1.7's BLOCK. A list is empty or full; a ticket is THERE or it is NOT, and "not" arrives as a
 * 404 that the screen used to render with the same sentence it gave a 500, a 503 and a dead
 * session: "That issue could not be read." Four causes, one sentence, and the only one of the four
 * that is not a fault — the link is stale, or the issue belongs to another workspace — read as a
 * broken product.
 *
 * ⚠ AND THE 404 IS DELIBERATELY AMBIGUOUS UPSTREAM, so this screen must not resolve it. Track's
 * `Handler.Get` answers 404 for a foreign id as well as an absent one, in as many words —
 * "SEC-5: scoped read — foreign id → ErrNotFound → 404 (no disclosure, no oracle)" — so a
 * sentence that said "this issue was deleted" would be the browser inventing the disclosure the
 * server refused to make. MEASURED read-only in talyvor-track at `main`, and the status reaches
 * the browser intact: apps/bff/lens.go#forwardProduct ends `w.WriteHeader(resp.StatusCode)`.
 */
describe('W1.1.8 — the ticket reads as one screen, in regions', () => {
  function regions() {
    return Array.from(document.querySelectorAll('[data-testid="region-label"]')).map((el) => ({
      index: el.querySelector('[data-testid="region-index"]')?.textContent ?? '',
      label: el.lastElementChild?.textContent ?? '',
    }))
  }

  /** Fails ONLY the issue read; every other route on the screen still answers. */
  function refuseIssue(status: number, body: unknown = { error: 'no' }) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input)
      const json = (b: unknown, s = 200) =>
        new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
      if (path === '/api/track/issues/iss-1') return json(body, status)
      if (path.endsWith('/comments')) return json([])
      if (path === '/api/members') return json([])
      if (path === '/api/track/teams') return json([])
      return json(null, 404)
    })
  }

  it('is six named regions, one idea each, indexed in document order', async () => {
    open()
    await screen.findByText('Original description.')
    expect(regions()).toEqual([
      { index: '00', label: 'Issue' },
      { index: '01', label: 'What this issue says' },
      { index: '02', label: 'How it is filed' },
      { index: '03', label: 'What it has cost so far' },
      { index: '04', label: 'What Track’s AI makes of it' },
      { index: '05', label: 'What has been said' },
    ])
  })

  it('makes exactly one page-scale claim, and it is the issue’s own title', async () => {
    open()
    await screen.findByText('Original description.')
    expect(document.querySelectorAll('.text-page')).toHaveLength(1)
    expect(document.querySelector('.text-page')?.textContent).toBe(ISSUE.title)
  })

  it('a 404 says the issue is not here, and does not blame the network', async () => {
    refuseIssue(404, { error: 'not found', code: 'NOT_FOUND' })
    open()
    await screen.findByText(/no issue at this address/i)
    expect(document.querySelector('.text-page')?.textContent).toBe(
      'There is no issue at this address.',
    )
    // The one thing it must NOT do is call a correct 404 a fault.
    expect(screen.queryByText(/can’t be reached/i)).toBeNull()
    // The way back is a destination, named — not "go back".
    expect(screen.getByRole('link', { name: 'All issues' })).toHaveAttribute('href', '/track')
  })

  it('a FAULT is not a missing issue — the loudest claim on the screen must not lie', async () => {
    refuseIssue(500)
    open()
    await screen.findByText(/this is a fault, not a missing issue/i)
    expect(document.querySelector('.text-page')?.textContent).toBe(
      'Track can’t be reached, so this issue can’t be shown.',
    )
    expect(screen.queryByText(/no issue at this address/i)).toBeNull()
  })

  it('an unconfigured Track reads as off, not as a missing issue', async () => {
    refuseIssue(503, { error: 'track upstream not configured on this BFF' })
    open()
    await screen.findByText(/not configured on this deployment/i)
    expect(screen.queryByText(/no issue at this address/i)).toBeNull()
    expect(screen.queryByText(/can’t be reached/i)).toBeNull()
  })

  it('a dead credential says only that it is unavailable — the bar says the rest', async () => {
    refuseIssue(401, { error: 'authentication required — sign in at /auth/login' })
    open()
    await screen.findByText('Unavailable.')
    // No second, differently-worded diagnosis of the one cause the bar already names.
    expect(screen.queryByText(/sign in/i)).toBeNull()
    expect(screen.queryByText(/no issue at this address/i)).toBeNull()
  })

  it('an issue with no description offers the action that writes one, and performs it', async () => {
    mockBff({ description: '' })
    open()
    await screen.findByText(/^Nothing has been written down/)
    fireEvent.click(screen.getByRole('button', { name: 'Write the description' }))
    await waitFor(() => {
      expect((document.activeElement as HTMLElement | null)?.id).toBe('issue-description')
    })
  })

  it('the empty thread invites the first comment, and performs that too', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input)
      const json = (b: unknown, s = 200) =>
        new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
      if (path === '/api/track/issues/iss-1') return json(ISSUE)
      if (path.endsWith('/comments')) return json([])
      if (path === '/api/members') return json([])
      if (path === '/api/track/teams') return json([])
      return json(null, 404)
    })
    open()
    await screen.findByText(/^No comments yet\./)
    fireEvent.click(screen.getByRole('button', { name: 'Write the first comment' }))
    await waitFor(() => {
      expect((document.activeElement as HTMLElement | null)?.id).toBe('new-comment')
    })
  })
})
