// B32.66 SELF-TEST — the stand-in Lens's tax (B32.37–B32.41), as tax-and-payouts reads and writes it: a buyer's tax profile
// (GET and PUT …/tax-profile), the tax on each billed use worked out by the Test tax partner on its fixture rows (talyvor-lens
// internal/partners/testdata/tax: GB 20% and DE 19% with a GB VAT and an EU OSS registration, no US one), Talyvor's
// receipt for each paid bill (…/marketplace/receipts), and a seller's tax details (…/marketplace/seller-tax) with the
// payout hold the payout run puts on a seller without them. The Bank (stub-bank.ts) bills, clears and pays; this desk
// answers what each use's tax is and keeps what was declared. Its defects:
//   tax-reverse-charged — a business abroad with a valid VAT number is charged its country's VAT, the reverse charge ignored
//   receipt-total-off   — a receipt's gross leaves its tax out
// B32.92 — and buyer-tax-profile's: a tax profile is its workspace owner's alone (an agent key is 403), and its defects:
//   tax-id-never-issued — a number on the list of numbers never issued is found valid, and makes a business
//   tax-check-unread    — the profile's read leaves out when its tax id was checked
//   tax-profile-agent   — an agent key may read and change its workspace's tax profile
// B32.94 — and market-receipts': a receipt is its workspace owner's alone too, read as JSON, its page (?format=html) or its
// PDF (?format=pdf), and its defects:
//   receipt-unissued       — a paid bill gets no receipt
//   receipt-sequence-stuck — every receipt is numbered the year's first, never the next in turn
//   receipt-agent          — an agent key may read its workspace's receipts
// B32.95 — and seller-tax-details': a seller's VAT number checked as a buyer's is, the TINs, date of birth and account
// read back masked and kept when a save leaves them out, and its defects:
//   seller-tax-unmasked  — the read returns the TINs as they were given
//   seller-tax-forgets   — a save that leaves out the TINs, date of birth and account removes them
//   seller-vat-unchecked — a VAT number never issued counts as given, and the details read complete
// B32.100 — and market-buyer-currency's: a listing's offers read in the reader's currency (Lens B32.51) at the fixture ECB
// rates of the day (1 EUR = 1.10 USD = 0.85 GBP), VAT included for a consumer where Talyvor is registered and "+ VAT" for
// a business, and its defects:
//   display-missing        — the offers carry no display
//   display-usd-moved      — the US-dollar price reads as the converted one's dollars, VAT and all
//   display-vat-left-out   — a consumer's price is labelled "incl. VAT" and leaves the VAT out
//   display-business-taxed — a business's price has the VAT in it, "incl. VAT"

import type { IncomingMessage, ServerResponse } from 'node:http'

/** The fixture rows: each jurisdiction's digital_service rate, and the ones Talyvor is registered in. */
const RATES_BPS: Record<string, number> = { GB: 2000, DE: 1900, FR: 2000 }
const REGISTERED = new Set(['GB', 'DE', 'FR'])
/** Talyvor supplies from GB. */
const SUPPLIER = 'GB'
/** Well-formed numbers the Test tax partner reports as never issued. */
const NEVER_ISSUED = new Set(['GB999999999', 'DE999999999'])
const VAT_FORMAT: Record<string, RegExp> = { GB: /^GB\d{9}$/, DE: /^DE\d{9}$/, FR: /^FR[0-9A-Z]{2}\d{9}$/ }

