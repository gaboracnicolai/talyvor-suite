import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceSettings } from './WorkspaceSettings'

// B18.53 — an owner deletes a Track workspace by typing its slug, sees it among the deleted ones
// with the day it goes for good, and restores it. Driven at the wire, against a Track that keeps
// what it is told.

afterEach(() => vi.restoreAllMocks())

const ACME = {
  id: 'ws-2', name: 'Acme', slug: 'acme', logo_url: '', plan: 'free',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

function mockTrack() {
  let deleted = false
  const writes: Array<{ url: string; method: string; body: unknown }> = []
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET') writes.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    const gone = { ...ACME, deleted_at: '2026-09-27T10:00:00Z', restorable_until: '2026-10-11T10:00:00Z' }
    if (url === '/api/track/workspaces') return json(deleted ? [] : [ACME])
    if (url === '/api/track/workspaces/deleted') return json(deleted ? [gone] : [])
    if (url === '/api/track/workspaces/ws-2' && method === 'DELETE') {
      deleted = true
      return json(gone)
    }
    if (url === '/api/track/workspaces/ws-2/restore' && method === 'POST') {
      deleted = false
      return json(ACME)
    }
    return json(null, 404)
  })
  return writes
}

describe('Track workspace settings', () => {
  it('deletes a workspace only once its slug is typed, lists it with the day it goes for good, and restores it', async () => {
    const writes = mockTrack()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <WorkspaceSettings />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const yours = () => screen.getByRole('region', { name: 'Your workspaces' })
    const gone = () => screen.getByRole('region', { name: 'Deleted workspaces' })

    fireEvent.click(await within(yours()).findByRole('button', { name: 'Delete…' }))
    const confirm = within(yours()).getByRole('button', { name: 'Delete workspace' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(yours()).getByRole('textbox', { name: 'Type acme to confirm' }), { target: { value: 'acm' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(yours()).getByRole('textbox', { name: 'Type acme to confirm' }), { target: { value: 'acme' } })
    fireEvent.click(confirm)

    await waitFor(() => expect(gone()).toHaveTextContent('Acme'))
    expect(gone()).toHaveTextContent('Deleted Sep 27, 2026 · goes for good on Oct 11, 2026')
    expect(within(yours()).queryByText('Acme')).toBeNull()

    fireEvent.click(within(gone()).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(within(yours()).getByText('Acme')).toBeInTheDocument())
    expect(gone()).toHaveTextContent('No deleted workspaces')
    expect(writes).toEqual([
      { url: '/api/track/workspaces/ws-2', method: 'DELETE', body: { confirm: 'acme' } },
      { url: '/api/track/workspaces/ws-2/restore', method: 'POST', body: null },
    ])
  })
})
