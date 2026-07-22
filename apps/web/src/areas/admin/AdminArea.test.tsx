import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdminArea } from './AdminArea'
import { NODES_SCOPE_NOTE } from './fixtures'

// Area-owned tests (the per-area convention that replaced the shared scaffold
// test): the bare-render smoke guarantee stays, and the routed screens are
// tested here against the fixture data — no fetch to mock, the fixtures ARE
// the data source until the BFF proxies the edge Admin API.

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/*" element={<AdminArea />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AdminArea', () => {
  it('renders without providers and names its area (the kept smoke guarantee)', () => {
    render(<AdminArea />)
    expect(screen.getAllByText(/admin/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/placeholder/i)).toBeInTheDocument()
  })

  it('tabs navigate between the five screens', async () => {
    renderAt('/admin')
    expect(await screen.findByText('Gateways')).toBeInTheDocument() // topology is the landing view
    fireEvent.click(screen.getByRole('button', { name: 'Nodes' }))
    expect(await screen.findByText('Connected nodes')).toBeInTheDocument()
  })
})

describe('topology (fixture-backed)', () => {
  it('renders all four object kinds with fixture marking', async () => {
    renderAt('/admin/topology')
    expect(await screen.findByText('public-https')).toBeInTheDocument()
    expect(screen.getByText('api-v1')).toBeInTheDocument()
    expect(screen.getByText('api-backend')).toBeInTheDocument()
    expect(screen.getByText('10.0.1.11:9000')).toBeInTheDocument()
    expect(screen.getByText('fixture')).toBeInTheDocument()
  })
})

describe('nodes — the connected-only caveat is load-bearing', () => {
  it("renders the server's scope note verbatim and never claims fleet health", async () => {
    renderAt('/admin/nodes')
    expect(await screen.findByText('Connected nodes')).toBeInTheDocument()
    // the scope chip + the note, always visible, exactly as the server stamps them
    expect(screen.getByText('connected-only')).toBeInTheDocument()
    expect(screen.getByText(NODES_SCOPE_NOTE)).toBeInTheDocument()
    // the summary counts the connected set explicitly…
    expect(screen.getByText('3 connected · 2 in sync · 1 behind')).toBeInTheDocument()
    expect(screen.getByText(/of the connected set only/)).toBeInTheDocument()
    // …and no phrasing anywhere reads as an all-clear over the fleet
    expect(screen.queryByText(/all nodes/i)).toBeNull()
    expect(screen.queryByText(/healthy/i)).toBeNull()
  })

  it('a behind node wears held, an acked node wears settled', async () => {
    renderAt('/admin/nodes')
    expect(await screen.findByText('edge-proxy-uswest2-a')).toBeInTheDocument()
    expect(screen.getByText('behind')).toBeInTheDocument()
    expect(screen.getAllByText('in sync').length).toBeGreaterThan(0)
  })
})

describe('certificates — economy states, no invented colours', () => {
  it('valid / expires soon / expired pills plus an unjudged parse-error row', async () => {
    renderAt('/admin/certificates')
    expect(await screen.findByText('wildcard-example-com')).toBeInTheDocument()
    expect(screen.getByText('valid')).toBeInTheDocument()
    expect(screen.getByText('expires soon')).toBeInTheDocument()
    expect(screen.getByText('expired')).toBeInTheDocument()
    // parse_error: reported, visible, and carrying NO expiry verdict
    expect(screen.getByText('imported-opaque')).toBeInTheDocument()
    expect(screen.getByText('parse error')).toBeInTheDocument()
    expect(screen.getByText(/no expiry data, so no expiry verdict/)).toBeInTheDocument()
  })
})

describe('provisioning — failures are the point', () => {
  it('renders services, the request lifecycle pills, and the FAILED error verbatim', async () => {
    renderAt('/admin/provisioning')
    expect(await screen.findByText('payments-api')).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(
      screen.getByText('route host collides with existing route api-v1 (api.example.com)'),
    ).toBeInTheDocument()
    expect(screen.getByText(/server-capped at 100/)).toBeInTheDocument()
  })
})

describe('config — reported, not settable', () => {
  it('shows state as text with the read-only stamp and offers NO control', async () => {
    renderAt('/admin/config')
    expect(await screen.findByText('Effective configuration')).toBeInTheDocument()
    expect(screen.getByText('read-only')).toBeInTheDocument()
    expect(screen.getByText(/Reported, not settable/)).toBeInTheDocument()
    expect(screen.getByText('ext_authz')).toBeInTheDocument()
    // no toggle-shaped anything: zero switches/checkboxes, and the only
    // buttons on the page are the five nav tabs
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })
})
