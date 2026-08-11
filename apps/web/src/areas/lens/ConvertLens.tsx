import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input, MuNumeral } from "@talyvor/ui";
import { InlineFailure } from "../../components/SessionExpiredBar";
import {
  ConvertError,
  convertApi,
  lensCostForLXC,
  microsToUnits,
} from "./convertApi";

// SPENDING EARNED LENS — the exit the balance did not have.
//
// A workspace earns LENS from a cross-tenant pooled royalty. Until now nothing in the suite could
// spend it: Lens had the conversion, the BFF had no code for it and no screen offered it. A balance
// with no exit is worse than no balance — it looks like money and behaves like a number.
//
// ── WHY IT LIVES ON THE BALANCE, NOT ON A PAGE OF ITS OWN ───────────────────
//
// The question "what can I do with this?" is asked while looking at the number. A separate
// /convert route would be a second thing to discover, and the discovery problem is exactly what
// made the balance dead in the first place. It stays collapsed until asked for, so the common case
// — reading the balance — is unchanged.
//
// ── THE THREE THINGS SAID BEFORE THE BUTTON ─────────────────────────────────
//
//  1. THE RATE, read from the deployment (Lens's conversion_rate_history, which moves).
//  2. WHAT IT WILL COST, computed with the same CEIL the server uses, so the number on the button
//     is the number that will be debited rather than a friendlier one.
//  3. ⚠ THAT IT IS ONE-WAY. Lens has no LXC→LENS conversion — the function does not exist. This is
//     stated in the panel, before the click, not in a toast afterwards. A confirmation that
//     appears after an irreversible action has confirmed nothing.

