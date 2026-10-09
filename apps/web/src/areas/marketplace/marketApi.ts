import { ApiError, getJSON, readable } from "../../lib/api";
import { isSessionExpired } from "../../lib/productState";
import { formatULXC } from "../lens/agentBankApi";

// marketApi.ts — B20.3: the marketplace screens' reads and writes, through the BFF's /api/marketplace
// routes (apps/bff/marketplace.go) to Lens's catalog (B20.1) and its uses and earnings (B20.2).
// Prices are integer µLXC; earnings are integer µUSD.
//
// A refusal carries Lens's own sentence — the secret a publish was refused for, the variables a
// prompt needs, the model to name — and the screen shows it, because that sentence is the answer to
// "why not?".

export type ListingKind =
  "agent" | "prompt" | "skill" | "evaluation" | "pipeline";

export const KINDS: readonly {
  kind: ListingKind;
  label: string;
  plural: string;
}[] = [
  { kind: "agent", label: "Agent", plural: "Agents" },
  { kind: "prompt", label: "Prompt", plural: "Prompts" },
  { kind: "skill", label: "Skill", plural: "Skills" },
  { kind: "evaluation", label: "Evaluation", plural: "Evaluations" },
  { kind: "pipeline", label: "Pipeline", plural: "Pipelines" },
];

export const kindLabel = (k: string) =>
  KINDS.find((x) => x.kind === k)?.label ?? k;

/** Lens market.Needs (B20.8) — what a use of a version asks for, shown to everyone who may use it. */
export interface ListingNeeds {
  /** an agent or a skill takes the person's message */
  input: boolean;
  /** a prompt's {{variables}}, by name */
  variables: string[] | null;
  /** the model it runs on unless the person names another; "" when it names none */
  model: string;
  /** an evaluation's case count */
  cases?: number;
}

/** Lens market.Similar (B32.46) — the listing a version is nearest to that it may not copy without declaring it. */
export interface SimilarListing {
  listing_id: string;
  title: string;
  /** 0 to 1 */
  score: number;
  /** it allows remixes: remix it and declare it as a parent to publish without a review */
  remixable: boolean;
}

/** Lens market.Scan — what a version's publish scan found; B32.46 adds the listing it is nearest to. */
export interface ListingScan {
  held?: string;
  similar?: SimilarListing;
}

/** Lens market.ParentRef (B32.24) — a listing version a new one builds on. */
export interface ParentRef {
  listing_id: string;
  version: number;
}

/** Lens market.Parent — one edge of the family tree, with the share locked when it was declared. */
export interface ListingParent extends ParentRef {
  share_bps: number;
  source: string;
}

/** Lens market.Version. `artifact` is present only for the listing's owner. */
export interface ListingVersion {
  version: number;
  artifact_sha256: string;
  changelog?: string;
  created_at: string;
  needs?: ListingNeeds;
  artifact?: Record<string, unknown>;
  scan?: ListingScan;
  parents?: ListingParent[] | null;
}

/** Lens market.Listing. */
export interface Listing {
  id: string;
  workspace_id: string;
  kind: ListingKind;
  title: string;
  description: string;
  price_per_use_ulxc: number;
  visibility: "public" | "unlisted" | "private";
  latest_version: number;
  created_at: string;
  updated_at: string;
  versions?: ListingVersion[];
  /** B20.4 — held at review (only its seller sees it), or taken down; approved otherwise. */
  review_status?: "approved" | "held" | "taken_down";
  review_reason?: string;
  /** B32.18 — how it is sold: per use, outright, rented or by subscription, each under a licence. */
  offers?: Offer[] | null;
  /** B32.51 — how its offers' prices in the buyer's currency are charged: in US dollars, on the monthly bill. */
  price_note?: string;
  /** B32.24 — whether others may build on it: not at all, freely, or for a share of each remix's sales. */
  remix_policy?: "none" | "free" | "royalty";
  remix_share_bps?: number;
  /** B32.50 — what it can do, from Lens's controlled list (market_capabilities). */
  capabilities?: string[] | null;
}

/** Lens market.Display (B32.51) — an offer's price in the buyer's currency. The charge is still its US-dollar price. */
export interface PriceDisplay {
  currency: string;
  /** rounded half-up to the currency's minor unit */
  amount_minor: number;
  includes_tax: boolean;
  /** "incl. VAT", "+ VAT", or none */
  tax_label?: string;
  rate: string;
  rate_date?: string;
  source: string;
}

