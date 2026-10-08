import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, CardHeader, Pill, cn } from "@talyvor/ui";
import { formatUSD, formatWhen } from "../lens/format";
import {
  type SelfBill,
  type SelfBillParty,
  type SellerStatement,
  marketApi,
} from "./marketApi";
import { Card } from "./parts";
import { sellerReadFailure } from "./SellerTax";

// SellerStatements.tsx — B32.60: the seller's weekly statements (Lens B32.42–B32.43). Sellers are paid once a week,
// and every week they were paid has a statement read from the marketplace journal: what was brought forward, the sales
// released to them, Talyvor's fee, the royalties their sales paid to the originals they build on and the royalties and
// split shares they received, refunds, anything taken as credits, what is carried forward and Stripe's fees — lines
// that sum to the net the week's payout paid. The VAT Talyvor collected from their buyers is shown for information: it
// was never the seller's. To a seller who agreed to self-billing, the statement is also their invoice to Talyvor, with
// the VAT on their supply. Lens computes every figure; the screen shows them.

export const STATEMENTS_KEY = ["market-statements"];

/** The Monday an ISO week (`2026-W41`) starts on, in UTC; null for anything else. */
function weekStart(period: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(period);
  if (!m) return null;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const monday =
    jan4 -
    ((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000 +
    (Number(m[2]) - 1) * 7 * 86_400_000;
  return new Date(monday);
}

const dayMonth = (d: Date, year: boolean) =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });

/** `2026-W41` → `Week 41 · 5–11 Oct 2026`: the week and its Monday to Sunday. */
export function weekName(period: string): string {
  const from = weekStart(period);
  if (!from) return period;
  const to = new Date(from.getTime() + 6 * 86_400_000);
  const days =
    from.getUTCMonth() === to.getUTCMonth()
      ? `${from.getUTCDate()}–${dayMonth(to, true)}`
      : `${dayMonth(from, from.getUTCFullYear() !== to.getUTCFullYear())} – ${dayMonth(to, true)}`;
  return `Week ${Number(period.slice(6))} · ${days}`;
}

/** A rate in basis points as a percentage: 2000 → `20%`, 550 → `5.5%`. */
const percent = (bps: number) => `${bps / 100}%`;

function Party({ role, p }: { role: string; p: SelfBillParty }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-figure text-eyebrow uppercase text-label">
        {role}
      </span>
      <span className="text-body text-ink">{p.name}</span>
      {p.address ? (
        <span className="whitespace-pre-line text-caption text-muted">
          {p.address}
        </span>
      ) : null}
      {p.country ? (
        <span className="text-caption text-muted">{p.country}</span>
      ) : null}
      <span className="text-caption text-muted">
        VAT number{" "}
        <span className="font-figure text-ink">{p.vat_number || "none"}</span>
      </span>
    </div>
  );
}

