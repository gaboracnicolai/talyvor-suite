import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW, IssueList, issuesQuery } from './IssueList'
import type { TrackIssue } from './types'

// THE THREE THINGS A TESTER DOES: land on an empty tracker, create an issue and see it, change its
// status and see that. Asserted through the component against a faked BFF, because these are claims
// about the SCREEN — the tenancy claims (whose workspace a write lands in) are asserted in the BFF
// suite instead, where the upstream path is visible and a form posting to the wrong tenant would
// look identical here.
//
// NO FABRICATED DATA anywhere: the empty case renders because the API returns [], not because a
// fixture says so. The fourteen-row invented table this screen used to have was deleted for exactly
// that reason, and nothing here reintroduces it.

function issue(over: Partial<TrackIssue> = {}): TrackIssue {
  return {
    id: 'iss-1',
    workspace_id: 'ws-1',
    team_id: 'team-1',
    number: 1,
    identifier: 'TAL-1',
    title: 'First issue',
    description: '',
    status: 'todo',
    priority: 0,
    creator_id: 'mem-1',
    lens_feature: '',
    ai_cost_usd: 0,
    ai_tokens: 0,
    created_at: '2026-07-27T00:00:00Z',
    updated_at: '2026-07-27T00:00:00Z',
    ...over,
  }
}

/** A fake BFF whose issue list is real server state: POST and PATCH mutate it, GET reflects it. */
function fakeBff(initial: TrackIssue[] = []) {
  let issues = [...initial]
  const calls: { method: string; url: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })

    // ⚠ The list now sends a QUERY (order_by/limit, plus status/assignee when set) — that is the
    // change under test, so the mock matches the PATH and lets the query through. Assertions that
    // care about the query read `calls` directly.
    if (url.startsWith('/api/track/issues?') && method === 'GET') return json(issues)
    if (url === '/api/track/issues' && method === 'GET') return json(issues)
    if (url.startsWith('/api/members')) return json([])
    if (url === '/api/track/issues' && method === 'POST') {
      const created = issue({
        id: `iss-${issues.length + 1}`,
        identifier: `TAL-${issues.length + 1}`,
        number: issues.length + 1,
        title: String((body as { title?: string })?.title ?? ''),
        status: 'todo',
      })
      issues = [...issues, created]
      return json(created, 201)
    }
    const patch = url.match(/^\/api\/track\/issues\/([^/]+)$/)
    if (patch && method === 'PATCH') {
      issues = issues.map((i) =>
        i.id === patch[1] ? { ...i, status: (body as { status: TrackIssue['status'] }).status } : i,
      )
      return json(issues.find((i) => i.id === patch[1]))
    }
    return new Response('null', { status: 404 })
  })
  return { calls }
}

