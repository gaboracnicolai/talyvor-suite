import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrackArea } from './TrackArea'

// The Track area on a deployment that runs no Track. Every sentence it shows must come from a
// RESPONSE, so that the day the TRACK_* trio appears the area changes what it says without
// anyone editing this app. That is the whole difference between this and the fixture screens it
// replaces, whose "the BFF proxies exactly ONE Track route today" header was false for weeks.

const WORKSPACES = [{ id: 'ws-1', name: 'Acme', slug: 'acme', created_at: '', updated_at: '' }]

function mock(handler: (path: string) => { status?: number; body: unknown }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const { status, body } = handler(String(input))
    return new Response(JSON.stringify(body), {
      status: status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

/** Both Track reads unconfigured — this deployment, today. */
const allUnconfigured = () => ({ status: 503, body: { error: 'track upstream not configured on this BFF' } })

function renderArea(route = '/track') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <TrackArea />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('an unconfigured Track reads as off, everywhere, from the response', () => {
  it('names the deployment state and shows no invented issues', async () => {
    mock(allUnconfigured)
    renderArea()

    expect(await screen.findByText('Track is not configured on this deployment')).toBeInTheDocument()
    expect(await screen.findByText(/no upstream is wired/)).toBeInTheDocument()
    // the fourteen fixture issues are gone, along with their badge and their filter rail
    expect(screen.queryByText(/Gateway 502s on cold start/)).toBeNull()
    expect(screen.queryByText(/Fixture/i)).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('an unknown sub-route still lands on the issues view, never a dead end', async () => {
    mock(allUnconfigured)
    // the retired detail route is the realistic case: an old link or bookmark
    renderArea('/track/issues/iss-1')
    expect(await screen.findByText('Issues')).toBeInTheDocument()
  })
})

describe('a configured Track is detected, not assumed', () => {
  it('a 200 replaces the off state with the honest not-yet-wired one', async () => {
    mock((path) => (path.includes('/api/track/workspaces') ? { body: WORKSPACES } : { body: [] }))
    renderArea()

    // the strip goes live …
    expect(await screen.findByText('Acme')).toBeInTheDocument()
    // … and the issues view now READS the route rather than announcing that it does not. The old
    // copy ("the BFF does not read it yet") became false the moment the list landed; a 200 with an
    // empty body is an empty TRACKER, and saying so is the honest output for a new workspace.
    expect(await screen.findByText(/No issues yet/i)).toBeInTheDocument()
    // THE ANTI-ROT ASSERTION, unchanged in spirit: "not configured" is unreachable once the
    // upstream answers, and neither is the superseded not-yet-wired copy.
    expect(screen.queryByText(/is not configured on this deployment/)).toBeNull()
    expect(screen.queryByText(/does not read it yet/)).toBeNull()
  })
})

describe('a real failure stays a failure', () => {
  it('500 is named as an error and never laundered into "off"', async () => {
    mock(() => ({ status: 500, body: { error: 'boom' } }))
    renderArea()

    expect(await screen.findByText('Couldn’t load workspaces')).toBeInTheDocument()
    // The workspace strip still names the error. The issues view now has its own error state
    // instead of a second identical card, so the COUNT changed while the guarantee did not: a 500
    // must read as a fault, never as "off" and never as an empty tracker — those three states mean
    // different things to a tester and conflating them says their work vanished.
    expect(await screen.findByText(/answered with an error/)).toBeInTheDocument()
    expect(await screen.findByText(/This is a fault, not an empty tracker/)).toBeInTheDocument()
    expect(screen.queryByText(/not configured/)).toBeNull()
    expect(screen.queryByText(/No issues yet/i)).toBeNull()
  })
})
