import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, queryClient } from "../../App";
import { formatUSD } from "../lens/format";

// B32.59 — your licences and your bill, walked the way the DONE line reads: a subscription is cancelled and stays
// active to its end, a rental shows rent-to-own at 2 of 3, an ended subscription is renewed under its offer, and the
// bill's totals are the mock's net plus its tax, with a Receipt link per paid invoice that opens the receipt. The
// mock BFF answers as Lens's B32.19–B32.20 licences, B32.39 taxed bill and B32.40 receipts do.

const BILL = {
  month: "2026-10",
  total_ulxc: 150_000_000,
  total_usd_micros: 15_000_000,
  net_usd_micros: 15_000_000,
  tax_usd_micros: 3_000_000,
  gross_usd_micros: 18_000_000,
  lines: [
    {
      use_id: "use_1",
      listing_id: "lst_rent",
      title: "Contract checker",
      price_ulxc: 100_000_000,
      used_at: "2026-10-02T10:00:00Z",
      tax_usd_micros: 2_000_000,
      tax_rate_bps: 2000,
      tax_jurisdiction: "GB",
    },
    {
      use_id: "use_2",
      listing_id: "lst_sub",
      title: "Daily brief",
      price_ulxc: 50_000_000,
      used_at: "2026-10-03T10:00:00Z",
      tax_usd_micros: 1_000_000,
      tax_rate_bps: 2000,
      tax_jurisdiction: "GB",
    },
  ],
};

function licence(over: Record<string, unknown>): Record<string, unknown> {
  return {
    licence: "commercial",
    terms: "",
    pinned_version: null,
    starts_at: "2026-10-08T00:00:00Z",
    ends_at: "2026-11-07T00:00:00Z",
    auto_renew: false,
    status: "active",
    uses_covered: 0,
    rent_paid_usd_micros: 0,
    source: "offer",
    created_at: "2026-10-08T00:00:00Z",
    price_ulxc: 0,
    ...over,
  };
}

function mockBff() {
  const sent: Array<{
    url: string;
    method: string;
    key: string | null;
    body: string;
  }> = [];
  const licences = [
    licence({
      id: "lic_sub",
      listing_id: "lst_sub",
      title: "Daily brief",
      offer_id: "ofr_sub",
      kind: "subscribe",
      auto_renew: true,
      included_uses: 100,
      uses_covered: 7,
      pinned_version: 2,
    }),
    licence({
      id: "lic_rent1",
      listing_id: "lst_rent",
      title: "Contract checker",
      offer_id: "ofr_rent",
      kind: "rent",
      status: "expired",
      rent_paid_usd_micros: 10_000_000,
      starts_at: "2026-09-08T00:00:00Z",
      ends_at: "2026-10-08T00:00:00Z",
    }),
    licence({
      id: "lic_rent2",
      listing_id: "lst_rent",
      title: "Contract checker",
      offer_id: "ofr_rent",
      kind: "rent",
      rent_paid_usd_micros: 10_000_000,
      included_uses: 0,
      uses_covered: 3,
    }),
    licence({
      id: "lic_old",
      listing_id: "lst_news",
      title: "News digest",
      offer_id: "ofr_news",
      kind: "subscribe",
      status: "expired",
      starts_at: "2026-08-01T00:00:00Z",
      ends_at: "2026-08-31T00:00:00Z",
      price_ulxc: 90_000_000,
    }),
  ];
  const listings: Record<string, unknown> = {
    lst_rent: {
      id: "lst_rent",
      price_per_use_ulxc: 0,
      title: "Contract checker",
      offers: [
        {
          id: "ofr_rent",
          kind: "rent",
          licence: "commercial",
          price_usd_micros: 10_000_000,
          period_days: 30,
        },
        {
          id: "ofr_buy",
          kind: "buy",
          licence: "commercial",
          price_usd_micros: 30_000_000,
        },
      ],
    },
    lst_sub: {
      id: "lst_sub",
      price_per_use_ulxc: 0,
      title: "Daily brief",
      offers: [
        {
          id: "ofr_sub",
          kind: "subscribe",
          licence: "commercial",
          price_usd_micros: 5_000_000,
          period_days: 30,
        },
      ],
    },
    lst_news: {
      id: "lst_news",
      price_per_use_ulxc: 0,
      title: "News digest",
      offers: [
        {
          id: "ofr_news",
          kind: "subscribe",
          licence: "commercial",
          price_usd_micros: 9_000_000,
          period_days: 30,
        },
      ],
    },
  };
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (method !== "GET") {
      sent.push({
        url,
        method,
        key: new Headers(init?.headers).get("Idempotency-Key"),
        body: String(init?.body ?? ""),
      });
    }
    if (url === "/auth/me")
      return json({ mode: "disabled", authenticated: false, user: null });
    if (url === "/api/marketplace/licences") return json({ licences });
    const cancel = /^\/api\/marketplace\/licences\/([^/]+)\/cancel$/.exec(url);
    if (cancel && method === "POST") {
      // Lens B32.20: a cancel turns renewing off; the licence stays active to its ends_at.
      const l = licences.find((x) => x.id === cancel[1])!;
      l.auto_renew = false;
      return json(l);
    }
    const renew = /^\/api\/marketplace\/listings\/([^/]+)\/licences$/.exec(url);
    if (renew && method === "POST") {
      const l = licence({
        id: "lic_new",
        listing_id: renew[1],
        title: "News digest",
        offer_id: "ofr_news",
        kind: "subscribe",
        auto_renew: true,
        ends_at: "2026-11-07T00:00:00Z",
      });
      licences.push(l);
      return json(l, 201);
    }
    const one = /^\/api\/marketplace\/listings\/([^/?]+)$/.exec(url);
    if (one && listings[one[1]]) return json(listings[one[1]]);
    if (url.startsWith("/api/marketplace/bill?month=")) return json(BILL);
    if (url === "/api/marketplace/receipts")
      return json({
        receipts: [
          {
            id: "rcp_1",
            number: "TEST-2026-000001",
            invoice_id: "in_1",
            issued_at: "2026-10-05T09:00:00Z",
            gross_usd_micros: 18_000_000,
            tax_usd_micros: 3_000_000,
          },
        ],
      });
    if (url === "/api/marketplace/receipts/rcp_1")
      return new Response(
        "<!doctype html><title>Receipt TEST-2026-000001</title><p>Total $18.00</p>",
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    return json({ error: "not found" }, 404);
  });
  return { sent };
}