export interface TaxLine { tax_usd_micros: number; tax_rate_bps: number; tax_jurisdiction: string; tax_treatment: string; tax_note: string }
interface Profile {
  legal_name: string; address: string; country: string; region: string; postal_code: string; business: boolean; tax_id: string; tax_id_valid: boolean
  tax_id_checked_at?: string; tax_id_detail: string; declared_at: string
}
export interface ReceiptUse { id: string; title: string; net_usd_micros: number }
interface Receipt {
  id: string; number: string; sequence: number; year: number; series: string; invoice_id: string; buyer_workspace_id: string; issued_at: string; paid_at: string
  supplier: { legal_name: string; address: string; vat_number: string }
  buyer: { workspace_id: string; name: string; country: string; business: boolean; vat_number?: string }
  lines: { use_id: string; description: string; net_usd_micros: number; rate_bps: number; tax_usd_micros: number; treatment: string; jurisdiction: string; note: string }[]
  net_usd_micros: number; tax_usd_micros: number; gross_usd_micros: number; gross_cents: number; stripe_total_cents: null; reverse_charge: boolean; notes: string[]
  preview: boolean; preview_reason: string
}
interface SellerDetails {
  seller_type: string; first_name: string; last_name: string; legal_name: string; address: string; country: string; tins: { jurisdiction: string; number: string }[]
  date_of_birth: string; account_identifier: string; account_holder: string; vat_number: string; vat_valid: boolean; vat_detail: string; vat_checked_at?: string
  self_billing_agreed_version: string; reminders_sent: number; withheld_since?: string; completed_at?: string
}

/** B32.100 — the fixture ECB day: each currency per US dollar as a fraction (1 EUR = 1.10 USD = 0.85 GBP), and each country's currency. */
const PER_USD: Record<string, [bigint, bigint]> = { USD: [1n, 1n], EUR: [10n, 11n], GBP: [17n, 22n] }
const RATE_DATE = '2026-10-02T00:00:00Z'
const CURRENCY_OF: Record<string, string> = { GB: 'GBP', DE: 'EUR', FR: 'EUR' }
const CHARGED_IN_USD = 'Charged in US dollars on your monthly marketplace bill'

export const HOLD_REASON = 'Your payouts are on hold until your tax details are complete. Your earnings keep clearing and are paid at the next payout after you complete them.'
const mask = (v: string): string => (v === '' ? '' : `••••${v.slice(-4)}`)
const halfUp = (micros: number, bps: number): number => Math.floor((micros * bps + 5_000) / 10_000)

export class TaxDesk {
  private readonly profiles = new Map<string, Profile>()
  private readonly lines = new Map<string, TaxLine>()
  private readonly receipts: Receipt[] = []
  private readonly sellers = new Map<string, SellerDetails>()
  private sequence = 0

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean

  constructor(json: TaxDesk['json'], body: TaxDesk['body'], broken: TaxDesk['broken']) {
    this.json = json
    this.body = body
    this.broken = broken
  }

  /** A billed use's tax, worked out once — as Lens does when it meters the use — from its buyer's profile then. */
  taxOf(buyer: string, useID: string, net: number): TaxLine {
    const known = this.lines.get(useID)
    if (known !== undefined) return known
    const p = this.profiles.get(buyer)
    const country = p?.country ?? ''
    let line: TaxLine
    if (p !== undefined && p.business && p.tax_id_valid && country !== SUPPLIER && !this.broken('tax-reverse-charged')) {
      line = { tax_usd_micros: 0, tax_rate_bps: 0, tax_jurisdiction: country, tax_treatment: 'reverse_charge', tax_note: `Reverse charge: the customer accounts for the tax due in ${country}` }
    } else if (country === '') {
      line = { tax_usd_micros: 0, tax_rate_bps: 0, tax_jurisdiction: '', tax_treatment: 'unknown_location', tax_note: 'No tax worked out: where the buyer is is not known' }
    } else if (!REGISTERED.has(country)) {
      line = { tax_usd_micros: 0, tax_rate_bps: 0, tax_jurisdiction: country, tax_treatment: 'not_registered', tax_note: `No tax charged: the supplier is not registered for tax in ${country}` }
    } else {
      const bps = RATES_BPS[country]
      line = { tax_usd_micros: halfUp(net, bps), tax_rate_bps: bps, tax_jurisdiction: country, tax_treatment: 'standard', tax_note: `Tax at ${bps / 100}% in ${country}` }
    }
    this.lines.set(useID, line)
    return line
  }

