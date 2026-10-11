// B30.126 SELF-TEST — the stand-in Lens's saved outside payees (Lens B30.16), as outside-payees reads and writes them:
// POST and GET /v1/money/payees, POST …/{id}/challenge and …/{id}/confirm. The Test partner answers by the name
// (TESTNOMATCH no match, TESTCLOSE a close match whose holder is the name without the word), TESTSANCTION is refused 403
// and not saved, and a close or no match is confirmed only by an assertion from one of the workspace's passkeys, signed
// over the payee's challenge (checked here as Lens's passkey.VerifyAssertion does).
// B30.109 — and the compliance desk the same scenario's money reaches: POST and GET /v1/money/accounts (Lens B30.13; a live
// account is refused naming currency_accounts' class RED), POST and GET /v1/money/payments (Lens B30.17; a payee held for
// review is refused on its case, live money is refused for want of any), and the compliance cases screening opens (Lens B30.6):
// a TESTSANCTION name is refused naming a blocked case, a TESTPENDING name is saved held on its own. Its defects:
//   payee-confirm-unsigned — a payee is confirmed with no assertion
//   compliance-live-paid   — a live payment on an uncleared capability is paid, and the account's live balance moves
// B30.130 — and an agent's account under the company's (Lens B30.13), its details and payment reference (GET
// /v1/money/accounts/{id}/details, Lens B30.14), the invoices it issues (POST and GET /v1/money/invoices, Lens B30.20), the pay
// page anyone with the link reads (GET /v1/pay/{token}) and another agent paying it from its account in the currency (POST
// /v1/pay/{token}/agent), which moves test money from the payer's account into the issuer's. Its defect:
//   invoice-paid-unmoved   — an agent's payment marks the invoice paid without asking what the payer holds or moving money

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'

interface Payee { id: string; workspace_id: string; name: string; country: string; check: string; suggested_name?: string; checked_by: string
  needs_confirmation: boolean; confirmed_by?: string; created_at: string; [k: string]: unknown }
interface Assertion { credential_id?: string; client_data_json?: string; authenticator_data?: string; signature?: string }
/** A compliance case as Lens's operator reads it (screening.Case). */
interface Case { id: string; workspace_id: string; kind: string; subject_kind: string; subject_id: string; name: string; outcome: string; status: string
  matches: unknown[]; provider: string; capability: string; opened_at: string }
/** A currency account (economy.CurrencyAccount). */
interface Account { id: string; workspace_id: string; agent_id?: string; parent_account_id?: string; currency: string; purpose: string; status: string
  name: string; balance_minor: number; test_minor: number; live_minor: number; created_at: string }
/** One line of an invoice and its VAT (economy.InvoiceLine). */
interface Line { description: string; quantity: number; unit_amount_minor: number; vat_rate_bps: number; net_minor: number; vat_minor: number }
/** An invoice as its issuer reads it (economy.Invoice). */
interface StubInvoice { id: string; workspace_id: string; agent_id: string; account_id: string; issuer: string; number: string; reference: string; pay_token: string
  pay_url: string; currency: string; customer_name: string; customer_email?: string; lines: Line[]; subtotal_minor: number; vat_minor: number; total_minor: number
  paid_minor: number; due_minor: number; due_date: string; remind_days_before: number; status: string; sent_at?: string; paid_at?: string; created_at: string
  payments: { entry_id: string; method: string; amount_minor: number; paid_at: string }[] }
/** A payment out (economy.OutsidePayment). */
interface Payment { id: string; workspace_id: string; account_id: string; payee_id: string; payee_name: string; amount_minor: number; currency: string
  funding: string; reference: string; idempotency_key: string; status: string; created_at: string }

const CURRENCIES = ['GBP', 'EUR', 'USD']
const HELD = 'screening: held — the name is close to one on a sanctions list, and waits for an operator to release it'
const DETAILS_NOTICE = 'Preview — test money only. These details are made up and reach no bank: nothing paid to them moves real money.'
const PAY_NOTICE = 'Preview — test money only. Nothing paid here moves real money.'
/** Minor units as Lens prints them: "GBP 10.00". */
const money = (minor: number, currency: string): string => `${currency} ${(minor / 100).toFixed(2)}`

export class PayeeDesk {
  private readonly payees = new Map<string, Payee[]>()
  private readonly challenges = new Map<string, string>()
  private readonly accounts = new Map<string, Account[]>()
  private readonly payments = new Map<string, Payment[]>()
  private readonly cases: Case[] = []
  /** B30.130 — each agent account's payment reference, by account id; and every invoice issued, found by its pay token. */
  private readonly references = new Map<string, string>()
  private readonly invoices: StubInvoice[] = []

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  /** The workspace's registered passkeys, each with its SPKI, base64url. */
  private readonly passkeys: (ws: string) => { credential_id: string; public_key: string }[]

