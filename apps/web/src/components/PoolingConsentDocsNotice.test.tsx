import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PoolingConsent } from './PoolingConsent'
import { DOCS_SHARED_HEADLINE } from '../areas/docs/sharedDocsNotice'

// The shared-Docs notice on the signup disclosure — the RENDERING. The claim itself is pinned in
// areas/docs/sharedDocsNotice.test.ts.
//
// The property that matters most is that it is CONDITIONAL. Docs having its own tenancy root is a
// parked decision with a stated reopening condition, not a permanent state, so a notice rendered
// unconditionally would become a false claim the day that lands. It renders from `docs_shared`,
// which the BFF derives from its own config — see the module header for why this value can be read
// live where the unpaid-contribution notice's cannot.

function renderConsent(me: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) === '/auth/me') {
      return new Response(JSON.stringify(me), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PoolingConsent onDone={() => {}} />
    </QueryClientProvider>,
  )
}

const signedIn = { mode: 'oidc', authenticated: true, user: { sub: 'u', email: 'a@example.com' } }

afterEach(() => vi.restoreAllMocks())

describe('the shared-Docs notice on the signup disclosure', () => {
  it('appears when this deployment pins Docs', async () => {
    renderConsent({ ...signedIn, docs_shared: true })
    expect(await screen.findByText(new RegExp(DOCS_SHARED_HEADLINE, 'i'))).toBeInTheDocument()
    // And the guidance, which is the part that prevents the harm rather than describing it.
    expect(screen.getByText(/private, personal or confidential/i)).toBeInTheDocument()
  })

  it('does NOT appear once Docs is per-user — the copy cannot outlive the fact', async () => {
    renderConsent({ ...signedIn, docs_shared: false })
    // Wait for the disclosure itself so this is not vacuously true on an unrendered screen.
    expect(await screen.findByText(/turn it off below/i)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(DOCS_SHARED_HEADLINE, 'i'))).not.toBeInTheDocument()
  })

  it('treats an ABSENT field as not-shared, so silence cannot manufacture a warning', async () => {
    renderConsent(signedIn) // older BFF: no docs_shared at all
    expect(await screen.findByText(/turn it off below/i)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(DOCS_SHARED_HEADLINE, 'i'))).not.toBeInTheDocument()
  })
})
