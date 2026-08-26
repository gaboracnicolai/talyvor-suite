import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_VIEW, IssueList, SORT_OPTIONS, issuesQuery } from './IssueList'
import { priorityLabel } from './format'
import { blankComments } from '../../../../../packages/ui/src/lib/sourceText'
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
    // ⚠ THIS CASE USED TO SEND `orderBy: 'priority'` AND ASSERT order_by=priority. It was a
    // true statement about the request and blind to what the request MEANT: the parameter was
    // forwarded and validated exactly as pinned, and the rows came back least-important first.
    // See the sort-control block at the end of this file for what was measured.
    const q = new URLSearchParams(
      issuesQuery({ status: 'in_progress', assignee: 'm-1', orderBy: 'created_at' }),
    )
    expect(q.get('status')).toBe('in_progress')
    expect(q.get('assignee_id')).toBe('m-1') // NOT "assignee" — the BFF rejects unknown keys
    expect(q.get('order_by')).toBe('created_at')
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

// ── THE SORT CONTROL MAY ONLY OFFER AN ORDERING THE UPSTREAM CAN DELIVER ────────────────
//
// This screen sends ONE direction — `order_dir=desc` — for whichever column is chosen, and
// that is correct for a timestamp: newest first is what a person means by "recently updated".
// It is not a property of every column in the upstream allowlist.
//
// MEASURED, real Chrome on the built bundle, the real issues DDL in a real Postgres running
// the ORDER BY talyvor-track's own store builds (internal/issue/store.go#Store.List). The control
// read "Priority" and the screen read, top to bottom:
//
//     Low — rename a variable            priority 4
//     Medium — tidy the settings copy    priority 3
//     High — customer data export fails  priority 2
//     Urgent — production is down        priority 1   ← FOURTH of five
//     None — unprioritised note          priority 0
//
// model.IssuePriority (upstream `internal/model/model.go`, `type IssuePriority`) numbers 0 None, 1 Urgent,
// 2 High, 3 Medium, 4 Low, so a numeric sort is not an importance sort in EITHER direction:
// desc buries Urgent under everything, and asc puts the UNPRIORITISED rows above it.
describe('the sort control offers only orderings the upstream can actually deliver', () => {
  it('offers exactly the two timestamp columns', () => {
    // Hardcoded rather than derived from SORT_OPTIONS: a guard that reads the constant it is
    // policing passes for every value the constant could take.
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual(['updated_at', 'created_at'])
  })

  it('every column it offers is one where a single hardcoded desc means "most useful first"', () => {
    // The direction is not a per-column choice on this screen — it is one literal. That is only
    // sound while every offered column is a timestamp. `priority` and `sort_order`, the other
    // two the upstream accepts, are not, and neither has a direction that ranks importance.
    for (const o of SORT_OPTIONS) {
      expect(o.value.endsWith('_at')).toBe(true)
      const q = new URLSearchParams(issuesQuery({ status: '', assignee: '', orderBy: o.value }))
      expect(q.get('order_by')).toBe(o.value)
      expect(q.get('order_dir')).toBe('desc')
    }
  })

  it('no view this screen can build asks the upstream to order by priority', () => {
    for (const o of SORT_OPTIONS) {
      expect(issuesQuery({ status: 'todo', assignee: 'm-1', orderBy: o.value })).not.toContain(
        'order_by=priority',
      )
    }
  })

  // The four tests above all read SORT_OPTIONS, so they are blind to a Sort item written
  // straight into the JSX — which is how the removed option would come back, since that is
  // the shape it had. The rendered items are generated from the constant; this asserts that
  // no ORDER BY column is spelled as a literal item anywhere in the screen.
  //
  // ⚠ COMMENTS ARE BLANKED FIRST. The block above SORT_OPTIONS discusses `priority` at length,
  // and a scanner that cannot tell a mention from a setting reports the documentation as the
  // defect — the same trap `decision-expiry.sh` D9 was rewritten for.
  it('the sort items are generated from SORT_OPTIONS, not written as literals', () => {
    const src = blankComments(
      readFileSync(resolve(import.meta.dirname, 'IssueList.tsx'), 'utf8'),
    )
    // The upstream's ORDER BY allowlist (talyvor-track internal/issue/store.go#Store.List, the
    // "Order column allowlist" switch), mirrored by the BFF in trackOrderBy — a closed set, not
    // a hand-kept list of things to avoid.
    //
    // ⚠ THIS AND THE TWO POINTERS ABOVE USED TO NAME LINES, AND ALL THREE NAMED THE WRONG
    // FUNCTION. They pointed inside `attachBlocked` / `attachTimeTracked` — the badge helpers
    // whose own upstream comment says they are "informational, not load-bearing" and which
    // swallow their errors. A reader checking whether this closed set is still closed landed
    // there and had every reason to conclude the premise was dead. The allowlist is real and
    // unchanged; only the pointers were false. See rule D in `upstreamCitations.test.ts`.
    for (const col of ['created_at', 'updated_at', 'priority', 'sort_order']) {
      expect(src, `an ORDER BY column is a literal <SelectItem>: ${col}`).not.toContain(
        `<SelectItem value="${col}"`,
      )
    }
    expect(src).toContain('SORT_OPTIONS.map')
  })

  // ⚠ THIS TEST CARRIES ITS OWN EXPIRY. It holds the PREMISE of the absence above — that the
  // upstream enum is not ordered by importance — rather than the absence itself, and it reads
  // the product's own label map to do it. The day priority is renumbered so that one numeric
  // direction IS the importance order, this fails and says to put the option back.
  it('the priority enum is not ordered by importance in either direction', () => {
    const VALUES = [0, 1, 2, 3, 4] as const // model.IssuePriority, upstream `model.go` `type IssuePriority`
    const IMPORTANCE = ['Urgent', 'High', 'Medium', 'Low', 'None'] // what "sort by priority" means
    const asc = [...VALUES].sort((a, b) => a - b).map((p) => priorityLabel(p))
    const desc = [...VALUES].sort((a, b) => b - a).map((p) => priorityLabel(p))
    expect(asc, `asc reads ${asc.join(' > ')}`).not.toEqual(IMPORTANCE)
    expect(desc, `desc reads ${desc.join(' > ')}`).not.toEqual(IMPORTANCE)
  })
})

