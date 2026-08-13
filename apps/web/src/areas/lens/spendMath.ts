// Pure derivation over ledger-shaped rows, for BOTH Lens ledgers. These functions run on the
// live /api/tokens/history and /api/lxc/history rows.
//
// The row SHAPE lives here now rather than in a fixtures module: a shape is part of the
// derivation's contract, whereas the sample rows that exercise it belong in the test files.
// areas/lens/fixtures.ts is gone — every screen it fed now reads a real route.

/** A mint-ledger row: the shape /api/tokens/history serves. */
export interface SpendLedgerRow {
  id: string
  amount_ulens: number
  type: string
  created_at: string
  metadata: Record<string, unknown>
}

export interface ModelAgg {
  model: string
  /** How many ledger rows named this model. */
  requests: number
  /** Exact µLENS across those rows — a count, never a float. */
  ulens: number
}

// byModel groups rows by metadata.model_used, largest µ first. Rows without a
// model claim are DROPPED, not bucketed as "unknown": inventing a bucket would
// present absence-of-provenance as a model, which is exactly the kind of quiet
// fabrication this app refuses elsewhere.
export function byModel(rows: SpendLedgerRow[]): ModelAgg[] {
  const agg = new Map<string, ModelAgg>()
  for (const r of rows) {
    const model = r.metadata['model_used']
    if (typeof model !== 'string' || model === '') continue
    const a = agg.get(model) ?? { model, requests: 0, ulens: 0 }
    a.requests += 1
    a.ulens += r.amount_ulens
    agg.set(model, a)
  }
  return [...agg.values()].sort((a, b) => b.ulens - a.ulens || a.model.localeCompare(b.model))
}

// inWindow keeps rows from the last `days` days relative to `now` (exclusive
// lower bound `now - days`). `now` is a parameter, not a wall-clock read, so
// the same call is reproducible in tests and in the UI.
export function inWindow(rows: SpendLedgerRow[], days: number, now: Date): SpendLedgerRow[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000
  return rows.filter((r) => {
    const t = Date.parse(r.created_at)
    return Number.isFinite(t) && t >= cutoff
  })
}

// ⚠ THE PAGE IS A CEILING, NOT A REQUEST — and every window figure on two screens is a sum
// over ONE page of it.
//
// 200 is clamped in TWO independent servers, so no client can ask past it:
//
//   apps/bff/lens.go#proxyPaged            clampInt(r.URL.Query().Get("limit"), 20, 1, 200)
//   lens internal/economy/dualtoken.go#DualTokenStore.GetLXCHistory  if limit > 200 { limit = 200 }
//
// MEASURED on the real BFF binary (not on this constant): an upstream holding 260 rows,
// asked for limit=1000, served 200. The control — same binary, same question, an upstream
// holding 150 — served 150, so 200 is the wire's answer rather than the fixture's.
//
// The rows arrive `ORDER BY created_at DESC`. A FULL page is therefore the NEWEST 200 and
// the rows it drops are the OLDEST ones in the window — so a sum over a full page is a
// FLOOR, and a count over it is a floor too.
//
// ⚠ ORDINARY VOLUME REACHES IT. A reserved request writes THREE lxc_ledger rows —
// reservation_hold, reservation_release, spend (lens agent_subbudget.go#ReserveLXCForAgent, and #SettleLXCReservation's release + delivered-charge writes) — so
// 200 rows is about 67 requests. Overview's window is THIRTY DAYS.
//
// Lives here, next to the derivations it bounds, and is passed to the fetch by the screens:
// a page size the fetch and the predicate could set separately is a page size they can drift
// apart on, and then the mark describes a number it is not attached to.
export const LEDGER_PAGE = 200