  constructor(json: PayeeDesk['json'], body: PayeeDesk['body'], broken: PayeeDesk['broken'], passkeys: PayeeDesk['passkeys']) {
    this.json = json
    this.body = body
    this.broken = broken
    this.passkeys = passkeys
  }

  /** B30.109 — the compliance cases in `status` (every one for ''), newest first, as GET /v1/admin/screening lists them. */
  complianceCases(status: string): Case[] {
    return this.cases.filter((c) => status === '' || c.status === status).reverse()
  }

  private openCase(ws: string, subjectID: string, name: string, status: 'blocked' | 'held'): Case {
    const c: Case = { id: `cc_${randomUUID()}`, workspace_id: ws, kind: 'screening', subject_kind: 'payee', subject_id: subjectID, name,
      outcome: status === 'blocked' ? 'hit' : 'review', status, matches: [{ name, list: 'TEST', entry: 'TESTSANCTION', score_bps: status === 'blocked' ? 10_000 : 9_000 }],
      provider: 'test', capability: 'payments_out', opened_at: new Date().toISOString() }
    this.cases.push(c)
    return c
  }

  /** The payee, account and payment routes, on workspace `ws`'s key: true when `path` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    const list = this.payees.get(ws) ?? []
    if (path === '/v1/money/accounts' || path === '/v1/money/payments') return this.money(req, res, ws, path, list), true
    if (await this.invoiceRoute(req, res, ws, path)) return true
    if (path === '/v1/money/payees' && req.method === 'GET') return this.json(res, 200, { payees: list }), true
    if (path === '/v1/money/payees' && req.method === 'POST') {
      const b = await this.body<Record<string, string>>(req)
      const name = (b.name ?? '').trim()
      if (name === '' || (b.country ?? '') === '') return this.json(res, 400, { error: 'economy: invalid payee: a payee has a name and a country' }), true
      if (/TESTSANCTION/i.test(name)) {
        const c = this.openCase(ws, `payee_${randomUUID()}`, name, 'blocked')
        return this.json(res, 403, { error: `screening: refused — the name is on a sanctions list (compliance case ${c.id})` }), true
      }
      const check = /TESTNOMATCH/i.test(name) ? 'no_match' : /TESTCLOSE/i.test(name) ? 'close_match' : 'exact_match'
      const p: Payee = { ...b, id: `payee_${randomUUID()}`, workspace_id: ws, name, country: b.country, check, checked_by: 'test',
        ...(check === 'close_match' ? { suggested_name: name.replace(/TESTCLOSE/gi, ' ').split(/\s+/).filter(Boolean).join(' ') } : {}),
        needs_confirmation: check !== 'exact_match', created_at: new Date().toISOString() }
      if (/TESTPENDING/i.test(name)) p.screening = `${HELD} (compliance case ${this.openCase(ws, p.id, name, 'held').id})`
      this.payees.set(ws, [...list, p])
      return this.json(res, 201, p), true
    }
    const m = /^\/v1\/money\/payees\/([^/]+)\/(challenge|confirm)$/.exec(path)
    if (m === null || req.method !== 'POST') return false
    const p = list.find((x) => x.id === m[1])
    if (p === undefined) return this.json(res, 404, { error: 'economy: no such payee' }), true
    if (!p.needs_confirmation) return this.json(res, 409, { error: 'economy: this payee needs no confirmation' }), true
    if (m[2] === 'challenge') {
      const keys = this.passkeys(ws)
      if (keys.length === 0) return this.json(res, 409, { error: 'economy: a payee is confirmed with one of the workspace\'s passkeys, signing its challenge — register one first' }), true
      const c = randomBytes(32).toString('base64url')
      this.challenges.set(p.id, c)
      return this.json(res, 200, { challenge: c, allow_credentials: keys.map((k) => k.credential_id), user_verification: 'required' }), true
    }
    const { assertion } = await this.body<{ assertion?: Assertion }>(req)
    if (!this.broken('payee-confirm-unsigned')) {
      const refused = this.refused(ws, p.id, assertion)
      if (refused !== undefined) return this.json(res, 403, { error: refused }), true
    }
    this.challenges.delete(p.id)
    Object.assign(p, { needs_confirmation: false, confirmed_by: assertion?.credential_id ?? '', confirmed_at: new Date().toISOString() })
    return this.json(res, 200, p), true
  }

  /** B30.109 — the accounts and the payments out, each refusal as Lens words it; only compliance-live-paid moves money. */
  private async money(req: IncomingMessage, res: ServerResponse, ws: string, path: string, payees: Payee[]): Promise<void> {
    const accounts = this.accounts.get(ws) ?? []
    if (path === '/v1/money/accounts') {
      if (req.method !== 'POST') return this.json(res, 200, { accounts })
      const b = await this.body<{ currency?: string; agent_id?: string; funding?: string }>(req)
      const currency = (b.currency ?? '').toUpperCase()
      const agentID = b.agent_id ?? ''
      if (!CURRENCIES.includes(currency)) return this.json(res, 400, { error: `economy: invalid currency account: an account is in GBP, EUR or USD, not "${currency}"` })
      if (b.funding === 'live') return this.json(res, 403, { error: 'currency_accounts is class RED: it takes test money only until Talyvor records a clearance for it, and this would use real money' })
      if (accounts.some((a) => a.currency === currency && (a.agent_id ?? '') === agentID)) {
        return this.json(res, 409, { error: `economy: an account is already open: ${agentID === '' ? "the company's" : "the agent's"} ${currency} account` })
      }
      // B30.130 — an agent's account is a sub-account of its company's in the currency, reached by a payment reference (Lens B30.14).
      const company = accounts.find((a) => a.currency === currency && a.purpose === 'company')
      if (agentID !== '' && company === undefined) {
        return this.json(res, 409, { error: `economy: an agent's account is a sub-account of its company's: open the company's account in this currency first (${currency})` })
      }
      const a: Account = { id: `macc_${randomUUID()}`, workspace_id: ws, ...(agentID === '' ? {} : { agent_id: agentID, parent_account_id: company?.id }), currency,
        purpose: agentID === '' ? 'company' : 'agent', status: 'open', name: `${currency} account`, balance_minor: 0, test_minor: 0, live_minor: 0, created_at: new Date().toISOString() }
      if (agentID !== '') this.references.set(a.id, 'TLV' + randomBytes(6).toString('hex').toUpperCase())
      this.accounts.set(ws, [...accounts, a])
      return this.json(res, 201, a)
    }
    const payments = this.payments.get(ws) ?? []
    if (req.method !== 'POST') return this.json(res, 200, { payments })
    const b = await this.body<{ payee_id?: string; amount_minor?: number; currency?: string; funding?: string; reference?: string; idempotency_key?: string }>(req)
    const currency = (b.currency ?? '').toUpperCase()
    const funding = b.funding === 'live' ? 'live' : 'test'
    const amount = b.amount_minor ?? 0
    if (!b.payee_id || !b.idempotency_key || amount <= 0 || !CURRENCIES.includes(currency)) {
      return this.json(res, 400, { error: 'economy: invalid payment: a payment names its payee, a positive amount_minor in GBP, EUR or USD and an idempotency key' })
    }
    const account = accounts.find((a) => a.currency === currency)
    if (account === undefined) return this.json(res, 404, { error: `economy: no such money account: no ${currency} account to pay from — open one at /v1/money/accounts` })
    const payee = payees.find((x) => x.id === b.payee_id)
    if (payee === undefined) return this.json(res, 404, { error: 'economy: no such payee' })
    const held = this.cases.find((c) => c.subject_id === payee.id && c.status === 'held')
    if (held !== undefined) return this.json(res, 403, { error: `${HELD} (compliance case ${held.id})` })
    const holds = funding === 'live' ? account.live_minor : account.test_minor
    if (holds < amount && !(funding === 'live' && this.broken('compliance-live-paid'))) {
      return this.json(res, 409, { error: `economy: insufficient funds: the account holds ${money(holds, currency)} of ${funding} money, and this payment is ${money(amount, currency)}` })
    }
    account[funding === 'live' ? 'live_minor' : 'test_minor'] -= amount
    account.balance_minor -= amount
    const p: Payment = { id: `mpay_${randomUUID()}`, workspace_id: ws, account_id: account.id, payee_id: payee.id, payee_name: payee.name, amount_minor: amount, currency,
      funding, reference: b.reference ?? '', idempotency_key: b.idempotency_key, status: 'completed', created_at: new Date().toISOString() }
    this.payments.set(ws, [...payments, p])
    return this.json(res, 201, p)
  }

