import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrackArea } from './TrackArea'
import type { TrackBoardLink } from './types'

// B27.30 — the board screen draws the issues by status, publishes a read-only link, and turns it off.

function fakeTrack() {
  const links: TrackBoardLink[] = []
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.startsWith('/api/track/issues?')) {
      return json([
        { id: 'iss-1', identifier: 'TAL-1', title: 'Write the release notes', status: 'in_review', priority: 3 },
      ])
    }
    if (url === '/api/track/boards' && method === 'POST') {
      const l = { id: 'sh-1', token: 'tok_abcdefghijklmnop', created_at: '2026-10-04T00:00:00Z' }
      links.push(l)
      return json(l, 201)
    }
    if (url === '/api/track/boards') return json(links)
    if (url === '/api/track/boards/sh-1' && method === 'DELETE') {
      links.splice(0)
      return json({ ok: true })
    }
    return json([])
  })
  return links
}

afterEach(() => vi.restoreAllMocks())

describe('the board screen (B27.30)', () => {
  it('shows each issue under its status, publishes a link, and turns it off', async () => {
    const links = fakeTrack()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/track/board']}>
          <Routes>
            <Route path="/track/*" element={<TrackArea />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const inReview = await screen.findByRole('region', { name: 'In review' })
    expect(within(inReview).getByRole('link', { name: 'Write the release notes' })).toBeInTheDocument()
    expect(await screen.findByText(/No board links are on, so nothing in this workspace is public/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Publish a board link' }))
    const field = await screen.findByLabelText('Board link for Every issue')
    expect((field as HTMLInputElement).value).toBe(`${window.location.origin}/board/tok_abcdefghijklmnop`)
    expect(links).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await screen.findByText(/No board links are on, so nothing in this workspace is public/)
    await waitFor(() => expect(links).toHaveLength(0))
  })
})
