import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, MuNumeral } from '@talyvor/ui'

import { api, type EarningsSummary, type EarningsTypeLine } from '../../lib/api'
import { PanelFailure } from '../../components/SessionExpiredBar'
import { Region, RegionScreen } from '../../components/Region'
import { UNPAID_CONTRIBUTION_NOTICE, UNPAID_NOTICE_HEADLINE } from './unpaidNotice'

// Earnings — what this workspace has EARNED, from GET /api/earnings (the BFF proxies Lens's
// /v1/workspaces/{ws}/earnings, the workspace resolved from the session per request).
//
// ── THE OBVIOUS FIELD IS WRONG, AND IT IS ALREADY ON THIS PRODUCT'S API ───────────────────────
//
// `LensBalance.lifetime_earned_ulens` is what anyone building "your answers earned $6 back"
// reaches for. talyvor-lens #472 measured it through the production ledger on real Postgres and it
// is lifetime CREDITED, not earned: `LedgerStore.applyTx` does `earned += amount` on EVERY credit
// with no filter on the ledger type, so LENS a workspace was given, bought, or simply got back all
// raise it — 27x over what was earned on a five-row fixture. A stake/unstake round trip, which
// returns the wallet to exactly the balance it started from, raises it by the principal every
// cycle with no bound. NOTHING ON THIS SCREEN READS THAT FIELD, and earningsSource.test.ts keeps
// it that way after this comment stops being read.
//
// ── THE THREE THINGS THIS SCREEN REFUSES TO DO ───────────────────────────────────────────────
//
// (1) IT NEVER FOLDS CAPITAL INTO CONTRIBUTION. `stake_yield` is settled income credited to the
//     workspace, so it is real — and nobody wrote an answer for it. Adding it to the headline
//     leaves the TOTAL right and makes the SENTENCE false, which is the worse of the two.
//
// (2) IT NEVER CALLS A PEG CONVERSION A PRICE. LENS has one published peg and no market. Every
//     dollar figure says "at the published peg" and the peg is on screen, because "$6" with no
//     qualifier is a claim about what somebody would pay.
//
// (3) IT NEVER RENDERS A BARE ZERO OVER A DISABLED FEATURE. The switches a royalty needs all ship
//     OFF, so on a stock deployment the honest answer is 0 and it says nothing about the
//     workspace. When Lens reports earning is not enabled this screen names the switches instead
//     of showing a total — a "$0.00" there would state an operator setting as a measurement.

/**
 * µLENS → dollars at a published peg. EXPORTED FOR THE TEST AND NOT USED BY THE COMPONENT, which
 * is deliberate rather than an oversight.
 *
 * The screen renders the dollars LENS SENT (`*_usd_at_peg`), because two derivations of one number
 * in two repositories is how they drift. This is the INDEPENDENT one, and Earnings.test.tsx
 * asserts the two agree on the fixture — so if Lens changes the peg or the conversion, a test says
 * so rather than the screen quietly showing a figure nobody re-derived.
 */
export function usdAtPeg(micros: number, lensPerUSD: number): number {
  if (!lensPerUSD) return 0
  return micros / 1_000_000 / lensPerUSD
}

function Money({ micros, usd }: { micros: number; usd: number }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <MuNumeral micros={micros} unit="lens" />
      <span className="font-figure text-body text-muted">
        ≈ ${usd.toFixed(2)} at the published peg
      </span>
    </span>
  )
}

function TypeRow({ line }: { line: EarningsTypeLine }) {
  return (
    <tr className="border-b border-rule last:border-b-0">
      <td className="px-gutter py-2 text-body text-ink">{line.type}</td>
      <td className="px-gutter py-2">
        <span className="font-figure text-eyebrow uppercase text-muted">{line.kind}</span>
      </td>
      <td className="px-gutter py-2 text-right">
        <div className="flex justify-end">
          <MuNumeral micros={line.amount_ulens} unit="lens" />
        </div>
      </td>
      <td className="px-gutter py-2 text-right font-figure text-body text-muted">{line.rows}</td>
      {/* The REASON travels from Lens rather than being restated here: a figure that cannot explain
          its own composition is what this area keeps being reviewed for, and a second copy of the
          explanation is a second thing to keep true. */}
      <td className="px-gutter py-2 text-caption font-normal text-muted">{line.reason}</td>
    </tr>
  )
}