  /** Talyvor's receipt for a test buyer's paid bill: one line per use it cleared, numbered in the test series. */
  issueReceipt(buyer: string, invoice: string, uses: ReceiptUse[], at: string): void {
    if (this.broken('receipt-unissued')) return
    const year = Number(at.slice(0, 4))
    const p = this.profiles.get(buyer)
    const lines = uses.map((u) => {
      const t = this.taxOf(buyer, u.id, u.net_usd_micros)
      return { use_id: u.id, description: u.title, net_usd_micros: u.net_usd_micros, rate_bps: t.tax_rate_bps, tax_usd_micros: t.tax_usd_micros, treatment: t.tax_treatment,
        jurisdiction: t.tax_jurisdiction, note: t.tax_note }
    })
    const net = lines.reduce((s, l) => s + l.net_usd_micros, 0)
    const tax = lines.reduce((s, l) => s + l.tax_usd_micros, 0)
    const gross = this.broken('receipt-total-off') ? net : net + tax
    const reverse = lines.some((l) => l.treatment === 'reverse_charge')
    this.sequence = this.broken('receipt-sequence-stuck') ? 1 : this.sequence + 1
    this.receipts.push({ id: `rcpt_${invoice.slice(-12)}`, number: `TEST-${year}-${String(this.sequence).padStart(6, '0')}`, sequence: this.sequence, year, series: 'test',
      invoice_id: invoice, buyer_workspace_id: buyer, issued_at: at, paid_at: at,
      // No LENS_SUPPLIER_VAT_NUMBER: the page prints "VAT registration pending" for it.
      supplier: { legal_name: 'TALYVOR LTD', address: '1 Test Street, London', vat_number: '' },
      buyer: { workspace_id: buyer, name: p?.legal_name ?? '', country: p?.country ?? '', business: p !== undefined && p.business && p.tax_id_valid, ...(p?.tax_id_valid ? { vat_number: p.tax_id } : {}) },
      lines, net_usd_micros: net, tax_usd_micros: tax, gross_usd_micros: gross, gross_cents: Math.round(gross / 10_000), stripe_total_cents: null, reverse_charge: reverse,
      notes: [...new Set(lines.filter((l) => l.treatment === 'reverse_charge').map((l) => l.note))], preview: true, preview_reason: 'Preview — test money only' })
  }

  /**
   * B32.100 — `offers` as `viewer` reads them (Lens market.ShowPrices): each with its display in `asked`, or in the currency
   * of the viewer's declared country (dollars where none), at the fixture ECB rates rounded half-up to the cent — VAT
   * included for a consumer in a country Talyvor is registered in, "+ VAT" for a business — and the note on how it is
   * charged. A currency that is no ISO code is the refusal's sentence.
   */
  showPrices<T extends { price_usd_micros: number }>(viewer: string, offers: T[], asked: string): { offers: T[]; price_note: string } | string {
    const ccyAsked = asked.trim().toUpperCase()
    if (ccyAsked !== '' && !/^[A-Z]{3}$/.test(ccyAsked)) return 'market: invalid listing: currency must be a three-letter ISO 4217 code, such as GBP'
    const p = this.profiles.get(viewer)
    const business = p !== undefined && p.business && p.tax_id_valid
    const ccy = ccyAsked !== '' ? ccyAsked : (CURRENCY_OF[p?.country ?? ''] ?? 'USD')
    const per = PER_USD[ccy]
    if (per === undefined) return { offers, price_note: `${CHARGED_IN_USD}; no ECB reference rate for ${ccy} is published yet.` }
    const [num, den] = per
    const vat = p !== undefined && !business && REGISTERED.has(p.country) ? RATES_BPS[p.country] : undefined
    const shown = offers.map((o) => {
      if (this.broken('display-missing')) return o
      const taxed = vat !== undefined || this.broken('display-business-taxed') ? halfUp(o.price_usd_micros, vat ?? RATES_BPS.GB) : 0
      const gross = o.price_usd_micros + (this.broken('display-vat-left-out') ? 0 : taxed)
      const amount = Number((2n * BigInt(gross) * 100n * num + den * 1_000_000n) / (2n * den * 1_000_000n))
      const label = taxed > 0 ? 'incl. VAT' : business ? '+ VAT' : undefined
      return { ...o, ...(this.broken('display-usd-moved') ? { price_usd_micros: o.price_usd_micros + taxed } : {}),
        display: { currency: ccy, amount_minor: amount, includes_tax: taxed > 0, ...(label === undefined ? {} : { tax_label: label }),
          rate: ccy === 'USD' ? '1' : (Number(num) / Number(den)).toFixed(6), ...(ccy === 'USD' ? {} : { rate_date: RATE_DATE }), source: ccy === 'USD' ? 'none' : 'ecb' } }
    })
    const note = ccy === 'USD' ? `${CHARGED_IN_USD}.` : `${CHARGED_IN_USD}; ${ccy} prices are at the ECB reference rate of 2 October 2026.`
    return { offers: shown, price_note: note }
  }

