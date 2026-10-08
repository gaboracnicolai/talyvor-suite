import { useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button, CardHeader, Pill, Row, inlineLink } from "@talyvor/ui";
import { Region } from "../../components/Region";
import { newMoveKey } from "../lens/agentBankApi";
import { formatUSD } from "../lens/format";
import {
  type Listing,
  type MarketLicence,
  type Offer,
  marketApi,
  refusalText,
} from "./marketApi";
import { Card, Note, readFailure } from "./parts";

// Licences.tsx — B32.59: what this workspace rents, subscribes to and owns in the marketplace (Lens B32.19–B32.20).
// Each active rental and subscription shows when it ends or renews, the version it pins and the uses it covers; a
// renewing one can be cancelled, and stays active to its end with nothing charged after it. A rental shows how far its
// rents have paid towards owning the listing (rent-to-own): once they reach the listing's buy price, Lens issues a
// licence that never ends and the rents stop. A rental or subscription that ended can be renewed — its offer licensed
// again, on this month's marketplace bill. Lens decides every one of these; the screen shows its answer.

export const LICENCES_KEY = ["market-licences"];

const KIND_WORD: Record<MarketLicence["kind"], string> = {
  buy: "Owned",
  rent: "Rental",
  subscribe: "Subscription",
};
const LICENCE_WORD: Record<MarketLicence["licence"], string> = {
  personal: "personal licence",
  commercial: "commercial licence",
  enterprise: "enterprise licence",
};
const ENDED_WORD: Record<MarketLicence["status"], string> = {
  active: "Active",
  expired: "Ended",
  cancelled: "Cancelled",
  refunded: "Refunded",
  unpaid: "Ended unpaid",
};

/** `2026-11-08T…` → `8 Nov 2026`, in UTC as Lens counts a licence's period. */
function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

/** How far a buyer's rents of one listing, under one licence, have paid towards owning it. */
export interface RentToOwn {
  paid: number;
  price: number;
  rentsPaid: number;
  rentsNeeded: number;
  owned: boolean;
}

/**
 * Rent-to-own for `lic`, a rental: what every rent of its listing under its licence has paid (Lens adds each cleared
 * rent's price to its licence), against the listing's buy offer for the same licence. Null when the listing is not
 * sold outright under that licence, so there is nothing to own.
 */
export function rentToOwn(
  lic: MarketLicence,
  all: MarketLicence[],
  offers: Offer[],
): RentToOwn | null {
  const buy = offers.find((o) => o.kind === "buy" && o.licence === lic.licence);
  const rent =
    offers.find((o) => o.id === lic.offer_id) ??
    offers.find((o) => o.kind === "rent" && o.licence === lic.licence);
  if (
    lic.kind !== "rent" ||
    !buy ||
    !rent ||
    buy.price_usd_micros <= 0 ||
    rent.price_usd_micros <= 0
  )
    return null;
  const same = all.filter(
    (l) => l.listing_id === lic.listing_id && l.licence === lic.licence,
  );
  const paid = same
    .filter((l) => l.kind === "rent")
    .reduce((sum, l) => sum + l.rent_paid_usd_micros, 0);
  const rentsNeeded = Math.ceil(buy.price_usd_micros / rent.price_usd_micros);
  return {
    paid,
    price: buy.price_usd_micros,
    rentsPaid: Math.min(Math.floor(paid / rent.price_usd_micros), rentsNeeded),
    rentsNeeded,
    owned: same.some((l) => l.source === "rent_to_own"),
  };
}

function ListingLink({ lic }: { lic: MarketLicence }) {
  return (
    <Link
      className={`text-ink ${inlineLink}`}
      to={`/marketplace/listings/${encodeURIComponent(lic.listing_id)}`}
    >
      {lic.title || lic.listing_id}
    </Link>
  );
}

/** What a licence covers: its licence type, the version it runs and its uses. */
function covers(lic: MarketLicence): string {
  const version =
    lic.pinned_version === null
      ? "follows the latest version"
      : `pinned to version ${lic.pinned_version}`;
  const uses =
    lic.kind === "buy"
      ? ""
      : lic.included_uses
        ? ` · ${lic.uses_covered} of ${lic.included_uses} uses`
        : ` · ${lic.uses_covered} ${lic.uses_covered === 1 ? "use" : "uses"}, unlimited`;
  return `${KIND_WORD[lic.kind]} · ${LICENCE_WORD[lic.licence]} · ${version}${uses}`;
}

