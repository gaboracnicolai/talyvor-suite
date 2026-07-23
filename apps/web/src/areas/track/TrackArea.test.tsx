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

  // The strip must tell the truth in three states, matching Docs' SpaceList:
  // 503/404 is INFORMATION (unconfigured — off, not broken), everything else is
  // a real failure named as such, and liveness wording only under live data.
  it('renders an unconfigured upstream (503) as off — never as an outage', async () => {
    mockWorkspaces(() => new Response('{"error":"track upstream not configured on this BFF"}', { status: 503 }))
    renderArea()

    expect(await screen.findByText('Track is not configured on this BFF deployment')).toBeInTheDocument()
    expect(screen.getByText(/TRACK_\* trio is unset/)).toBeInTheDocument()
    expect(screen.getByText(/off, not broken/)).toBeInTheDocument()
    expect(screen.queryByText(/unreachable/)).not.toBeInTheDocument()
    expect(screen.queryByText('live · membership-scoped')).not.toBeInTheDocument()
    // the fixture screens are a design preview and stay fully usable
    expect(screen.getByText(/design preview on marked sample data/)).toBeInTheDocument()
    expect(screen.getByText('14 issues')).toBeInTheDocument()
  })

  it('names a real failure as a failure — without claiming to know why', async () => {
    mockWorkspaces(() => new Response('bad gateway', { status: 502 }))
    renderArea()

    expect(await screen.findByText('Couldn’t load workspaces')).toBeInTheDocument()
    expect(screen.queryByText(/unreachable/)).not.toBeInTheDocument()
    expect(screen.queryByText(/not configured/)).not.toBeInTheDocument()
    expect(screen.queryByText('live · membership-scoped')).not.toBeInTheDocument()
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
