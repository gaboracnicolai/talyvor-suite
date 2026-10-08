import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  CardHeader,
  Input,
  Pill,
  Row,
  focusRing,
  inlineLink,
} from "@talyvor/ui";
import { formatWhen } from "../lens/format";
import {
  MarketError,
  type SellerTax,
  type SellerTaxInput,
  type SellerTIN,
  marketApi,
  refusalText,
} from "./marketApi";
import { Card, Note, readFailure, selectClass } from "./parts";

// SellerTax.tsx — B32.60: the seller's tax details (Lens B32.41), the ones the UK reporting rules and DAC7 have a
// marketplace collect from everyone it pays: who is paid (a person's names and date of birth, or a company's legal
// name and registration number), where they live, their tax identification numbers, a VAT number if they have one —
// checked when it is saved — and the account they are paid to. Once saved, the TINs, the date of birth and the account
// read back masked, and a correction leaves them as they are unless the seller replaces them. Saving also records the
// self-billing agreement: each weekly statement is then the seller's invoice to Talyvor (B32.43).
//
// A seller with earnings who has not completed them is asked three times; after the third, Lens holds their payouts
// while their earnings keep clearing. A held seller is told why and what is still to fill in — here and at the top of
// Selling — and the next payout after they complete the details pays them.

export const SELLER_TAX_KEY = ["market-seller-tax"];

/** The self-billing agreement a save accepts: Lens's docs/terms/self-billing.md, "Draft — for legal review". */
export const SELF_BILLING_VERSION = "draft-2026-10";

/** What each of Lens's missing fields asks the seller for. */
const MISSING_WORD: Record<string, string> = {
  seller_type: "whether you sell as a person or a company",
  first_name: "your first name",
  last_name: "your last name",
  date_of_birth: "your date of birth",
  legal_name: "the company’s legal name",
  company_registration_number: "the company registration number",
  address: "your address",
  country: "your country of residence",
  tins: "a tax identification number",
  vat_number: "a VAT number that checks out, or none",
  account_identifier: "the account you are paid to",
  account_holder: "the account holder’s name",
};