function RentToOwnBar({ r }: { r: RentToOwn }) {
  const pct = Math.min(100, Math.round((r.paid / r.price) * 100));
  return (
    <div
      className="flex flex-col gap-1 px-gutter pb-3"
      data-testid="rent-to-own"
    >
      <p className="text-caption text-muted">
        Rent-to-own:{" "}
        <span className="font-figure text-ink">
          {r.rentsPaid} of {r.rentsNeeded}
        </span>{" "}
        rents paid · <span className="font-figure">{formatUSD(r.paid)}</span> of{" "}
        <span className="font-figure">{formatUSD(r.price)}</span>. When your
        rents reach the price, it is yours and the rents stop.
      </p>
      <div
        className="h-1 w-full rounded-pill bg-rule"
        role="progressbar"
        aria-label="Rents paid towards owning it"
        aria-valuemin={0}
        aria-valuemax={r.rentsNeeded}
        aria-valuenow={r.rentsPaid}
      >
        <div
          className="h-1 rounded-pill bg-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ActiveLicence({
  lic,
  all,
  offers,
}: {
  lic: MarketLicence;
  all: MarketLicence[];
  offers: Offer[];
}) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const cancel = useMutation({
    mutationFn: () => marketApi.cancelLicence(lic.id),
    onSuccess: () => setAsking(false),
    onSettled: () => qc.invalidateQueries({ queryKey: LICENCES_KEY }),
  });
  const r = lic.kind === "rent" ? rentToOwn(lic, all, offers) : null;
  const ends = lic.ends_at ? day(lic.ends_at) : "";
  return (
    <li className="border-b border-rule last:border-b-0" data-testid="licence">
      <Row
        className="border-b-0"
        stack
        label={<ListingLink lic={lic} />}
        hint={
          <>
            {covers(lic)}
            <br />
            {lic.auto_renew ? (
              <>
                Renews on <span className="font-figure">{ends}</span>
              </>
            ) : (
              <>
                Active until <span className="font-figure">{ends}</span>, then
                it ends — nothing more is charged
              </>
            )}
          </>
        }
      >
        {lic.auto_renew ? (
          asking ? (
            <>
              <Button
                variant="danger"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                {cancel.isPending ? "Cancelling…" : "Stop renewing"}
              </Button>
              <Button onClick={() => setAsking(false)}>Keep it</Button>
            </>
          ) : (
            <Button onClick={() => setAsking(true)}>Cancel</Button>
          )
        ) : (
          <Pill status="held">Not renewing</Pill>
        )}
      </Row>
      {asking ? (
        <p className="px-gutter pb-3 text-caption text-muted">
          It stays active until <span className="font-figure">{ends}</span> and
          is not charged again.
        </p>
      ) : null}
      {cancel.isError ? (
        <div className="px-gutter pb-3">
          <Note ok={false}>{refusalText(cancel.error)}</Note>
        </div>
      ) : null}
      {r && !r.owned ? <RentToOwnBar r={r} /> : null}
    </li>
  );
}

function EndedLicence({
  lic,
  offers,
  renewable,
}: {
  lic: MarketLicence;
  offers: Offer[];
  renewable: boolean;
}) {
  const qc = useQueryClient();
  const [key, setKey] = useState<string | null>(null);
  const offer = offers.find((o) => o.id === lic.offer_id);
  const price = offer ? offer.price_usd_micros : lic.price_ulxc / 10;
  const renew = useMutation({
    mutationFn: (k: string) =>
      marketApi.renewLicence(
        lic.listing_id,
        lic.offer_id ?? "",
        lic.pinned_version ?? 0,
        k,
      ),
    onSuccess: () => setKey(null),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: LICENCES_KEY }),
        qc.invalidateQueries({ queryKey: ["market-bill"] }),
      ]),
  });
  return (
    <li
      className="border-b border-rule last:border-b-0"
      data-testid="licence-ended"
    >
      <Row
        className="border-b-0"
        stack
        label={<ListingLink lic={lic} />}
        hint={
          <>
            {covers(lic)}
            <br />
            {ENDED_WORD[lic.status]}
            {lic.ends_at ? (
              <>
                {" "}
                on <span className="font-figure">{day(lic.ends_at)}</span>
              </>
            ) : null}
          </>
        }
      >
        {renewable && lic.offer_id ? (
          key ? (
            <>
              <Button
                variant="primary"
                disabled={renew.isPending}
                onClick={() => renew.mutate(key)}
              >
                {renew.isPending ? (
                  "Renewing…"
                ) : (
                  <>
                    Renew for{" "}
                    <span className="font-figure">{formatUSD(price)}</span>
                  </>
                )}
              </Button>
              <Button onClick={() => setKey(null)}>Not now</Button>
            </>
          ) : (
            <Button onClick={() => setKey(newMoveKey())}>Renew</Button>
          )
        ) : null}
      </Row>
      {key ? (
        <p className="px-gutter pb-3 text-caption text-muted">
          {lic.kind === "subscribe" ? "A new subscription" : "A new rental"}{" "}
          starts today, under the same licence and version; its price goes on
          this month’s marketplace bill.
        </p>
      ) : null}
      {renew.isError ? (
        <div className="px-gutter pb-3">
          <Note ok={false}>{refusalText(renew.error)}</Note>
        </div>
      ) : null}
    </li>
  );
}

