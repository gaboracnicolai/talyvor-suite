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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE FIRST SPACE — found on the live deploy: a brand-new user could not reach the product.
//
// Every create-page form lives INSIDE a space, so a workspace with zero spaces had no way in. The
// empty state described the absence and offered nothing to click; the product was unreachable from
// its own front door.
//
// ⚠ THE SUBJECT IS THE SEQUENCE, NOT THE FORM. A test that submits and asserts "POST was called"
// passes while the user still stares at an empty list — the create succeeded and the screen lied.
// So this asserts what the user SEES, on a component that is never re-rendered or remounted: the
// new space appears because the list refetched itself.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** A Docs stub that actually holds state: what the server returns AFTER a create is a
 *  consequence of the create, not a second fixture handed to the test. A stub that returns a
 *  canned non-empty list on the second GET would pass with no POST wired at all. */
function mockDocsWithCreate() {
  const spaces: unknown[] = []
  const posted: Array<Record<string, unknown>> = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/docs/spaces' && (init?.method ?? 'GET') === 'GET') return json(spaces)
    if (url === '/api/docs/spaces' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
      posted.push(body)
      // Mirrors Docs' own store: name is required, slug is DERIVED when absent, and the row the
      // handler returns is what the list will show.
      const name = String(body.name ?? '')
      if (!name.trim()) return json({ error: 'CREATE_FAILED' }, 400)
      const row = {
        id: `sp-${spaces.length + 1}`,
        workspace_id: 'default',
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description: '',
        icon: '📄',
        color: '#6366f1',
        private: false,
        created_by: 'm-1',
        created_at: '2026-07-28T00:00:00Z',
        updated_at: '2026-07-28T00:00:00Z',
      }
      spaces.push(row)
      return json(row, 201)
    }
    return new Response('null', { status: 404 })
  })
  return { posted }
}

describe('a workspace with NO spaces can create its first one', () => {
  it('the empty state OFFERS the action rather than only describing the absence', async () => {
    mockDocsWithCreate()
    renderAt('/docs')

    expect(await screen.findByText('No spaces in this workspace yet.')).toBeInTheDocument()
    // The dead end was: this text, and nothing to click.
    expect(screen.getByRole('button', { name: /create space/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/space name/i)).toBeInTheDocument()
  })

  it('creates the first space and it APPEARS WITHOUT A RELOAD', async () => {
    const { posted } = mockDocsWithCreate()
    renderAt('/docs')

    expect(await screen.findByText('No spaces in this workspace yet.')).toBeInTheDocument()
    expect(screen.queryByText('Engineering')).toBeNull()

    fireEvent.change(screen.getByLabelText(/space name/i), { target: { value: 'Engineering' } })
    fireEvent.click(screen.getByRole('button', { name: /create space/i }))

    // ⚠ No re-render, no remount, no second renderAt — the SAME mounted list must show it.
    expect(await screen.findByText('Engineering')).toBeInTheDocument()
    expect(screen.queryByText('No spaces in this workspace yet.')).toBeNull()

    // ⚠ THE FIELD NAME IS THE SILENT FAILURE. Docs decodes into model.Space; a wrong key is
    // ignored as a zero value, so `name` missing is a 400 the UI can show, but a misspelling
    // that still parsed would create an UNNAMED space and look like success. Assert the wire.
    expect(posted).toHaveLength(1)
    expect(posted[0]).toHaveProperty('name', 'Engineering')
  })

  it('the client does NOT name a workspace — the BFF pins it from the session', async () => {
    const { posted } = mockDocsWithCreate()
    renderAt('/docs')

    await screen.findByText('No spaces in this workspace yet.')
    fireEvent.change(screen.getByLabelText(/space name/i), { target: { value: 'Engineering' } })
    fireEvent.click(screen.getByRole('button', { name: /create space/i }))
    await screen.findByText('Engineering')

    // SEC-4: a caller-supplied workspace_id is a workspace the caller chose. The BFF injects it
    // from the pinned session, so the browser never sends one — if it did, that is the field an
    // attacker edits.
    expect(posted[0]).not.toHaveProperty('workspace_id')
  })

  it('a failed create says so, and invents no space', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/docs/spaces' && (init?.method ?? 'GET') === 'GET')
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url === '/api/docs/spaces' && init?.method === 'POST')
        return new Response('{"error":"CREATE_FAILED"}', { status: 400 })
      return new Response('null', { status: 404 })
    })
    renderAt('/docs')

    await screen.findByText('No spaces in this workspace yet.')
    fireEvent.change(screen.getByLabelText(/space name/i), { target: { value: 'Engineering' } })
    fireEvent.click(screen.getByRole('button', { name: /create space/i }))

    expect(await screen.findByText(/Couldn’t create that space/)).toBeInTheDocument()
    expect(screen.queryByText('Engineering')).toBeNull()
    expect(screen.getByText('No spaces in this workspace yet.')).toBeInTheDocument()
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

  it('a configured upstream READS the space, and an empty one is an empty space', async () => {
    mockDocs({ spaces: { body: SPACES }, other: { body: [] } })
    renderAt('/docs/spaces/sp-eng')

    // The old copy ("the BFF does not read it yet") became FALSE when the tree started reading and
    // the create form started writing. A 200 with an empty body is an empty SPACE, and saying so is
    // the honest output — the fabricated seven-page tree is gone and does not come back.
    expect(await screen.findByText(/No pages yet/i)).toBeInTheDocument()
    // the anti-rot assertions: neither "not configured" nor the superseded copy can be reached
    expect(screen.queryByText(/is not configured on this deployment/)).toBeNull()
    expect(screen.queryByText(/does not read it yet/)).toBeNull()
  })

  it('the reader opens the PAGE, not the tree', async () => {
    mockDocs({ spaces: { body: SPACES }, other: { body: { id: 'pg-1', title: 'Runbook', content_text: 'draft' } } })
    renderAt('/docs/spaces/sp-eng/pages/pg-1')
    // It reads the page and offers the editor, rather than naming the route it has not called.
    expect(await screen.findByText('Runbook')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('a real failure on the tree route is an error, never laundered into off', async () => {
    mockDocs({ spaces: { body: SPACES }, other: { status: 500, body: { error: 'boom' } } })
    renderAt('/docs/spaces/sp-eng')
    // The guarantee is unchanged and the wording is not: a 500 must read as a FAULT, never as
    // "off" and never as an empty space. Those three states mean different things to whoever wrote
    // the page, and conflating them says their work vanished.
    expect(await screen.findByText(/This is a fault, not an empty space/)).toBeInTheDocument()
    expect(screen.queryByText(/not configured/)).toBeNull()
    expect(screen.queryByText(/No pages yet/i)).toBeNull()
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
