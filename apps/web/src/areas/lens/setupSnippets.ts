// The strings a trial user pastes into a shell. Every fact here was read out of Lens source,
// not assumed — a URL one character wrong, or the wrong credential variable, produces a bare
// 401 with no hint, which is worse than shipping no setup page.
//
// VERIFIED against talyvor-lens@cc67661:
//
//   ROUTES (cmd/lens/main.go:1832-1835, 1869-1871, 1878-1879)
//     POST /v1/proxy/{openai,anthropic,google,bedrock,mistral,groq,vllm}/*
//     POST /oai/*  and  POST /anthropic/*
//   The last two are FIRST-CLASS routes to the same handlers (HandleOpenAI / HandleAnthropic),
//   not deprecated aliases — the source calls them "Helicone-shape URL prefixes … migrating
//   teams can keep these URLs indefinitely". They differ only in that a compat middleware
//   strips Helicone-Auth / Helicone-Property-* headers first. So /anthropic and
//   /v1/proxy/anthropic behave identically; we print the shorter one for Claude Code because
//   Claude Code appends /v1/messages and `…/anthropic/v1/messages` reads as intended.
//
//   PATH SUFFIX IS IGNORED (internal/inference/config.go:36-51)
//     upstreamURLFn returns a URL from CONFIG (openAIChatURL =
//     "https://api.openai.com/v1/chat/completions"), never something derived from the inbound
//     path. So the wildcard absorbs whatever the SDK appends. Two consequences we state
//     plainly below rather than let a user discover: only chat-completions-shaped calls work
//     (an /embeddings call would be forwarded to chat/completions), and the routes are POST
//     ONLY — no GET is registered, so a client that probes GET /models gets 405.
//
//   CREDENTIAL HEADER (internal/auth/middleware.go:35-39, 106-112)
//     extractKey reads ONLY `Authorization: Bearer …` then `X-Talyvor-Key`. AuthMiddleware
//     401s IMMEDIATELY when it comes back empty, so manager.go's broader extractor — which
//     does read X-API-Key — is never reached on these routes. This is why Claude Code must use
//     ANTHROPIC_AUTH_TOKEN (Authorization: Bearer) and NOT ANTHROPIC_API_KEY (X-Api-Key),
//     even though Anthropic's own docs call the latter the standard choice for a third-party
//     gateway. Following that advice against Lens fails with a bare 401.

/** The path prefixes Lens mounts, pinned so a rename upstream breaks a test, not a shell. */
export const PROVIDER_PATHS = {
  openai: '/v1/proxy/openai',
  anthropic: '/anthropic',
} as const

export type Provider = keyof typeof PROVIDER_PATHS

/** Shown in place of a credential when the user has not minted one yet. Deliberately not
 *  tlv_-prefixed: a realistic-looking fake invites a copy-paste that 401s. */
export const KEY_PLACEHOLDER = 'PASTE_YOUR_TALYVOR_KEY_HERE'

export interface EnvVar {
  name: string
  value: string
}

export interface Tool {
  id: string
  name: string
  /** 'env' — two exported variables. 'setting' — a field in the tool's own UI or config file,
   *  where an env var would do nothing and telling someone to set one wastes their patience. */
  kind: 'env' | 'setting'
  env?: EnvVar[]
  /** Ordered, human instructions for a settings-field tool. */
  setting?: string[]
  /** One-line caveat worth reading before pasting. */
  note?: string
  /** Exactly what the copy button puts on the clipboard. */
  copyText: string
  /** A hazard that must be read BEFORE the snippet above is pasted. Rendered inside this
   *  tool's own card, above its block — a page-level banner is the thing nobody reads. */
  hazard?: string
  /** An alternative, safer form. Present when the env-var route has a hazard that a
   *  per-call form avoids. */
  alternative?: { title: string; code: string }
}

/** normalise strips trailing slashes so a base URL ending in '/' cannot produce '//v1/proxy'. */
function normalise(base: string): string {
  return base.trim().replace(/\/+$/, '')
}

/** providerBaseURL is the value that goes in the tool's base-URL variable.
 *  Empty base ⇒ empty result: the caller must show an honest "not configured" state rather
 *  than print the BFF's internal Lens address, which no customer can reach. */
export function providerBaseURL(base: string, provider: Provider): string {
  const b = normalise(base)
  if (b === '') return ''
  return b + PROVIDER_PATHS[provider]
}

function shellExport(vars: EnvVar[]): string {
  return vars.map((v) => `export ${v.name}="${v.value}"`).join('\n')
}

/**
 * toolsFor builds the per-tool instructions for one workspace key.
 *
 * `key` empty ⇒ KEY_PLACEHOLDER is substituted, so the page is still readable before a key
 * exists. `base` empty ⇒ NO tools at all, because every snippet would carry a URL that cannot
 * work and a half-right instruction is the expensive kind.
 */