/**
 * Did this page prove it reached back past the window's edge?
 *
 * FALSE (covered) when either is true:
 *   · the page came back SHORT — the ledger itself was exhausted, so nothing is missing;
 *   · its OLDEST row is already older than the cutoff — the window is wholly inside the page.
 *
 * TRUE (truncated) only when the page is FULL and every row on it is still inside the
 * window: rows inside the window exist that were never fetched, and every total derived
 * from it under-reports.
 *
 * ⚠ The oldest row is taken by MINIMUM, not by reading the last element. The ordering is
 * the upstream's promise, and a predicate that would go quietly wrong if that promise
 * changed is not the one to put under a money figure.
 *
 * This is the rule `Ledger.tsx` already applies one screen away (`hasNext = rows.length ===
 * PAGE`) — a full page means there may be more. That screen pages; these two sum.
 */
export function windowExceedsPage(
  rows: readonly { created_at: string }[],
  pageSize: number,
  days: number,
  now: Date,
): boolean {
  if (rows.length < pageSize) return false
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000
  let oldest = Infinity
  for (const r of rows) {
    const t = Date.parse(r.created_at)
    if (Number.isFinite(t) && t < oldest) oldest = t
  }
  // No parseable row on a full page: nothing can be said about its reach, and a figure
  // summed from unreadable dates is not one to certify as complete.
  if (!Number.isFinite(oldest)) return true
  return oldest >= cutoff
}

/** A row with a signed µ amount — either token's normalized ledger shape. */
export interface SignedRow {
  amount: number
  created_at: string
  /** The ledger row type. ⚠ LOAD-BEARING — see SETTLED_CHARGE below.
   *
   *  REQUIRED, and it was optional. The optionality existed for a fallback in `debitTotal`
   *  justified as "the LENS ledger shares this shape and does not have lxc_ledger's types".
   *  MEASURED, and false about the ledger it named: `api.LedgerRow.type` is a required string
   *  that BOTH `api.lensLedger` and `api.lxcLedger` set from the wire, lens serialises
   *  `Type string \`json:"type"\`` (no omitempty) over a NOT NULL column, and the LENS ledger's
   *  own types are what `format.ts#ledgerStatus` classifies by suffix. Nothing this product can
   *  fetch arrived without one — so the optional marker described no row and only invited a
   *  caller to build the one shape that re-enabled the sign rule underneath a money figure. */
  type: string
}

/** A signed row that still carries its lxc_ledger metadata document. */
export interface SignedRowWithMeta extends SignedRow {
  metadata: Record<string, unknown>
}

// ⚠ WHAT COUNTS AS SPENT — and why summing negative rows was ~4.5x too high.
//
// lxc_ledger carries SIX types. Only ONE of them is a charge:
//
//   spend                 the delivered charge. THIS is spend.
//   reservation_hold      NEGATIVE, but a pre-serve BOUND, not a bill. Released moments later.
//   reservation_release   the compensating credit; nets the hold to zero.
//   grant | purchase | convert_from_lens   credits.
//
// The previous rule was "negative amount = debit", chosen so that "credits are excluded by SIGN,
// not by type string, which stays correct if a new credit type appears". That reasoning is right
// about CREDITS and wrong about HOLDS: a hold is negative and is not a charge. Real production
// rows — a -3270 hold, its +3270 release, and the -920 that was actually billed — summed to 8,380
// where 1,840 was spent.
//
// Lens states this on the constant itself (internal/economy/agent_subbudget.go#LXCTypeReservationHold):
//   "LXCTypeReservationHold marks the pre-serve HOLD debit — a bound, NOT a bill. Revenue readers
//    (sum type='spend') MUST exclude it; it nets to zero against its release."
// `type` survives the whole path — Lens selects it, the BFF proxies it, api.ts maps it — and only
// this file's row interface dropped it, so the sums could not see what they were adding.
//
// ⚠ ALLOW-LIST, NOT DENY-LIST. Excluding 'reservation_hold' by name would silently over-count the
// next negative non-charge type someone adds. Naming the one type that IS a charge fails the other
// way: a genuinely new charge type would be under-counted and visibly missing, which someone
// notices, rather than inflating a number nobody can check.
const SETTLED_CHARGE = 'spend'

/** One model's share of the LXC that left the balance. µLXC, exact integer. */
export interface LxcModelAgg {
  model: string
  requests: number
  ulxc: number
}

