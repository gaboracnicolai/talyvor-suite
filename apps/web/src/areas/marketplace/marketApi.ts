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

/** Lens market.Needs (B20.8) — what a use of a version asks for, shown to everyone who may use it. */
export interface ListingNeeds {
  /** an agent or a skill takes the person's message */
  input: boolean
  /** a prompt's {{variables}}, by name */
  variables: string[] | null
  /** the model it runs on unless the person names another; "" when it names none */
  model: string
  /** an evaluation's case count */
  cases?: number
}

/** Lens market.Version. `artifact` is present only for the listing's owner. */
export interface ListingVersion {
  version: number
  artifact_sha256: string
  changelog?: string
  created_at: string
  needs?: ListingNeeds
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
  /** B20.4 — held at review (only its seller sees it), or taken down; approved otherwise. */
  review_status?: 'approved' | 'held' | 'taken_down'
  review_reason?: string
}

/** The reasons Lens takes a report for (B20.4), as a person would say them. */
export const REPORT_REASONS: readonly [string, string][] = [
  ['malicious', 'It does something harmful'],
  ['injection', 'It tries to take over the model (prompt injection)'],
  ['secret', 'It exposes a password, key or other secret'],
  ['personal_data', 'It exposes someone’s personal data'],
  ['infringing', 'It copies someone else’s work'],
  ['misleading', 'It does not do what it says'],
  ['other', 'Something else'],
]

/** Lens market.Report. */
export interface ListingReport {
  id: string
  listing_id: string
  reason: string
  details?: string
  created_at: string
  already_reported?: boolean
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

/** Lens billing.ConnectAccount — the seller's Stripe account, as Stripe last described it (B20.5). */
export interface ConnectAccount {
  stripe_account_id: string
  country: string
  details_submitted: boolean
  payouts_enabled: boolean
  currently_due: string[] | null
  disabled_reason?: string
}

/** Lens market.Payout — one payout: money through Stripe, or the balance taken as credits. */
export interface Payout {
  id: string
  method: 'stripe' | 'credits'
  month: string
  gross_usd_micros: number
  account_fee_usd_micros: number
  payout_fee_usd_micros: number
  net_usd_micros: number
  credits_ulxc?: number
  stripe_transfer_id?: string
  paid_at?: string
  last_error?: string
  created_at: string
}

/** Lens market.Payouts (B20.5) — a seller's payout page. account is null until they connect. */
export interface Payouts {
  account: ConnectAccount | null
  in_holdback_usd_micros: number
  available_usd_micros: number
  owed_usd_micros: number
  paid_out_usd_micros: number
  minimum_usd_micros: number
  paid_this_month: boolean
  /** Paying the available balance out in money now, with Stripe's fees at cost. */
  quote: { gross_usd_micros: number; account_fee_usd_micros: number; payout_fee_usd_micros: number; net_usd_micros: number }
  payouts: Payout[] | null
}

/** Lens market.BillLine — one paid use on the buyer's bill. */
export interface BillLine {
  use_id: string
  listing_id: string
  title: string
  agent_id?: string
  price_ulxc: number
  used_at: string
  cleared_at?: string
}

/** Lens market.Bill — the buyer's billed uses in one month (UTC). */
export interface MarketBill {
  month: string
  total_ulxc: number
  total_usd_micros: number
  lines: BillLine[] | null
}

/** Lens market.QueueItem (B20.4) — a listing waiting for Talyvor's review: held, reported, or both. */
export interface QueueItem {
  listing: Listing
  open_reports: number
  /** the open reports' reasons, most frequent first */
  report_reasons: string[] | null
  /** the latest open reports' details, newest first */
  report_details: string[] | null
}

/** Lens market.Refund — one refunded use, a market_refunds row. */
export interface Refund {
  use_id: string
  listing_id: string
  buyer_workspace_id: string
  seller_workspace_id: string
  price_ulxc: number
  gross_usd_micros: number
  reversed_share_usd_micros: number
  reason: string
  refunded_at: string
  stripe_credit_id?: string
  credited_at?: string
}

/** Lens market.Takedown — the listing taken down and the refunds that wrote. */
export interface Takedown {
  listing: Listing
  refunds: Refund[] | null
  /** a buyer's credit Stripe did not accept yet; Lens retries it */
  credit_error?: string
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
  return send<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A read whose refusal carries a sentence the screen shows (the review queue's 403 and 501). */
async function read<T>(path: string): Promise<T> {
  return send<T>(path, { headers: { Accept: 'application/json' } })
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, init)
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
  bill: (month: string) => getJSON<MarketBill>(`/api/marketplace/bill?month=${e(month)}`),
  publish: (draft: ListingDraft) => post<Listing>('/api/marketplace/listings', draft),
  use: (id: string, req: UseRequest) => post<ListingUse>(`/api/marketplace/listings/${e(id)}/use`, req),
  report: (id: string, reason: string, details: string) =>
    post<ListingReport>(`/api/marketplace/listings/${e(id)}/reports`, { reason, details }),
  // B20.6 — the seller's payouts (Lens B20.5).
  payouts: () => getJSON<Payouts>('/api/marketplace/payouts'),
  connectPayouts: (country: string) => post<{ url: string; account: ConnectAccount }>('/api/marketplace/payouts/connect', { country }),
  takeAsCredits: () => post<Payout>('/api/marketplace/payouts/credits', {}),
  // B20.12 — Talyvor's review queue, for operators (apps/bff/market_review.go).
  reviewQueue: async () => (await read<{ listings: QueueItem[] | null }>('/api/admin/marketplace/review')).listings ?? [],
  approve: (id: string) => post<Listing>(`/api/admin/marketplace/listings/${e(id)}/approve`, {}),
  takedown: (id: string, reason: string) => post<Takedown>(`/api/admin/marketplace/listings/${e(id)}/takedown`, { reason }),
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

/** The twelve months up to `now`, newest first, as Lens reads them: `2026-09`, in UTC. */
export function recentMonths(now: Date): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

/** `2026-09` → `September 2026`. */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

