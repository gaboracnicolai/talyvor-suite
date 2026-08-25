import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
  // MemoryRouter: the screen now links to /setup, so a router context is required. Wrapping
  // here rather than dropping the link — someone who mints a key on this screen and is told
  // nothing about using it is the exact gap /setup exists to close.
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Keys />
      </QueryClientProvider>
    </MemoryRouter>,
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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// REVOKE. Until this shipped the product could create credentials and not destroy them: a key you
// could not use still counted against your list, permanently.
//
// ⚠ THE CONFIRM GUARDS THE TARGET, NOT THE ACT — see Keys.tsx for the argument. So the tests are
// about WHICH key goes: that the wrong prefix does not arm the button, and that the id sent is the
// row's own. "A dialog appeared" is not the property.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** List + DELETE. Records every revoke so the test can assert WHICH id was sent. */
function mockKeysWithRevoke() {
  let rows = [
    { id: 'key_01', workspace_id: 'default', key_prefix: 'tlv_ws_9f21c4a0', name: 'CI pipeline', scopes: ['proxy'], created_at: '2026-07-14T09:12:00Z' },
    { id: 'key_02', workspace_id: 'default', key_prefix: 'tlv_ws_ff66ef1f', name: 'CI pipeline', scopes: ['proxy'], created_at: '2026-07-15T09:12:00Z' },
  ]
  const deleted: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'DELETE' && url.startsWith('/api/keys/')) {
      const id = url.slice('/api/keys/'.length)
      deleted.push(id)
      rows = rows.filter((r) => r.id !== id)
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url === '/api/keys' && method === 'GET') {
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('null', { status: 404 })
  })
  return { deleted }
}

describe('revoking a key', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('a key revoked is GONE from the list, and the id sent is that row’s', async () => {
    const { deleted } = mockKeysWithRevoke()
    renderKeys()

    // ⚠ TWO ROWS SHARE A NAME and differ only by prefix — the real list looks like this, which is
    // exactly why the confirm has to identify the target rather than the action.
    expect(await screen.findByText('tlv_ws_ff66ef1f')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /revoke tlv_ws_ff66ef1f/i }))
    fireEvent.change(screen.getByLabelText(/type tlv_ws_ff66ef1f/i), {
      target: { value: 'tlv_ws_ff66ef1f' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^revoke key$/i }))

    await waitFor(() => expect(deleted).toEqual(['key_02']))
    // ARRIVAL, not just the call: the row is gone without a reload, and the OTHER key survives.
    await waitFor(() => expect(screen.queryByText('tlv_ws_ff66ef1f')).toBeNull())
    expect(screen.getByText('tlv_ws_9f21c4a0')).toBeInTheDocument()
  })

  it('the wrong identifier does NOT arm the button — nothing is sent', async () => {
    const { deleted } = mockKeysWithRevoke()
    renderKeys()

    await screen.findByText('tlv_ws_ff66ef1f')
    fireEvent.click(screen.getByRole('button', { name: /revoke tlv_ws_ff66ef1f/i }))

    // The OTHER key's identifier — the exact mistake this guard exists to catch.
    fireEvent.change(screen.getByLabelText(/type tlv_ws_ff66ef1f/i), {
      target: { value: 'tlv_ws_9f21c4a0' },
    })
    expect(screen.getByRole('button', { name: /^revoke key$/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /^revoke key$/i }))
    expect(deleted).toEqual([])
  })

  it('cancelling leaves the key alone', async () => {
    const { deleted } = mockKeysWithRevoke()
    renderKeys()

    await screen.findByText('tlv_ws_ff66ef1f')
    fireEvent.click(screen.getByRole('button', { name: /revoke tlv_ws_ff66ef1f/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByLabelText(/type tlv_ws_ff66ef1f/i)).toBeNull()
    expect(deleted).toEqual([])
    expect(screen.getByText('tlv_ws_ff66ef1f')).toBeInTheDocument()
  })

  it('says revocation is not instant, because it is not', async () => {
    mockKeysWithRevoke()
    renderKeys()

    await screen.findByText('tlv_ws_ff66ef1f')
    fireEvent.click(screen.getByRole('button', { name: /revoke tlv_ws_ff66ef1f/i }))

    // Lens caches validated keys for 5 minutes (internal/auth/apikeys.go cacheTTL) and the revoke
    // route does not purge it. Telling an operator a leaked key is dead the moment they click would
    // be the most dangerous sentence on this screen.
    expect(screen.getByText(/5 minutes/i)).toBeInTheDocument()
  })
})

