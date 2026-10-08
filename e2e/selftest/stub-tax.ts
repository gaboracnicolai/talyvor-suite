// B32.66 SELF-TEST — the stand-in Lens's tax (B32.37–B32.41), as tax-and-payouts reads and writes it: a buyer's tax profile
// (GET and PUT …/tax-profile), the tax on each billed use worked out by the Test tax partner on its fixture rows (talyvor-lens
// internal/partners/testdata/tax: GB 20% and DE 19% with a GB VAT and an EU OSS registration, no US one), Talyvor's
// receipt for each paid bill (…/marketplace/receipts), and a seller's tax details (…/marketplace/seller-tax) with the
// payout hold the payout run puts on a seller without them. The Bank (stub-bank.ts) bills, clears and pays; this desk
// answers what each use's tax is and keeps what was declared. Its defects:
//   tax-reverse-charged — a business abroad with a valid VAT number is charged its country's VAT, the reverse charge ignored
//   receipt-total-off   — a receipt's gross leaves its tax out

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
interface Profile { legal_name: string; address: string; country: string; region: string; postal_code: string; business: boolean; tax_id: string; tax_id_valid: boolean; declared_at: string }
export interface ReceiptUse { id: string; title: string; net_usd_micros: number }
interface Receipt {
  id: string; number: string; sequence: number; year: number; series: string; invoice_id: string; buyer_workspace_id: string; issued_at: string; paid_at: string
  buyer: { workspace_id: string; name: string; country: string; business: boolean; vat_number?: string }
  lines: { use_id: string; description: string; net_usd_micros: number; rate_bps: number; tax_usd_micros: number; treatment: string; jurisdiction: string; note: string }[]
  net_usd_micros: number; tax_usd_micros: number; gross_usd_micros: number; gross_cents: number; stripe_total_cents: null; reverse_charge: boolean; notes: string[]
  preview: boolean; preview_reason: string
}
interface SellerDetails {
  seller_type: string; first_name: string; last_name: string; legal_name: string; address: string; country: string; tins: { jurisdiction: string; number: string }[]
  date_of_birth: string; account_identifier: string; account_holder: string; vat_number: string; self_billing_agreed_version: string
  reminders_sent: number; withheld_since?: string; completed_at?: string
}

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
    this.sequence++
    this.receipts.push({ id: `rcpt_${invoice.slice(-12)}`, number: `TEST-${year}-${String(this.sequence).padStart(6, '0')}`, sequence: this.sequence, year, series: 'test',
      invoice_id: invoice, buyer_workspace_id: buyer, issued_at: at, paid_at: at,
      buyer: { workspace_id: buyer, name: p?.legal_name ?? '', country: p?.country ?? '', business: p?.business ?? false, ...(p?.tax_id_valid ? { vat_number: p.tax_id } : {}) },
      lines, net_usd_micros: net, tax_usd_micros: tax, gross_usd_micros: gross, gross_cents: Math.round(gross / 10_000), stripe_total_cents: null, reverse_charge: reverse,
      notes: [...new Set(lines.filter((l) => l.treatment === 'reverse_charge').map((l) => l.note))], preview: true, preview_reason: 'VAT registration pending' })
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

  /** The workspace's tax routes: true when `rest` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string, now: string): Promise<boolean> {
    const method = req.method ?? 'GET'
    if (rest === '/tax-profile') {
      if (method === 'PUT') {
        const b = await this.body<Partial<Profile> & { business?: boolean }>(req)
        const country = String(b.country ?? '').toUpperCase()
        if (!/^[A-Z]{2}$/.test(country)) return this.json(res, 400, { error: `taxprofile: country is two letters, not ${JSON.stringify(b.country ?? '')}` }), true
        const id = String(b.tax_id ?? '').toUpperCase().replace(/\s/g, '')
        const valid = id !== '' && (VAT_FORMAT[id.slice(0, 2)]?.test(id) ?? false) && !NEVER_ISSUED.has(id)
        this.profiles.set(ws, { legal_name: String(b.legal_name ?? ''), address: String(b.address ?? ''), country, region: String(b.region ?? ''), postal_code: String(b.postal_code ?? ''),
          business: valid && (b.business ?? true), tax_id: id, tax_id_valid: valid, declared_at: now })
      }
      const p = this.profiles.get(ws)
      return this.json(res, 200, { profile: p === undefined ? null : { workspace_id: ws, ...p },
        resolved: p === undefined ? { workspace_id: ws, country: '', known: false, business: false, decided_by: 'unknown', evidence: [], flagged: false }
          : { workspace_id: ws, country: p.country, known: true, business: p.business, ...(p.tax_id_valid ? { tax_id: p.tax_id } : {}), decided_by: 'declared', evidence: [{ source: 'declared', country: p.country }], flagged: false } }), true
    }
    if (rest === '/marketplace/receipts' && method === 'GET') {
      return this.json(res, 200, { receipts: this.receipts.filter((r) => r.buyer_workspace_id === ws)
        .map((r) => ({ id: r.id, number: r.number, invoice_id: r.invoice_id, issued_at: r.issued_at, gross_usd_micros: r.gross_usd_micros, tax_usd_micros: r.tax_usd_micros })) }), true
    }
    const one = /^\/marketplace\/receipts\/([^/]+)$/.exec(rest)
    if (one !== null && method === 'GET') {
      const r = this.receipts.find((x) => x.id === one[1] && x.buyer_workspace_id === ws)
      return r === undefined ? this.json(res, 404, { error: 'market: no such receipt' }) : this.json(res, 200, r), true
    }
    if (rest === '/marketplace/seller-tax') {
      if (method === 'PUT') {
        const b = await this.body<Partial<SellerDetails>>(req)
        const d = { ...(this.sellers.get(ws) ?? this.blankSeller()) }
        for (const k of ['seller_type', 'first_name', 'last_name', 'legal_name', 'address', 'country', 'account_holder', 'vat_number', 'self_billing_agreed_version'] as const) {
          if (b[k] !== undefined) d[k] = String(b[k])
        }
        if (b.tins !== undefined) d.tins = b.tins
        if (b.date_of_birth !== undefined) d.date_of_birth = b.date_of_birth
        if (b.account_identifier !== undefined) d.account_identifier = b.account_identifier
        if (this.missing(d).length === 0) {
          d.completed_at ??= now
          d.withheld_since = undefined
        }
        this.sellers.set(ws, d)
      }
      return this.json(res, 200, this.sellerOut(ws, this.sellers.get(ws) ?? this.blankSeller())), true
    }
    return false
  }

  private blankSeller(): SellerDetails {
    return { seller_type: '', first_name: '', last_name: '', legal_name: '', address: '', country: '', tins: [], date_of_birth: '', account_identifier: '', account_holder: '',
      vat_number: '', self_billing_agreed_version: '', reminders_sent: 0 }
  }

  /** What a seller has still to give (Lens sellertax's required fields for an individual or an entity). */
  private missing(d: SellerDetails | undefined): string[] {
    if (d === undefined || d.seller_type === '') return ['seller_type']
    const need: [string, boolean][] = d.seller_type === 'individual'
      ? [['first_name', d.first_name !== ''], ['last_name', d.last_name !== ''], ['date_of_birth', d.date_of_birth !== '']]
      : [['legal_name', d.legal_name !== '']]
    need.push(['address', d.address !== ''], ['country', d.country !== ''], ['tins', d.tins.length > 0], ['account_identifier', d.account_identifier !== ''],
      ['account_holder', d.account_holder !== ''])
    return need.filter(([, given]) => !given).map(([field]) => field)
  }

  private sellerOut(ws: string, d: SellerDetails): object {
    const missing = this.missing(d)
    return { workspace_id: ws, seller_type: d.seller_type, first_name: d.first_name, middle_name: '', last_name: d.last_name, legal_name: d.legal_name, address: d.address,
      country: d.country, tins: d.tins.map((t) => ({ jurisdiction: t.jurisdiction, number: mask(t.number) })), date_of_birth: d.date_of_birth === '' ? '' : '••••-••-••',
      company_registration_number: '', vat_number: d.vat_number, vat_valid: false, account_identifier: mask(d.account_identifier), account_holder: d.account_holder,
      self_billing_agreed_version: d.self_billing_agreed_version, complete: missing.length === 0, missing, reminders_sent: d.reminders_sent,
      ...(d.completed_at === undefined ? {} : { completed_at: d.completed_at }),
      ...(d.withheld_since === undefined ? {} : { withheld_since: d.withheld_since, hold: HOLD_REASON }), accepting: true }
  }
}