  /** Whether a seller's tax details are incomplete — the payout run withholds such a seller with earnings. */
  incomplete(seller: string): boolean {
    return this.missing(this.sellers.get(seller)).length > 0
  }

  /** The payout run's hold on a seller without tax details, once their reminders are due: when it began. */
  withhold(seller: string, at: string): string {
    const d = this.sellers.get(seller) ?? this.blankSeller()
    d.reminders_sent = 3
    d.withheld_since ??= at
    this.sellers.set(seller, d)
    return d.withheld_since
  }

  withheld(seller: string): boolean {
    return (this.sellers.get(seller)?.withheld_since ?? '') !== ''
  }

  /** B32.98 — a seller's details as they saved them, the TINs in clear, as the platform report opens them: undefined before they give any. */
  sellerDetails(seller: string): Readonly<SellerDetails> | undefined {
    return this.sellers.get(seller)
  }

  /**
   * B32.97 — the seller as their self-billed invoice prints them (Lens market.selfBillFor), with the agreement they saved:
   * undefined when they have not agreed to self-billing — unless `anyway`, as though every seller had.
   */
  selfBiller(seller: string, anyway: boolean): { agreement_version: string; name: string; address: string; country: string; vat_number: string } | undefined {
    const d = this.sellers.get(seller)
    if (d === undefined || (d.self_billing_agreed_version === '' && !anyway)) return undefined
    const name = d.seller_type === 'individual' ? `${d.first_name} ${d.last_name}`.trim() : d.legal_name
    return { agreement_version: d.self_billing_agreed_version, name: name || seller, address: d.address, country: d.country, vat_number: d.vat_valid ? d.vat_number : '' }
  }

