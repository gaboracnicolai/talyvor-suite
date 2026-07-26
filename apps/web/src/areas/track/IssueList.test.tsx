import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IssueList } from './IssueList'
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

    if (url === '/api/track/issues' && method === 'GET') return json(issues)
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

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <IssueList />
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