/** Lens's missing fields, in words: "your date of birth and the account you are paid to". */
export function missingText(missing: string[]): string {
  const words = missing.map((m) => MISSING_WORD[m] ?? m.replace(/_/g, " "));
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Where a seller may live and be taxed: the United Kingdom, the European Union and the places sellers most often are. */
const COUNTRIES: readonly [string, string][] = [
  ["AU", "Australia"],
  ["AT", "Austria"],
  ["BE", "Belgium"],
  ["BR", "Brazil"],
  ["BG", "Bulgaria"],
  ["CA", "Canada"],
  ["HR", "Croatia"],
  ["CY", "Cyprus"],
  ["CZ", "Czechia"],
  ["DK", "Denmark"],
  ["EE", "Estonia"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["GR", "Greece"],
  ["HU", "Hungary"],
  ["IS", "Iceland"],
  ["IN", "India"],
  ["IE", "Ireland"],
  ["IL", "Israel"],
  ["IT", "Italy"],
  ["JP", "Japan"],
  ["LV", "Latvia"],
  ["LI", "Liechtenstein"],
  ["LT", "Lithuania"],
  ["LU", "Luxembourg"],
  ["MT", "Malta"],
  ["MX", "Mexico"],
  ["NL", "Netherlands"],
  ["NZ", "New Zealand"],
  ["NO", "Norway"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["RO", "Romania"],
  ["SG", "Singapore"],
  ["SK", "Slovakia"],
  ["SI", "Slovenia"],
  ["ZA", "South Africa"],
  ["ES", "Spain"],
  ["SE", "Sweden"],
  ["CH", "Switzerland"],
  ["AE", "United Arab Emirates"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
];

/** The countries offered, with `current` among them when it is one Lens stored that the list does not name. */
function countryOptions(current: string): readonly [string, string][] {
  return current && !COUNTRIES.some(([c]) => c === current)
    ? [...COUNTRIES, [current, current]]
    : COUNTRIES;
}

/** A read's failure: Lens's sentence when it refused (only the owner or an admin may read these), or why not otherwise. */
export function sellerReadFailure(err: unknown, what: string): string {
  return err instanceof MarketError && err.status === 403 && err.sentence
    ? refusalText(err)
    : readFailure(err, what);
}

/** `2026-11-08T…` → `8 Nov 2026`, in UTC as Lens counts its reminders. */
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

/**
 * Where the seller stands: a payout hold and why, with what is still to fill in; or, before a hold, how many times
 * Talyvor has asked and when it asks next. Nothing once the details are complete.
 */
export function TaxStanding({
  tax,
  link = false,
}: {
  tax: SellerTax;
  /** offers a link down to the form — at the top of Selling */
  link?: boolean;
}) {
  const missing = tax.missing ?? [];
  const fill =
    missing.length > 0 ? (
      <>
        {" "}
        Still to fill in: {missingText(missing)}.
        {link ? (
          <>
            {" "}
            <a className={`text-ink ${inlineLink}`} href="#tax-details">
              Fill in your tax details
            </a>
          </>
        ) : null}
      </>
    ) : null;
  if (tax.hold)
    return (
      <div
        className="flex flex-col gap-2 rounded-card border border-rule bg-raised px-gutter py-3"
        data-testid="tax-hold"
      >
        <span>
          <Pill status="held">Payouts on hold</Pill>
        </span>
        <Note ok={false}>
          {tax.hold}
          {fill}
        </Note>
      </div>
    );
  if (tax.complete || tax.reminders_sent === 0) return null;
  return (
    <div
      className="rounded-card border border-rule bg-raised px-gutter py-3"
      data-testid="tax-requested"
    >
      <Note ok>
        Talyvor has asked for your tax details{" "}
        {tax.reminders_sent === 1 ? "once" : `${tax.reminders_sent} times`}.
        After the third request your payouts are held until they are complete.
        {tax.next_reminder_at
          ? ` The next request is on ${day(tax.next_reminder_at)}.`
          : ""}
        {fill}
      </Note>
    </div>
  );
}

/** The hold notice at the top of Selling: nothing while the details are complete, or cannot be read. */
export function SellerTaxNotice() {
  const tax = useQuery({
    queryKey: SELLER_TAX_KEY,
    queryFn: marketApi.sellerTax,
  });
  return tax.data ? <TaxStanding tax={tax.data} link /> : null;
}

/** One sealed value as Lens reads it back — masked — with Replace to give it again. */
function Masked({
  label,
  shown,
  onReplace,
  testid,
}: {
  label: string;
  shown: string;
  onReplace: () => void;
  testid: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-caption text-muted">
      {label}
      <span className="flex items-center gap-3">
        <span className="font-figure text-body text-ink" data-testid={testid}>
          {shown}
        </span>
        <Button type="button" onClick={onReplace}>
          Replace
        </Button>
      </span>
    </div>
  );
}

function SellerTaxForm({ tax }: { tax: SellerTax }) {
  const qc = useQueryClient();
  const [type, setType] = useState<"individual" | "entity">(
    tax.seller_type === "entity" ? "entity" : "individual",
  );
  const [first, setFirst] = useState(tax.first_name);
  const [middle, setMiddle] = useState(tax.middle_name);
  const [last, setLast] = useState(tax.last_name);
  const [legal, setLegal] = useState(tax.legal_name);
  const [company, setCompany] = useState(tax.company_registration_number);
  const [address, setAddress] = useState(tax.address);
  const [country, setCountry] = useState(tax.country);
  const [vat, setVat] = useState(tax.vat_number);
  const [holder, setHolder] = useState(tax.account_holder);
  const [agreed, setAgreed] = useState(
    tax.self_billing_agreed_version === SELF_BILLING_VERSION,
  );
  // The sealed values: null keeps what Lens stores; given, they replace it.
  const stored = tax.tins ?? [];
  const [tins, setTins] = useState<SellerTIN[] | null>(
    stored.length > 0 ? null : [{ jurisdiction: tax.country, number: "" }],
  );
  const [dob, setDob] = useState<string | null>(
    tax.date_of_birth ? null : "",
  );
  const [account, setAccount] = useState<string | null>(
    tax.account_identifier ? null : "",
  );

  const save = useMutation({
    mutationFn: (input: SellerTaxInput) => marketApi.saveSellerTax(input),
    onSuccess: (saved) => {
      qc.setQueryData(SELLER_TAX_KEY, saved);
      // What Lens stores now reads back masked: the form shows that, not what was typed.
      setTins(saved.tins && saved.tins.length > 0 ? null : tins);
      setDob(saved.date_of_birth ? null : dob);
      setAccount(saved.account_identifier ? null : account);
      setVat(saved.vat_number);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const person = type === "individual";
    save.mutate({
      seller_type: type,
      first_name: person ? first : "",
      middle_name: person ? middle : "",
      last_name: person ? last : "",
      legal_name: person ? "" : legal,
      company_registration_number: person ? "" : company,
      address,
      country,
      tins:
        tins === null
          ? null
          : tins.filter((t) => t.number.trim() !== ""),
      // A company has no date of birth: one stored from before is removed.
      date_of_birth: person ? dob : tax.date_of_birth ? "" : null,
      vat_number: vat,
      account_identifier: account,
      account_holder: holder,
      self_billing_agreed_version: agreed ? SELF_BILLING_VERSION : "",
    });
  };

  const setTin = (i: number, t: Partial<SellerTIN>) =>
    setTins((all) => (all ?? []).map((x, j) => (j === i ? { ...x, ...t } : x)));

  const shown = save.data ?? tax;
  return (
    <form
      className="flex flex-col gap-4 px-gutter py-4"
      onSubmit={submit}
      aria-label="Tax details"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption text-muted">You sell as</legend>
        <div className="flex flex-wrap gap-4 text-body text-ink">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              className={`h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              name="seller-type"
              checked={type === "individual"}
              onChange={() => setType("individual")}
            />
            A person
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              className={`h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              name="seller-type"
              checked={type === "entity"}
              onChange={() => setType("entity")}
            />
            A company
          </label>
        </div>
      </fieldset>

      {type === "individual" ? (
        <div className="grid gap-3 wide:grid-cols-3">
          <label className="flex flex-col gap-1 text-caption text-muted">
            First name
            <Input value={first} onChange={(e) => setFirst(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-caption text-muted">
            Middle names
            <Input
              value={middle}
              onChange={(e) => setMiddle(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-caption text-muted">
            Last name
            <Input value={last} onChange={(e) => setLast(e.target.value)} />
          </label>
          {dob === null ? (
            <Masked
              label="Date of birth"
              shown={tax.date_of_birth}
              onReplace={() => setDob("")}
              testid="tax-dob"
            />
          ) : (
            <label className="flex flex-col gap-1 text-caption text-muted">
              Date of birth
              <Input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
              />
            </label>
          )}
        </div>
      ) : (
        <div className="grid gap-3 wide:grid-cols-2">
          <label className="flex flex-col gap-1 text-caption text-muted">
            Legal name
            <Input value={legal} onChange={(e) => setLegal(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-caption text-muted">
            Company registration number
            <Input
              className="font-figure"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
        </div>
      )}

      <label className="flex flex-col gap-1 text-caption text-muted">
        Address
        <textarea
          className={`min-h-20 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-caption text-muted wide:w-72">
        Country of residence
        <select
          className={selectClass}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          <option value="">Choose…</option>
          {countryOptions(country).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-caption text-muted">
          Tax identification numbers — each with the country that issued it
        </span>
        {tins === null ? (
          <div className="flex flex-wrap items-center gap-3">
            <ul className="flex flex-col gap-1" data-testid="tax-tins">
              {stored.map((t, i) => (
                <li key={i} className="font-figure text-body text-ink">
                  {t.jurisdiction} {t.number}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              onClick={() => setTins([{ jurisdiction: country, number: "" }])}
            >
              Replace
            </Button>
          </div>
        ) : (
          <>
            {tins.map((t, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <label className="flex w-44 flex-col gap-1 text-caption text-muted">
                  Issued by
                  <select
                    className={selectClass}
                    value={t.jurisdiction}
                    onChange={(e) => setTin(i, { jurisdiction: e.target.value })}
                  >
                    <option value="">Choose…</option>
                    {countryOptions(t.jurisdiction).map(([code, name]) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-caption text-muted">
                  Tax identification number
                  <Input
                    className="w-56 font-figure"
                    autoComplete="off"
                    value={t.number}
                    onChange={(e) => setTin(i, { number: e.target.value })}
                  />
                </label>
                {tins.length > 1 ? (
                  <Button
                    type="button"
                    onClick={() =>
                      setTins(tins.filter((_, j) => j !== i))
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
            <div className="flex gap-2">
              {tins.length < 5 ? (
                <Button
                  type="button"
                  onClick={() =>
                    setTins([...tins, { jurisdiction: "", number: "" }])
                  }
                >
                  Add another
                </Button>
              ) : null}
              {stored.length > 0 ? (
                <Button type="button" onClick={() => setTins(null)}>
                  Keep the saved ones
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-caption text-muted wide:w-72">
          VAT number
          <Input
            className="font-figure"
            placeholder="None"
            value={vat}
            onChange={(e) => setVat(e.target.value)}
          />
        </label>
        {shown.vat_number && shown.vat_number === vat ? (
          <span className="flex flex-wrap items-center gap-2 text-caption text-muted" data-testid="tax-vat-check">
            {shown.vat_valid ? (
              <Pill status="settled">Checked</Pill>
            ) : (
              <Pill status="slashed">Not valid</Pill>
            )}
            {shown.vat_valid
              ? shown.vat_checked_at
                ? (
                    <>
                      Valid when checked on{" "}
                      <span className="font-figure">
                        {formatWhen(shown.vat_checked_at)}
                      </span>
                      .
                    </>
                  )
                : "Valid."
              : (shown.vat_detail ??
                "It did not check out. Correct it, or leave it empty if you are not registered for VAT.")}
          </span>
        ) : (
          <span className="text-caption text-muted">
            Leave it empty if you are not registered for VAT. It is checked
            when you save.
          </span>
        )}
      </div>

      <div className="grid gap-3 wide:grid-cols-2">
        {account === null ? (
          <Masked
            label="Account you are paid to"
            shown={tax.account_identifier}
            onReplace={() => setAccount("")}
            testid="tax-account"
          />
        ) : (
          <label className="flex flex-col gap-1 text-caption text-muted">
            Account you are paid to — IBAN or account number
            <Input
              className="font-figure"
              autoComplete="off"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-caption text-muted">
          Account holder
          <Input value={holder} onChange={(e) => setHolder(e.target.value)} />
        </label>
      </div>

      <div className="flex flex-col gap-2 border-t border-rule pt-4">
        <label className="flex items-start gap-2 text-body text-ink">
          <input
            type="checkbox"
            className={`mt-1 h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            I agree to the self-billing agreement{" "}
            <span className="font-figure text-caption text-muted">
              ({SELF_BILLING_VERSION})
            </span>
          </span>
        </label>
        <details className="text-caption text-muted">
          <summary className="cursor-pointer">
            What self-billing means — draft, for legal review
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <p>
              When a buyer pays for one of your listings, Talyvor sells it to
              them and buys it from you. Instead of you sending Talyvor an
              invoice, Talyvor issues it for you: each weekly statement is a
              self-billed invoice from you to Talyvor Ltd for the earnings that
              week’s payout pays, numbered in a series that is yours alone.
            </p>
            <p>
              You agree not to issue your own invoices for those earnings, to
              update these details at once if you register for VAT,
              deregister or your VAT number changes, and to account for any VAT
              an invoice shows to your tax authority. Either of us may end the
              agreement at any time.
            </p>
          </div>
        </details>
        {tax.self_billing_agreed_version &&
        tax.self_billing_agreed_version !== SELF_BILLING_VERSION ? (
          <span className="text-caption text-muted">
            You agreed to version {tax.self_billing_agreed_version}. Agree to
            this one to keep your weekly statements as invoices.
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <Button variant="primary" type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save tax details"}
          </Button>
        </div>
        {save.isSuccess ? (
          <Note ok>
            {save.data.complete
              ? "Saved. Your tax details are complete."
              : `Saved. Still to fill in: ${missingText(save.data.missing ?? [])}.`}
          </Note>
        ) : null}
        {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
      </div>
    </form>
  );
}

/** B32.60 — Tax details, on Selling: where the seller stands, and the form. */
export function SellerTaxCard() {
  const tax = useQuery({
    queryKey: SELLER_TAX_KEY,
    queryFn: marketApi.sellerTax,
  });
  return (
    <div id="tax-details" className="scroll-mt-4">
      <Card>
        <CardHeader>Tax details</CardHeader>
        {tax.isError ? (
          <p className="px-gutter py-3 text-body text-muted">
            {sellerReadFailure(tax.error, "Your tax details")}
          </p>
        ) : tax.isPending ? (
          <p className="px-gutter py-3 text-body text-muted">Reading…</p>
        ) : (
          <>
            <Row
              label="Status"
              hint="The UK and EU rules have a marketplace collect these from every seller it pays."
            >
              <span data-testid="tax-status">
                {tax.data.complete ? (
                  <Pill status="settled">Complete</Pill>
                ) : (
                  <Pill status="held">Incomplete</Pill>
                )}
              </span>
            </Row>
            {tax.data.hold || (!tax.data.complete && tax.data.reminders_sent > 0) ? (
              <div className="px-gutter pt-3">
                <TaxStanding tax={tax.data} />
              </div>
            ) : null}
            {tax.data.accepting ? (
              <SellerTaxForm tax={tax.data} />
            ) : (
              <p className="px-gutter py-3 text-body text-muted">
                Tax details cannot be saved here yet.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
