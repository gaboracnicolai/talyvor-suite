import { describe, expect, it } from 'vitest'

import { PROVIDER_PATHS, providerBaseURL, toolsFor } from './setupSnippets'

// Every string this module emits is something a trial user PASTES INTO A SHELL. A URL one
// character wrong, or the wrong credential variable, produces a bare 401 with no hint — which
// is worse than no setup page at all. So each fact below is pinned against Lens source, cited.
//
// VERIFIED against talyvor-lens@cc67661:
//   cmd/lens/main.go:1832-1835,1869-1871  POST /v1/proxy/{openai,anthropic,google,bedrock,
//                                          mistral,groq,vllm}/*
//   cmd/lens/main.go:1878-1879            POST /oai/*, /anthropic/*  — first-class routes to
//                                          the SAME handlers (HandleOpenAI / HandleAnthropic),
//                                          not deprecated aliases.
//   internal/inference/config.go:36-51    the upstream URL comes from CONFIG, not the request
//                                          path — so the client's path suffix is ignored and
//                                          any sub-path under the prefix reaches the handler.
//   internal/auth/middleware.go:106-112   extractKey reads ONLY `Authorization: Bearer` and
//                                          `X-Talyvor-Key`.
//   internal/auth/middleware.go:35-39     AuthMiddleware 401s IMMEDIATELY when extractKey is
//                                          empty — the broader extractor in manager.go (which
//                                          does read X-API-Key) is never reached.

describe('providerBaseURL', () => {
  it('emits the exact prefixes Lens mounts', () => {
    expect(providerBaseURL('https://lens.talyvor.com', 'openai')).toBe(
      'https://lens.talyvor.com/v1/proxy/openai',
    )
    // Claude Code appends /v1/messages, so the base must be the /anthropic prefix.
    expect(providerBaseURL('https://lens.talyvor.com', 'anthropic')).toBe(
      'https://lens.talyvor.com/anthropic',
    )
  })

  it('normalises a trailing slash rather than emitting a double slash', () => {
    expect(providerBaseURL('https://lens.talyvor.com/', 'openai')).toBe(
      'https://lens.talyvor.com/v1/proxy/openai',
    )
    expect(providerBaseURL('https://lens.talyvor.com///', 'anthropic')).toBe(
      'https://lens.talyvor.com/anthropic',
    )
  })

  it('returns empty for an empty base — never a relative path that would silently resolve', () => {
    expect(providerBaseURL('', 'openai')).toBe('')
    expect(providerBaseURL('   ', 'anthropic')).toBe('')
  })

  it('pins the mounted paths so a rename in Lens breaks this test, not a user’s shell', () => {
    expect(PROVIDER_PATHS.openai).toBe('/v1/proxy/openai')
    expect(PROVIDER_PATHS.anthropic).toBe('/anthropic')
  })
})

describe('toolsFor', () => {
  const base = 'https://lens.talyvor.com'
  const key = 'tlv_live_EXAMPLEKEY123'
  const tools = toolsFor(base, key)

  it('covers the tools people actually use', () => {
    const ids = tools.map((t) => t.id)
    expect(ids).toContain('claude-code')
    expect(ids).toContain('openai-sdk')
    expect(ids).toContain('cursor')
    expect(ids).toContain('continue')
  })

  // THE FINDING THAT MATTERS MOST. Anthropic's own docs call ANTHROPIC_API_KEY "the standard
  // choice for third-party gateways" — and it sends the credential as `X-Api-Key`, which Lens's
  // extractKey does not read, so it 401s. ANTHROPIC_AUTH_TOKEN sends `Authorization: Bearer`,
  // which Lens does read. Following the obvious advice fails here.
  it('uses ANTHROPIC_AUTH_TOKEN for Claude Code, never ANTHROPIC_API_KEY', () => {
    const cc = tools.find((t) => t.id === 'claude-code')!
    const names = cc.env!.map((e) => e.name)
    expect(names).toContain('ANTHROPIC_BASE_URL')
    expect(names).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(names).not.toContain('ANTHROPIC_API_KEY')
    // And the page must SAY why, or the next person "helpfully" switches it.
    expect(cc.note ?? '').toMatch(/X-Api-Key|Authorization|Bearer/i)
  })

  it('points Claude Code at the /anthropic prefix with the real key', () => {
    const cc = tools.find((t) => t.id === 'claude-code')!
    const byName = Object.fromEntries(cc.env!.map((e) => [e.name, e.value]))
    expect(byName.ANTHROPIC_BASE_URL).toBe('https://lens.talyvor.com/anthropic')
    expect(byName.ANTHROPIC_AUTH_TOKEN).toBe(key)
  })

  it('uses OPENAI_BASE_URL + OPENAI_API_KEY for the OpenAI SDK', () => {
    const sdk = tools.find((t) => t.id === 'openai-sdk')!
    const byName = Object.fromEntries(sdk.env!.map((e) => [e.name, e.value]))
    expect(byName.OPENAI_BASE_URL).toBe('https://lens.talyvor.com/v1/proxy/openai')
    expect(byName.OPENAI_API_KEY).toBe(key)
  })

  it('marks settings-field tools as such instead of printing an env var that does nothing', () => {
    for (const id of ['cursor', 'continue']) {
      const t = tools.find((x) => x.id === id)!
      expect(t.kind).toBe('setting')
      expect(t.env).toBeUndefined()
      expect(t.setting!.length).toBeGreaterThan(0)
    }
  })

  it('exposes exactly two lines per env-var tool — the whole promise of the page', () => {
    for (const t of tools.filter((x) => x.kind === 'env')) {
      expect(t.env!.length).toBe(2)
    }
  })

  it('renders a copyable block that is valid shell with the key inlined', () => {
    const cc = tools.find((t) => t.id === 'claude-code')!
    expect(cc.copyText).toBe(
      `export ANTHROPIC_BASE_URL="https://lens.talyvor.com/anthropic"\n` +
        `export ANTHROPIC_AUTH_TOKEN="${key}"`,
    )
  })

  it('never fabricates a savings figure', () => {
    const blob = JSON.stringify(tools)
    // Any percentage claim would be invented — none is measured.
    expect(blob).not.toMatch(/\d+\s?%/)
    expect(blob).not.toMatch(/\b\d+\s*[-–]\s*\d+\s?%/)
  })

  it('emits no snippets at all when the public base URL is unknown', () => {
    // Better a page that says "ask your operator" than one that prints the BFF's internal
    // http://127.0.0.1:8080, which every trial user would paste and none would reach.
    expect(toolsFor('', key)).toEqual([])
  })

  it('leaves a visible placeholder, not a real-looking key, when no key exists yet', () => {
    const anon = toolsFor(base, '')
    const cc = anon.find((t) => t.id === 'claude-code')!
    const token = cc.env!.find((e) => e.name === 'ANTHROPIC_AUTH_TOKEN')!.value
    expect(token).toMatch(/PASTE|YOUR|_KEY_/i)
    expect(token).not.toMatch(/^tlv_/)
  })
})
