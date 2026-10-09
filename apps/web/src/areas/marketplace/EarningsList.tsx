import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CardHeader, Pill, type PillStatus, Row, inlineLink } from "@talyvor/ui";
import { formatUSD, formatWhen } from "../lens/format";
import { type Earning, marketApi } from "./marketApi";
import { Card, EARNINGS_KEY, MINE_KEY, readFailure } from "./parts";

// EarningsList.tsx — B28.159: every earning on screen, one row for each in Lens's earnings list (its latest 100,
// newest first): the listing that earned it, when the buyer's bill was paid, what the buyer paid, Talyvor's fee,
// the seller's share, and where that share is — in the holdback, past it, held for a dispute, or refunded.
// The totals above it are EarningsCard's; this is the rows they add up from.

/** A µUSD amount to the cent, or to the µUSD when a use cost less than a cent: no row reads $0.00 that is not. */
export function exactUSD(micros: number): string {
  if (micros % 10_000 === 0) return formatUSD(micros);
  return `$${(micros / 1_000_000).toFixed(6).replace(/0+$/, "")}`;
}

const HELD_FOR: Record<string, string> = {
  dispute: "Held: dispute",
  ip_claim: "Held: IP claim",
};

/** Where an earning's share is now. */
export function earningState(
  e: Earning,
  now: number,
): { status: PillStatus; text: string } {
  if (e.refunded_at) return { status: "idle", text: "Refunded" };
  if (e.held_for)
    return { status: "held", text: HELD_FOR[e.held_for] ?? "Held" };
  if (Date.parse(e.payable_at) > now)
    return { status: "held", text: "In the holdback" };
  return { status: "settled", text: "Past the holdback" };
}

function ListingName({
  id,
  titles,
}: {
  id: string;
  titles: Map<string, string>;
}) {
  return (
    <Link
      className={`text-ink ${inlineLink}`}
      to={`/marketplace/listings/${encodeURIComponent(id)}`}
    >
      {titles.get(id) ?? id}
    </Link>
  );
}

function EarningRow({
  e,
  titles,
  now,
}: {
  e: Earning;
  titles: Map<string, string>;
  now: number;
}) {
  const state = earningState(e, now);
  const struck = e.refunded_at ? " line-through" : "";
  const royalty = e.kind === "lineage" && e.original_listing_id;
  const label = e.payee_agent_id ? (
    // A payment to this company's agent (B19.15) has no listing, so there is no page to link to.
    "Payment to your agent"
  ) : royalty ? (
    <>
      Royalty on{" "}
      <ListingName id={e.original_listing_id as string} titles={titles} />
    </>
  ) : e.listing_id ? (
    <ListingName id={e.listing_id} titles={titles} />
  ) : (
    "A use"
  );
  return (
    <Row
      stack
      data-testid="market-earning"
      data-use-id={e.use_id}
      label={label}
      hint={
        <>
          Bill paid{" "}
          <span className="font-figure">{formatWhen(e.cleared_at)}</span>
          {royalty ? " · from a remix’s sale" : ""}
          {e.gross_usd_micros > 0 ? (
            <>
              {" "}
              · buyer paid{" "}
              <span className="font-figure">
                {exactUSD(e.gross_usd_micros)}
              </span>
              , Talyvor’s fee{" "}
              <span className="font-figure">
                {exactUSD(e.fee_usd_micros ?? 0)}
              </span>
            </>
          ) : null}
          {state.text === "In the holdback" ? (
            <>
              {" "}
              · available{" "}
              <span className="font-figure">{formatWhen(e.payable_at)}</span>
            </>
          ) : null}
        </>
      }
    >
      <Pill status={state.status} data-testid="market-earning-state">
        {state.text}
      </Pill>
      <span
        className={`font-figure text-body text-ink${struck}`}
        data-testid="market-earning-share"
      >
        {exactUSD(e.share_usd_micros)}
      </span>
    </Row>
  );
}

/** Every earning Lens lists for this workspace, newest first, one row each. */
export function EarningsListCard({ now = Date.now() }: { now?: number }) {
  const earnings = useQuery({
    queryKey: EARNINGS_KEY,
    queryFn: marketApi.earnings,
  });
  const mine = useQuery({ queryKey: MINE_KEY, queryFn: marketApi.mine });
  if (earnings.isError)
    return (
      <p className="text-body text-muted">
        {readFailure(earnings.error, "Your earnings")}
      </p>
    );
  if (earnings.isPending) return null;
  const rows = earnings.data.earnings ?? [];
  const titles = new Map((mine.data ?? []).map((l) => [l.id, l.title]));
  return (
    <Card>
      <CardHeader>Every earning</CardHeader>
      {rows.length === 0 ? (
        <p className="px-gutter py-3 text-body text-muted">
          Nothing has earned yet. Each use of your listings appears here when its buyer’s bill is paid.
        </p>
      ) : (
        <div data-testid="market-earnings-list">
          {rows.map((e, i) => (
            <EarningRow
              // A use can earn this workspace more than once (its sale and a royalty), so the use alone is no key.
              key={`${i}:${e.use_id}`}
              e={e}
              titles={titles}
              now={now}
            />
          ))}
        </div>
      )}
      {rows.length >= 100 ? (
        <p className="border-t border-rule px-gutter py-3 text-caption text-muted">
          Your latest 100. Your statements below carry every week.
        </p>
      ) : null}
    </Card>
  );
}
