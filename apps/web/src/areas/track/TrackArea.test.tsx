import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrackArea } from './TrackArea'

// The area root: the live workspace strip (/api/track/workspaces — the ONE proxied
// route) above the fixture-backed screens. Mounted exactly as App.tsx mounts it
// (path="/track/*") so index/sub-route resolution is tested for real.

const WORKSPACES = [
  { id: 'ws-talyvor', name: 'Talyvor', slug: 'talyvor', logo_url: '', plan: 'trial', created_at: '2026-06-01T08:00:00Z', updated_at: '2026-07-01T08:00:00Z' },
]

function mockWorkspaces(response: () => Response) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/track/workspaces')) return response()
    return new Response('null', { status: 404 })
  })
}

function renderArea(url = '/track') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/track/*" element={<TrackArea />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('TrackArea', () => {
  it('renders the live workspace strip and the issue list at /track', async () => {
    mockWorkspaces(() => new Response(JSON.stringify(WORKSPACES), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    renderArea()

    expect(await screen.findByText('Talyvor')).toBeInTheDocument()
    expect(screen.getByText('live · membership-scoped')).toBeInTheDocument()
    // the core screen below the strip
    expect(screen.getByText('14 issues')).toBeInTheDocument()
  })

  it('names the fault honestly when the proxy is unreachable — and the fixtures stay usable', async () => {
    mockWorkspaces(() => new Response('bad gateway', { status: 502 }))
    renderArea()

    expect(await screen.findByText('Track upstream unreachable')).toBeInTheDocument()
    expect(screen.getByText(/TRACK_BASE_URL and TRACK_GATEWAY_SECRET/)).toBeInTheDocument()
    expect(screen.getByText('14 issues')).toBeInTheDocument()
  })

  it('routes /track/issues/:id to the detail screen', async () => {
    mockWorkspaces(() => new Response(JSON.stringify(WORKSPACES), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    renderArea('/track/issues/iss-1')

    expect(await screen.findByText('Gateway 502s on cold start when the upstream pool is empty')).toBeInTheDocument()
    expect(screen.getByText('Description')).toBeInTheDocument()
  })

  it('an unknown sub-route falls back to the list, never a dead end', async () => {
    mockWorkspaces(() => new Response(JSON.stringify(WORKSPACES), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    renderArea('/track/definitely-not-a-route')

    expect(await screen.findByText('14 issues')).toBeInTheDocument()
  })
})