  /** Why `a` does not confirm payee `id`: undefined when it is a passkey's signature over the payee's challenge. */
  private refused(ws: string, id: string, a: Assertion | undefined): string | undefined {
    if (a === undefined) return 'economy: a payee is confirmed with one of the workspace\'s passkeys, signing its challenge — register one first'
    const spki = this.passkeys(ws).find((k) => k.credential_id === a.credential_id)?.public_key
    if (!spki) return 'passkey: the passkey ceremony is not valid: not one of the workspace\'s passkeys'
    const cdj = Buffer.from(a.client_data_json ?? '', 'base64url')
    const ad = Buffer.from(a.authenticator_data ?? '', 'base64url')
    let cd: { type?: string; challenge?: string } = {}
    try { cd = JSON.parse(cdj.toString()) } catch { /* refused below */ }
    if (cd.type !== 'webauthn.get' || cd.challenge === undefined || cd.challenge !== this.challenges.get(id)) return 'passkey: the passkey ceremony is not valid: the assertion answers another challenge'
    if (ad.length < 37 || (ad[32] & 0x05) !== 0x05) return 'passkey: the passkey ceremony is not valid: the user was not verified'
    const key = createPublicKey({ key: Buffer.from(spki, 'base64url'), format: 'der', type: 'spki' })
    const signed = Buffer.concat([ad, createHash('sha256').update(cdj).digest()])
    if (!verify('sha256', signed, key, Buffer.from(a.signature ?? '', 'base64url'))) return 'passkey: the passkey ceremony is not valid: the signature does not verify'
    return undefined
  }
  /** B30.14 — what a payer pays into `a`: its company's details, made up by the Test partner, and an agent account's payment reference. */
  private details(ws: string, a: Account): { payment_reference?: string } & Record<string, unknown> {
    const company = (this.accounts.get(ws) ?? []).find((x) => x.id === (a.parent_account_id ?? a.id)) ?? a
    return { account_id: a.id, account_ref: `test:${company.id}`, holder: `${ws} Ltd`, currency: a.currency, sort_code: '040004', account_number: '12345678',
      ...(a.purpose === 'agent' ? { payment_reference: this.references.get(a.id) } : {}), mode: 'TEST', notice: DETAILS_NOTICE }
  }