/** Lens market.Offer (B32.18). Prices are integer µUSD. */
export interface Offer {
  id?: string;
  kind: "per_use" | "buy" | "rent" | "subscribe";
  licence: "personal" | "commercial" | "enterprise";
  price_usd_micros: number;
  period_days?: number;
  included_uses?: number;
  seats?: number;
  /** B32.21 — a per_use offer's free trial uses for each buyer */
  trial_uses?: number;
  /** what the licence allows, in Lens's words */
  terms?: string;
  /** B32.51 — the price in the buyer's currency, on a read */
  display?: PriceDisplay;
}

// ── B32.61: discovery (Lens B32.50) ─────────────────────────────────────────────────────────────

/** Lens market.Capability — one entry of the controlled list a listing declares from. */
export interface Capability {
  slug: string;
  label: string;
}

/** Lens market.DiscoverHit — a listing a search found, with what one use is billed and what it was ranked by. */
export interface DiscoverHit extends Listing {
  /** µUSD: what one use is billed; 0 free; null when it is not sold per use (rented, bought or subscribed only) */
  price_per_use_usd_micros: number | null;
  distinct_buyers_7d: number;
  trending_score: number;
}

/** Lens market.DiscoverPage — one page of a search, 50 listings at most. */
export interface DiscoverPage {
  listings: DiscoverHit[] | null;
  sort: string;
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export type DiscoverSort = "relevance" | "trending" | "new" | "price";

/** A search as the Discover screen asks it; every field left empty is not a filter. */
export interface DiscoverQuery {
  q: string;
  capability: string;
  kind: ListingKind | "";
  licence: "" | "personal" | "commercial" | "enterprise";
  /** µUSD, or null for no ceiling */
  max_price_per_use: number | null;
  verified_only: boolean;
  /** "" lets Lens choose: relevance with words, trending without */
  sort: DiscoverSort | "";
  page: number;
}

/** Lens market.Collection — a workspace's list of listings; `listings` only on a read of it alone, in its order. */
export interface Collection {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  public: boolean;
  featured: boolean;
  featured_at?: string;
  listing_count: number;
  created_at: string;
  updated_at: string;
  listings?: Listing[] | null;
}

/** The search's query string: only what is set, so Lens applies its own defaults to the rest. */
export function discoverParams(q: DiscoverQuery): string {
  const p = new URLSearchParams();
  if (q.q.trim()) p.set("q", q.q.trim());
  if (q.capability) p.set("capability", q.capability);
  if (q.kind) p.set("kind", q.kind);
  if (q.licence) p.set("licence", q.licence);
  if (q.max_price_per_use !== null)
    p.set("max_price_per_use", String(q.max_price_per_use));
  if (q.verified_only) p.set("verified_only", "true");
  if (q.sort) p.set("sort", q.sort);
  if (q.page > 1) p.set("page", String(q.page));
  return p.toString();
}

/** The reasons Lens takes a report for (B20.4), as a person would say them. */
export const REPORT_REASONS: readonly [string, string][] = [
  ["malicious", "It does something harmful"],
  ["injection", "It tries to take over the model (prompt injection)"],
  ["secret", "It exposes a password, key or other secret"],
  ["personal_data", "It exposes someone’s personal data"],
  ["infringing", "It copies someone else’s work"],
  ["misleading", "It does not do what it says"],
  ["other", "Something else"],
];

/** Lens market.Report. */
export interface ListingReport {
  id: string;
  listing_id: string;
  reason: string;
  details?: string;
  created_at: string;
  already_reported?: boolean;
}

/** Lens market.Draft — what a publish carries. */
export interface ListingDraft {
  kind: ListingKind;
  title: string;
  description: string;
  price_per_use_ulxc: number;
  visibility: "public" | "unlisted" | "private";
  artifact: Record<string, unknown>;
  changelog: string;
  /** B32.24 — whether others may build on it, and a royalty's share of each remix's sales */
  remix_policy: RemixPolicy;
  remix_share_bps: number;
  /** B32.24 — the listing versions it builds on; someone else's needs its remix licence accepted first (B32.25) */
  parents: ParentRef[];
}

export type RemixPolicy = "none" | "free" | "royalty";

/** Lens market.Remix (B32.25) — a listing version opened to build on, and the remix licence it was opened under. */
export interface RemixOpened {
  listing_id: string;
  version: number;
  kind: ListingKind;
  title: string;
  licence: string;
  /** absent for the listing's own workspace, which needs none */
  grant?: { listing_id: string; version: number; share_bps: number; accepted_at: string };
  artifact: Record<string, unknown>;
}

/** Lens market.UseRequest. */
export interface UseRequest {
  /** B32.57 — the version to run; 0 or none is the latest (a licence's pinned version, where one covers the use) */
  version?: number;
  model: string;
  input: string;
  variables: Record<string, string>;
}

/** Lens market.CaseResult. */
export interface CaseResult {
  input: string;
  expected: string;
  output: string;
  passed: boolean;
}

/** Lens market.Use — one use, as its buyer sees it. */
export interface ListingUse {
  id: string;
  listing_id: string;
  version: number;
  kind: ListingKind;
  model: string;
  charge: "billed" | "free" | "own" | "linked" | "licensed" | "trial";
  price_ulxc: number;
  output?: string;
  cases?: CaseResult[];
  used_at: string;
  /** B32.19 — the licence it ran under */
  licence_id?: string;
  /** B32.21 — a trial use: free, on test money, and what it would have cost had it been billed */
  trial?: boolean;
  trial_uses_left?: number;
  would_have_cost_usd_micros?: number;
}

/** Lens market.Review (B32.49) — a paying buyer's review and the seller's reply. */
export interface ListingReview {
  id: string;
  rating: number;
  text: string;
  reply?: string;
  created_at: string;
}

/** Lens market.Ancestor (B32.24) — one edge up the family tree: a listing this one builds on, and its share. */
export interface Ancestor {
  listing_id: string;
  version: number;
  /** none when the viewer may not see that listing */
  title?: string;
  hidden?: boolean;
  child_listing_id: string;
  child_version: number;
  share_bps: number;
  source: string;
  /** 1 a parent, 2 a grandparent, … */
  depth: number;
}

/** Lens market.Trust (B32.49) — a listing's trust panel, for the version a buyer would run. */
export interface ListingTrust {
  listing_id: string;
  version: number;
  publisher: {
    workspace_id: string;
    verified: boolean;
    payouts_enabled: boolean;
    upheld_claims_12_months: number;
    not_verified_because?: string[] | null;
  };
  /** only from buyers who paid and are not linked to the seller */
  reviews: {
    count: number;
    average: number;
    /** how many gave 1, 2, 3, 4 and 5 */
    stars: number[];
    recent: ListingReview[] | null;
  };
  /** null: no stored eval run of that version */
  eval: { version: number; passed: number; cases: number; ran_at: string } | null;
  claims: { open: number; upheld: number; attributed: number; rejected: number };
  originals: Ancestor[] | null;
  /** how many listings build on it, at any depth */
  remixes: number;
}

/** Lens market.Earning — one cleared use's share: the seller's, or an original's royalty from a remix's sale. */
export interface Earning {
  use_id: string;
  /** the listing sold; "" for a payment to this company's agent */
  listing_id: string;
  /** sale, or lineage: a royalty from a remix's sale (B32.26) */
  kind?: string;
  /** a royalty's own listing: the original the listing sold builds on */
  original_listing_id?: string;
  /** what the buyer paid: on the sale, 0 on a royalty */
  gross_usd_micros: number;
  share_usd_micros: number;
  /** Talyvor's take, on the sale */
  fee_usd_micros?: number;
  invoice_id: string;
  cleared_at: string;
  payable_at: string;
  /** its share was reversed by a refund, chargeback or takedown */
  refunded_at?: string | null;
  /** a payment to this company's agent, not a use of a listing (B19.15) */
  payee_agent_id?: string;
  /** dispute or ip_claim: kept in the holdback until the hold is released (B32.17) */
  held_for?: string;
}

/** Lens market.Earnings — a seller's totals and latest 100 earnings. */
export interface Earnings {
  pending_uses: number;
  pending_usd_micros: number;
  payable_usd_micros: number;
  in_holdback_usd_micros: number;
  available_usd_micros: number;
  lifetime_gross_usd_micros: number;
  earnings: Earning[] | null;
}

/** Lens billing.ConnectAccount — the seller's Stripe account, as Stripe last described it (B20.5). */
export interface ConnectAccount {
  stripe_account_id: string;
  country: string;
  details_submitted: boolean;
  payouts_enabled: boolean;
  currently_due: string[] | null;
  disabled_reason?: string;
}

/** Lens market.Payout — one payout: money through Stripe, or the balance taken as credits. */
export interface Payout {
  id: string;
  method: "stripe" | "credits";
  month: string;
  /** B32.42 — the ISO week it was made in, such as `2026-W41` */
  period?: string;
  gross_usd_micros: number;
  /** B32.43 — the VAT on the seller's self-billed invoice, paid on top */
  vat_usd_micros?: number;
  account_fee_usd_micros: number;
  payout_fee_usd_micros: number;
  net_usd_micros: number;
  credits_ulxc?: number;
  stripe_transfer_id?: string;
  paid_at?: string;
  last_error?: string;
  created_at: string;
}

/** Lens market.Payouts (B20.5) — a seller's payout page. account is null until they connect. */
export interface Payouts {
  account: ConnectAccount | null;
  in_holdback_usd_micros: number;
  available_usd_micros: number;
  owed_usd_micros: number;
  paid_out_usd_micros: number;
  minimum_usd_micros: number;
  paid_this_month: boolean;
  /** B32.42 — the seller was paid this week, so is next paid next week. */
  paid_this_week?: boolean;
  /** Paying the available balance out in money now, with Stripe's fees at cost. */
  quote: {
    gross_usd_micros: number;
    account_fee_usd_micros: number;
    payout_fee_usd_micros: number;
    net_usd_micros: number;
  };
  payouts: Payout[] | null;
}

/** Lens sellertax.TIN — a taxpayer identification number and the country that issued it. Read back masked: `••••4567`. */
export interface SellerTIN {
  jurisdiction: string;
  number: string;
}

/** Lens sellertax.Details (B32.41) — a seller's tax details as they are shown: the TINs, the date of birth and the
 *  payout account masked, what is still missing, and where the reminders and any payout hold stand. */
export interface SellerTax {
  seller_type: "" | "individual" | "entity";
  first_name: string;
  middle_name: string;
  last_name: string;
  legal_name: string;
  address: string;
  country: string;
  tins: SellerTIN[] | null;
  /** masked, `••••-••-••`; "" when not given */
  date_of_birth: string;
  company_registration_number: string;
  vat_number: string;
  vat_valid: boolean;
  /** why the VAT number is not valid */
  vat_detail?: string;
  vat_checked_at?: string;
  /** masked to its last four characters */
  account_identifier: string;
  account_holder: string;
  self_billing_agreed_version: string;
  complete: boolean;
  /** the fields still to give, in the order the form asks for them */
  missing: string[] | null;
  completed_at?: string;
  reminders_sent: number;
  last_reminded_at?: string;
  next_reminder_at?: string;
  withheld_since?: string;
  /** why payouts are held, in Lens's words */
  hold?: string;
  /** false: tax details cannot be saved here yet */
  accepting: boolean;
}

/** Lens sellertax.Input — what a save sends. tins, date_of_birth and account_identifier null keep what is stored. */
export interface SellerTaxInput {
  seller_type: "individual" | "entity";
  first_name: string;
  middle_name: string;
  last_name: string;
  legal_name: string;
  address: string;
  country: string;
  tins: SellerTIN[] | null;
  date_of_birth: string | null;
  company_registration_number: string;
  vat_number: string;
  account_identifier: string | null;
  account_holder: string;
  self_billing_agreed_version: string;
}

/** Lens market.StatementSummary (B32.42) — one week the seller was paid in. */
export interface StatementSummary {
  period: string;
  payout_id: string;
  net_usd_micros: number;
  paid_at: string | null;
}

/** Lens market.StatementLine — what one line adds to the net, or (negative) takes from it. */
export interface StatementLine {
  kind:
    | "brought_forward"
    | "sales"
    | "talyvor_fee"
    | "royalties_paid"
    | "royalties_received"
    | "refunds"
    | "credits"
    | "supply_vat"
    | "other"
    | "carried_forward"
    | "stripe_fees";
  label: string;
  amount_usd_micros: number;
}

/** Lens market.SelfBillParty — one side of a self-billed invoice, as it prints. */
export interface SelfBillParty {
  name: string;
  address: string;
  country: string;
  vat_number: string;
}

/** Lens market.SelfBill (B32.43) — the week's payout as a self-billed invoice from the seller to Talyvor. */
export interface SelfBill {
  id: string;
  number: string;
  payout_id: string;
  period: string;
  issued_at: string;
  agreement_version: string;
  supplier: SelfBillParty;
  customer: SelfBillParty;
  net_usd_micros: number;
  vat_usd_micros: number;
  gross_usd_micros: number;
  rate_bps: number;
  jurisdiction: string;
  treatment: string;
  note: string;
  vat_enabled: boolean;
  preview: boolean;
}

/** Lens market.Statement (B32.42) — a seller's statement for one ISO week, read from the journal. Its lines sum to
 *  net_usd_micros, what the week's payout paid. */
export interface SellerStatement {
  period: string;
  from: string;
  to: string;
  payout: Payout | null;
  /** how many of the seller's sales were released to them this week */
  sales: number;
  lines: StatementLine[] | null;
  net_usd_micros: number;
  /** for information: the VAT Talyvor collected from the buyers of those sales, owed to the tax authorities */
  vat_collected_usd_micros: number;
  self_billed_invoice: SelfBill | null;
}

/** Lens market.BillLine — one paid use on the buyer's bill. Its tax (B32.39) is on top of its price. */
export interface BillLine {
  use_id: string;
  listing_id: string;
  title: string;
  agent_id?: string;
  price_ulxc: number;
  used_at: string;
  cleared_at?: string;
  refunded_at?: string;
  tax_usd_micros?: number;
  tax_rate_bps?: number;
  tax_jurisdiction?: string;
  tax_treatment?: string;
  tax_note?: string;
}

/** Lens market.Bill — the buyer's billed uses in one month (UTC), or (B28.140) on one Stripe invoice. The totals are
 *  before tax; net, tax and gross are what the buyer pays, its tax included (B32.39). A refunded use is listed, and
 *  counts in refunded_ulxc instead of the totals. */
export interface MarketBill {
  month: string;
  total_ulxc: number;
  total_usd_micros: number;
  refunded_ulxc?: number;
  net_usd_micros?: number;
  tax_usd_micros?: number;
  gross_usd_micros?: number;
  lines: BillLine[] | null;
  /** B28.140 — the invoice it was read for (?invoice=) */
  invoice?: MarketInvoice;
}

/** B28.385 — the invoice the marketplace bill's period in progress will be: Lens lists it first, before Stripe issues it. */
export const UPCOMING_INVOICE = "upcoming";

/** Lens market.Invoice (B28.140) — one Stripe invoice of the buyer's marketplace bill: the billing period it charged
 *  for, and Stripe's PDF of it. µUSD. The bill read for it (?invoice=) has gross = gross_usd_micros − refunded_usd_micros. */
export interface MarketInvoice {
  /** Stripe's invoice id; UPCOMING_INVOICE for the period in progress */
  id: string;
  /** Stripe's invoice number, once it is issued */
  number?: string;
  /** the billing period: its first instant, and its end (exclusive) */
  period_start: string;
  period_end: string;
  status: "upcoming" | "draft" | "open" | "paid" | "void" | "uncollectible";
  /** Stripe's PDF of the invoice, once it is issued */
  invoice_pdf?: string;
  /** what it charged — or, upcoming, has come to so far — its tax included, refunded uses too */
  gross_usd_micros: number;
  /** of that, what was refunded */
  refunded_usd_micros: number;
}

/** Lens market.Licence (B32.19–B32.20) — a purchase, rental or subscription this workspace holds or held. */
export interface MarketLicence {
  id: string;
  listing_id: string;
  title: string;
  offer_id?: string;
  agent_id?: string;
  licence: "personal" | "commercial" | "enterprise";
  terms: string;
  kind: "buy" | "rent" | "subscribe";
  /** null: it follows the latest version */
  pinned_version: number | null;
  starts_at: string;
  /** null: it never ends */
  ends_at: string | null;
  auto_renew: boolean;
  status: "active" | "expired" | "cancelled" | "refunded" | "unpaid";
  seats?: number;
  /** a rental's or subscription's uses, from its offer: 0 is unlimited */
  included_uses?: number;
  uses_covered: number;
  /** what its rents have paid, µUSD — towards owning the listing (rent-to-own) */
  rent_paid_usd_micros: number;
  /** offer, or rent_to_own: its buyer's rents paid for it */
  source: "offer" | "rent_to_own";
  created_at: string;
  price_ulxc: number;
}

/** Lens market.ReceiptSummary (B32.40) — Talyvor's receipt for one paid marketplace bill. */
export interface ReceiptSummary {
  id: string;
  number: string;
  invoice_id: string;
  issued_at: string;
  gross_usd_micros: number;
  tax_usd_micros: number;
}

/** Lens market.QueueItem (B20.4) — a listing waiting for Talyvor's review: held, reported, or both. */
export interface QueueItem {
  listing: Listing;
  open_reports: number;
  /** the open reports' reasons, most frequent first */
  report_reasons: string[] | null;
  /** the latest open reports' details, newest first */
  report_details: string[] | null;
}

/** Lens market.Refund — one refunded use, a market_refunds row. */
export interface Refund {
  use_id: string;
  listing_id: string;
  buyer_workspace_id: string;
  seller_workspace_id: string;
  price_ulxc: number;
  gross_usd_micros: number;
  reversed_share_usd_micros: number;
  reason: string;
  refunded_at: string;
  stripe_credit_id?: string;
  credited_at?: string;
}

/** Lens market.Takedown — the listing taken down and the refunds that wrote. */
export interface Takedown {
  listing: Listing;
  refunds: Refund[] | null;
  /** a buyer's credit Stripe did not accept yet; Lens retries it */
  credit_error?: string;
}

/** B27.19 — a billed use Stripe refused too often: off its buyer's bill until an operator retries it. */
export interface ParkedUse {
  id: string;
  listing_id: string;
  buyer_workspace_id: string;
  price_ulxc: number;
  used_at: string;
  /** how many times Stripe refused it */
  refusals: number;
  /** Stripe's reason, from its last refusal */
  reason: string;
  parked_at: string;
}

/** A refusal, with the sentence Lens gave for it. */
export class MarketError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly sentence: string,
  ) {
    super(status, path);
  }
}