// lxcDebitsByModel splits LXC spend per model — the thing two screens used to say was
// impossible ("LXC ledger rows carry no model attribution"). It became possible at lens
// #343 and richer at #355; the rows have carried it on the wire the whole time since, and
// this UI was throwing the field away in api.lxcLedger before anything could read it.
//
// WHICH MODEL A DEBIT BELONGS TO: served_model when present, else requested_model. The hold
// is taken PRE-ROUTE so it can only name the requested model; the delivered-charge spend row
// names both, and there the model that actually served is the truthful attribution for the
// money. Falling back rather than dropping keeps hold-only rows (a settle that never
// completed, a swept reservation) attributed instead of silently absent.
//
// This is the LXC ledger ONLY — µLXC the workspace was charged. It is NOT provider USD COGS
// (token_events / /api/usage), and the two must never be summed into one column: one is what
// the customer paid, the other what the provider cost. Two ledgers, no mixing.
//
// ⚠ THE FALLBACK'S STATED REASON NAMED A ROW CLASS THIS FUNCTION DROPS. It used to read
// "keeps hold-only rows (a settle that never completed, a swept reservation) attributed
// instead of silently absent" — and `r.type !== SETTLED_CHARGE` below drops every hold
// unconditionally, so no hold-only row has ever been attributed here. The fallback is NOT
// dead, and the rows that take it are a different class entirely: talyvor-lens'
// `SpendLXCForAgent` (the legacy pre-serve estimate debit, agent_subbudget.go#DualTokenStore.SpendLXCForAgent) stamps
// `meta.toMap()` — requested_model and request_id, NEVER served_model, because the debit is
// taken before routing. Those are `spend` rows with a requested model and no served one, and
// without the fallback every one of them would leave the split.
//
// Credits are excluded by SIGN as well as by type. ⚠ THIS IS THE ONE PLACE THE SIGN RULE
// SURVIVES, and `debitTotal` has no equivalent — the asymmetry is deliberate and it is why
// `splitShortfall` can go negative. A `spend` row with a NON-NEGATIVE amount is skipped here
// and SUMMED (as a negative) by debitTotal. No lens writer can produce that row — all three
// require a positive amount (dualtoken.go#DualTokenStore.SpendLXC, agent_subbudget.go#DualTokenStore.SpendLXCForAgent,
// and the settle's `if finalLXC > 0` in agent_subbudget.go#DualTokenStore.SettleLXCReservation) — but if one ever did, the sign test is what
// stops it becoming a NEGATIVE per-model figure, which is worse than an absent one.
//
// Rows with no model claim are DROPPED, not bucketed as "unknown" — same rule as
// byModel: absence of provenance is not a model. What that costs the reader is disclosed at
// the screen rather than hidden here: see splitShortfall below.
export function lxcDebitsByModel(rows: SignedRowWithMeta[], days: number, now: Date): LxcModelAgg[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000
  const agg = new Map<string, LxcModelAgg>()
  for (const r of rows) {
    const t = Date.parse(r.created_at)
    if (!Number.isFinite(t) || t < cutoff) continue
    if (r.amount >= 0) continue // credit, not spend
    const served = r.metadata['served_model']
    const requested = r.metadata['requested_model']
    const model =
      typeof served === 'string' && served !== ''
        ? served
        : typeof requested === 'string' && requested !== ''
          ? requested
          : ''
    if (model === '') continue
    // Holds carry model metadata too, so without this they inflated BOTH the µLXC and the request
    // count — two holds and two charges read as "4 charges" for two requests.
    if (r.type !== SETTLED_CHARGE) continue
    const a = agg.get(model) ?? { model, requests: 0, ulxc: 0 }
    a.requests += 1
    a.ulxc += -r.amount
    agg.set(model, a)
  }
  return [...agg.values()].sort((a, b) => b.ulxc - a.ulxc || a.model.localeCompare(b.model))
}

