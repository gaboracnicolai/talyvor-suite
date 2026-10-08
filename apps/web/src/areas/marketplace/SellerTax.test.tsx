import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, queryClient } from "../../App";
import { formatUSD } from "../lens/format";

// B32.60 — the seller's tax details and weekly statements on Selling, walked the way the DONE line reads: tax details
// are saved and the TIN reads masked afterwards; a weekly statement opens and its lines sum to its net; a withheld
// seller sees the hold's reason and what to fill in. The mock BFF answers as Lens's B32.41 seller-tax and B32.42–B32.43
// statement routes do.

const HOLD =
  "Your payouts are on hold until your tax details are complete. Your earnings keep clearing and are paid at the next payout after you complete them.";

function details(over: Record<string, unknown>): Record<string, unknown> {
  return {
    workspace_id: "ws_1",
    seller_type: "",
    first_name: "",
    middle_name: "",
    last_name: "",
    legal_name: "",
    address: "",
    country: "",
    tins: [],
    date_of_birth: "",
    company_registration_number: "",
    vat_number: "",
    vat_valid: false,
    account_identifier: "",
    account_holder: "",
    self_billing_agreed_version: "",
    complete: false,
    missing: [
      "seller_type",
      "address",
      "country",
      "tins",
      "account_identifier",
      "account_holder",
    ],
    reminders_sent: 0,
    accepting: true,
    ...over,
  };
}

// Week 41: $40.00 of sales, Talyvor's $6.00, $2.00 of royalties out and $3.00 in, a $1.00 refund and Stripe's $2.33.
const LINES = [
  { kind: "brought_forward", label: "Brought forward from earlier weeks", amount_usd_micros: 0 },
  { kind: "sales", label: "Sales", amount_usd_micros: 40_000_000 },
  { kind: "talyvor_fee", label: "Talyvor's fee", amount_usd_micros: -6_000_000 },
  { kind: "royalties_paid", label: "Royalties paid to the originals your listings build on", amount_usd_micros: -2_000_000 },
  { kind: "royalties_received", label: "Royalties and split shares received", amount_usd_micros: 3_000_000 },
  { kind: "refunds", label: "Refunds and chargebacks", amount_usd_micros: -1_000_000 },
  { kind: "credits", label: "Taken as Talyvor credits", amount_usd_micros: 0 },
  { kind: "supply_vat", label: "VAT on your supply: under review", amount_usd_micros: 0 },
  { kind: "carried_forward", label: "Carried forward to next week", amount_usd_micros: 0 },
  { kind: "stripe_fees", label: "Stripe's fees, at cost", amount_usd_micros: -2_330_000 },
];
const NET = 31_670_000;

