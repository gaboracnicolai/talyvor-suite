import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrackArea } from './TrackArea'
import type { TrackIssue, TrackMember } from './types'

// B27.30 — an issue is created, assigned, moved and closed with the keyboard alone, through the real
// Track area. Keys are dispatched on the focused element, as a browser dispatches them; what is
// asserted is the issue Track ended up holding, not a status code.

function issue(n: number, title: string): TrackIssue {
  return {
    id: `iss-${n}`,
    workspace_id: 'ws-1',
    team_id: 'team-1',
    number: n,
    identifier: `TAL-${n}`,
    title,
    description: '',
    status: 'backlog',
    priority: 0,
    creator_id: 'mem-1',
    lens_feature: '',
    ai_cost_usd: 0,
    ai_tokens: 0,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  }
}

const PEOPLE: TrackMember[] = [
  { id: 'mem-1', name: 'Grace Hopper', email: 'grace@example.com', role: 'owner', avatar_url: '' },
  { id: 'mem-2', name: 'Ada Lovelace', email: 'ada@example.com', role: 'member', avatar_url: '' },
]

/** A stateful Track behind the BFF: creates and edits land in `issues`, and every read sees them. */
function fakeTrack() {
  const issues: TrackIssue[] = [issue(1, 'An issue already here')]
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/track/issues' && method === 'POST') {
      const created = issue(issues.length + 1, JSON.parse(String(init?.body)).title)
      issues.unshift(created)
      return json(created, 201)
    }
    if (url.startsWith('/api/track/issues?')) return json(issues)
    const one = url.match(/^\/api\/track\/issues\/(iss-\d+)$/)
    if (one && method === 'PATCH') {
      const it = issues.find((i) => i.id === one[1])!
      Object.assign(it, JSON.parse(String(init?.body)))
      return json(it)
    }
    if (url === '/api/members') return json(PEOPLE)
    return json([])
  })
  return issues
}

function renderTrack() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/track']}>
        <Routes>
          <Route path="/track/*" element={<TrackArea />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key })

/** Enter in a form's text field submits the form — the browser's implicit submission, which jsdom
 *  does not perform on its own. */
function enter() {
  const field = document.activeElement as HTMLInputElement
  if (fireEvent.keyDown(field, { key: 'Enter' }) && field.form) fireEvent.submit(field.form)
}

const type = (text: string) => fireEvent.change(document.activeElement!, { target: { value: text } })

afterEach(() => vi.restoreAllMocks())

describe('issue work from the keyboard alone (B27.30)', () => {
  it('c creates, a assigns, s moves and x closes — and Track holds each change', async () => {
    const track = fakeTrack()
    renderTrack()
    await screen.findByText('An issue already here')

    // Create.
    press('c')
    type('Fix the login loop')
    enter()
    const link = await screen.findByRole('link', { name: 'Fix the login loop' })
    expect(track[0]).toMatchObject({ identifier: 'TAL-2', title: 'Fix the login loop', status: 'backlog' })

    // To the new issue: leave the field, then j.
    press('Escape')
    press('j')
    expect(document.activeElement).toBe(link)

    // Assign.
    press('a')
    expect(await screen.findByRole('dialog', { name: 'Assign TAL-2 to…' })).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Ada Lovelace' })
    type('ada')
    press('Enter')
    await waitFor(() => expect(track[0].assignee_id).toBe('mem-2'))
    expect(await screen.findByText('TAL-2 assigned to Ada Lovelace.')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Fix the login loop' })))

    // Move: Backlog → Todo → In progress.
    press('s')
    expect(await screen.findByRole('dialog', { name: 'Move TAL-2 to…' })).toBeInTheDocument()
    press('ArrowDown')
    press('ArrowDown')
    press('Enter')
    await waitFor(() => expect(track[0].status).toBe('in_progress'))
    expect(await screen.findByText('TAL-2 moved to In progress.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Close.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Fix the login loop' })))
    press('x')
    await waitFor(() => expect(track[0].status).toBe('done'))
    expect(await screen.findByText('TAL-2 closed.')).toBeInTheDocument()

    // The other issue was never touched.
    expect(track[1]).toMatchObject({ identifier: 'TAL-1', status: 'backlog' })
    expect(track[1].assignee_id).toBeUndefined()
  })

  it('Esc leaves a picker without changing anything', async () => {
    const track = fakeTrack()
    renderTrack()
    await screen.findByText('An issue already here')
    press('j')
    press('s')
    await screen.findByRole('dialog', { name: 'Move TAL-1 to…' })
    press('ArrowDown')
    press('Escape')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'An issue already here' }))
    expect(track[0].status).toBe('backlog')
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })
})
