import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocsArea } from './DocsArea'

// Live-shape spaces — field-for-field model.Space, as the BFF streams it verbatim.
const SPACES = [
  {
    id: 'sp-eng',
    workspace_id: 'default',
    name: 'Engineering',
    slug: 'engineering',
    description: 'How we build',
    icon: '📘',
    color: '#0B7A85',
    private: false,
    created_by: 'm-1',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  },
  {
    id: 'sp-ops',
    workspace_id: 'default',
    name: 'Operations',
    slug: 'operations',
    description: '',
    icon: '🛠️',
    color: '#B07F38',
    private: true,
    created_by: 'm-1',
    created_at: '2026-06-02T00:00:00Z',
    updated_at: '2026-07-02T00:00:00Z',
  },
]

function mockSpaces(status = 200) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/docs/spaces')) {
      if (status !== 200) return new Response('{"error":"boom"}', { status })
      return new Response(JSON.stringify(SPACES), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('null', { status: 404 })
  })
}

/** Spaces answers one way, every other Docs route another — the shape of a deployment where
 *  the routes exist but the upstream does not. */
function mockDocs(opts: { spaces: { status?: number; body: unknown }; other: { status?: number; body: unknown } }) {
  const stub = (s: { status?: number; body: unknown }) =>
    new Response(JSON.stringify(s.body), {
      status: s.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/docs/spaces') return stub(opts.spaces)
    if (url.startsWith('/api/docs/')) return stub(opts.other)
    return new Response('null', { status: 404 })
  })
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/docs/*" element={<DocsArea />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('scaffold contract survives the real area', () => {
  it('rendered bare — no router, no query client — it is still the descriptive placeholder', () => {
    render(<DocsArea />)
    expect(screen.getAllByText(/docs/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/placeholder/i)).toBeInTheDocument()
  })
})

describe('space list (LIVE /api/docs/spaces)', () => {
  it('renders one row per space, marks private, and never wears a fixture chip', async () => {
    mockSpaces()
    renderAt('/docs')
    expect(await screen.findByText('Engineering')).toBeInTheDocument()
    expect(screen.getByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('How we build')).toBeInTheDocument()
    expect(screen.getByText('private')).toBeInTheDocument()
    expect(screen.queryByText('fixture')).toBeNull()
  })

  it('shows the error state when the proxy fails', async () => {
    mockSpaces(500)
    renderAt('/docs')
    expect(await screen.findByText('Couldn’t load spaces.')).toBeInTheDocument()
  })

  it('shows the empty state on a workspace with no spaces', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    renderAt('/docs')
    expect(await screen.findByText('No spaces in this workspace yet.')).toBeInTheDocument()
  })
})

describe('the tree and the reader PROBE their route, and report what came back', () => {
  // These two screens used to render seven fabricated pages with view counts (128, 64, 31, …)
  // under a footnote claiming "the BFF serves only /api/docs/spaces today" — while the BFF
  // served four Docs routes. The fixtures are gone; the copy now requires a response.
  it('an unconfigured Docs upstream reads as off, with no invented pages', async () => {
    mockDocs({ spaces: { body: SPACES }, other: { status: 503, body: { error: 'docs upstream not configured on this BFF' } } })
    renderAt('/docs/spaces/sp-eng')

    expect(await screen.findByText(/Docs is not configured on this deployment/)).toBeInTheDocument()
    expect(screen.queryByText('Getting started')).toBeNull()
    expect(screen.queryByText(/128 views/)).toBeNull()
    expect(screen.queryByText('fixture')).toBeNull()
  })

  it('a configured upstream flips it to the honest not-yet-wired state, naming the read', async () => {
    mockDocs({ spaces: { body: SPACES }, other: { body: [] } })
    renderAt('/docs/spaces/sp-eng')

    expect(await screen.findByText(/does not read it yet/)).toBeInTheDocument()
    expect(screen.getByText('GET /api/docs/spaces/{spaceID}/pages')).toBeInTheDocument()
    // the anti-rot assertion: "not configured" cannot be reached once it answers
    expect(screen.queryByText(/is not configured on this deployment/)).toBeNull()
  })

  it('the reader probes the PAGE route, not the tree route', async () => {
    mockDocs({ spaces: { body: SPACES }, other: { body: {} } })
    renderAt('/docs/spaces/sp-eng/pages/pg-1')
    expect(await screen.findByText('GET /api/docs/spaces/{spaceID}/pages/{pageID}')).toBeInTheDocument()
  })

  it('a real failure on the tree route is an error, never laundered into off', async () => {
    mockDocs({ spaces: { body: SPACES }, other: { status: 500, body: { error: 'boom' } } })
    renderAt('/docs/spaces/sp-eng')
    expect(await screen.findByText(/answered with an error/)).toBeInTheDocument()
    expect(screen.queryByText(/not configured/)).toBeNull()
  })

  it('keeps the way back to spaces', async () => {
    mockDocs({ spaces: { body: SPACES }, other: { status: 503, body: {} } })
    renderAt('/docs/spaces/sp-eng')
    expect(await screen.findByRole('link', { name: 'Spaces' })).toHaveAttribute('href', '/docs')
  })
})

describe('unmatched /docs routes', () => {
  it('offers the way back to spaces', async () => {
    mockSpaces()
    renderAt('/docs/nowhere')
    expect(await screen.findByRole('link', { name: 'Back to spaces' })).toBeInTheDocument()
  })
})

// ── The caption must tell the truth in all three states ──────────────────────
// The review's worst finding: "Live from the BFF's Docs proxy" rendered
// UNCONDITIONALLY — including under "Couldn't load spaces." A failure state
// carrying a liveness claim is the one thing a technical reader never forgives.
describe('SpaceList captions tell the truth', () => {
  it('claims liveness only when data actually loaded', async () => {
    mockSpaces(200)
    renderAt('/docs')
    expect(await screen.findByText('Engineering')).toBeInTheDocument()
    expect(screen.getByText(/Live from the BFF’s Docs proxy/)).toBeInTheDocument()
  })

  it('renders an unconfigured upstream (503) as off — never as broken, never as live', async () => {
    mockSpaces(503)
    renderAt('/docs')
    expect(await screen.findByText('Docs is not configured on this BFF deployment.')).toBeInTheDocument()
    expect(screen.queryByText(/Live from the BFF/)).not.toBeInTheDocument()
    expect(screen.queryByText('Couldn’t load spaces.')).not.toBeInTheDocument()
  })

  it('drops the liveness claim on a real failure', async () => {
    mockSpaces(500)
    renderAt('/docs')
    expect(await screen.findByText('Couldn’t load spaces.')).toBeInTheDocument()
    expect(screen.queryByText(/Live from the BFF/)).not.toBeInTheDocument()
  })
})
