import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { fireEvent, render, screen } from '@testing-library/react'
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

describe('page tree (fixtures until the BFF route exists)', () => {
  it('opens a space from the list and shows the fixture-marked tree', async () => {
    mockSpaces()
    renderAt('/docs')
    fireEvent.click(await screen.findByRole('link', { name: 'Open space Engineering' }))

    expect(await screen.findByText('Getting started')).toBeInTheDocument()
    expect(screen.getByText('fixture')).toBeInTheDocument()
    // nested children render expanded by default
    expect(screen.getByText('Collaboration protocol')).toBeInTheDocument()
    expect(screen.getByText('The collab tier gate')).toBeInTheDocument()
    expect(screen.getByText('7 pages')).toBeInTheDocument()
  })

  it('collapse hides a branch; expand restores it', async () => {
    mockSpaces()
    renderAt('/docs/spaces/sp-eng')
    await screen.findByText('Architecture')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Architecture' }))
    expect(screen.queryByText('Collaboration protocol')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Architecture' }))
    expect(screen.getByText('Collaboration protocol')).toBeInTheDocument()
  })
})

describe('page reader (fixtures until the BFF route exists)', () => {
  it('renders the stored ProseMirror content with meta and chips', async () => {
    mockSpaces()
    renderAt('/docs/spaces/sp-eng/pages/fx-getting-started')

    expect(await screen.findByRole('heading', { level: 1, name: /Getting started/ })).toBeInTheDocument()
    expect(screen.getByText('fixture')).toBeInTheDocument()
    expect(screen.getByText(/128 views/)).toBeInTheDocument()
    expect(screen.getByText(/verified Jul 14, 2026/)).toBeInTheDocument()
    // content really rendered, not just the title
    expect(screen.getByText('ProseMirror JSON').tagName).toBe('STRONG')
    expect(screen.getByText('curl -s /api/docs/spaces | jq length')).toBeInTheDocument()
    // breadcrumb resolves the space name from the live list
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Engineering')
  })

  it('a locked fixture page wears the locked chip', async () => {
    mockSpaces()
    renderAt('/docs/spaces/sp-eng/pages/fx-oncall')
    expect(await screen.findByText('locked')).toBeInTheDocument()
  })

  it('an unknown page id is an honest not-found, not a crash', async () => {
    mockSpaces()
    renderAt('/docs/spaces/sp-eng/pages/nope')
    expect(await screen.findByText('No such page in this space.')).toBeInTheDocument()
  })
})

describe('unmatched /docs routes', () => {
  it('offers the way back to spaces', async () => {
    mockSpaces()
    renderAt('/docs/nowhere')
    expect(await screen.findByRole('link', { name: 'Back to spaces' })).toBeInTheDocument()
  })
})
