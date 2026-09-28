import { ApiError, getJSON } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { formatULXC } from '../lens/agentBankApi'

// marketApi.ts — B20.3: the marketplace screens' reads and writes, through the BFF's /api/marketplace
// routes (apps/bff/marketplace.go) to Lens's catalog (B20.1) and its uses and earnings (B20.2).
// Prices are integer µLXC; earnings are integer µUSD.
//
// A refusal carries Lens's own sentence — the secret a publish was refused for, the variables a
// prompt needs, the model to name — and the screen shows it, because that sentence is the answer to
// "why not?".

export type ListingKind = 'agent' | 'prompt' | 'skill' | 'evaluation' | 'pipeline'

export const KINDS: readonly { kind: ListingKind; label: string; plural: string }[] = [
  { kind: 'agent', label: 'Agent', plural: 'Agents' },
  { kind: 'prompt', label: 'Prompt', plural: 'Prompts' },
  { kind: 'skill', label: 'Skill', plural: 'Skills' },
  { kind: 'evaluation', label: 'Evaluation', plural: 'Evaluations' },
  { kind: 'pipeline', label: 'Pipeline', plural: 'Pipelines' },
]

export const kindLabel = (k: string) => KINDS.find((x) => x.kind === k)?.label ?? k

/** Lens market.Version. `artifact` is present only for the listing's owner. */
export interface ListingVersion {
  version: number
  artifact_sha256: string
  changelog?: string
  created_at: string
  artifact?: Record<string, unknown>
}

/** Lens market.Listing. */
export interface Listing {
  id: string
  workspace_id: string
  kind: ListingKind
  title: string
  description: string
  price_per_use_ulxc: number
  visibility: 'public' | 'unlisted' | 'private'
  latest_version: number
  created_at: string
  updated_at: string
  versions?: ListingVersion[]
}

/** Lens market.Draft — what a publish carries. */
export interface ListingDraft {
  kind: ListingKind
  title: string
  description: string
  price_per_use_ulxc: number
  visibility: 'public' | 'unlisted' | 'private'
  artifact: Record<string, unknown>
  changelog: string
}

/** Lens market.UseRequest. */
export interface UseRequest {
  model: string
  input: string
  variables: Record<string, string>
}

/** Lens market.CaseResult. */
export interface CaseResult {
  input: string
  expected: string
  output: string
  passed: boolean
}

/** Lens market.Use — one use, as its buyer sees it. */
export interface ListingUse {
  id: string
  listing_id: string
  version: number
  kind: ListingKind
  model: string
  charge: 'billed' | 'free' | 'own' | 'linked'
  price_ulxc: number
  output?: string
  cases?: CaseResult[]
  used_at: string
}

/** Lens market.Earning — one cleared use's share. */
export interface Earning {
  use_id: string
  listing_id: string
  gross_usd_micros: number
  share_usd_micros: number
  invoice_id: string
  cleared_at: string
  payable_at: string
}

/** Lens market.Earnings — a seller's totals and latest 100 earnings. */
export interface Earnings {
  pending_uses: number
  pending_usd_micros: number
  payable_usd_micros: number
  in_holdback_usd_micros: number
  available_usd_micros: number
  lifetime_gross_usd_micros: number
  earnings: Earning[] | null
}

/** A refusal, with the sentence Lens gave for it. */
export class MarketError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly sentence: string,
  ) {
    super(status, path)
  }
}

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new MarketError(res.status, path, sentence)
  }
  return (await res.json()) as T
}

const e = encodeURIComponent

export const marketApi = {
  catalog: async (kind: ListingKind | '') =>
    (await getJSON<{ listings: Listing[] | null }>(`/api/marketplace/listings${kind ? `?kind=${kind}` : ''}`)).listings ?? [],
  listing: (id: string) => getJSON<Listing>(`/api/marketplace/listings/${e(id)}`),
  mine: async () => (await getJSON<{ listings: Listing[] | null }>('/api/marketplace/mine')).listings ?? [],
  earnings: () => getJSON<Earnings>('/api/marketplace/earnings'),
  publish: (draft: ListingDraft) => post<Listing>('/api/marketplace/listings', draft),
  use: (id: string, req: UseRequest) => post<ListingUse>(`/api/marketplace/listings/${e(id)}/use`, req),
}

/** A listing's price, in words. */
export function priceText(micros: number): string {
  return micros > 0 ? `${formatULXC(micros)} per use` : 'Free'
}

/** `0.5` → 500,000 µLXC; empty is free (0). Null for anything that is not an amount with at most six decimals. */
export function parsePrice(text: string): number | null {
  if (text.trim() === '') return 0
  const m = /^\s*(\d+)(?:\.(\d{1,6}))?\s*$/.exec(text)
  if (!m) return null
  const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? '').padEnd(6, '0'))
  return Number.isSafeInteger(micros) ? micros : null
}

/** The variables Lens named when a prompt was used without them: "… the prompt needs the variables a, b". */
export function variablesNamedIn(err: unknown): string[] {
  if (!(err instanceof MarketError)) return []
  const m = /the prompt needs the variables (.+)$/.exec(err.sentence)
  return m ? m[1].split(',').map((v) => v.trim()).filter(Boolean) : []
}

/** Why a write did not happen, in Lens's words where Lens gave some. */
export function refusalText(err: unknown): string {
  if (isSessionExpired(err)) return 'Nothing happened — sign in again.'
  if (err instanceof MarketError && err.sentence && (err.status < 500 || err.status === 503)) {
    const s = err.sentence.replace(/^market: (invalid listing: )?/, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return 'Nothing happened. You can try again.'
}

/** The {{variables}} a prompt's template asks for, by Lens's pattern (internal/market/use.go). */
export function variablesIn(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]))]
}