function mockBff(tax: Record<string, unknown>) {
  const sent: Array<{ url: string; method: string; body: unknown }> = [];
  let current = tax;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (method !== "GET")
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? "null")) });
    if (url === "/auth/me")
      return json({ mode: "disabled", authenticated: false, user: null });
    if (url === "/api/marketplace/seller-tax" && method === "PUT") {
      // Lens B32.41: the TIN, the date of birth and the account are sealed and read back masked.
      const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const tins = (b.tins as Array<{ jurisdiction: string; number: string }>).map(
        (t) => ({ jurisdiction: t.jurisdiction, number: `••••${t.number.slice(-4)}` }),
      );
      current = details({
        ...b,
        tins,
        date_of_birth: "••••-••-••",
        account_identifier: `••••${String(b.account_identifier).slice(-4)}`,
        complete: true,
        missing: [],
        completed_at: "2026-10-08T09:00:00Z",
      });
      return json(current);
    }
    if (url === "/api/marketplace/seller-tax") return json(current);
    if (url === "/api/marketplace/statements")
      return json({
        statements: [
          { period: "2026-W41", payout_id: "mpo_2", net_usd_micros: NET, paid_at: "2026-10-12T06:00:00Z" },
          { period: "2026-W40", payout_id: "mpo_1", net_usd_micros: 34_000_000, paid_at: "2026-10-05T06:00:00Z" },
        ],
      });
    if (url === "/api/marketplace/statements?period=2026-W41")
      return json({
        period: "2026-W41",
        from: "2026-10-05T00:00:00Z",
        to: "2026-10-12T00:00:00Z",
        payout: {
          id: "mpo_2",
          method: "stripe",
          month: "2026-10",
          period: "2026-W41",
          gross_usd_micros: 34_000_000,
          vat_usd_micros: 0,
          account_fee_usd_micros: 2_000_000,
          payout_fee_usd_micros: 330_000,
          net_usd_micros: NET,
          paid_at: "2026-10-12T06:00:00Z",
          created_at: "2026-10-12T06:00:00Z",
        },
        sales: 4,
        lines: LINES,
        net_usd_micros: NET,
        vat_collected_usd_micros: 8_000_000,
        self_billed_invoice: {
          id: "sb_1",
          number: "TEST-SB-000002",
          payout_id: "mpo_2",
          period: "2026-W41",
          issued_at: "2026-10-12T06:00:00Z",
          agreement_version: "draft-2026-10",
          supplier: { name: "Ada Lovelace", address: "1 Analytical Row, London", country: "GB", vat_number: "" },
          customer: { name: "TALYVOR LTD", address: "71-75 Shelton Street, London", country: "GB", vat_number: "GB123456789" },
          net_usd_micros: 34_000_000,
          vat_usd_micros: 0,
          gross_usd_micros: 34_000_000,
          rate_bps: 0,
          jurisdiction: "GB",
          treatment: "under_review",
          note: "VAT on your supply: under review",
          vat_enabled: false,
          preview: true,
        },
      });
    if (url === "/api/marketplace/mine") return json({ listings: [] });
    if (url === "/api/marketplace/earnings")
      return json({
        pending_uses: 0,
        pending_usd_micros: 0,
        payable_usd_micros: 0,
        in_holdback_usd_micros: 0,
        available_usd_micros: 0,
        lifetime_gross_usd_micros: 0,
        earnings: [],
      });
    if (url === "/api/marketplace/payouts")
      return json({
        account: null,
        in_holdback_usd_micros: 0,
        available_usd_micros: 0,
        owed_usd_micros: 0,
        paid_out_usd_micros: 0,
        minimum_usd_micros: 25_000_000,
        paid_this_month: false,
        paid_this_week: false,
        quote: { gross_usd_micros: 0, account_fee_usd_micros: 0, payout_fee_usd_micros: 0, net_usd_micros: 0 },
        payouts: [],
      });
    return json({ error: "not found" }, 404);
  });
  return { sent };
}

async function atSelling() {
  cleanup();
  queryClient.clear();
  window.history.pushState({}, "", "/marketplace/selling");
  render(<App />);
  await screen.findByRole("navigation", { name: /sections/i });
}

/** `-$6.00` → -6,000,000 µUSD. */
function micros(text: string): number {
  const m = /^(-?)\$([\d,]+)\.(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`not an amount: ${text}`);
  const v = Number(m[2].replace(/,/g, "")) * 1_000_000 + Number(m[3]) * 10_000;
  return m[1] ? -v : v;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  queryClient.clear();
});