  /**
   * The workspace's tax routes: true when `rest` was one of them. `agent`: the call is on one of its agents' keys, which
   * Lens refuses the tax profile to — only the workspace's owner or an admin may read or change it.
   */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string, now: string, agent = false): Promise<boolean> {
    const method = req.method ?? 'GET'
    if (rest === '/tax-profile') {
      if (agent && !this.broken('tax-profile-agent')) {
        return this.json(res, 403, { error: "only the workspace's owner or an admin may read or change its tax profile" }), true
      }
      if (method === 'PUT') {
        const b = await this.body<Partial<Profile> & { business?: boolean }>(req)
        const country = String(b.country ?? '').toUpperCase()
        if (!/^[A-Z]{2}$/.test(country)) return this.json(res, 400, { error: `taxprofile: country is two letters, not ${JSON.stringify(b.country ?? '')}` }), true
        const id = String(b.tax_id ?? '').toUpperCase().replace(/\s/g, '')
        // The Test tax partner's check (talyvor-lens partners.TestTaxPartner.ValidateTaxID): the format, then the list.
        const detail = id === '' ? '' : !(VAT_FORMAT[id.slice(0, 2)]?.test(id) ?? false) ? `not the format of a ${country} VAT number`
          : NEVER_ISSUED.has(id) && !this.broken('tax-id-never-issued') ? 'test mode: this number is on the list of numbers no authority issued' : ''
        // A tax id declares a business; the workspace is one only while the number is valid (Resolve).
        this.profiles.set(ws, { legal_name: String(b.legal_name ?? ''), address: String(b.address ?? ''), country, region: String(b.region ?? ''), postal_code: String(b.postal_code ?? ''),
          business: b.business ?? id !== '', tax_id: id, tax_id_valid: id !== '' && detail === '', ...(id === '' ? {} : { tax_id_checked_at: now }), tax_id_detail: detail, declared_at: now })
      }
      const p = this.profiles.get(ws)
      const shown = p === undefined || method !== 'GET' || !this.broken('tax-check-unread') ? p : { ...p, tax_id_checked_at: undefined }
      const business = p !== undefined && p.business && p.tax_id_valid
      return this.json(res, 200, { profile: shown === undefined ? null : { workspace_id: ws, ...shown },
        resolved: p === undefined ? { workspace_id: ws, country: '', known: false, business: false, decided_by: 'unknown', evidence: [], flagged: false }
          : { workspace_id: ws, country: p.country, known: true, business, ...(business ? { tax_id: p.tax_id } : {}), decided_by: 'declared', evidence: [{ source: 'declared', country: p.country }], flagged: false } }), true
    }
    if (agent && rest.startsWith('/marketplace/receipts') && !this.broken('receipt-agent')) {
      return this.json(res, 403, { error: "only the workspace's owner or an admin may read its receipts" }), true
    }
    if (rest === '/marketplace/receipts' && method === 'GET') {
      return this.json(res, 200, { receipts: this.receipts.filter((r) => r.buyer_workspace_id === ws)
        .map((r) => ({ id: r.id, number: r.number, invoice_id: r.invoice_id, issued_at: r.issued_at, gross_usd_micros: r.gross_usd_micros, tax_usd_micros: r.tax_usd_micros })) }), true
    }
    const one = /^\/marketplace\/receipts\/([^/]+)$/.exec(rest)
    if (one !== null && method === 'GET') {
      const r = this.receipts.find((x) => x.id === one[1] && x.buyer_workspace_id === ws)
      if (r === undefined) return this.json(res, 404, { error: 'market: no such receipt' }), true
      const format = new URL(req.url ?? '/', 'http://stub').searchParams.get('format') ?? ''
      if (format === 'html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end(`<!doctype html><title>Receipt ${r.number} — Talyvor</title><h1>Receipt ${r.number}</h1><p class="vat">${r.supplier.vat_number || 'VAT registration pending'}</p>` +
          `<p class="preview">${r.preview_reason}</p>`), true
      }
      if (format === 'pdf') {
        res.writeHead(200, { 'Content-Type': 'application/pdf' })
        return res.end(`%PDF-1.4\n% Receipt ${r.number}\n%%EOF\n`), true
      }
      return this.json(res, 200, r), true
    }
    if (rest === '/marketplace/seller-tax') {
      if (method === 'PUT') {
        const b = await this.body<Partial<SellerDetails>>(req)
        const d = { ...(this.sellers.get(ws) ?? this.blankSeller()) }
        for (const k of ['seller_type', 'first_name', 'last_name', 'legal_name', 'address', 'country', 'account_holder', 'vat_number', 'self_billing_agreed_version'] as const) {
          if (b[k] !== undefined) d[k] = String(b[k])
        }
        const forgets = this.broken('seller-tax-forgets')
        if (b.tins !== undefined || forgets) d.tins = b.tins ?? []
        if (b.date_of_birth !== undefined || forgets) d.date_of_birth = b.date_of_birth ?? ''
        if (b.account_identifier !== undefined || forgets) d.account_identifier = b.account_identifier ?? ''
        // The Test tax partner's check, as a buyer's tax id has it, against the country given with it.
        const id = d.vat_number.toUpperCase().replace(/\s/g, '')
        if (id !== '' && d.country === '') return this.json(res, 400, { error: 'sellertax: give your country to check your VAT number against' }), true
        d.vat_detail = id === '' ? '' : !(VAT_FORMAT[id.slice(0, 2)]?.test(id) ?? false) ? `not the format of a ${d.country} VAT number`
          : NEVER_ISSUED.has(id) ? 'test mode: this number is on the list of numbers no authority issued' : ''
        d.vat_number = id
        d.vat_valid = id !== '' && d.vat_detail === ''
        d.vat_checked_at = id === '' ? undefined : now
        if (this.missing(d).length === 0) {
          d.completed_at ??= now
          d.withheld_since = undefined
        }
        this.sellers.set(ws, d)
      }
      return this.json(res, 200, this.sellerOut(ws, this.sellers.get(ws) ?? this.blankSeller(), method === 'GET' && this.broken('seller-tax-unmasked'))), true
    }
    return false
  }

  private blankSeller(): SellerDetails {
    return { seller_type: '', first_name: '', last_name: '', legal_name: '', address: '', country: '', tins: [], date_of_birth: '', account_identifier: '', account_holder: '',
      vat_number: '', vat_valid: false, vat_detail: '', self_billing_agreed_version: '', reminders_sent: 0 }
  }

  /** What a seller has still to give (Lens sellertax's required fields for an individual or an entity). */
  private missing(d: SellerDetails | undefined): string[] {
    if (d === undefined || d.seller_type === '') return ['seller_type']
    const need: [string, boolean][] = d.seller_type === 'individual'
      ? [['first_name', d.first_name !== ''], ['last_name', d.last_name !== ''], ['date_of_birth', d.date_of_birth !== '']]
      : [['legal_name', d.legal_name !== '']]
    need.push(['address', d.address !== ''], ['country', d.country !== ''], ['tins', d.tins.length > 0],
      ['vat_number', d.vat_number === '' || d.vat_valid || this.broken('seller-vat-unchecked')], ['account_identifier', d.account_identifier !== ''],
      ['account_holder', d.account_holder !== ''])
    return need.filter(([, given]) => !given).map(([field]) => field)
  }

  private sellerOut(ws: string, d: SellerDetails, unmasked = false): object {
    const missing = this.missing(d)
    return { workspace_id: ws, seller_type: d.seller_type, first_name: d.first_name, middle_name: '', last_name: d.last_name, legal_name: d.legal_name, address: d.address,
      country: d.country, tins: d.tins.map((t) => ({ jurisdiction: t.jurisdiction, number: unmasked ? t.number : mask(t.number) })), date_of_birth: d.date_of_birth === '' ? '' : '••••-••-••',
      company_registration_number: '', vat_number: d.vat_number, vat_valid: d.vat_valid, ...(d.vat_detail === '' ? {} : { vat_detail: d.vat_detail }),
      ...(d.vat_checked_at === undefined ? {} : { vat_checked_at: d.vat_checked_at }), account_identifier: mask(d.account_identifier), account_holder: d.account_holder,
      self_billing_agreed_version: d.self_billing_agreed_version, complete: missing.length === 0, missing, reminders_sent: d.reminders_sent,
      ...(d.completed_at === undefined ? {} : { completed_at: d.completed_at }),
      ...(d.withheld_since === undefined ? {} : { withheld_since: d.withheld_since, hold: HOLD_REASON }), accepting: true }
  }
}
