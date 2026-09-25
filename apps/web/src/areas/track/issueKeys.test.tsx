import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrackArea } from './TrackArea'
import type { TrackIssue } from './types'

// B4.3 — the issue list is usable without a mouse: c, /, j, k, Enter, e, Esc. Driven through the
// real Track area, with keys dispatched where a browser would dispatch them: on the focused element.

function issue(n: number): TrackIssue {
  return {
    id: `iss-${n}`,
    workspace_id: 'ws-1',
    team_id: 'team-1',
    number: n,
    identifier: `TAL-${n}`,
    title: `Issue number ${n}`,
    description: `What issue ${n} is about`,
    status: 'todo',
    priority: 0,
    creator_id: 'mem-1',
    lens_feature: '',
    ai_cost_usd: 0,
    ai_tokens: 0,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  }
}

const ISSUES = [issue(1), issue(2), issue(3)]

function renderTrack() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('/api/track/issues?')) return json(ISSUES)
    const one = url.match(/^\/api\/track\/issues\/(iss-\d+)$/)
    if (one) return json(ISSUES.find((i) => i.id === one[1]))
    return json([])
  })
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

afterEach(() => vi.restoreAllMocks())

describe('the issue list without a mouse (B4.3)', () => {
  it('c starts a new issue, / starts a search, Esc leaves the field — and letters typed into a field stay text', async () => {
    renderTrack()
    await screen.findByText('Issue number 1')

    press('c')
    expect(document.activeElement).toBe(screen.getByPlaceholderText('What needs doing?'))
    press('j') // typing, not navigating
    expect(document.activeElement).toBe(screen.getByPlaceholderText('What needs doing?'))

    press('Escape')
    press('/')
    expect(document.activeElement).toBe(screen.getByPlaceholderText('auth token expiry'))
  })

  it('j and k step through the issues, and e opens the focused one with its editor open', async () => {
    renderTrack()
    await screen.findByText('Issue number 1')

    press('j')
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Issue number 1' }))
    press('j')
    press('j')
    press('j') // stops at the last one
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Issue number 3' }))
    press('k')
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Issue number 2' }))

    press('e')
    const editor = await screen.findByLabelText('Description')
    await waitFor(() => expect(document.activeElement).toBe(editor))
    expect((editor as HTMLTextAreaElement).value).toBe('What issue 2 is about')
  })
})