export function Licences() {
  const licences = useQuery({
    queryKey: LICENCES_KEY,
    queryFn: marketApi.licences,
  });
  const all = licences.data ?? [];
  // Rent-to-own and a renewal's price need each listing's offers; a bought licence needs neither.
  const listingIDs = [
    ...new Set(all.filter((l) => l.kind !== "buy").map((l) => l.listing_id)),
  ];
  const listings = useQueries({
    queries: listingIDs.map((id) => ({
      queryKey: ["market-listing", id],
      queryFn: () => marketApi.listing(id),
    })),
  });
  const offersOf = (id: string): Offer[] =>
    listings.find((q) => (q.data as Listing | undefined)?.id === id)?.data
      ?.offers ?? [];
  const active = all.filter((l) => l.status === "active" && l.kind !== "buy");
  const owned = all.filter((l) => l.status === "active" && l.kind === "buy");
  const ended = all.filter((l) => l.status !== "active");
  // Renewing what is still covered would pay twice for the same days: only an ended rental or subscription with no
  // active licence of the same listing, licence and kind is offered again.
  const renewable = (lic: MarketLicence) =>
    lic.kind !== "buy" &&
    lic.status !== "refunded" &&
    !all.some(
      (l) =>
        l.status === "active" &&
        l.listing_id === lic.listing_id &&
        l.licence === lic.licence &&
        (l.kind === lic.kind || l.kind === "buy"),
    );
  return (
    <>
      <Region
        index="00"
        label="Your licences"
        heading="What your workspace rents, subscribes to and owns"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          A rental or subscription covers your uses of a listing until it ends;
          a subscription renews each period on your marketplace bill until you
          cancel it. Rents add up: once they reach a listing’s price, it is
          yours.
        </p>
      </Region>
      <Region
        index="01"
        label="Licences"
        className="flex max-w-2xl flex-col gap-4"
      >
        {licences.isError ? (
          <p className="text-body text-muted">
            {readFailure(licences.error, "Your licences")}
          </p>
        ) : licences.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : all.length === 0 ? (
          <p className="text-body text-muted">
            Your workspace holds no licences yet. Rent, subscribe to or buy a
            listing from the{" "}
            <Link className={`text-ink ${inlineLink}`} to="/marketplace">
              marketplace
            </Link>
            .
          </p>
        ) : (
          <>
            <Card>
              <CardHeader>Rentals and subscriptions</CardHeader>
              {active.length === 0 ? (
                <p className="px-gutter py-3 text-body text-muted">
                  None active.
                </p>
              ) : (
                <ul data-testid="licences-active">
                  {active.map((l) => (
                    <ActiveLicence
                      key={l.id}
                      lic={l}
                      all={all}
                      offers={offersOf(l.listing_id)}
                    />
                  ))}
                </ul>
              )}
            </Card>
            {owned.length > 0 ? (
              <Card>
                <CardHeader>Owned</CardHeader>
                <ul data-testid="licences-owned">
                  {owned.map((l) => (
                    <li
                      key={l.id}
                      className="border-b border-rule last:border-b-0"
                    >
                      <Row
                        className="border-b-0"
                        label={<ListingLink lic={l} />}
                        hint={`${covers(l)} · ${l.source === "rent_to_own" ? "your rents paid for it" : `bought ${day(l.starts_at)}`}`}
                      >
                        <Pill status="settled">Never ends</Pill>
                      </Row>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            {ended.length > 0 ? (
              <Card>
                <CardHeader>Ended</CardHeader>
                <ul data-testid="licences-ended">
                  {ended.map((l) => (
                    <EndedLicence
                      key={l.id}
                      lic={l}
                      offers={offersOf(l.listing_id)}
                      renewable={renewable(l)}
                    />
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        )}
      </Region>
    </>
  );
}
