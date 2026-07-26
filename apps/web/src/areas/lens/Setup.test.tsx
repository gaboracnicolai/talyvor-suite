import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Setup } from './Setup'

// /setup closes the gap a trial user actually falls into: they sign in, mint a key, and are told
// nothing about what to do with it. The whole product is "point your existing tool at Lens" —
// two environment variables — and nothing said so.
//
// These tests drive the real fetch surface (mocked), never a fixture, and they hold the page to
// three promises: it shows the user's OWN key, it prints the base URL Lens actually mounts, and
// it is honest before a key exists rather than showing a plausible fake.

const MINTED = {
  key: 'tlv_ws_TESTKEY_not_a_real_credential_00000000000000000000',
  prefix: 'tlv_ws_7c0ffee0',
  name: 'Setup',
  scopes: ['proxy'],
}

const writeText = vi.fn(() => Promise.resolve())

interface MockOpts {
  publicLens?: string
  existingKeys?: unknown[]
  mintStatus?: number
}

function mockBff({ publicLens = 'https://lens.talyvor.com', existingKeys = [], mintStatus = 201 }: MockOpts = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

    if (url === '/api/context') {
      return json({
        workspace_id: 'u7kq2mfa',
        lens_base_url: 'http://127.0.0.1:8080', // internal — must never be shown
        lens_public_base_url: publicLens,
      })
    }
    if (url === '/api/keys' && method === 'POST') {
      if (mintStatus !== 201) return new Response('nope', { status: mintStatus })
      return json(MINTED, 201)
    }
    if (url === '/api/keys') return json(existingKeys)
    return json({})
  })
}

function renderSetup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Setup />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText } })
  writeText.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe('Setup — the two lines', () => {
  it('prints the exact base URL Lens mounts, per provider', async () => {
    mockBff()
    renderSetup()
    // Anthropic prefix for Claude Code; /v1/proxy/openai for everything on the OpenAI SDK.
    // The URL appears in several places by design (a copy block, and the settings-field steps
    // for Cursor/Continue), so assert presence, not uniqueness.
    await waitFor(() => {
      expect(screen.getAllByText(/https:\/\/lens\.talyvor\.com\/anthropic/).length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText(/https:\/\/lens\.talyvor\.com\/v1\/proxy\/openai/).length).toBeGreaterThan(0)
  })

  it('never shows the BFF’s internal Lens address', async () => {
    mockBff()
    const { container } = renderSetup()
    await waitFor(() => expect(screen.getAllByText(/\/anthropic/).length).toBeGreaterThan(0))
    expect(container.textContent).not.toContain('127.0.0.1')
  })

  it('exports ANTHROPIC_AUTH_TOKEN, and warns in prose against ANTHROPIC_API_KEY', async () => {
    mockBff()
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toContain('ANTHROPIC_AUTH_TOKEN'))

    // The SNIPPET must export the working variable and never the failing one. Scoped to the
    // <pre> blocks, because the surrounding prose SHOULD name ANTHROPIC_API_KEY — that warning
    // is the most valuable sentence on the page, and an assertion that banned the string
    // outright would have deleted it.
    const snippets = Array.from(container.querySelectorAll('pre')).map((n) => n.textContent ?? '')
    const shell = snippets.join('\n')
    expect(shell).toContain('export ANTHROPIC_AUTH_TOKEN=')
    expect(shell).not.toContain('ANTHROPIC_API_KEY')

    // And the page must explain why, or the next reader "fixes" it back.
    expect(container.textContent).toContain('ANTHROPIC_API_KEY')
    expect(container.textContent).toMatch(/X-Api-Key/i)
  })

  it('shows the user’s OWN key in the snippet after minting, once', async () => {
    mockBff()
    renderSetup()
    const mint = await screen.findByRole('button', { name: /create a key|mint/i })
    fireEvent.click(mint)
    await waitFor(() => {
      // Present in every env snippet — that is the point of the page.
      expect(screen.getAllByText(new RegExp(MINTED.key)).length).toBeGreaterThan(0)
    })
  })

  it('copies the two-line block to the clipboard', async () => {
    mockBff()
    renderSetup()
    const mint = await screen.findByRole('button', { name: /create a key|mint/i })
    fireEvent.click(mint)
    await waitFor(() => expect(screen.getAllByText(new RegExp(MINTED.key)).length).toBeGreaterThan(0))
    const copies = await screen.findAllByRole('button', { name: /copy/i })
    fireEvent.click(copies[0])
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = String((writeText.mock.calls as unknown as string[][])[0]?.[0] ?? '')
    expect(copied).toContain('ANTHROPIC_BASE_URL="https://lens.talyvor.com/anthropic"')
    expect(copied).toContain(`ANTHROPIC_AUTH_TOKEN="${MINTED.key}"`)
  })
})

describe('Setup — honest states', () => {
  it('says a key is needed, and does NOT invent one, before any key exists', async () => {
    mockBff({ existingKeys: [] })
    const { container } = renderSetup()
    // Wait for the SNIPPETS (which need the context query), not the mint button, which renders
    // immediately — otherwise this asserts against a half-loaded page and passes for the wrong
    // reason.
    await waitFor(() => expect(container.textContent).toContain('PASTE_YOUR_TALYVOR_KEY_HERE'))
    expect(screen.getByRole('button', { name: /create a key|mint/i })).toBeTruthy()
    expect(container.textContent).not.toMatch(/tlv_ws_[0-9a-f]{8}/)
  })

  it('explains why an EXISTING key cannot be re-shown, instead of faking it', async () => {
    mockBff({
      existingKeys: [
        { id: 'k1', workspace_id: 'u7kq2mfa', key_prefix: 'tlv_ws_9f21c4a0', name: 'CI', scopes: ['proxy'], created_at: '2026-07-14T09:12:00Z' },
      ],
    })
    const { container } = renderSetup()
    // Wait on the PREFIX: /hash/i alone matches the privacy card ("a hash of the prompt"), which
    // renders before the keys query resolves, so waiting on that passed vacuously.
    await waitFor(() => expect(container.textContent).toContain('tlv_ws_9f21c4a0'))
    // Lens stores only a hash, so the plaintext is unrecoverable. Say so.
    expect(container.textContent).toMatch(/only once|cannot show|can’t show|cannot be shown/i)
  })

  it('asks the operator for the URL rather than printing a broken one', async () => {
    mockBff({ publicLens: '' })
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toMatch(/not configured|operator|administrator/i))
    // With no URL there is nothing safe to paste, so no snippet may appear.
    expect(container.textContent).not.toContain('OPENAI_BASE_URL=')
    expect(container.textContent).not.toContain('127.0.0.1')
  })

  it('surfaces a failed mint instead of silently showing a placeholder', async () => {
    mockBff({ mintStatus: 500 })
    renderSetup()
    const mint = await screen.findByRole('button', { name: /create a key|mint/i })
    fireEvent.click(mint)
    await waitFor(() => expect(screen.getByText(/couldn’t|could not|failed/i)).toBeTruthy())
  })
})