export function toolsFor(base: string, key: string): Tool[] {
  const b = normalise(base)
  if (b === '') return []

  const cred = key.trim() === '' ? KEY_PLACEHOLDER : key.trim()
  const openaiBase = providerBaseURL(b, 'openai')
  const anthropicBase = providerBaseURL(b, 'anthropic')

  const claudeCode: EnvVar[] = [
    { name: 'ANTHROPIC_BASE_URL', value: anthropicBase },
    { name: 'ANTHROPIC_AUTH_TOKEN', value: cred },
  ]
  const openaiSDK: EnvVar[] = [
    { name: 'OPENAI_BASE_URL', value: openaiBase },
    { name: 'OPENAI_API_KEY', value: cred },
  ]

  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      kind: 'env',
      env: claudeCode,
      note:
        'ANTHROPIC_AUTH_TOKEN, not ANTHROPIC_API_KEY. The two are not interchangeable here: ' +
        'ANTHROPIC_API_KEY is sent as an X-Api-Key header, which Lens does not read, so it ' +
        'returns 401. ANTHROPIC_AUTH_TOKEN is sent as Authorization: Bearer, which it does.',
      copyText: shellExport(claudeCode),
    },
    {
      id: 'openai-sdk',
      name: 'OpenAI SDK — Python, Node, LangChain, any script',
      kind: 'env',
      env: openaiSDK,
      // ⚠ READ BEFORE PASTING. OPENAI_BASE_URL is global to the SDK client, so it redirects
      // EVERY call — including embeddings. Lens's proxy sends whatever it receives to the
      // provider's CHAT endpoint (the upstream URL is fixed in config, not derived from the
      // request path), so an embeddings call arrives at chat/completions and the provider
      // rejects it. Verified end to end, and the good news is that it fails LOUDLY rather
      // than quietly: the cache write is gated on a 200, so nothing is stored and no vector
      // store is poisoned. But a RAG app breaks, and the error names the wrong endpoint.
      hazard:
        'If this app also creates embeddings, do NOT set these as environment variables. ' +
        'OPENAI_BASE_URL applies to every call the SDK makes, and embeddings are not proxied ' +
        'yet — they would be sent to the chat endpoint and rejected. Use the per-client form ' +
        'below instead, which routes only chat through Lens.',
      alternative: {
        title: 'Route only chat — two clients (use this if you embed)',
        code:
          `from openai import OpenAI\n` +
          `\n` +
          `# Chat goes through Lens.\n` +
          `lens = OpenAI(base_url="${openaiBase}", api_key="${cred}")\n` +
          `\n` +
          `# Embeddings keep talking to the provider directly, for now.\n` +
          `direct = OpenAI(api_key="YOUR_OPENAI_KEY")\n` +
          `\n` +
          `lens.chat.completions.create(model="gpt-4o", messages=[...])\n` +
          `direct.embeddings.create(model="text-embedding-3-small", input="…")`,
      },
      note:
        'Works for the official openai package in Python and Node, and for anything built on ' +
        'it. LangChain reads OPENAI_API_BASE first if you already have that set — unset it, ' +
        'or pass base_url= explicitly (and note the embeddings caveat above applies to ' +
        'LangChain retrieval too).',
      copyText: shellExport(openaiSDK),
    },
    {
      id: 'cursor',
      name: 'Cursor',
      kind: 'setting',
      setting: [
        'Settings › Models › OpenAI API Key.',
        'Enable "Override OpenAI Base URL" and set it to: ' + openaiBase,
        'Put your Talyvor key in the OpenAI API Key field.',
        'Cursor verifies the key before saving; if that check fails, confirm the URL has no trailing slash.',
      ],
      note:
        'Cursor reads its endpoint from its own settings, not the environment — exporting ' +
        'OPENAI_BASE_URL in a shell has no effect on it.',
      copyText: openaiBase,
    },
    {
      id: 'continue',
      name: 'Continue',
      kind: 'setting',
      setting: [
        'Open your Continue config (~/.continue/config.yaml, or config.json on older versions).',
        'On the model you want to route, set provider: openai.',
        'Set apiBase to: ' + openaiBase,
        'Set apiKey to your Talyvor key.',
      ],
      note:
        'Continue is configured by file, not environment. apiBase is per-model — which helps ' +
        'here: set it only on your chat model and an embeddings model in the same config keeps ' +
        'talking to the provider directly.',
      copyText: openaiBase,
    },
  ]
}

/** What Lens does and does not forward, stated once so the page can render it verbatim.
 *  Derived from the route table + config, not from marketing copy. */
export const MECHANISM_CAVEATS: string[] = [
  'Chat completions only, for now. Lens forwards to the provider’s chat endpoint regardless of the path your client appends, so an embeddings call is rejected rather than proxied. It fails loudly — nothing is cached and no vector store is affected — but a retrieval app will break if you route it here.',
  'POST only. No GET route is mounted, so a client that probes GET /models on startup sees 405 — that alone does not mean your key is wrong.',
  'Your existing model names keep working. You are changing where the request goes, not what you ask for.',
]