async function post<T>(path: string, body: object): Promise<T> {
  return send<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
}

/** A read whose refusal carries a sentence the screen shows (the review queue's 403 and 501). */
async function read<T>(path: string): Promise<T> {
  return send<T>(path, { headers: { Accept: "application/json" } });
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let sentence = "";
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new MarketError(res.status, path, sentence);
  }
  return (await res.json()) as T;
}

const e = encodeURIComponent;

/** Licenses one of a listing's offers. Lens requires the Idempotency-Key, so a retried click never buys twice. */
function license(listingID: string, offerID: string, version: number, key: string) {
  return send<MarketLicence>(`/api/marketplace/listings/${e(listingID)}/licences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({ offer_id: offerID, version }),
  });
}

export const marketApi = {
  catalog: async (kind: ListingKind | "") =>
    (
      await getJSON<{ listings: Listing[] | null }>(
        `/api/marketplace/listings${kind ? `?kind=${kind}` : ""}`,
        {
          listings: "list",
        },
      )
    ).listings ?? [],
  // B32.61 — discovery: Lens's search (B32.50), its controlled list of capabilities and the public collections.
  /** A filter Lens refuses (a capability not on its list) is refused with its sentence, so it is a read that keeps it. */
  search: async (q: DiscoverQuery) => {
    const qs = discoverParams(q);
    const path = `/api/marketplace/search${qs ? `?${qs}` : ""}`;
    return readable<DiscoverPage>(path, await read<unknown>(path), {
      listings: "list",
      total: "number",
      has_more: "boolean",
    });
  },
  capabilities: async () =>
    (
      await getJSON<{ capabilities: Capability[] | null }>(
        "/api/marketplace/capabilities",
        { capabilities: "list" },
      )
    ).capabilities ?? [],
  collections: async () =>
    (
      await getJSON<{ collections: Collection[] | null }>(
        "/api/marketplace/collections",
        { collections: "list" },
      )
    ).collections ?? [],
  collection: (id: string) =>
    // `listings` is left out of an empty collection's read (Lens omits it), so it is not part of the shape.
    getJSON<Collection>(`/api/marketplace/collections/${e(id)}`, {
      id: "string",
      title: "string",
    }),
  /** B32.57 — `currency` "" asks for the buyer's own: that of their tax-profile country. */
  listing: (id: string, currency = "") =>
    getJSON<Listing>(
      `/api/marketplace/listings/${e(id)}${currency ? `?currency=${e(currency)}` : ""}`,
      {
        id: "string",
        title: "string",
        price_per_use_ulxc: "number",
      },
    ),
  trust: (id: string) =>
    getJSON<ListingTrust>(`/api/marketplace/listings/${e(id)}/trust`, {
      publisher: "object",
      reviews: "object",
      remixes: "number",
    }),
  mine: async () =>
    (
      await getJSON<{ listings: Listing[] | null }>("/api/marketplace/mine", {
        listings: "list",
      })
    ).listings ?? [],
  earnings: () =>
    getJSON<Earnings>("/api/marketplace/earnings", {
      pending_usd_micros: "number",
      payable_usd_micros: "number",
      available_usd_micros: "number",
      earnings: "list",
    }),
  bill: (month: string) =>
    getJSON<MarketBill>(`/api/marketplace/bill?month=${e(month)}`, {
      total_ulxc: "number",
      total_usd_micros: "number",
      lines: "list",
    }),
  /** B28.385 — the bill's Stripe invoices, newest first (Lens B28.140); null from a Lens that does not list them yet. */
  invoices: async (): Promise<MarketInvoice[] | null> => {
    try {
      return (
        (
          await read<{ invoices: MarketInvoice[] | null }>(
            "/api/marketplace/invoices",
          )
        ).invoices ?? []
      );
    } catch (err) {
      if (err instanceof MarketError && err.status === 404) return null;
      throw err;
    }
  },
  /** B28.385 — the uses one invoice carried, as the bill (Lens B28.140). */
  invoiceBill: (id: string) =>
    getJSON<MarketBill>(`/api/marketplace/bill?invoice=${e(id)}`, {
      total_ulxc: "number",
      total_usd_micros: "number",
      lines: "list",
    }),
  // B32.59 — the licences this workspace holds (Lens B32.19–B32.20), and the receipts for its paid bills (B32.40).
  licences: async () =>
    (
      await getJSON<{ licences: MarketLicence[] | null }>(
        "/api/marketplace/licences",
        { licences: "list" },
      )
    ).licences ?? [],
  cancelLicence: (id: string) =>
    post<MarketLicence>(`/api/marketplace/licences/${e(id)}/cancel`, {}),
  /** Licenses the offer again — a rental or subscription that ended, renewed. `key` makes a retried click buy once. */
  renewLicence: (
    listingID: string,
    offerID: string,
    version: number,
    key: string,
  ) => license(listingID, offerID, version, key),
  /** B32.57 — buys, rents or subscribes to one of a listing's offers; version 0 follows the latest, any other pins it. */
  license: (listingID: string, offerID: string, version: number, key: string) =>
    license(listingID, offerID, version, key),
  receipts: async () =>
    (
      await read<{ receipts: ReceiptSummary[] | null }>(
        "/api/marketplace/receipts",
      )
    ).receipts ?? [],
  publish: (draft: ListingDraft) =>
    post<Listing>("/api/marketplace/listings", draft),
  /** B32.58 — accepts a listing's remix licence for a version (0: its latest) and opens its artifact to build on. */
  remix: (id: string, version = 0) =>
    post<RemixOpened>(`/api/marketplace/listings/${e(id)}/remix`, { version }),
  use: (id: string, req: UseRequest) =>
    post<ListingUse>(`/api/marketplace/listings/${e(id)}/use`, req),
  report: (id: string, reason: string, details: string) =>
    post<ListingReport>(`/api/marketplace/listings/${e(id)}/reports`, {
      reason,
      details,
    }),
  // B20.6 — the seller's payouts (Lens B20.5).
  payouts: () =>
    getJSON<Payouts>("/api/marketplace/payouts", {
      available_usd_micros: "number",
      owed_usd_micros: "number",
      quote: "object",
      payouts: "list",
    }),
  connectPayouts: (country: string) =>
    post<{ url: string; account: ConnectAccount }>(
      "/api/marketplace/payouts/connect",
      { country },
    ),
  takeAsCredits: () => post<Payout>("/api/marketplace/payouts/credits", {}),
  // B32.60 — the seller's tax details (Lens B32.41) and weekly statements (B32.42–B32.43). The owner or an admin only:
  // Lens says so to anyone else, and the screen shows its sentence.
  sellerTax: () => read<SellerTax>("/api/marketplace/seller-tax"),
  saveSellerTax: (input: SellerTaxInput) =>
    send<SellerTax>("/api/marketplace/seller-tax", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    }),
  statements: async () =>
    (
      await read<{ statements: StatementSummary[] | null }>(
        "/api/marketplace/statements",
      )
    ).statements ?? [],
  statement: (period: string) =>
    read<SellerStatement>(`/api/marketplace/statements?period=${e(period)}`),
  // B20.12 — Talyvor's review queue, for operators (apps/bff/market_review.go).
  reviewQueue: async () =>
    (
      await read<{ listings: QueueItem[] | null }>(
        "/api/admin/marketplace/review",
      )
    ).listings ?? [],
  approve: (id: string) =>
    post<Listing>(`/api/admin/marketplace/listings/${e(id)}/approve`, {}),
  takedown: (id: string, reason: string) =>
    post<Takedown>(`/api/admin/marketplace/listings/${e(id)}/takedown`, {
      reason,
    }),
  // B27.19 — parked uses, for operators (apps/bff/market_parked.go).
  parkedUses: async () =>
    (
      await read<{ parked_uses: ParkedUse[] | null }>(
        "/api/admin/marketplace/parked-uses",
      )
    ).parked_uses ?? [],
  retryParkedUse: (id: string) =>
    post<{ id: string; retrying: boolean }>(
      `/api/admin/marketplace/parked-uses/${e(id)}/retry`,
      {},
    ),
};

/** Where a receipt opens: Talyvor's page for it, from Lens. */
export const receiptHref = (id: string) => `/api/marketplace/receipts/${e(id)}`;

/** B32.57 — an offer's price in the buyer's currency, from its minor units: `£18.55`, `¥2,950`. */
export function formatDisplay(d: PriceDisplay): string {
  const f = new Intl.NumberFormat("en-GB", { style: "currency", currency: d.currency });
  const digits = f.resolvedOptions().maximumFractionDigits ?? 2;
  return f.format(d.amount_minor / 10 ** digits);
}

/** A listing's price, in words. */
export function priceText(micros: number): string {
  return micros > 0 ? `${formatULXC(micros)} per use` : "Free";
}

/** `0.5` → 500,000 µLXC; empty is free (0). Null for anything that is not an amount with at most six decimals. */
export function parsePrice(text: string): number | null {
  if (text.trim() === "") return 0;
  const m = /^\s*(\d+)(?:\.(\d{1,6}))?\s*$/.exec(text);
  if (!m) return null;
  const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
  return Number.isSafeInteger(micros) ? micros : null;
}

/** The variables Lens named when a prompt was used without them: "… the prompt needs the variables a, b". */
export function variablesNamedIn(err: unknown): string[] {
  if (!(err instanceof MarketError)) return [];
  const m = /the prompt needs the variables (.+)$/.exec(err.sentence);
  return m
    ? m[1]
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];
}

/** Why a write did not happen, in Lens's words where Lens gave some. */
export function refusalText(err: unknown): string {
  if (isSessionExpired(err)) return "Nothing happened — sign in again.";
  if (
    err instanceof MarketError &&
    err.sentence &&
    (err.status < 500 || err.status === 503)
  ) {
    const s = err.sentence.replace(
      /^(market: (invalid listing: )?|sellertax: (invalid tax details: )?)/,
      "",
    );
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith(".") ? "" : "."}`;
  }
  return "Nothing happened. You can try again.";
}