describe("a seller's tax details and weekly statements", () => {
  it("saves tax details, and the TIN reads masked afterwards", async () => {
    const { sent } = mockBff(details({}));
    await atSelling();

    const form = await screen.findByRole("form", { name: "Tax details" });
    const f = within(form);
    fireEvent.change(f.getByLabelText("First name"), { target: { value: "Ada" } });
    fireEvent.change(f.getByLabelText("Last name"), { target: { value: "Lovelace" } });
    fireEvent.change(f.getByLabelText("Date of birth"), { target: { value: "1990-12-10" } });
    fireEvent.change(f.getByLabelText("Address"), { target: { value: "1 Analytical Row, London" } });
    fireEvent.change(f.getByLabelText("Country of residence"), { target: { value: "GB" } });
    fireEvent.change(f.getByLabelText("Issued by"), { target: { value: "GB" } });
    fireEvent.change(f.getByLabelText("Tax identification number"), { target: { value: "AB123456C" } });
    fireEvent.change(f.getByLabelText(/Account you are paid to/), { target: { value: "GB33BUKB20201555555555" } });
    fireEvent.change(f.getByLabelText("Account holder"), { target: { value: "Ada Lovelace" } });
    fireEvent.click(f.getByLabelText(/I agree to the self-billing agreement/));
    fireEvent.click(f.getByRole("button", { name: "Save tax details" }));

    expect(await f.findByText("Saved. Your tax details are complete.")).toBeTruthy();
    expect(sent).toEqual([
      {
        url: "/api/marketplace/seller-tax",
        method: "PUT",
        body: {
          seller_type: "individual",
          first_name: "Ada",
          middle_name: "",
          last_name: "Lovelace",
          legal_name: "",
          company_registration_number: "",
          address: "1 Analytical Row, London",
          country: "GB",
          tins: [{ jurisdiction: "GB", number: "AB123456C" }],
          date_of_birth: "1990-12-10",
          vat_number: "",
          account_identifier: "GB33BUKB20201555555555",
          account_holder: "Ada Lovelace",
          self_billing_agreed_version: "draft-2026-10",
        },
      },
    ]);
    // What was typed is gone; Lens's masked reading is what the form shows.
    expect(f.getByTestId("tax-tins").textContent).toBe("GB ••••456C");
    expect(f.getByTestId("tax-dob").textContent).toBe("••••-••-••");
    expect(f.getByTestId("tax-account").textContent).toBe("••••5555");
    expect(form.innerHTML).not.toContain("AB123456C");
    expect(form.innerHTML).not.toContain("GB33BUKB20201555555555");
    expect(within(screen.getByTestId("tax-status")).getByText("Complete")).toBeTruthy();
  });

  it("opens a weekly statement whose lines sum to its net, with the VAT note and the self-billed invoice", async () => {
    mockBff(details({ seller_type: "individual", complete: true, missing: [] }));
    await atSelling();

    const list = await screen.findByTestId("statements");
    expect(within(list).getByText("Week 41 · 5–11 Oct 2026")).toBeTruthy();
    fireEvent.click(
      within(list).getByRole("button", { name: "Open the statement for Week 41 · 5–11 Oct 2026" }),
    );

    const st = await screen.findByTestId("statement");
    const lines = within(st).getAllByTestId("statement-amount").map((td) => micros(td.textContent ?? ""));
    expect(lines).toHaveLength(LINES.length);
    const net = within(st).getByTestId("statement-net").textContent ?? "";
    expect(net).toBe(formatUSD(NET));
    expect(lines.reduce((a, b) => a + b, 0)).toBe(micros(net));
    expect(within(st).getByText("Talyvor's fee")).toBeTruthy();
    expect(within(st).getByText("Stripe's fees, at cost")).toBeTruthy();
    expect(within(st).getByTestId("statement-vat").textContent).toContain(
      "Talyvor also collected $8.00 of VAT from your buyers",
    );

    const invoice = within(st).getByTestId("statement-invoice");
    expect(within(invoice).getByText("TEST-SB-000002")).toBeTruthy();
    expect(within(invoice).getByText("Preview — test money only")).toBeTruthy();
    expect(within(invoice).getByTestId("statement-invoice-note").textContent).toBe(
      "VAT on your supply: under review",
    );
  });

  it("shows a withheld seller why, and what to fill in", async () => {
    mockBff(
      details({
        seller_type: "individual",
        first_name: "Ada",
        last_name: "Lovelace",
        address: "1 Analytical Row, London",
        country: "GB",
        tins: [{ jurisdiction: "GB", number: "••••456C" }],
        account_holder: "Ada Lovelace",
        missing: ["date_of_birth", "account_identifier"],
        reminders_sent: 3,
        withheld_since: "2026-10-01T00:00:00Z",
        hold: HOLD,
      }),
    );
    await atSelling();

    const holds = await screen.findAllByTestId("tax-hold");
    // At the top of Selling, with a link to the form, and on the form itself.
    expect(holds).toHaveLength(2);
    expect(holds[0].textContent).toContain(HOLD);
    expect(holds[0].textContent).toContain(
      "Still to fill in: your date of birth and the account you are paid to.",
    );
    expect(
      within(holds[0]).getByRole("link", { name: "Fill in your tax details" }).getAttribute("href"),
    ).toBe("#tax-details");
    expect(within(screen.getByTestId("tax-status")).getByText("Incomplete")).toBeTruthy();
  });
});