describe('Setup — proving it worked', () => {
  it('spells out the send-one-request → see-the-row → repeat-for-a-cache-hit loop', async () => {
    mockBff()
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toContain('ANTHROPIC_AUTH_TOKEN'))
    const t = container.textContent ?? ''
    expect(t).toMatch(/ledger/i)
    // The second identical request is the pitch: a cache hit that costs nothing.
    expect(t).toMatch(/again|second|repeat/i)
    expect(t).toMatch(/cache/i)
  })

  it('links to the ledger so the confirmation is one click away', async () => {
    mockBff()
    renderSetup()
    await waitFor(() => expect(screen.getAllByText(/ANTHROPIC_AUTH_TOKEN/).length).toBeGreaterThan(0))
    const link = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/ledger')
    expect(link).toBeTruthy()
  })
})

describe('Setup — what Talyvor does with their traffic', () => {
  it('states what is stored, before anything is pasted', async () => {
    mockBff()
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toContain('ANTHROPIC_AUTH_TOKEN'))
    const t = container.textContent ?? ''
    expect(t).toMatch(/stored|stores/i)
    expect(t).toMatch(/logging/i)
  })

  it('says cross-tenant pooling is OFF unless they turned it on, and links the setting', async () => {
    mockBff()
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toContain('ANTHROPIC_AUTH_TOKEN'))
    expect(container.textContent).toMatch(/off\b|opt[- ]?in|not shared/i)
    const link = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/settings')
    expect(link).toBeTruthy()
  })

  it('says prompts are never served to another company — only answers, only if opted in', async () => {
    mockBff()
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toContain('ANTHROPIC_AUTH_TOKEN'))
    expect(container.textContent).toMatch(/prompt/i)
  })

  it('invents no savings figure', async () => {
    mockBff()
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toContain('ANTHROPIC_AUTH_TOKEN'))
    // No measured number exists, so no percentage may appear anywhere on the page.
    expect(container.textContent).not.toMatch(/\d+\s?%/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Two corrections found after the page was first written. Both are the same class
// of defect the page exists to avoid: text asserting a state the system does not have.

describe('Setup — sharing state is READ, not asserted', () => {
  // #33 reversed the default: the BFF now sends no field at provision, so Lens's default
  // (true) applies and sharing is ON for a new workspace. The page shipped saying
  // "Cross-tenant pooling is OFF unless you turn it on" — false the moment #33 merged, and
  // it is a privacy claim shown to someone deciding whether to route their company's
  // traffic through us. The fix is to render the RECORDED value from /auth/me rather than
  // hardcode either default, so it cannot go stale again.
  function mockWithSharing(cachePoolable: boolean | undefined) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
      if (url === '/api/context')
        return json({ workspace_id: 'u7kq2mfa', lens_base_url: 'http://127.0.0.1:8080', lens_public_base_url: 'https://lens.talyvor.com' })
      if (url === '/auth/me') return json({ cache_poolable: cachePoolable })
      if (url === '/api/keys' && method === 'POST') return json(MINTED, 201)
      if (url === '/api/keys') return json([])
      return json({})
    })
  }

  it('says sharing is ON when the workspace records it on', async () => {
    mockWithSharing(true)
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toMatch(/sharing is (currently )?on/i))
    // And must NOT carry the old, now-false absolute claim.
    expect(container.textContent).not.toMatch(/pooling is OFF unless/i)
    expect(container.textContent).not.toMatch(/By default nothing of yours/i)
  })

  it('says sharing is OFF when the workspace records it off', async () => {
    mockWithSharing(false)
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toMatch(/sharing is (currently )?off/i))
  })

  it('does not guess when the recorded value is unknown', async () => {
    mockWithSharing(undefined)
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toContain('ANTHROPIC_AUTH_TOKEN'))
    // Neither state may be asserted from an absent value.
    expect(container.textContent).not.toMatch(/sharing is (currently )?on\b/i)
    expect(container.textContent).not.toMatch(/sharing is (currently )?off\b/i)
    expect(container.textContent).toMatch(/check the setting|see the setting|unknown/i)
  })

  it('still says prompts are never shared, which is true either way', async () => {
    mockWithSharing(true)
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toMatch(/sharing is (currently )?on/i))
    expect(container.textContent).toMatch(/prompt/i)
  })
})

