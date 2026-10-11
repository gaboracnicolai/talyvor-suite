// B30.130 — invoices and pay links (Lens B30.20), on Lens's API, once a run, on two workspaces of its own.
//
// One test company's agent issues an invoice from its GBP account — two lines, VAT on one — and sends it, so Lens answers
// its number, reference, pay token and pay link with the total. The pay page behind the link is read with no credential:
// "Preview — test money only", the invoice sent with the total due, a transfer offered that quotes the agent's payment
// reference and the invoice's, and none of the issuer's ids or the token on it. Another company's agent, with a GBP
// account of its own holding nothing, pays it through the link and must be refused 409 for want of money; the invoice
// must still read sent with the total due and no payment, and neither agent's account may have moved.
//
// shortcut: the payer holds nothing — Lens has no route that puts test money into an account until B30.15's payments-in
// webhook lands; once it has, fund the payer here (B30.14's payment reference) and assert the paid path: the issuer's
// account up by the total, the payer's down by it, the invoice paid.

import { fail } from './bank.ts'
import type { Answered, SyntheticUser, WorkspaceTerms } from './lens.ts'
import { said } from './routes.ts'
import type { Scenario } from './scenarios.ts'

/** A currency account as Lens answers it (economy.CurrencyAccount). */
interface Account { id: string; agent_id?: string; currency: string; purpose: string; balance_minor: number; test_minor: number; live_minor: number }
/** An invoice as its issuer reads it (economy.Invoice); the pay page shows it without the issuer's ids. */
interface Invoice { id: string; workspace_id?: string; agent_id?: string; account_id?: string; number: string; reference: string; pay_token?: string; pay_url?: string
  currency: string; subtotal_minor: number; vat_minor: number; total_minor: number; paid_minor: number; due_minor: number; status: string; payments?: unknown[] }
/** The public pay page (GET /v1/pay/{token}). */
interface PayPage { notice: string; card: boolean; transfer?: { details: unknown; mode: string; reference: string }; invoice: Invoice }

const TERMS = '/v1/workspaces/{ws}/terms'
const LINES = [
  { description: 'Nightly research run', quantity: 2, unit_amount_minor: 5000, vat_rate_bps: 2000 },
  { description: 'Nightly report', quantity: 1, unit_amount_minor: 2500, vat_rate_bps: 0 },
]
/** 2 × £50.00 net + 20% VAT, and £25.00 with none. */
const SUBTOTAL = 12_500
const VAT = 2000
const TOTAL = SUBTOTAL + VAT
/** An agent account's payment reference (talyvor-lens economy.paymentReference). */
const PAYMENT_REFERENCE = /TLV[0-9A-F]{12}/

