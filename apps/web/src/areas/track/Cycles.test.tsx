import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Cycles } from './Cycles'

// B4.1 — start a cycle, add issues to it, see its progress. Driven at the wire.

const TEAM = { id: 'team-1', workspace_id: 'w', name: 'Platform', identifier: 'PLT', color: '', icon: '', created_at: '', updated_at: '' }
const CYCLE = { id: 'cy-1', team_id: 'team-1', name: 'Sprint 12', number: 12, status: 'active', start_date: '2026-10-01T00:00:00Z', end_date: '2026-10-15T00:00:00Z' }

type Call = { url: string; method: string; body: unknown }

function mockTrack(opts: { cycles?: unknown[]; progress?: Record<string, unknown>[] } = {}) {
  const calls: Call[] = []
  const progress = [...(opts.progress ?? [{ cycle_id: 'cy-1', total_issues: 0, completed: 0, in_progress: 0, not_started: 0, completion_pct: 0, total_ai_cost_usd: 0, avg_ai_cost_per_issue: 0 }])]
  let lastProgress = progress[0]
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const raw = init?.body
    calls.push({ url, method, body: typeof raw === 'string' ? JSON.parse(raw) : raw })
    if (url === '/api/track/teams') return json([TEAM])
    if (url === '/api/track/teams/team-1/cycles') return method === 'POST' ? json({ ...CYCLE, id: 'cy-2' }, 201) : json(opts.cycles ?? [])
    if (url === '/api/track/teams/team-1/cycles/cy-1/progress') {
      if (progress.length > 0) lastProgress = progress.shift() as Record<string, unknown>
      return json(lastProgress)
    }
    if (url.startsWith('/api/track/issues?cycle_id=cy-1')) return json([])
    if (url.startsWith('/api/track/issues?team_id=team-1')) {
      return json([
        { id: 'iss-1', title: 'Already planned', status: 'todo', cycle_id: 'cy-0', team_id: 'team-1' },
        { id: 'iss-2', title: 'Fix the flaky deploy', status: 'todo', team_id: 'team-1' },
      ])
    }
    if (url === '/api/track/issues/iss-2' && method === 'PATCH') return json({ id: 'iss-2' })
    return json({ error: 'no route' }, 404)
  })
  return calls
}

function renderCycles() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Cycles />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('cycles', () => {
  it('starts a cycle for the team with a name and two calendar days', async () => {
    const calls = mockTrack()
    renderCycles()
    fireEvent.change(await screen.findByPlaceholderText('Sprint 12'), { target: { value: 'Sprint 13' } })
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-16' } })
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start cycle' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      url: '/api/track/teams/team-1/cycles',
      method: 'POST',
      body: { name: 'Sprint 13', start_date: '2026-10-16T00:00:00Z', end_date: '2026-10-30T00:00:00Z' },
    })
  })

  it('shows each cycle’s progress as Track reports it', async () => {
    mockTrack({
      cycles: [CYCLE],
      progress: [{ cycle_id: 'cy-1', total_issues: 8, completed: 3, in_progress: 2, not_started: 3, completion_pct: 37.5, total_ai_cost_usd: 0.42, avg_ai_cost_per_issue: 0.05 }],
    })
    renderCycles()
    expect(await screen.findByText('Sprint 12')).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByTestId('cycle-progress').textContent).toContain('3 of 8 done · 38%'),
    )
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('38')
  })

  it('adds an unplanned issue to the cycle, and the progress is re-read', async () => {
    const calls = mockTrack({
      cycles: [CYCLE],
      progress: [
        { cycle_id: 'cy-1', total_issues: 0, completed: 0, in_progress: 0, not_started: 0, completion_pct: 0, total_ai_cost_usd: 0, avg_ai_cost_per_issue: 0 },
        { cycle_id: 'cy-1', total_issues: 1, completed: 0, in_progress: 0, not_started: 1, completion_pct: 0, total_ai_cost_usd: 0, avg_ai_cost_per_issue: 0 },
      ],
    })
    renderCycles()
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    expect(await screen.findByText('Fix the flaky deploy')).toBeTruthy()
    // An issue already in another cycle is not offered.
    expect(screen.queryByText('Already planned')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add to cycle' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toEqual({
        url: '/api/track/issues/iss-2',
        method: 'PATCH',
        body: { cycle_id: 'cy-1' },
      }),
    )
    await waitFor(() => expect(screen.getByTestId('cycle-progress').textContent).toContain('0 of 1 done'))
  })
})

// B3.4 — both of this screen's empty states go where they point.
describe('Cycles — empty states with somewhere to go', () => {
  it('no cycles: Start the first cycle puts the caret in Name', async () => {
    mockTrack({ cycles: [] })
    renderCycles()
    await screen.findByText(/^No cycles yet\./)
    fireEvent.click(screen.getByRole('button', { name: 'Start the first cycle' }))
    expect((document.activeElement as HTMLInputElement | null)?.placeholder).toBe('Sprint 12')
  })

  it('an empty cycle: Add issues opens it on this team’s open issues', async () => {
    mockTrack({ cycles: [CYCLE] })
    renderCycles()
    fireEvent.click(await screen.findByRole('button', { name: 'Add issues' }))
    expect(await screen.findByText('Fix the flaky deploy')).toBeInTheDocument()
  })
})
