import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input, MuNumeral } from "@talyvor/ui";
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
        <p className="text-caption text-muted">
          {quote.error instanceof ConvertError
            ? quote.error.message
            : "Couldn’t read the conversion rate."}
        </p>
      ) : quote.data ? (
        <>
          <div className="flex flex-col gap-1">
            <div className="text-caption text-muted">
              Rate: <span className="text-ink">{quote.data.lens_per_lxc}</span>{" "}
              LENS per LXC · minimum{" "}
              <span className="text-ink">
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
              <Input
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
        <p className="text-caption text-muted">
          {run.error instanceof ConvertError
            ? run.error.message
            : "Couldn’t convert — nothing was converted."}
        </p>
      ) : null}
      {run.isSuccess && run.data ? (
        <p className="text-caption text-muted">
          Converted. LXC balance is now{" "}
          <MuNumeral micros={run.data.new_lxc_balance_ulxc} unit="lxc" />
          , LENS{" "}
          <MuNumeral micros={run.data.new_lens_balance_ulens} unit="lens" />.
        </p>
      ) : null}
    </div>
  );
}