export function ConvertLens({
  lensBalanceMicros,
  heldMicros = 0,
}: {
  /** SPENDABLE LENS — what a conversion can actually draw on. */
  lensBalanceMicros: number;
  /** Earned but still in its holdback window. Quoted here so a refusal is never a surprise. */
  heldMicros?: number;
}) {
  const [open, setOpen] = useState(false);
  const [lxcUnits, setLxcUnits] = useState("1");
  const qc = useQueryClient();

  const quote = useQuery({
    queryKey: ["convert-quote"],
    queryFn: convertApi.quote,
    enabled: open, // no request until someone asks — the balance read stays one call
  });

  const run = useMutation({
    mutationFn: (micros: number) => convertApi.convert(micros),
    onSuccess: () => {
      // Both balances moved, so both reads are stale. Invalidating rather than patching keeps the
      // screen's numbers the server's numbers.
      void qc.invalidateQueries({ queryKey: ["lens-balance"] });
      void qc.invalidateQueries({ queryKey: ["lxc-balance"] });
      // ⚠ AND THE QUOTE, which this same reasoning always covered and this call did not reach.
      // The rate is read at CONVERT time upstream (lens `internal/economy/dualtoken.go`,
      // the `Convert` path's `s.engine.CurrentRate(ctx)` — a SYMBOL, because a line number in
      // another repo decays with no commit here and cannot be checked from this one; see #153), not from the quote — so a ConvertResult whose `rate` is not
      // the quoted one is proof the panel's rate is stale. Leaving it cached means the next
      // "Costs …" line is computed from a number the server has already contradicted.
      void qc.invalidateQueries({ queryKey: ["convert-quote"] });
    },
  });

  if (!open) {
    return (
      <div className="px-gutter pb-3">
        <Button variant="default" onClick={() => setOpen(true)}>
          Convert to LXC…
        </Button>
      </div>
    );
  }

  const micros = Math.round(Number(lxcUnits) * 1e6);
  const valid = Number.isFinite(micros) && micros > 0;
  const min = quote.data?.min_lxc_ulxc ?? 0;
  const belowMin = valid && min > 0 && micros < min;
  const cost = quote.data ? lensCostForLXC(micros, quote.data.lens_per_lxc) : 0;
  const tooExpensive = valid && cost > lensBalanceMicros;

  return (
    <div className="flex flex-col gap-3 border-t border-rule px-gutter py-3">
      {quote.isLoading ? (
        <p className="text-caption text-muted">Reading the current rate…</p>
      ) : quote.isError ? (
        // ⚠ THE READ AND THE WRITE GET DIFFERENT ANSWERS ON THE SAME 401, from one rule.
        // The quote is a useQuery, so it lands in the cache `useSessionExpired` scans and the
        // app-wide bar above has ALREADY named the cause and offered the click. A panel that
        // adds its own sentence here is the second voice SessionExpiredBar.tsx exists to
        // remove ("a card repeating it is the eighth voice this change exists to prevent"), so
        // this defers to InlineFailure — the one place that decision lives. The convert
        // MUTATION below is the opposite case and says so there.
        <InlineFailure
          error={quote.error}
          className="text-caption text-muted"
          failed={
            quote.error instanceof ConvertError
              ? quote.error.message
              : "Couldn’t read the conversion rate."
          }
        />
      ) : quote.data ? (
        <>
          <div className="flex flex-col gap-1">
            <div className="text-caption text-muted">
              {/* ⚠ THE FIGURE FACE, both of them. These are the two numbers the panel exists to
                  state before an irreversible click, and until #95 they were the only figures on
                  this surface in the body sans — the rate beside a `Costs <MuNumeral>` that is on
                  the face, one line down. Neither is money-shaped, so #93's name rule and #94's
                  `$` rule both walked past them. */}
              Rate:{" "}
              <span className="font-figure text-ink">
                {quote.data.lens_per_lxc}
              </span>{" "}
              LENS per LXC · minimum{" "}
              <span className="font-figure text-ink">
                {microsToUnits(quote.data.min_lxc_ulxc)}
              </span>{" "}
              LXC
            </div>
            {/* ⚠ BEFORE THE BUTTON. The note comes from the server with the quote, so it cannot
                drift from what the backend actually supports. */}
            {!quote.data.reversible ? (
              <p className="text-caption text-faint">
                ⚠ {quote.data.reversible_note}
              </p>
            ) : null}
          </div>

          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-faint">LXC to receive</span>
              {/* ⚠ `font-figure` IS ON THE FIELD BECAUSE ITS VALUE IS A NUMERAL, and it is the
                  only numeral on this card that was not. The rate, the minimum and the `Costs`
                  line below are all on the face; the amount the irreversible conversion is ABOUT
                  was the body sans. `text-body` sets size and weight and NO family, so the field
                  was inheriting `body{font-family:var(--sans)}`. Measured in Chrome 151 on the
                  shipped sheet — see src/fieldFaceAudit.ts, which is also what fails without it. */}
              <Input
                className="font-figure"
                value={lxcUnits}
                inputMode="decimal"
                onChange={(e) => setLxcUnits(e.target.value)}
                aria-label="LXC to receive"
              />
            </label>
            <Button
              variant="primary"
              disabled={!valid || belowMin || tooExpensive || run.isPending}
              onClick={() => run.mutate(micros)}
            >
              {run.isPending ? "Converting…" : "Convert"}
            </Button>
            <Button variant="default" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>

          {valid ? (
            <div className="text-caption text-muted">
              Costs <MuNumeral micros={cost} unit="lens" /> — rounded up, the
              way the server charges it.
            </div>
          ) : null}
          {belowMin ? (
            <p className="text-caption text-muted">
              Below the {microsToUnits(min)} LXC minimum.
            </p>
          ) : null}
          {tooExpensive ? (
            <p className="text-caption text-muted">
              That costs more LENS than this workspace can spend right now.
              {heldMicros > 0 ? (
                <>
                  {" "}
                  {/* ⚠ WITHOUT THIS THE REFUSAL IS UNINTERPRETABLE. Someone looking at a held
                      balance will try to convert it, and "not enough LENS" beside a visible 822
                      reads as a bug in the conversion rather than as the holdback working.

                      ⚠ It used to say "about 72h" and describe only settlement. The length is
                      LENS_POOL_HOLDBACK_WINDOW, an operator setting exposed on no endpoint, so
                      this screen cannot verify it; and the window is precisely when a payout can
                      be REVOKED, which the sentence left out. Both corrected — see Overview. */}
                  <MuNumeral micros={heldMicros} unit="lens" /> is held and not
                  yet spendable — it settles on its own after a holding period,
                  during which it can still be revoked. That period is an operator
                  setting this screen cannot read, so it is not stated here.
                </>
              ) : null}
            </p>
          ) : null}
        </>
      ) : null}

      {run.isError ? (
        // ⚠ AND HERE THE PANEL MUST SPEAK, INCLUDING ABOUT AN EXPIRED SESSION. This is a
        // useMutation: `useSessionExpired` reads `cache.getAll()`, which is QUERIES, so no bar
        // can ever appear for a refused conversion. The panel is not a second voice here — it
        // is the only one. `classify` gives 401 its own `signed_out` sentence for that reason;
        // it used to fall through to "Please try again", which is false for a verdict.
        <p className="text-caption text-muted">
          {run.error instanceof ConvertError
            ? run.error.message
            : "Couldn’t convert — nothing was converted."}
        </p>
      ) : null}
      {/* ⚠ WHAT WAS ACTUALLY CHARGED — the one number this panel exists to be honest about, and
          the one it used to throw away.

          MEASURED on this component, not read: with the quote at 2 LENS per LXC and the server
          charging at 3 (`lens_spent_ulens: 3_000_000`, `rate: 3`), the panel rendered
          "Costs 2.000000 lens — rounded up, the way the server charges it" and then, after the
          conversion, only the two new balances. The false sentence stayed on screen beside a
          conversion that cost 50% more, and the workspace was never told.

          ⚠ THE DIVERGENCE IS THE ORDINARY CASE, NOT AN EDGE ONE. The quote is a SNAPSHOT: this
          file's own header says the rate "lives in Lens's conversion_rate_history and changes",
          and Lens computes the charge from `CurrentRate(ctx)` at POST time. Between opening the
          panel and clicking, nothing revalidates it.

          ⚠ THE SERVER ALREADY SENT ALL OF THIS. `lens_spent_ulens`, `lxc_minted_ulxc` and `rate`
          are on the wire, declared in ConvertResult and — before this — read by nothing: a census
          of the whole app found `lens_spent_ulens` in exactly two places, the interface and a test
          FIXTURE. The client's `lensCostForLXC` mirror is a prediction; this is the receipt. */}
      {run.isSuccess && run.data ? (
        <p className="text-caption text-muted">
          Converted. Charged{" "}
          <MuNumeral micros={run.data.lens_spent_ulens} unit="lens" /> for{" "}
          <MuNumeral micros={run.data.lxc_minted_ulxc} unit="lxc" />
          {quote.data && run.data.rate !== quote.data.lens_per_lxc ? (
            <>
              {" "}
              at{" "}
              <span className="font-figure text-ink">{run.data.rate}</span> LENS
              per LXC — the rate moved after this panel read{" "}
              <span className="font-figure text-ink">
                {quote.data.lens_per_lxc}
              </span>
              , and the charge is the rate at the moment of conversion
            </>
          ) : null}
          . LXC balance is now{" "}
          <MuNumeral micros={run.data.new_lxc_balance_ulxc} unit="lxc" />
          , LENS{" "}
          <MuNumeral micros={run.data.new_lens_balance_ulens} unit="lens" />.
        </p>
      ) : null}
    </div>
  );
}