// ⚠ A ROUTER IS NOW PART OF THIS SCREEN'S ENVIRONMENT. Each row's title links to the issue detail,
// which is the change that made the list usable at all — so the list can no longer render outside a
// router, and this helper provides the one the app already gives it. Rendering it standalone tested
// a configuration the product does not have.
function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IssueList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('the issue list a tester actually uses', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('shows a genuine empty state for a brand-new workspace, not invented rows', async () => {
    fakeBff([])
    renderList()
    expect(await screen.findByText(/no issues yet/i)).toBeInTheDocument()
    // The old screen invented fourteen rows. Nothing that looks like an issue may appear here.
    expect(screen.queryByRole('row')).toBeNull()
  })

  it('lists what the API returns', async () => {
    fakeBff([issue({ title: 'Existing work' })])
    renderList()
    expect(await screen.findByText('Existing work')).toBeInTheDocument()
  })

  // ⚠ THE CLAIM: create an issue and SEE IT, with no reload. This fails if the list query is not
  // invalidated after the POST — the most likely way this screen is subtly broken.
  it('creates an issue and shows it without a reload', async () => {
    const { calls } = fakeBff([])
    renderList()
    await screen.findByText(/no issues yet/i)

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Ship the trial' } })
    fireEvent.click(screen.getByRole('button', { name: /create issue/i }))

    expect(await screen.findByText('Ship the trial')).toBeInTheDocument()
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.url).toBe('/api/track/issues')
    expect((post?.body as { title: string }).title).toBe('Ship the trial')
  })

  it('changes a status and shows the new one without a reload', async () => {
    const { calls } = fakeBff([issue({ title: 'Existing work', status: 'todo' })])
    renderList()
    await screen.findByText('Existing work')

    fireEvent.change(await screen.findByLabelText(/status for TAL-1/i), {
      target: { value: 'in_progress' },
    })

    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH')
      expect(patch?.url).toBe('/api/track/issues/iss-1')
      expect((patch?.body as { status: string }).status).toBe('in_progress')
    })
    await waitFor(() =>
      expect((screen.getByLabelText(/status for TAL-1/i) as HTMLSelectElement).value).toBe(
        'in_progress',
      ),
    )
  })

  it('refuses to submit an empty title rather than posting a blank issue', async () => {
    const { calls } = fakeBff([])
    renderList()
    await screen.findByText(/no issues yet/i)
    fireEvent.click(screen.getByRole('button', { name: /create issue/i }))
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true))
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────
// WHEN THE CREATE IS REFUSED, SAY WHY.
//
// The live failure was a 400 from Track carrying an exact reason:
//
//   {"error":"issue: WorkspaceID, TeamID, Title, and CreatorID are required","code":"CREATE_FAILED"}
//
// The screen threw that away — it kept the status and rendered "Try again". So the only way to learn
// what was wrong was to open the network tab, which is where this bug was in fact found, and the
// advice was WRONG: no number of retries produces a team. A structural refusal told the reporter it
// was transient.
//
// ⚠ THE COPY IS THE DEFECT, so the copy is what is asserted, both directions: the reason must be
// shown, and "Try again" must NOT appear on a 4xx. A test that only checked "some error is visible"
// would have passed against the version that shipped.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Refuses every create with a chosen status and body — the shape Track's writeErr produces. */
function refusingBff(status: number, payload: unknown) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const json = (v: unknown, s = 200) =>
      new Response(JSON.stringify(v), { status: s, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('/api/track/issues?') && method === 'GET') return json([])
    if (url === '/api/track/issues' && method === 'GET') return json([])
    if (url.startsWith('/api/members')) return json([])
    if (url === '/api/track/issues' && method === 'POST') return json(payload, status)
    return new Response('null', { status: 404 })
  })
}

async function submitTitle(text: string) {
  fireEvent.change(await screen.findByLabelText(/title/i), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: /create issue/i }))
}

describe('a refused create explains itself', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('shows the upstream reason for a 400 instead of inviting a pointless retry', async () => {
    refusingBff(400, {
      error: 'issue: WorkspaceID, TeamID, Title, and CreatorID are required',
      code: 'CREATE_FAILED',
    })
    renderList()
    await submitTitle('Write the thing down')

    expect(await screen.findByText(/TeamID/)).toBeInTheDocument()
    // ⚠ The wrong advice must be GONE, not merely accompanied by the reason.
    expect(screen.queryByText(/Try again/i)).toBeNull()
  })

  it('a workspace with several teams gets the actionable message, not a generic one', async () => {
    refusingBff(400, {
      error: 'this workspace has several teams — name one in team_id',
      code: 'TEAM_REQUIRED',
    })
    renderList()
    await submitTitle('Ambiguous')

    expect(await screen.findByText(/name one in team_id/)).toBeInTheDocument()
  })

  it('a 5xx IS retryable, so that copy survives', async () => {
    refusingBff(503, { error: 'track upstream not configured on this BFF' })
    renderList()
    await submitTitle('Upstream down')

    expect(await screen.findByText(/Try again/i)).toBeInTheDocument()
  })

  it('a refusal with no readable body still says something honest', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/track/issues' && method === 'GET')
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url === '/api/track/issues' && method === 'POST') return new Response('<html>502</html>', { status: 502 })
      return new Response('null', { status: 404 })
    })
    renderList()
    await submitTitle('Gateway ate it')

    expect(await screen.findByText(/Couldn’t create that issue/)).toBeInTheDocument()
  })
})