/** The week's payout as the seller's self-billed invoice to Talyvor (B32.43). */
function SelfBilledInvoice({ bill }: { bill: SelfBill }) {
  return (
    <section
      aria-label="Self-billed invoice"
      className="flex flex-col gap-3 border-t border-rule px-gutter py-4"
      data-testid="statement-invoice"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-col gap-0.5">
          <span className="font-figure text-eyebrow uppercase text-label">
            Self-billed invoice
          </span>
          <span className="font-figure text-body text-ink">{bill.number}</span>
        </span>
        {bill.preview ? (
          <Pill status="parked">Preview — test money only</Pill>
        ) : null}
      </div>
      <p className="text-caption text-muted">
        Issued{" "}
        <span className="font-figure">{formatWhen(bill.issued_at)}</span> by
        Talyvor on your behalf, under the
        self-billing agreement{" "}
        <span className="font-figure">{bill.agreement_version}</span>.
      </p>
      <div className="grid gap-4 wide:grid-cols-2">
        <Party role="From — you, the supplier" p={bill.supplier} />
        <Party role="To — the customer" p={bill.customer} />
      </div>
      <dl className="flex flex-col gap-1 text-body">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Your supply</dt>
          <dd className="font-figure text-ink">
            {formatUSD(bill.net_usd_micros)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">
            VAT
            {bill.rate_bps > 0 ? (
              <span className="font-figure"> {percent(bill.rate_bps)}</span>
            ) : null}
            {bill.jurisdiction ? ` (${bill.jurisdiction})` : ""}
          </dt>
          <dd className="font-figure text-ink">
            {formatUSD(bill.vat_usd_micros)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink">Total</dt>
          <dd className="font-figure text-ink">
            {formatUSD(bill.gross_usd_micros)}
          </dd>
        </div>
      </dl>
      {bill.note ? (
        <p className="text-caption text-muted" data-testid="statement-invoice-note">
          {bill.note}
        </p>
      ) : null}
    </section>
  );
}

/** One week's statement: its lines summing to the net, the VAT collected for information, and the invoice. */
function Statement({ period }: { period: string }) {
  const st = useQuery({
    queryKey: [...STATEMENTS_KEY, period],
    queryFn: () => marketApi.statement(period),
  });
  if (st.isError)
    return (
      <p className="border-t border-rule px-gutter py-3 text-body text-muted">
        {sellerReadFailure(st.error, "This statement")}
      </p>
    );
  if (st.isPending)
    return (
      <p className="border-t border-rule px-gutter py-3 text-body text-muted">
        Reading…
      </p>
    );
  const s: SellerStatement = st.data;
  const p = s.payout;
  return (
    <div
      className="flex flex-col border-t border-rule bg-surface"
      data-testid="statement"
      aria-label={`Statement for ${weekName(s.period)}`}
      role="region"
    >
      <div className="flex flex-col gap-1 px-gutter py-3">
        <span className="text-head text-ink">{weekName(s.period)}</span>
        <span className="text-caption text-muted">
          <span className="font-figure">{s.sales}</span>{" "}
          {s.sales === 1 ? "sale" : "sales"} released to you this week.{" "}
          {p === null
            ? "Nothing was paid this week: your balance is carried forward."
            : p.paid_at
              ? (
                  <>
                    Paid{" "}
                    <span className="font-figure">{formatWhen(p.paid_at)}</span>{" "}
                    to your Stripe account.
                  </>
                )
              : p.last_error
                ? "Stripe refused the transfer; Talyvor is retrying it."
                : "Being sent to your Stripe account."}
        </span>
      </div>
      <table className="w-full text-body" data-testid="statement-lines">
        <tbody>
          {(s.lines ?? []).map((l) => (
            <tr key={l.kind} className="border-t border-rule">
              <td className="px-gutter py-2 text-ink">{l.label}</td>
              <td
                className={cn(
                  "px-gutter py-2 text-right font-figure",
                  l.amount_usd_micros === 0 ? "text-muted" : "text-ink",
                )}
                data-testid="statement-amount"
              >
                {formatUSD(l.amount_usd_micros)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-rule-strong">
            <th scope="row" className="px-gutter py-2 text-left font-normal text-ink">
              Paid to you
            </th>
            <td
              className="px-gutter py-2 text-right font-figure text-ink"
              data-testid="statement-net"
            >
              {formatUSD(s.net_usd_micros)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p
        className="border-t border-rule px-gutter py-3 text-caption text-muted"
        data-testid="statement-vat"
      >
        {s.vat_collected_usd_micros > 0 ? (
          <>
            Talyvor also collected{" "}
            <span className="font-figure text-ink">
              {formatUSD(s.vat_collected_usd_micros)}
            </span>{" "}
            of VAT from your buyers on these sales. It is owed to the tax
            authorities, so it is not part of your earnings.
          </>
        ) : (
          "No VAT was collected from your buyers on these sales."
        )}
      </p>
      {s.self_billed_invoice ? (
        <SelfBilledInvoice bill={s.self_billed_invoice} />
      ) : null}
    </div>
  );
}

/** B32.60 — Statements, on Selling: one per week the seller was paid, each opening to its statement. */
export function SellerStatementsCard() {
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: STATEMENTS_KEY,
    queryFn: marketApi.statements,
  });
  return (
    <Card>
      <CardHeader>Weekly statements</CardHeader>
      {list.isError ? (
        <p className="px-gutter py-3 text-body text-muted">
          {sellerReadFailure(list.error, "Your statements")}
        </p>
      ) : list.isPending ? (
        <p className="px-gutter py-3 text-body text-muted">Reading…</p>
      ) : list.data.length === 0 ? (
        <p className="px-gutter py-3 text-body text-muted">
          No statements yet. One appears here when you are paid each week:
          your sales, Talyvor’s fee, royalties, refunds and Stripe’s fees,
          summing to what you were paid.
        </p>
      ) : (
        <ul data-testid="statements">
          {list.data.map((x) => (
            <li key={x.period} className="border-t border-rule first:border-t-0">
              <div className="flex flex-wrap items-center justify-between gap-3 px-gutter py-3">
                <span className="flex flex-col gap-0.5">
                  <span className="text-body text-ink">{weekName(x.period)}</span>
                  <span className="text-caption text-muted">
                    {x.paid_at ? (
                      <>
                        Paid{" "}
                        <span className="font-figure">{formatWhen(x.paid_at)}</span>
                      </>
                    ) : (
                      "Not paid yet"
                    )}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-figure text-body text-ink">
                    {formatUSD(x.net_usd_micros)}
                  </span>
                  <Button
                    aria-expanded={open === x.period}
                    aria-label={`${open === x.period ? "Close" : "Open"} the statement for ${weekName(x.period)}`}
                    onClick={() => setOpen(open === x.period ? null : x.period)}
                  >
                    {open === x.period ? "Close" : "Open"}
                  </Button>
                </span>
              </div>
              {open === x.period ? <Statement period={x.period} /> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