export function Earnings() {
  const q = useQuery({ queryKey: ['earnings'], queryFn: () => api.earnings() })

  // ⚠ ONE FAULT ARM FOR THE WHOLE SCREEN, AND IT RETURNS EARLY, BECAUSE A FAILED READ IS NOT A
  // SMALLER VERSION OF THIS SCREEN. Every figure below — earned, held, revoked, the breakdown —
  // is a claim about a ledger this component could not read, so none of them can be drawn and
  // none of the regions that frame them mean anything either. The first version rendered the
  // fault inside region 01 and let regions 02 and 03 fall away on a `!s` guard; emptyVsFault.test
  // named region 03's empty branch (⚠ NO LINE NUMBER: a pointer into THIS file moves every time
  // this file does, which pointerAudit caught within minutes of my writing one), and it was right
  // for a reason the code did not show: the
  // error arm sat in a SIBLING container that had already closed, so nothing on the path to
  // region 03's "nothing has earned yet" had asked whether the read failed.
  if (q.isError) {
    return (
      <RegionScreen>
        <Region index="01" label="Earnings" heading="What your work earned">
          <PanelFailure error={q.error} what="your earnings" />
        </Region>
      </RegionScreen>
    )
  }

  const s: EarningsSummary | undefined = q.data
  const lines = s?.by_type ?? []
  // Only the lines that are income. `not_earnings` rows are real ledger activity and belong on the
  // Ledger, not under a heading that says earned.
  const income = lines.filter((l) => l.class === 'settled' || l.class === 'held')
  const gates = s?.disabled_gates ?? []
  const unclassified = s?.unclassified_types ?? []
  const armed = Boolean(s && s.earning_enabled)

  return (
    <RegionScreen>
      <Region index="01" label="Earnings" heading="What your work earned">
        {q.isLoading || !s ? (
          <p className="text-body text-muted">Loading…</p>
        ) : !s.earning_enabled ? (
          <div className="space-y-3">
            <p data-testid="earning-off" className="text-body text-ink">
              Reuse earning is switched off in this deployment, so there is nothing to report — not
              zero, unmeasured.
            </p>
            <p className="text-body text-muted">
              A contribution only earns when every switch below is on. Until then this workspace can
              contribute answers that others reuse and be credited nothing, and no figure here would
              tell you that.
            </p>
            {gates.length > 0 ? (
              <ul data-testid="disabled-gates" className="space-y-1">
                {gates.map((g) => (
                  <li key={g} className="font-mono text-caption text-ink">
                    {g}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-caption font-normal text-muted">
              These are operator settings on Lens, not preferences on this account. An operator
              turns them on; nothing on this screen can.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-body text-muted">
              Settled earnings from work of yours that somebody else reused.
            </p>
            <div data-testid="contribution-total" className="text-title text-ink">
              <Money
                micros={s.contribution_settled_ulens}
                usd={s.contribution_settled_usd_at_peg}
              />
            </div>
            {/* ⚠ SEPARATE LINE, NEVER ADDED IN. Yield on locked LENS is income and is not an answer
                anybody wrote, so it cannot sit inside a figure the sentence above introduces. */}
            {s.capital_settled_ulens > 0 ? (
              <p data-testid="capital-line" className="text-body text-muted">
                Separately, <MuNumeral micros={s.capital_settled_ulens} unit="lens" /> of yield on
                LENS you locked. That is income, and it is not something you answered — so it is not
                part of the figure above.
              </p>
            ) : null}
            <p className="text-caption font-normal text-muted">
              Dollar figures convert at the peg Lens publishes ({s.lens_per_usd} LENS to the
              dollar). LENS is not traded, so that is a unit conversion and not a price.
            </p>
          </div>
        )}
      </Region>

      {armed && s ? (
        <Region index="02" label="Not yours yet">
          <p className="text-body text-muted">
            A reuse royalty is <em>held</em> before it settles: while it is held an adjudicator can
            still revoke it, so it is not money you have.
          </p>
          <p data-testid="held-total" className="mt-3 text-body text-ink">
            <Money micros={s.held_ulens} usd={s.held_usd_at_peg} /> held.
          </p>
          {s.revoked_ulens > 0 ? (
            <p data-testid="revoked-line" className="mt-3 text-body text-muted">
              <MuNumeral micros={s.revoked_ulens} unit="lens" /> has been revoked after
              adjudication. It is shown so a fall in what you earned has a name rather than being an
              unexplained drop.
            </p>
          ) : null}
        </Region>
      ) : null}

      {armed && s ? (
        <Region index="03" label="Where it came from">
          {income.length === 0 ? (
            <div className="space-y-2">
              {/* ⚠ THE NEXT ACTION IS A LINK, NOT A SENTENCE ABOUT ONE. EmptyStates.test named
                  this branch while its advice sat in the paragraph BELOW — the paragraph a reader
                  who stops at the first line never reaches. Prose saying "Setup is the next thing
                  to check" would have satisfied nobody: the reader still has to go and find it. */}
              <p data-testid="nothing-earned" className="text-body text-ink">
                Nothing has earned yet — earning is on, and no contribution of yours has been
                reused.
              </p>
              <p className="text-body text-muted">
                Reuse earning needs your work to be poolable, and that consent lives on Setup.
              </p>
              <Button asChild variant="primary" className="mt-1">
                <Link to="/setup">Open Setup</Link>
              </Button>
              <p className="text-caption text-muted">
                <strong className="text-ink">{UNPAID_NOTICE_HEADLINE}</strong>{' '}
                {UNPAID_CONTRIBUTION_NOTICE}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-rule text-left font-figure text-eyebrow uppercase text-muted">
                    <th className="px-gutter py-2 font-semibold">Ledger type</th>
                    <th className="px-gutter py-2 font-semibold">Kind</th>
                    <th className="px-gutter py-2 text-right font-semibold">Amount</th>
                    <th className="px-gutter py-2 text-right font-semibold">Rows</th>
                    <th className="px-gutter py-2 font-semibold">Why it counts</th>
                  </tr>
                </thead>
                <tbody>
                  {income.map((l) => (
                    <TypeRow key={l.type} line={l} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ⚠ NEVER DROPPED SILENTLY. Lens reports ledger types its own vocabulary does not
              classify; a type nobody classified is otherwise worth zero here without anyone
              noticing, which is how a new mint becomes invisible on an earnings screen. */}
          {unclassified.length > 0 ? (
            <p data-testid="unclassified" className="mt-4 text-caption text-muted">
              <strong className="text-ink">Not counted, and not ignored.</strong> Lens found ledger
              types it does not classify on this workspace:{' '}
              <span className="font-mono text-ink">{unclassified.join(', ')}</span>. They are left
              out of every figure above rather than guessed at.
            </p>
          ) : null}
        </Region>
      ) : null}
    </RegionScreen>
  )
}
