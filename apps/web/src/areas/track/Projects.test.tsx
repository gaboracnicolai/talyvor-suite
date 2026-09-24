import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { IssueDetail } from './IssueDetail'
import { IssueList } from './IssueList'
import { Projects, suggestIdentifier } from './Projects'

// B4.2 — start a project, put an issue in it, filter the list by it. Driven at the wire.

beforeAll(() => {
  // Radix Select measures and captures pointers; jsdom does neither.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => vi.restoreAllMocks())

const TEAM = { id: 'team-1', identifier: 'ENG', name: 'Engineering' }
const PROJECT = { id: 'pr-1', team_id: 'team-1', name: 'Billing v2', identifier: 'BV', description: '', status: 'active' }
const ISSUE = {
  id: 'iss-1', workspace_id: 'w', team_id: 'team-1', number: 7, identifier: 'ENG-7', title: 'Cache stampede',
  description: '', status: 'todo', priority: 3, creator_id: 'u-1', lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

type Call = { url: string; method: string; body: unknown }
function mockTrack() {
  const calls: Call[] = []
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const raw = init?.body
    calls.push({ url, method, body: typeof raw === 'string' ? JSON.parse(raw) : raw })
    if (url === '/api/track/teams') return json([TEAM])
    if (url === '/api/track/projects') return method === 'POST' ? json({ ...PROJECT, id: 'pr-2' }, 201) : json([PROJECT])
    if (url === '/api/members') return json([])
    if (url.startsWith('/api/track/issues?')) return json([ISSUE])
    if (url === '/api/track/issues/iss-1') return method === 'PATCH' ? json({ ...ISSUE, project_id: 'pr-1' }) : json(ISSUE)
    if (url.endsWith('/comments')) return json([])
    return json(null, 404)
  })
  return calls
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/track" element={<IssueList />} />
          <Route path="/track/projects" element={<Projects />} />
          <Route path="/track/issues/:id" element={<IssueDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('projects', () => {
  it('suggests an identifier from the name, and starts the project with the four fields', async () => {
    expect(suggestIdentifier('Billing v2')).toBe('BV')
    expect(suggestIdentifier('Onboarding')).toBe('ONBO')
    const calls = mockTrack()
    renderAt('/track/projects')
    fireEvent.change(await screen.findByPlaceholderText('Billing v2'), { target: { value: 'Search relaunch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start project' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      team_id: 'team-1',
      name: 'Search relaunch',
      identifier: 'SR',
      description: '',
    })
    // Each project links to the issue list filtered to it.
    expect((await screen.findByRole('link', { name: 'Its issues' })).getAttribute('href')).toBe('/track?project=pr-1')
  })

  it('opens the issue list filtered to a project from its link', async () => {
    const calls = mockTrack()
    renderAt('/track?project=pr-1')
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/track/issues?'))).toBe(true))
    expect(calls.find((c) => c.url.startsWith('/api/track/issues?'))?.url).toContain('project_id=pr-1')
  })

  it('puts an issue in a project from its page', async () => {
    const calls = mockTrack()
    renderAt('/track/issues/iss-1')
    const picker = await screen.findByRole('combobox', { name: 'Project' })
    await waitFor(() => expect(picker.hasAttribute('data-disabled')).toBe(false))
    // Radix Select's typeahead on the CLOSED trigger: "B" picks "Billing v2" without opening the
    // popup, whose focus-guard spans are Radix internals the product's focus audit would flag.
    fireEvent.keyDown(picker, { key: 'B' })
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toEqual({
        url: '/api/track/issues/iss-1',
        method: 'PATCH',
        body: { project_id: 'pr-1' },
      }),
    )
  })
})
