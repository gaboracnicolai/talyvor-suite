import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B8.2 — the Features screen: the Tare switch writes Lens's policy and the row then reads what
// Lens recorded; a capability with no reachable control is shown without a switch.

function mockBff(posts: Array<{ url: string; body: unknown }>) {
  let tare = 'disabled'
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/features/tare' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { tare_policy: string }
      posts.push({ url, body })
      tare = body.tare_policy
      return json({ tare_policy: tare })
    }
    if (url === '/api/features')
      return json({
        tare_policy: tare,
        distill_policy: 'always',
        compression_policy: 'disabled',
        logging_policy: 'metadata',
        cache_poolable: true,
        distill_poolable: false,
        cost_optimize_routing: false,
        guardrails: { injection: true, pii: false },
      })
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

function row(name: string): HTMLElement {
  return screen.getByRole('heading', { name, level: 3 }).closest('li') as HTMLElement
}

describe('the Features screen', () => {
  it('turning Tare on writes Lens’s policy and the row then reads On; off writes it back', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts)
    window.history.pushState({}, '', '/features')
    render(<App />)

    await waitFor(() => expect(within(row('Tare')).getByTestId('state-Tare')).toHaveTextContent('Off'))
    fireEvent.click(within(row('Tare')).getByRole('switch'))
    await waitFor(() => expect(within(row('Tare')).getByTestId('state-Tare')).toHaveTextContent('On'))
    expect(posts).toEqual([{ url: '/api/features/tare', body: { tare_policy: 'always' } }])

    fireEvent.click(within(row('Tare')).getByRole('switch'))
    await waitFor(() => expect(within(row('Tare')).getByTestId('state-Tare')).toHaveTextContent('Off'))
    expect(posts[1]).toEqual({ url: '/api/features/tare', body: { tare_policy: 'disabled' } })
  })

  it('a capability with no control this app can reach shows its state and no switch', async () => {
    mockBff([])
    window.history.pushState({}, '', '/features')
    render(<App />)
    await waitFor(() =>
      expect(within(row('Prompt-injection detection')).getByText('On')).toBeInTheDocument(),
    )
    for (const name of ['Prompt rewriter', 'Shared document conversions', 'Prompt-injection detection', 'Request logging']) {
      expect(within(row(name)).queryByRole('switch'), name).toBeNull()
    }
  })
})