/**
 * W1.1.7 — THE PAGE-SCALE HEADING IS A THIRD PLACE THE THREE STATES CAN COLLAPSE.
 *
 * This file's oldest comment already states the rule, about the PANEL: "Track is not deployed
 * here" (503), "Track is broken" (5xx) and "you have no issues yet" ([]) mean completely different
 * things to a tester, and laundering any of them into another tells them their work vanished or
 * that a fault is normal.
 *
 * The rebuild added a heading that makes one of those claims in the largest type on the screen, so
 * it added a new way to get it wrong — and a louder one. `rows.length === 0` is the obvious
 * predicate and it is WRONG TWICE: it is true while the read is still in flight, and true when the
 * read FAILED. Hence `answered = !isLoading && !isError`.
 *
 * ⚠ THE LOADING CASE IS WHY THIS TEST EXISTS AT ALL. My first probe of the empty state asserted
 * against the heading as soon as it appeared in the DOM and read the NEUTRAL headline — the
 * heading renders from the first paint, while `answered` is still false. The screen was right and
 * the instrument was sampling the wrong moment; a test that waits for the read to ANSWER (here,
 * for the panel's own sentence) is the one that can tell the two apart.
 *
 * Not a sweep, and not a new guard family — three assertions about copy this item introduced.
 */
describe('W1.1.7 — the page-scale heading does not collapse the three states', () => {
  it('a populated tracker says what it is', async () => {
    fakeBff([issue({ id: 'i1', identifier: 'TAL-1', title: 'A real issue' })])
    renderList()
    await screen.findByText('A real issue')
    expect(document.querySelector('.text-page')?.textContent).toBe(
      'Everything this workspace is tracking.',
    )
    // exactly one page-scale claim, as on every rebuilt screen
    expect(document.querySelectorAll('.text-page')).toHaveLength(1)
  })

  it('an EMPTY tracker says so, and offers the action that fills it', async () => {
    fakeBff([])
    renderList()
    // ⚠ wait for the READ TO ANSWER, not for the heading to exist — see the block comment.
    // The panel's own sentence is the signal that the query resolved; it carries its next action
    // too (EmptyStates.test.tsx's rule), so it is matched by prefix rather than exactly.
    await screen.findByText(/^No issues yet\./)
    expect(document.querySelector('.text-page')?.textContent).toBe(
      'Nothing is being tracked in this workspace yet.',
    )
    // The next action is PERFORMED, not described: the button puts the caret in the title field.
    const cta = screen.getByRole('button', { name: /write the first issue/i })
    fireEvent.click(cta)
    await waitFor(() => {
      expect((document.activeElement as HTMLInputElement | null)?.placeholder).toBe(
        'What needs doing?',
      )
    })
  })

  it('a FAULT is not an empty tracker — the loudest claim on the screen must not lie', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      const json = (v: unknown, status = 200) =>
        new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
      if (url.startsWith('/api/track/issues')) return json({ error: 'boom' }, 500)
      return json([])
    })
    renderList()
    await screen.findByText(/This is a fault, not an empty tracker/i)
    expect(document.querySelector('.text-page')?.textContent).toBe(
      'Track can’t be reached, so nothing can be listed.',
    )
    // and it must not offer the empty state's invitation over a broken read
    expect(screen.queryByRole('button', { name: /write the first issue/i })).toBeNull()
  })
})
