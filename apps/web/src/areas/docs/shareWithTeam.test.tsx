import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShareWithTeam } from './ShareWithTeam'

// B28.450 — on a page, its admin puts someone from the roster on a team and gives the team edit; the team's row says
// what it can do, by the member's email, and each change goes to the BFF's team routes.

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ShareWithTeam', () => {
  it('puts a roster member on a team and gives the team edit on the page', async () => {
    let members: string[] = []
    let grants: unknown[] = []
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${path}`)
      if (path === '/api/members') return Response.json([{ id: 'm-bob', name: 'Bob', email: 'bob@example.com', role: 'member', avatar_url: '' }])
      if (path === '/api/docs/teams') return Response.json([{ id: 't1', name: 'Design', members, can_manage: true }])
      if (path === '/api/docs/teams/t1/members/m-bob') {
        members = ['m-bob']
        return Response.json({ member: true })
      }
      if (method === 'POST') {
        grants = [{ id: 'g1', subject_type: 'team', subject_id: 't1', access: JSON.parse(String(init?.body)).access }]
        return Response.json(grants[0], { status: 201 })
      }
      return Response.json(grants)
    }))

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ShareWithTeam spaceId="s1" pageId="p1" />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Share with a team' }))

    const pick = await screen.findByRole('combobox', { name: 'Add a member to Design' })
    await screen.findByRole('option', { name: 'bob@example.com' })
    fireEvent.change(pick, { target: { value: 'm-bob' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Design' }))
    expect(await screen.findByRole('button', { name: 'Remove bob@example.com from Design' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Give access to Design' }))
    expect(await screen.findByText('can edit this page')).toBeInTheDocument()
    await waitFor(() => expect(calls).toEqual(expect.arrayContaining([
      'PUT /api/docs/teams/t1/members/m-bob',
      'POST /api/docs/spaces/s1/pages/p1/permissions',
    ])))
  })
})
