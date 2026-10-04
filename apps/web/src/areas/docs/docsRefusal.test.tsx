import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { populatedBff, settleQueries } from '../../populatedBff'
import { DocsArea } from './DocsArea'
import { membershipRecheckDelay } from './SpaceList'

// B27.15 — Docs refusing someone it has not been told about yet (403 "not a member of this
// workspace", until Track's roster reaches it) is a refusal, not an outage.

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
const FORBIDDEN = { error: 'not a member of this workspace' }

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('the Docs screen while Docs refuses (B27.15)', () => {
  it('says the person is not a member yet, re-checks with backoff, and lists the spaces once membership arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let member = false
    const asked: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      asked.push(url)
      if (url === '/api/docs/membership') return json({ member })
      if (url === '/api/docs/spaces') return member ? json([{ id: 'sp-eng', name: 'Engineering', slug: 'eng' }]) : json(FORBIDDEN, 403)
      return json(null, 404)
    })
    const checks = () => asked.filter((u) => u === '/api/docs/membership').length

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/docs']}>
          <Routes>
            <Route path="/docs/*" element={<DocsArea />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'You’re not a member of Docs yet.' })).toBeTruthy()
    expect(screen.getByText(/keeps checking and lists your spaces by itself/)).toBeTruthy()
    expect(screen.queryByText(/can’t be reached/)).toBeNull()
    expect(screen.queryByText(/proxy answered with an error/)).toBeNull()

    // Backoff: the first re-check after 2s, the next 4s after that. (Fake time also creeps with real
    // time here, so each "not yet" stops half a second short rather than one millisecond.)
    expect(checks()).toBe(0)
    await act(() => vi.advanceTimersByTimeAsync(membershipRecheckDelay(0)))
    await waitFor(() => expect(checks()).toBe(1))
    await act(() => vi.advanceTimersByTimeAsync(membershipRecheckDelay(1) - 500))
    expect(checks()).toBe(1)
    expect(screen.getByRole('heading', { name: 'You’re not a member of Docs yet.' })).toBeTruthy()

    // Track's roster reaches Docs. Nobody touches the screen.
    member = true
    await act(() => vi.advanceTimersByTimeAsync(500))
    expect(await screen.findByRole('link', { name: 'Open space Engineering' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'You’re not a member of Docs yet.' })).toBeNull()

    // Recovered, so it stops asking.
    const after = checks()
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(checks()).toBe(after)
  })
})

describe('Chat while Docs refuses (B27.15)', () => {
  it('loads with no failed request: the sidebar asks whether the person can read Docs, and does not ask for pins', async () => {
    window.history.pushState({}, '', '/chat')
    const failed: string[] = []
    const spy = vi.spyOn(globalThis, 'fetch')
    const seen = populatedBff(
      (impl) =>
        spy.mockImplementation(async (input) => {
          const url = String(input)
          // Docs refuses this person everywhere it is asked.
          const res = url === '/api/docs/pins' || url.startsWith('/api/docs/spaces') ? json(FORBIDDEN, 403) : await impl(input)
          if (!res.ok) failed.push(`${url} -> ${res.status}`)
          return res
        }),
      { '/api/docs/membership': { member: false } },
    )

    render(<App />)
    await screen.findByRole('navigation', { name: /sections/i })
    await settleQueries(queryClient, waitFor)

    expect(seen.asked).toContain('/api/docs/membership')
    expect(seen.asked).not.toContain('/api/docs/pins')
    expect(failed).toEqual([])
  })
})