export function invoicePayLink(): Scenario {
  return {
    id: 'invoice-pay-link',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    items: ['B30.20'],
    title: 'invoices and pay links: an agent issues and sends a GBP invoice with VAT; its pay page reads with no credential, test money only, ' +
      "quoting the agent's payment reference, naming no issuer id; another company's unfunded agent is refused 409 and nothing moves",
    run: async (ctx) => {
      const { lens } = ctx.env
      const [issuer, payer] = await lens.createUsers(2)
      const call = async <T>(user: SyntheticUser, method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      /** The company's GBP account, then one of its agents' under it: the agent and its account. */
      const openAgentAccount = async (user: SyntheticUser, who: string, agentName: string): Promise<{ agent: string; account: Account } | string> => {
        const terms = await call<{ terms: WorkspaceTerms[] | null }>(user, 'GET', TERMS, undefined, `${who} reads the workspace's terms`)
        if (!terms.ok) return `reading ${who} workspace's terms was refused: ${said(terms)}`
        for (const t of terms.value.terms ?? []) {
          if (!['currency_accounts', 'account_details'].includes(t.capability) || t.accepted != null) continue
          const accepted = await call(user, 'POST', `${TERMS}/${t.capability}/accept`, { version: t.version }, `${who} accepts version ${t.version} of ${t.capability}' terms`)
          if (accepted.status !== 201) return `accepting ${t.capability}' terms must answer 201; Lens answered ${said(accepted)}`
        }
        const company = await call<Account>(user, 'POST', '/v1/money/accounts', { currency: 'GBP' }, `${who} opens the company's GBP account on test money`)
        if (company.status !== 201) return `opening a company GBP account must answer 201; Lens answered ${said(company)}`
        const agent = await lens.createAgent(user, agentName)
        ctx.evidence.push({ note: `${who} creates the agent ${agentName}`, answer: agent.id })
        const opened = await call<Account>(user, 'POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `${who} opens the agent's GBP account`)
        if (opened.status !== 201 || !opened.ok) return `opening an agent's GBP account must answer 201; Lens answered ${said(opened)}`
        if (opened.value.purpose !== 'agent' || opened.value.agent_id !== agent.id || opened.value.test_minor !== 0) {
          return `an agent's account is purpose agent, the agent's own, holding 0; Lens opened ${JSON.stringify(opened.value)}`
        }
        return { agent: agent.id, account: opened.value }
      }

      // The issuer: its agent's account, the reference a transfer quotes, and the invoice, sent.
      const issuing = await openAgentAccount(issuer, 'the issuer', 'Nightly invoicing agent')
      if (typeof issuing === 'string') return fail(issuing)
      const details = await call<{ payment_reference?: string; mode: string }>(issuer, 'GET', `/v1/money/accounts/${issuing.account.id}/details`, undefined,
        "the issuer reads the agent account's details")
      if (!details.ok) return fail(`reading the agent account's details was refused: ${said(details)}`)
      if (details.value.mode !== 'TEST' || !PAYMENT_REFERENCE.test(details.value.payment_reference ?? '')) {
        return fail(`an agent account's details are mode TEST with a TLV payment reference; Lens answered ${said(details)}`)
      }
      const reference = details.value.payment_reference ?? ''
      const due = new Date(Date.now() + 7 * 86_400e3).toISOString().slice(0, 10)
      const issued = await call<Invoice>(issuer, 'POST', '/v1/money/invoices', { account_id: issuing.account.id, customer_name: 'Nightly Payer Ltd',
        customer_email: 'payer@nightly.test', lines: LINES, due_date: due, send: true }, 'the issuer issues and sends an invoice from the agent\'s GBP account')
      if (issued.status !== 201 || !issued.ok) return fail(`issuing an invoice must answer 201; Lens answered ${said(issued)}`)
      const inv = issued.value
      if (inv.status !== 'sent' || inv.currency !== 'GBP' || inv.subtotal_minor !== SUBTOTAL || inv.vat_minor !== VAT || inv.total_minor !== TOTAL || inv.due_minor !== TOTAL) {
        return fail(`a sent GBP invoice of 2 × £50.00 at 20% VAT and £25.00 is sent, subtotal ${SUBTOTAL}, VAT ${VAT}, total and due ${TOTAL}; Lens issued ${said(issued)}`)
      }
      if (inv.number === '' || inv.reference === '' || (inv.pay_token ?? '') === '' || !(inv.pay_url ?? '').endsWith(`/pay/${inv.pay_token}`)) {
        return fail(`an invoice has a number, a reference, a pay token and a pay link ending /pay/<token>; Lens issued ${said(issued)}`)
      }
      const token = inv.pay_token ?? ''

      // The pay page, with no credential.
      const page = await lens.as('', 'GET', `/v1/pay/${token}`)
      ctx.evidence.push({ note: 'the pay link is opened with no credential', answer: `${page.status} ${page.text.slice(0, 400)}` })
      if (page.status !== 200) return fail(`the pay page must answer 200 to anyone with the link; Lens answered ${page.status}: ${page.text.slice(0, 200)}`)
      const pay = JSON.parse(page.text) as PayPage
      if (!/Preview — test money only/.test(pay.notice ?? '')) return fail(`the pay page must say "Preview — test money only"; its notice is ${JSON.stringify(pay.notice ?? '')}`)
      if (pay.invoice?.number !== inv.number || pay.invoice.status !== 'sent' || pay.invoice.due_minor !== TOTAL) {
        return fail(`the pay page shows invoice ${inv.number} sent with ${TOTAL} due; it shows ${JSON.stringify(pay.invoice).slice(0, 300)}`)
      }
      const leaked = ['workspace_id', 'agent_id', 'account_id', 'pay_token'].filter((k) => k in pay.invoice)
      if (leaked.length > 0) return fail(`the pay page must name none of the issuer's ids or the token; it carries ${leaked.join(', ')}`)
      if (pay.transfer === undefined || !pay.transfer.reference.includes(reference) || !pay.transfer.reference.includes(inv.reference)) {
        return fail(`the pay page offers a transfer quoting the agent's payment reference ${reference} and the invoice's ${inv.reference}; it offers ${JSON.stringify(pay.transfer)}`)
      }

      // Another company's agent, holding nothing, pays through the link.
      const paying = await openAgentAccount(payer, 'the payer', 'Nightly paying agent')
      if (typeof paying === 'string') return fail(paying)
      const paid = await call<{ invoice: Invoice }>(payer, 'POST', `/v1/pay/${token}/agent`, { agent_id: paying.agent }, "the payer's agent pays the invoice from its empty GBP account")
      if (paid.status !== 409 || paid.ok) return fail(`paying an invoice from an account holding 0 must be refused 409; Lens answered ${said(paid)}`)
      if (!/hold/.test(paid.error)) return fail(`the refusal must say what the account holds; Lens said ${JSON.stringify(paid.error)}`)

      // Nothing moved: the invoice still sent and unpaid, both agents' accounts at 0.
      const invoices = await call<{ invoices: Invoice[] | null }>(issuer, 'GET', '/v1/money/invoices', undefined, 'the issuer lists its invoices')
      if (!invoices.ok) return fail(`listing the issuer's invoices was refused: ${said(invoices)}`)
      const after = (invoices.value.invoices ?? []).find((x) => x.id === inv.id)
      if (after === undefined || after.status !== 'sent' || after.paid_minor !== 0 || after.due_minor !== TOTAL || (after.payments ?? []).length !== 0) {
        return fail(`after a refused payment the invoice is still sent with ${TOTAL} due and no payment; it reads ${JSON.stringify(after).slice(0, 300)}`)
      }
      for (const [user, who, account] of [[issuer, 'the issuer', issuing.account], [payer, 'the payer', paying.account]] as const) {
        const accounts = await call<{ accounts: Account[] | null }>(user, 'GET', '/v1/money/accounts', undefined, `${who} lists the accounts`)
        if (!accounts.ok) return fail(`listing ${who}'s accounts was refused: ${said(accounts)}`)
        const a = (accounts.value.accounts ?? []).find((x) => x.id === account.id)
        if (a === undefined || a.test_minor !== 0 || a.live_minor !== 0 || a.balance_minor !== 0) {
          return fail(`${who}'s agent account must still hold 0 test and 0 live; it reads ${JSON.stringify(a)}`)
        }
      }

      return {
        pass: true,
        detail: "a GBP invoice of £145.00 (two lines, 20% VAT on one) issued from the agent's account and sent, with a number, a reference and a pay link; " +
          "its pay page read with no credential, test money only, offering a transfer quoting the agent's payment reference and the invoice's, naming no issuer id; " +
          "another company's agent holding £0.00 refused 409; the invoice still sent with £145.00 due and no payment, both agents' accounts still 0; " +
          'the paid path waits on payments in (B30.15)',
      }
    },
  }
}