async function at(path: string) {
  cleanup();
  queryClient.clear();
  window.history.pushState({}, "", path);
  render(<App />);
  await screen.findByRole("navigation", { name: /sections/i });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  queryClient.clear();
});

describe("your licences and your bill", () => {
  it("cancels a subscription, which stays active to its end, and shows rent-to-own at 2 of 3", async () => {
    mockBff();
    await at("/marketplace/licences");
    expect(
      screen.getByRole("link", { name: "Your licences" }).getAttribute("href"),
    ).toBe("/marketplace/licences");

    const active = await screen.findByTestId("licences-active");
    const sub = within(active)
      .getByRole("link", { name: "Daily brief" })
      .closest("li")!;
    expect(sub.textContent).toContain("Renews on 7 Nov 2026");
    expect(sub.textContent).toContain("pinned to version 2");
    expect(sub.textContent).toContain("7 of 100 uses");
    fireEvent.click(within(sub).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(sub).getByRole("button", { name: "Stop renewing" }));
    await waitFor(() =>
      expect(sub.textContent).toContain(
        "Active until 7 Nov 2026, then it ends",
      ),
    );
    expect(
      within(screen.getByTestId("licences-active")).getByRole("link", {
        name: "Daily brief",
      }),
    ).toBeTruthy();
    expect(within(sub).queryByRole("button", { name: "Cancel" })).toBeNull();

    const rent = within(screen.getByTestId("licences-active"))
      .getByRole("link", { name: "Contract checker" })
      .closest("li")!;
    await waitFor(() =>
      expect(within(rent).getByTestId("rent-to-own").textContent).toContain(
        "Rent-to-own: 2 of 3 rents paid",
      ),
    );
    expect(
      within(rent).getByRole("progressbar").getAttribute("aria-valuenow"),
    ).toBe("2");
    expect(within(rent).getByTestId("rent-to-own").textContent).toContain(
      "$20.00 of $30.00",
    );
  });

  it("renews an ended subscription under its offer, once per click", async () => {
    const { sent } = mockBff();
    await at("/marketplace/licences");
    const ended = await screen.findByTestId("licences-ended");
    const old = within(ended)
      .getByRole("link", { name: "News digest" })
      .closest("li")!;
    // The rental that ended has a live one beside it, so only the subscription with nothing active is offered again.
    expect(
      within(
        within(ended)
          .getByRole("link", { name: "Contract checker" })
          .closest("li")!,
      ).queryByRole("button"),
    ).toBeNull();
    fireEvent.click(within(old).getByRole("button", { name: "Renew" }));
    fireEvent.click(
      await within(old).findByRole("button", { name: "Renew for $9.00" }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId("licences-active")).getByRole("link", {
          name: "News digest",
        }),
      ).toBeTruthy(),
    );
    expect(
      sent.filter(
        (s) => s.url === "/api/marketplace/listings/lst_news/licences",
      ),
    ).toEqual([
      {
        url: "/api/marketplace/listings/lst_news/licences",
        method: "POST",
        key: expect.any(String),
        body: '{"offer_id":"ofr_news","version":0}',
      },
    ]);
  });

  it("shows each line's tax and the net, tax and gross totals, with a receipt link that opens the receipt", async () => {
    mockBff();
    await at("/marketplace/bill");
    await waitFor(() =>
      expect(screen.getByTestId("market-bill-total").textContent).toBe(
        formatUSD(BILL.net_usd_micros + BILL.tax_usd_micros),
      ),
    );
    expect(screen.getByTestId("market-bill-net").textContent).toBe("$15.00");
    expect(screen.getByTestId("market-bill-tax").textContent).toBe("$3.00");
    expect(
      screen.getAllByTestId("market-bill-line-tax").map((n) => n.textContent),
    ).toEqual(["+ $2.00 tax", "+ $1.00 tax"]);
    expect(
      screen
        .getByRole("link", { name: "Contract checker" })
        .closest('div[class*="min-h-row"]')!.textContent,
    ).toContain("tax 20% GB");

    const link = await screen.findByTestId("market-receipt-link");
    expect(link.getAttribute("href")).toBe("/api/marketplace/receipts/rcp_1");
    expect(link.getAttribute("target")).toBe("_blank");
    const page = await fetch(link.getAttribute("href")!);
    expect(page.headers.get("Content-Type")).toBe("text/html");
    expect(await page.text()).toContain("Receipt TEST-2026-000001");
  });
});