describe('Setup — the embeddings hazard', () => {
  it('warns INSIDE the OpenAI SDK card, where the unsafe instruction is', async () => {
    mockBff()
    renderSetup()
    // Scoped to the card, not a page-level banner: a warning somewhere else is a warning
    // nobody reads before pasting.
    await waitFor(() => expect(screen.getAllByText(/Before you paste this/i).length).toBeGreaterThan(0))
    const heading = await screen.findByText(/OpenAI SDK/i)
    // Walk up to the ancestor that also holds the snippet — that element IS the card, and it is
    // what "inside the card" means. Fixed-depth parentElement chains break on markup changes.
    let card: HTMLElement | null = heading
    while (card && !card.querySelector('pre')) card = card.parentElement
    expect(card, 'could not find the OpenAI SDK card').toBeTruthy()
    expect(card!.textContent).toMatch(/embedding/i)
    // …and the warning must be in THIS card, not merely somewhere on the page.
    expect(card!.textContent).toMatch(/Before you paste this/i)
  })

  it('explains that OPENAI_BASE_URL is global to the SDK', async () => {
    mockBff()
    const { container } = renderSetup()
    // Wait on the HAZARD text specifically: /embedding/i also matches the caveat list, which
    // renders before the tool cards, so waiting on that passed vacuously.
    await waitFor(() => expect(container.textContent).toMatch(/Before you paste this/i))
    expect(container.textContent).toMatch(/every call|all calls|global/i)
  })

  it('gives a per-client example so chat routes through Lens and embeddings do not', async () => {
    mockBff()
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toMatch(/Before you paste this/i))
    const snippets = Array.from(container.querySelectorAll('pre')).map((n) => n.textContent ?? '')
    const perCall = snippets.find((s) => s.includes('base_url') || s.includes('baseURL'))
    expect(perCall, 'a per-client snippet must exist, not just prose').toBeTruthy()
    // Two clients: one pointed at Lens, one left on the provider default.
    expect(perCall!).toMatch(/lens\.talyvor\.com\/v1\/proxy\/openai/)
  })

  it('does not claim embeddings work through the proxy', async () => {
    mockBff()
    const { container } = renderSetup()
    await waitFor(() => expect(container.textContent).toMatch(/embedding/i))
    expect(container.textContent).toMatch(/not proxied|are not|do not|cannot/i)
  })
})
