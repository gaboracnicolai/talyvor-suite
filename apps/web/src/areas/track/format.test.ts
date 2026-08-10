import { describe, expect, it } from 'vitest'
import { formatCost, formatWhen, priorityLabel, statusLabel } from './format'

describe('track formatters', () => {
  it('formatWhen renders the shared compact clock and passes garbage through', () => {
    expect(formatWhen('2026-07-19T14:52:59Z')).toMatch(/Jul 19/)
    expect(formatWhen('not-a-date')).toBe('not-a-date')
  })

  it('statusLabel covers the whole six-value enum from model.go', () => {
    expect(statusLabel('backlog')).toBe('Backlog')
    expect(statusLabel('todo')).toBe('Todo')
    expect(statusLabel('in_progress')).toBe('In progress')
    expect(statusLabel('in_review')).toBe('In review')
    expect(statusLabel('done')).toBe('Done')
    expect(statusLabel('cancelled')).toBe('Cancelled')
  })

  it('priorityLabel maps 0–4 per model.IssuePriority', () => {
    expect(priorityLabel(0)).toBe('None')
    expect(priorityLabel(1)).toBe('Urgent')
    expect(priorityLabel(2)).toBe('High')
    expect(priorityLabel(3)).toBe('Medium')
    expect(priorityLabel(4)).toBe('Low')
  })

  // formatCost REPLACES a `formatUSD` this file used to test. That one rounded to cents and had
  // ZERO production call sites; the screen rendering ai_cost_usd used a local `costLabel`. These
  // cases are the SHIPPED rule — the one the product has always drawn — now that it is exported.
  describe('formatCost — Track\'s per-issue AI cost, the rule the screen actually renders', () => {
    it('keeps a sub-cent cost visible instead of rounding it to $0.00', () => {
      // The deleted formatUSD answered `$0.00` here. A single AI call is usually sub-cent, so
      // that is the value this field most often holds, and $0.00 reads as "cost nothing".
      expect(formatCost(0.0004)).toBe('$0.0004')
      expect(formatCost(0.009)).toBe('$0.0090')
    })

    it('says a genuine zero in words rather than showing $0.00', () => {
      expect(formatCost(0)).toBe('No AI spend recorded')
    })

    // ⚠ THE ZERO HAS TWO MEANINGS AND ONLY ONE OF THEM IS "NOTHING HAPPENED". A cache- or
    // node-served response is written upstream with cost_usd = 0 and its token counts intact
    // (talyvor-lens `insertCacheServeSQL` writes the 0 as a literal), and talyvor-track's syncer
    // lands every such row, so an issue can hold ai_tokens > 0 against ai_cost_usd == 0. The
    // sentence for "nothing was recorded" is FALSE about that issue — something was recorded, and
    // it summed to zero.
    //
    // Both strings are claims about the LEDGER, not about the world: this function is not told
    // whether the zero came from a cache hit, a node serve or a reconciliation, so it says what
    // was recorded and characterises nothing. Upstream is explicit that "free" would be the wrong
    // word (alerts.go: "A spend view must never render this row as 'the request was free'"), and
    // it is not this module's call to invent a better one.
    it('distinguishes a recorded zero from no record at all', () => {
      expect(formatCost(0, 18342)).toBe('$0.00 recorded')
      expect(formatCost(0, 0)).toBe('No AI spend recorded')
    })

    // The tokens argument only ever disambiguates the ZERO. A real cost renders identically
    // whatever the token count, so no existing call site can change meaning by omitting it.
    it('ignores the token count for any nonzero cost', () => {
      expect(formatCost(0.42, 18342)).toBe('$0.42')
      expect(formatCost(0.0004, 18342)).toBe('$0.0004')
      expect(formatCost(0.42)).toBe('$0.42')
    })

    it('renders a cent-or-more cost to two places', () => {
      expect(formatCost(0.42)).toBe('$0.42')
      expect(formatCost(0.01)).toBe('$0.01')
    })

    // ⚠ MEASURED, NOT CHANGED, AND IT IS A REAL DIFFERENCE FROM THE DELETED FUNCTION. The shipped
    // rule is `toFixed`, which has NO thousands separator: the deleted formatUSD returned
    // `$1,130.50` for this value and its unit test asserted that comma. The product has never
    // drawn the comma — costLabel never had one — so consolidating on the shipped rule changes
    // nothing on screen. Whether Track's cost SHOULD group above $1,000 is a formatting choice on
    // a money path, so it is pinned here as the shipped behaviour rather than quietly altered.
    it('does not group thousands — the shipped rule never has (pinned, not endorsed)', () => {
      expect(formatCost(1130.5)).toBe('$1130.50')
    })

    // ⚠ THE SHIPPED RULE HAS ITS OWN ZERO FLOOR, and an invariant written as "never render a
    // nonzero amount as zero" would fail on the very function it was written to protect.
    // toFixed(4) bottoms out below half a hundredth of a cent. Pinned so the floor is a known
    // property with a number on it rather than a surprise.
    it('bottoms out at four places — below $0.00005 it reads as zero too', () => {
      expect(formatCost(0.00001)).toBe('$0.0000')
    })
  })
})