/** The {{variables}} a prompt's template asks for, by Lens's pattern (internal/market/use.go). */
export function variablesIn(template: string): string[] {
  return [
    ...new Set(
      [...template.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]),
    ),
  ];
}

/** The twelve months up to `now`, newest first, as Lens reads them: `2026-09`, in UTC. */
export function recentMonths(now: Date): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
    );
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** B28.385 — an invoice's billing period, as Stripe prints it: `Sep 14 – Oct 14, 2026`, or with both years across one. */
export function periodName(start: string, end: string): string {
  const across =
    new Date(start).getUTCFullYear() !== new Date(end).getUTCFullYear();
  return `${dayName(start, across)} – ${dayName(end)}`;
}

/** `2026-10-14T…` → `Oct 14, 2026` (UTC), or `Oct 14` without its year. */
export function dayName(iso: string, year = true): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** B28.385 — Stripe's PDF of an invoice, when Lens gave one that opens over https: anything else is not linked. */
export function invoicePdfHref(inv: MarketInvoice): string | undefined {
  if (!inv.invoice_pdf) return undefined;
  try {
    return new URL(inv.invoice_pdf).protocol === "https:"
      ? inv.invoice_pdf
      : undefined;
  } catch {
    return undefined;
  }
}

/** `2026-09` → `September 2026`. */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
