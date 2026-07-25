import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Members } from './Members'

// Members WAS fixture-backed: two invented people ("Sample Owner", "Sample Member") under a
// caption that already admitted "GET /api/members landed with the shared-unblock PR". The
// route did exist — apps/bff/lens.go registers it — and this screen simply never called it.
//
// It is a TRACK upstream, and this deployment runs no Track (no TRACK_* variables, the
// service is not in the compose stack), so /api/members answers 503 here. That is exactly
// why the not-configured state must be DETECTED from the response rather than written into
// the screen: hardcoding "Track isn't configured" would become the next stale caption the
// day Track ships. The screen asks, and reports what it finds.

const ROSTER = [
  { id: 'mem-owner', name: 'Ada Owner', email: 'ada@corp.example', role: 'owner', avatar_url: '' },
  { id: 'mem-1', name: 'Bo Member', email: 'bo@corp.example', role: 'member', avatar_url: '' },
]

function mockMembers(res: { status?: number; body: unknown }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function renderMembers() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Members />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('Members reads the live roster', () => {
  it('lists real members from /api/members, owner first, with no sample marking', async () => {
    mockMembers({ body: [ROSTER[1], ROSTER[0]] }) // deliberately unsorted on the wire
    renderMembers()

    expect(await screen.findByText('Ada Owner')).toBeInTheDocument()
    expect(screen.getByText('bo@corp.example')).toBeInTheDocument()
    const roles = screen.getAllByText(/^(owner|member)$/)
    expect(roles[0]).toHaveTextContent('owner')
    // nothing here is a sample any more
    expect(screen.queryByText(/sample data/i)).toBeNull()
    expect(screen.queryByText('Sample Owner')).toBeNull()
  })

  it('an empty roster is an honest empty, not an invented person', async () => {
    mockMembers({ body: [] })
    renderMembers()
    expect(await screen.findByText(/No members in this workspace yet/)).toBeInTheDocument()
  })

  // Lens list endpoints serialise an empty result as JSON null, not [] — the bug lib/api
  // normalises centrally. Track's roster goes through the same reader, so pin it.
  it('a null body reads as empty, never as a failure', async () => {
    mockMembers({ body: null })
    renderMembers()
    expect(await screen.findByText(/No members in this workspace yet/)).toBeInTheDocument()
    expect(screen.queryByText(/Couldn’t load/)).toBeNull()
  })
})

describe('an unconfigured Track upstream is DETECTED, never asserted', () => {
  it('503 reads as "not configured on this deployment" — calm state, not a fault', async () => {
    mockMembers({ status: 503, body: { error: 'track upstream not configured on this BFF' } })
    renderMembers()

    expect(await screen.findByText(/Track is not configured on this deployment/)).toBeInTheDocument()
    // off is information: no error copy, and no invented roster to fall back on
    expect(screen.queryByText(/Couldn’t load/)).toBeNull()
    expect(screen.queryByText('Sample Owner')).toBeNull()
  })

  it('the not-configured copy is reached only via the response — a 200 never shows it', async () => {
    mockMembers({ body: ROSTER })
    renderMembers()
    await screen.findByText('Ada Owner')
    // This is the anti-rot assertion: the sentence cannot be static markup, or it would
    // still be on screen the day Track appears.
    expect(screen.queryByText(/not configured on this deployment/)).toBeNull()
  })

  it('a genuine failure is an error, never laundered into "not configured"', async () => {
    mockMembers({ status: 500, body: { error: 'boom' } })
    renderMembers()

    expect(await screen.findByText(/Couldn’t load the members/)).toBeInTheDocument()
    expect(screen.queryByText(/not configured/)).toBeNull()
  })
})