// ─── W1.1.5 — THE REBUILD ────────────────────────────────────────────────────────────────────
//
// What this screen was: ONE card in a `px-gutter py-4` stack holding four different ideas — where
// to learn what a key is for, how to mint one, what went wrong, and the keys that exist — with no
// heading of the screen's own and no marking between them. The sticky banner wrote "Keys" and
// everything under it was one anonymous panel, so a reader moving by region got one stop on the
// screen that hands out credentials.
//
// ⚠ AND ITS EMPTY STATE WAS A ROW IN A LIST. "No keys yet. Create one above." is a sentence about
// the LIST; the state a new signup is actually in is a WORKSPACE with no credential at all, and
// nothing on the page said what a key is for or what to do after minting one — which is the
// question `/setup` exists to answer and which this screen only ever offered as a caption.

/** A workspace that has never minted anything. An ANSWERED empty list, never a failed read. */
function mockNoKeys() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/keys' && method === 'GET')
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    return new Response('null', { status: 404 })
  })
}

describe('W1.1.5 — the screen has a shape a reader can navigate', () => {
  it('opens with exactly one page-scale heading, and it is an h2', async () => {
    mockKeys()
    renderKeys()
    await screen.findByText('CI pipeline')
    const pageScale = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter((h) =>
      h.className.includes('text-page'),
    )
    expect(
      pageScale.map((h) => h.tagName),
      'the screen writes ONE page-scale claim about what this page is; the shell already writes ' +
        'the only h1',
    ).toEqual(['H2'])
  })

  it('every section of the screen is a NAMED landmark — none is anonymous', async () => {
    mockKeys()
    renderKeys()
    await screen.findByText('CI pipeline')
    const sections = Array.from(document.querySelectorAll('section'))
    expect(
      sections.length,
      'the screen draws no sections at all — it is the single anonymous panel the rebuild replaces',
    ).toBeGreaterThan(2)
    // A <section> is a `region` landmark ONLY when it has an accessible name, so the two counts
    // must agree. A floor on getAllByRole('region') alone passes an unnamed sibling.
    expect(screen.getAllByRole('region')).toHaveLength(sections.length)
  })
})

describe('W1.1.5 — a workspace with no key is told what a key is FOR', () => {
  it('says the workspace has no keys and links to where a key gets used', async () => {
    mockNoKeys()
    renderKeys()
    expect(await screen.findByText(/has no keys/i)).toBeInTheDocument()
    // The next action after minting is not on this screen, and it never was: Setup holds the two
    // environment variables. The empty state names that destination instead of implying the key
    // does something by existing.
    expect(screen.getByRole('link', { name: /setup/i })).toHaveAttribute('href', '/setup')
  })

  it('a list that could NOT be read is never drawn as a workspace with no keys', async () => {
    // ⚠ THE DIRECTION THAT MATTERS. A failed read is not an empty workspace. Told wrongly here it
    // tells an operator whose keys are live that they have none — on the screen whose other
    // control is REVOKE.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }))
    renderKeys()
    await screen.findByText(/couldn’t load|couldn’t read|try again/i)
    expect(screen.queryByText(/has no keys/i)).toBeNull()
  })

  it('the reveal state says at page scale that the credential will not be shown again', async () => {
    mockKeys()
    renderKeys()
    fireEvent.change(await screen.findByLabelText('New key name'), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    await screen.findByText(MINTED.key)
    const pageScale = document.querySelector('h2.text-page')
    expect(
      pageScale?.textContent ?? '',
      'the one moment this screen has a credential on it is the one moment its page-scale claim ' +
        'should be about the credential',
    ).toMatch(/again/i)
  })
})