// debitTotal sums the SETTLED CHARGES inside the window and returns the total as a POSITIVE µ
// count — what the workspace was actually billed. See SETTLED_CHARGE above for why this is an
// allow-list on the type rather than a test on the sign.
//
// ⚠ THERE IS NO SIGN FALLBACK, AND THERE USED TO BE. A row whose `type` was not a string was
// summed by SIGN — the exact rule SETTLED_CHARGE exists to replace, kept alive one branch below
// it. The stated reason was "the LENS ledger shares this shape and does not have lxc_ledger's
// types"; see SignedRow.type for why both halves of that are false. No row this product can
// fetch ever took the branch, which is why nobody saw that its ONLY unit test lived inside it:
// every fixture row here carried no `type`, so mutating SETTLED_CHARGE left this function's
// test green. `type` is required now, so the shape the branch existed for cannot be built by a
// call site, and `spendMath.test.ts` asserts a cast one still sums to zero.
//
// Same ALLOW-LIST as `lxcDebitsByModel` one function up — one predicate on the type. ⚠ NOT the
// same rule end to end, and saying so was wrong: that function ALSO tests the sign, this one does
// not. See its comment for what the surviving sign test is for and what the asymmetry costs.
export function debitTotal(rows: SignedRow[], days: number, now: Date): number {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000
  let total = 0
  for (const r of rows) {
    const t = Date.parse(r.created_at)
    if (!Number.isFinite(t) || t < cutoff) continue
    if (r.type === SETTLED_CHARGE) {
      total += -r.amount
    }
  }
  return total
}

/** What a RENDERED per-model split leaves out of the window total it sits directly under. */
export interface SplitShortfall {
  /** µLXC of settled charges in the window whose row names NO model. */
  unattributed: number
  /** µLXC of ATTRIBUTED charges the caller is not rendering — a top-N slice. */
  notShown: number
}

// ⚠ THE SPLIT IS RENDERED AS A DECOMPOSITION OF THE TOTAL AND CANNOT ADD UP TO IT.
//
// Both screens draw `debitTotal` — "every model — the window total that left the balance" — and
// immediately below it the rows of `lxcDebitsByModel`, which Overview's own source calls "The
// per-model split of that total". Two disjoint things sit in the total and in no row:
//
//   · UNATTRIBUTED — a settled charge whose row names no model. Dropped here on purpose
//     (absence of provenance is not a model) and counted by debitTotal. Reachable, MEASURED in
//     talyvor-lens at `a04310a`: `shadow_lxc.go#Proxy.shadowSpendLXC` → `SpendLXC` inserts a `spend` row with
//     metadata literally `nil` (dualtoken.go#DualTokenStore.SpendLXC), and `AgentDebitMeta.toMap` OMITS an empty
//     scalar (agent_subbudget.go#AgentDebitMeta.toMap), so a settle carrying neither model writes no model key
//     either. `api.lxcLedger` maps an absent document to `{}`, so it arrives with no claim.
//   · NOT SHOWN — an attributed charge outside a top-N slice. Overview renders `.slice(0, 5)`;
//     the sixth model's µLXC is in the figure above and in none of the five rows.
//
// TWO NUMBERS, NOT ONE SUM. A single combined figure would need a sentence naming two causes for
// one amount, and then neither half could be checked against anything. Each is derived from the
// same rows the screen renders, so neither can drift from what is on it.
//
// ⚠ `unattributed` CAN GO NEGATIVE, and it is not clamped here. It does so for exactly one row
// shape — a `spend` row with a non-negative amount, which debitTotal sums and lxcDebitsByModel's
// sign test skips. No lens writer can produce one (see lxcDebitsByModel). A clamp would present
// that row as "nothing missing"; left signed, the screen renders no clause for it (a shortfall
// claim needs a positive shortfall) and the caller keeps the ability to tell the two apart.
export function splitShortfall(
  rows: SignedRowWithMeta[],
  shown: readonly LxcModelAgg[],
  days: number,
  now: Date,
): SplitShortfall {
  const sum = (xs: readonly LxcModelAgg[]) => xs.reduce((n, a) => n + a.ulxc, 0)
  const attributed = sum(lxcDebitsByModel(rows, days, now))
  return {
    unattributed: debitTotal(rows, days, now) - attributed,
    notShown: attributed - sum(shown),
  }
}
