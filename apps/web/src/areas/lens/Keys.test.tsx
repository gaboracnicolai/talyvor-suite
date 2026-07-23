import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keys } from './Keys'

// /keys is LIVE — wired to the BFF's GET + POST /api/keys (apps/bff/keys.go). The
// screen exists because the mint response has `key` and `prefix` ADJACENT and
// alike, and the wrong one gets copied; the design makes that impossible — the
// credential shows ONCE with one copy action, the prefix is a labeled
// non-credential, and dismissal purges the key from the DOM and the mutation
// cache. These tests drive the real fetch surface (mocked), never a fixture.

const EXISTING = [
  { id: 'key_01', workspace_id: 'default', key_prefix: 'tlv_ws_9f21c4a0', name: 'CI pipeline', scopes: ['proxy'], created_at: '2026-07-14T09:12:00Z' },
]
// A mint response shaped like Lens's: key + prefix adjacent. The key is a TEST
// value, never a real credential.
const MINTED = {
  key: 'tlv_ws_TESTKEY_not_a_real_credential_00000000000000000000',
  prefix: 'tlv_ws_7c0ffee0',
  name: 'Laptop',
  scopes: ['proxy'],
}

const writeText = vi.fn(() => Promise.resolve())

/** Mock GET /api/keys (list) and POST /api/keys (mint). `postStatus` lets a test
 *  force the mint to fail. Records the POST init so the write shape is asserted. */
function mockKeys({ postStatus = 201 }: { postStatus?: number } = {}) {
  let minted = false
  const post = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/keys' && method === 'POST') {
      post(init)
      if (postStatus !== 201) return new Response('nope', { status: postStatus })
      minted = true
      return new Response(JSON.stringify(MINTED), { status: 201, headers: { 'Content-Type': 'application/json' } })
    }
    if (url === '/api/keys' && method === 'GET') {
      // After a successful mint the refetch includes the new key BY PREFIX.
      const rows = minted ? [{ id: 'key_new', workspace_id: 'default', key_prefix: MINTED.prefix, name: MINTED.name, scopes: MINTED.scopes, created_at: '2026-07-23T00:00:00Z' }, ...EXISTING] : EXISTING
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('null', { status: 404 })
  })
  return { post }
}

function renderKeys() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Keys />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  writeText.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe('Keys — the live list', () => {
  it('lists existing keys from GET /api/keys by name and prefix, with no fixture notice and no credential', async () => {
    mockKeys()
    renderKeys()
    expect(await screen.findByText('CI pipeline')).toBeInTheDocument()
    expect(screen.getByText('tlv_ws_9f21c4a0')).toBeInTheDocument()
    // Live now — the sample-data notice is gone, and nothing reads "placeholder".
    expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument()
    // No credential is on the page before minting.
    expect(screen.queryByText(MINTED.key)).not.toBeInTheDocument()
  })

  it('surfaces a list failure honestly rather than inventing keys', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }))
    renderKeys()
    expect(await screen.findByText(/Couldn’t load your keys/)).toBeInTheDocument()
  })
})

describe('Keys — mint is a one-time reveal', () => {
  it('mints via POST → shows the full key ONCE with the warning and the prefix as a labeled non-credential', async () => {
    mockKeys()
    renderKeys()
    await screen.findByText('CI pipeline')

    fireEvent.change(screen.getByLabelText(/new key name/i), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('button', { name: /create key/i }))

    expect(await screen.findByText(MINTED.key)).toBeInTheDocument()
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument()
    expect(screen.getByText(MINTED.prefix)).toBeInTheDocument()
    expect(screen.getByText(/not a credential/i)).toBeInTheDocument()
  })

  it('the POST carries the entered name and the proxy scope as JSON', async () => {
    const { post } = mockKeys()
    renderKeys()
    await screen.findByText('CI pipeline')

    fireEvent.change(screen.getByLabelText(/new key name/i), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('button', { name: /create key/i }))
    await screen.findByText(MINTED.key)

    expect(post).toHaveBeenCalledTimes(1)
    const init = post.mock.calls[0][0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Laptop', scopes: ['proxy'] })
  })

  it('copy copies THE KEY — never the prefix — and confirms in text', async () => {
    mockKeys()
    renderKeys()
    await screen.findByText('CI pipeline')
    fireEvent.change(screen.getByLabelText(/new key name/i), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('button', { name: /create key/i }))
    await screen.findByText(MINTED.key)

    fireEvent.click(screen.getByRole('button', { name: /copy key/i }))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(MINTED.key)
    expect(writeText).not.toHaveBeenCalledWith(MINTED.prefix)
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeInTheDocument()
  })

  it('dismissing removes the key from the DOM permanently; the refetched list gains it BY PREFIX', async () => {
    mockKeys()
    renderKeys()
    await screen.findByText('CI pipeline')
    fireEvent.change(screen.getByLabelText(/new key name/i), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('button', { name: /create key/i }))
    await screen.findByText(MINTED.key)

    fireEvent.click(screen.getByRole('button', { name: /i stored it/i }))

    // The credential is gone and there is no way back to it.
    await waitFor(() => expect(screen.queryByText(MINTED.key)).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /copy key/i })).not.toBeInTheDocument()
    // The new key is now in the list — by its prefix, from the server refetch —
    // and never as the credential value (asserted absent above).
    expect(await screen.findByText('Laptop')).toBeInTheDocument()
    expect(await screen.findByText(MINTED.prefix)).toBeInTheDocument()
  })

  it('a mint failure surfaces calmly and shows no credential', async () => {
    mockKeys({ postStatus: 500 })
    renderKeys()
    await screen.findByText('CI pipeline')
    fireEvent.change(screen.getByLabelText(/new key name/i), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('button', { name: /create key/i }))

    expect(await screen.findByText(/Couldn’t mint the key/)).toBeInTheDocument()
    expect(screen.queryByText(MINTED.key)).not.toBeInTheDocument()
  })
})