// ⚠ THE VIEW CONTROLS. The value of this rail is not that it has dropdowns — it is that each one
// becomes a parameter the BFF already validates, so the list narrows a SET rather than a PAGE.
// These assert the request that goes out, because that is where the honesty lives: a control that
// filtered the rows already fetched would look identical on screen and be a lie about what it
// searched.
describe('the view controls query the server, not the page', () => {
  it('the default view asks for most-recently-updated first, bounded', () => {
    // Sorting is what keeps the list usable as it grows — the work someone is touching stays on
    // top without them filtering for it. Pinned as the DEFAULT, not merely as an option.
    const q = new URLSearchParams(issuesQuery(DEFAULT_VIEW))
    expect(q.get('order_by')).toBe('updated_at')
    expect(q.get('order_dir')).toBe('desc')
    expect(q.get('limit')).toBe('50')
    // Absent controls are OMITTED, never sent blank: the BFF reads present-but-empty as
    // absent-filter semantics, so sending one would make the request say something unasked.
    expect(q.has('status')).toBe(false)
    expect(q.has('assignee_id')).toBe(false)
  })

  it('a chosen status and assignee are sent as the parameters the BFF validates', () => {
    const q = new URLSearchParams(
      issuesQuery({ status: 'in_progress', assignee: 'm-1', orderBy: 'priority' }),
    )
    expect(q.get('status')).toBe('in_progress')
    expect(q.get('assignee_id')).toBe('m-1') // NOT "assignee" — the BFF rejects unknown keys
    expect(q.get('order_by')).toBe('priority')
  })

  it('sends only keys the BFF forwards — an unknown one is a 400, not a silent no-op', () => {
    // The BFF refuses unknown query parameters outright, and refuses `labels` specifically
    // because upstream would return unfiltered results while appearing to filter. So the set
    // this screen can send is closed, and this pins it.
    const allowed = new Set([
      'status', 'team_id', 'project_id', 'cycle_id', 'assignee_id',
      'priority', 'order_by', 'order_dir', 'limit', 'offset',
    ])
    for (const v of [
      DEFAULT_VIEW,
      { status: 'done' as const, assignee: 'm-2', orderBy: 'created_at' as const },
    ]) {
      for (const key of new URLSearchParams(issuesQuery(v)).keys()) {
        expect(allowed.has(key)).toBe(true)
      }
    }
    expect(issuesQuery(DEFAULT_VIEW)).not.toContain('labels')
  })

  // ⚠ WHAT THIS DOES *NOT* TEST, DELIBERATELY. Driving the Select open and picking an option
  // tests the design-system component, not this screen — and no test in this area drives one
  // (IssueDetail's three Selects are untested for interaction too). Rather than assert through a
  // component I do not own, this pins the seam I do: the component asks for exactly what
  // issuesQuery builds, and issuesQuery is pinned above for every view. A regression in either
  // half fails here or there.
  it('the list fetches exactly what issuesQuery builds for the default view', async () => {
    const { calls } = fakeBff([issue({ id: 'i1', identifier: 'TAL-1', title: 'One' })])
    renderList()
    await screen.findByText('One')

    const get = calls.find((c) => c.method === 'GET' && c.url.startsWith('/api/track/issues'))
    expect(get).toBeDefined()
    expect(get!.url).toBe(`/api/track/issues?${issuesQuery(DEFAULT_VIEW)}`)
  })

  it('a full page says there may be more, and does NOT invent a total', async () => {
    // Track's store has no COUNT, so "N of M" is unavailable to this screen and to the BFF. A
    // full page is the only honest signal, and the copy must not imply a number it cannot know.
    const many = Array.from({ length: 50 }, (_, i) =>
      issue({ id: `i${i}`, identifier: `TAL-${i}`, number: i, title: `Issue ${i}` }),
    )
    fakeBff(many)
    renderList()

    expect(await screen.findByText(/Showing the first 50/i)).toBeInTheDocument()
    expect(screen.getByText(/no total to count against/i)).toBeInTheDocument()
    expect(screen.queryByText(/of \d+/i)).toBeNull()
  })

  it('a partial page says nothing about more', async () => {
    fakeBff([issue({ id: 'i1', identifier: 'TAL-1', title: 'Only one' })])
    renderList()
    await screen.findByText('Only one')
    expect(screen.queryByText(/Showing the first/i)).toBeNull()
  })
})
