import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from './components/AuthGate'
import type { AuthMe } from './lib/api'

// The gate's contract: /auth/me is the ONE probe. Sign-in renders only for an
// oidc BFF reporting no session; disabled mode (loopback dev) and a live
// session both render the app unchanged. A 401 is therefore never a silent
// empty screen — it becomes the sign-in card.

function stubMe(me: AuthMe) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.includes('/auth/me')) {
        return new Response(JSON.stringify(me), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch in test: ${path}`)
    }),
  )
}

function renderGate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AuthGate>
        <div data-testid="the-app">app content</div>
      </AuthGate>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthGate', () => {
  it('renders the sign-in card (and not the app) when oidc mode has no session', async () => {
    stubMe({ mode: 'oidc', authenticated: false, user: null })
    renderGate()
    const link = await screen.findByRole('link', { name: /sign in/i })
    // The link must start the BFF's OIDC flow and return to the current path.
    expect(link).toHaveAttribute('href', expect.stringContaining('/auth/login'))
    expect(link).toHaveAttribute('href', expect.stringContaining('return_to='))
    expect(screen.queryByTestId('the-app')).not.toBeInTheDocument()
  })

  it('renders the app when the session is live', async () => {
    stubMe({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'ng@example.com' } })
    renderGate()
    await waitFor(() => expect(screen.getByTestId('the-app')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('renders the app untouched in disabled mode (loopback dev)', async () => {
    stubMe({ mode: 'disabled', authenticated: false, user: null })
    renderGate()
    await waitFor(() => expect(screen.getByTestId('the-app')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
  })
})