  /** An invoice as Lens answers it: payments only once there are any (omitempty). */
  private invoice(i: StubInvoice): object {
    return { ...i, payments: i.payments.length === 0 ? undefined : i.payments }
  }

  /** B30.130 — an account's details, the invoices and an agent's payment of one, on workspace `ws`'s key: true when `path` was one of them. */
  private async invoiceRoute(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    const accounts = this.accounts.get(ws) ?? []
    const details = /^\/v1\/money\/accounts\/([^/]+)\/details$/.exec(path)
    if (details !== null && req.method === 'GET') {
      const a = accounts.find((x) => x.id === details[1])
      if (a === undefined) return this.json(res, 404, { error: 'economy: no such money account' }), true
      return this.json(res, 200, this.details(ws, a)), true
    }
    if (path === '/v1/money/invoices' && req.method === 'GET') return this.json(res, 200, { invoices: this.invoices.filter((i) => i.workspace_id === ws).map((i) => this.invoice(i)) }), true
    if (path === '/v1/money/invoices' && req.method === 'POST') {
      const b = await this.body<{ account_id?: string; customer_name?: string; customer_email?: string; lines?: Partial<Line>[]; due_date?: string; send?: boolean }>(req)
      const lines: Line[] = (b.lines ?? []).map((l) => {
        const net = (l.quantity ?? 0) * (l.unit_amount_minor ?? 0)
        return { description: l.description ?? '', quantity: l.quantity ?? 0, unit_amount_minor: l.unit_amount_minor ?? 0, vat_rate_bps: l.vat_rate_bps ?? 0, net_minor: net,
          vat_minor: Math.floor((net * (l.vat_rate_bps ?? 0) + 5000) / 10000) }
      })
      if ((b.customer_name ?? '') === '' || lines.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date ?? '') || lines.some((l) => l.quantity <= 0 || l.unit_amount_minor <= 0)) {
        return this.json(res, 400, { error: 'economy: invalid invoice: a customer, 1 to 100 lines above zero and a due date, YYYY-MM-DD' }), true
      }
      const account = accounts.find((a) => a.id === b.account_id && a.purpose === 'agent')
      if (account === undefined) return this.json(res, 404, { error: `economy: no such money account: no agent account ${b.account_id ?? ''} to be paid into` }), true
      const subtotal = lines.reduce((n, l) => n + l.net_minor, 0)
      const vat = lines.reduce((n, l) => n + l.vat_minor, 0)
      const now = new Date().toISOString()
      const token = randomBytes(24).toString('hex')
      const inv: StubInvoice = { id: `inv_${randomUUID()}`, workspace_id: ws, agent_id: account.agent_id ?? '', account_id: account.id, issuer: `${ws} Ltd`,
        number: `INV-${String(this.invoices.filter((i) => i.workspace_id === ws).length + 1).padStart(6, '0')}`, reference: randomBytes(6).toString('hex'),
        pay_token: token, pay_url: `http://127.0.0.1/pay/${token}`, currency: account.currency, customer_name: b.customer_name ?? '', customer_email: b.customer_email, lines,
        subtotal_minor: subtotal, vat_minor: vat, total_minor: subtotal + vat, paid_minor: 0, due_minor: subtotal + vat, due_date: b.due_date ?? '', remind_days_before: 0,
        status: b.send ? 'sent' : 'draft', ...(b.send ? { sent_at: now } : {}), created_at: now, payments: [] }
      this.invoices.push(inv)
      return this.json(res, 201, this.invoice(inv)), true
    }
    const pay = /^\/v1\/pay\/([^/]+)\/agent$/.exec(path)
    if (pay === null || req.method !== 'POST') return false
    const inv = this.invoices.find((i) => i.pay_token === pay[1] && i.status !== 'draft')
    if (inv === undefined) return this.json(res, 404, { error: 'economy: no such invoice' }), true
    const { agent_id: agentID = '' } = await this.body<{ agent_id?: string }>(req)
    if (agentID === '') return this.json(res, 400, { error: 'agent_id names the agent that pays' }), true
    const from = accounts.find((a) => a.purpose === 'agent' && a.agent_id === agentID && a.currency === inv.currency && a.status === 'open')
    if (from === undefined) return this.json(res, 404, { error: `economy: no such money account: the agent has no open ${inv.currency} account to pay from` }), true
    if (inv.status === 'paid' || inv.status === 'void') return this.json(res, 409, { error: `economy: the invoice's state does not allow this: it is ${inv.status}` }), true
    // STUB_BREAK=invoice-paid-unmoved — the invoice is marked paid without asking what the payer holds, and no account moves.
    if (!this.broken('invoice-paid-unmoved')) {
      if (from.test_minor < inv.due_minor) {
        return this.json(res, 409, { error: `economy: the account does not hold enough to pay this invoice: it holds ${money(from.test_minor, inv.currency)} of test money, ` +
          `and ${money(inv.due_minor, inv.currency)} is due` }), true
      }
      const to = [...this.accounts.values()].flat().find((a) => a.id === inv.account_id)
      from.test_minor -= inv.due_minor
      from.balance_minor -= inv.due_minor
      if (to !== undefined) {
        to.test_minor += inv.due_minor
        to.balance_minor += inv.due_minor
      }
    }
    const now = new Date().toISOString()
    const entry = { id: `me_${randomUUID()}`, workspace_id: ws, kind: 'invoice_payment', funding: 'test', amount_minor: inv.due_minor, currency: inv.currency, created_at: now }
    inv.payments.push({ entry_id: entry.id, method: 'agent', amount_minor: inv.due_minor, paid_at: now })
    Object.assign(inv, { paid_minor: inv.total_minor, due_minor: 0, status: 'paid', paid_at: now })
    return this.json(res, 200, { invoice: this.invoice(inv), entry }), true
  }

  /** B30.20 — the pay page behind an invoice's link, read with no credential: the invoice without the issuer's ids, how to pay it. */
  payPage(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    const m = /^\/v1\/pay\/([^/]+)$/.exec(path)
    if (m === null || req.method !== 'GET') return false
    const inv = this.invoices.find((i) => i.pay_token === m[1] && i.status !== 'draft')
    if (inv === undefined) return this.json(res, 404, { error: 'economy: no such invoice' }), true
    const { workspace_id: _w, agent_id: _a, account_id: _c, pay_token: _t, payments: _p, ...shown } = inv
    const page: Record<string, unknown> = { notice: PAY_NOTICE, card: false, invoice: shown }
    const account = (this.accounts.get(inv.workspace_id) ?? []).find((a) => a.id === inv.account_id)
    if (account !== undefined && (inv.status === 'sent' || inv.status === 'overdue')) {
      const d = this.details(inv.workspace_id, account)
      page.transfer = { details: d, mode: 'TEST', reference: `${d.payment_reference ?? ''} ${inv.reference}` }
    }
    return this.json(res, 200, page), true
  }
}
