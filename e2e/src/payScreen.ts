// B30.96 — the Pay screen (/money/pay), once a run, in the browser, on a workspace of its own.
//
// On Lens's API the owner accepts the terms of currency_accounts, payments_in and payments_out, opens the company's GBP
// account, makes an agent and opens its GBP account, and puts test money in it the one way there is today: an invoice from
// that account, paid by card on its pay page (B30.97) — the account must hold the invoice's total more afterwards. On the
// screen the owner saves a payee (its name must read Exact match), pays it £20.00 from the agent's account (the row must
// show £20.00; Lens's record must hold the payment at 2,000 minor and the agent's account 2,000 minor less: the posting is
// what makes it paid), sets up a £10.00 weekly standing order to it (Lens's schedules must hold it as a standing order to
// that payee), grants it a mandate as an outside business (the pull key shown once; Lens's mandates must list it), and
// uploads a three-row payouts CSV — two rows to the payee, one to a payee that does not exist. The batch must read three
// rows with the unknown payee's row invalid, naming it; a valid row is paid only when the batch is approved, and the
// company's account, which bulk payouts pay from, holds nothing until money in (B30.15) lands, so the two good rows read
// invalid for want of funds and nothing moves — asserted on the account. Screenshots at 1440 and 390.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { payWithTestCard } from './screens.ts'
import { call, said } from './settings.ts'
import { screenshots } from './termsScreen.ts'

const TIMEOUT_MS = 20_000
/** Stripe's hosted checkout, or the self-test's stand-in: a page away from the app that comes back on its own. */
const CHECKOUT_MS = 90_000
const TERMS = '/v1/workspaces/{ws}/terms'
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
/** £100.00 in by card; £20.00 out; £10.00 a week. */
const FUND_MINOR = 10_000
const PAY_MINOR = 2_000
const ORDER_MINOR = 1_000

interface Terms { capability: string; version: number; accepted?: { version: number } }
interface Account { id: string; agent_id?: string; currency: string; purpose: string; status: string; test_minor: number }
interface Payment { id: string; payee_id: string; amount_minor: number; currency: string; reference: string; status: string }
interface Schedule { id: string; from_agent_id: string; to_payee_id?: string; amount_minor?: number; currency?: string; every: string; active: boolean }
interface Mandate { id: string; payee_business_id?: string; payee_id?: string; max_per_pull_minor: number; max_per_month_minor: number; status: string }
interface Row { line: number; payee_id: string; amount_minor: number; status: string; payment_id?: string; detail?: string }
interface Batch { id: string; status: string; rows?: Row[] | null; rows_total: number; rows_valid: number; rows_invalid: number }

/** An account as Lens reads it back, or why it could not be read. */
async function account(ctx: ScenarioCtx, id: string, note: string): Promise<Account | string> {
  const r = await call<{ accounts: Account[] | null }>(ctx, 'GET', '/v1/money/accounts')
  ctx.evidence.push({ note, answer: said(r) })
  if (r.status !== 200 || r.value === undefined) return `GET /v1/money/accounts answered ${said(r)}`
  return (r.value.accounts ?? []).find((a) => a.id === id) ?? `GET /v1/money/accounts no longer lists ${id}`
}

export function payScreen(): Scenario {
  return {
    id: 'pay-screen',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    items: ['B30.96'],
    title: 'the Pay screen saves a payee, pays it £20.00 from an agent’s GBP account funded by a card-paid invoice (Lens records the payment and ' +
      'the account 2,000 minor down), sets up a weekly standing order and a mandate to it, and uploads a payouts CSV whose unknown payee reads ' +
      'invalid with the reason while nothing moves from the company’s empty account',
    run: async (ctx) => {
      // The terms, the company's GBP account, an agent and its GBP account, on Lens's API.
      const terms = await call<{ terms: Terms[] | null }>(ctx, 'GET', TERMS)
      ctx.evidence.push({ note: 'the owner reads the workspace’s terms', answer: said(terms) })
      if (terms.status !== 200 || terms.value === undefined) return fail(`reading the workspace’s terms answered ${said(terms)}`)
      for (const capability of CAPABILITIES) {
        const t = (terms.value.terms ?? []).find((x) => x.capability === capability)
        if (t === undefined || t.accepted !== undefined) continue
        const accepted = await call(ctx, 'POST', `${TERMS}/${capability}/accept`, { version: t.version })
        ctx.evidence.push({ note: `the owner accepts version ${t.version} of ${capability}’s terms`, answer: said(accepted) })
        if (accepted.status !== 201) return fail(`accepting ${capability}’s terms answered ${said(accepted)}`)
      }
      const company = await call<Account>(ctx, 'POST', '/v1/money/accounts', { currency: 'GBP' })
      ctx.evidence.push({ note: 'the owner opens the company’s GBP account on test money', answer: said(company) })
      if (company.status !== 201 || company.value?.id === undefined) return fail(`opening the company’s GBP account answered ${said(company)}`)
      const made = await call<{ id: string; name: string }>(ctx, 'POST', '/v1/workspaces/{ws}/agents', { name: `Paying agent ${RUN_SALT}` })
      ctx.evidence.push({ note: 'the owner makes the agent that pays', answer: said(made) })
      if (made.status !== 201 || made.value?.id === undefined) return fail(`making an agent answered ${said(made)}`)
      const agent = made.value
      const opened = await call<Account>(ctx, 'POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id })
      ctx.evidence.push({ note: `the owner opens ${agent.name}’s GBP account`, answer: said(opened) })
      if (opened.status !== 201 || opened.value?.id === undefined) return fail(`opening the agent’s GBP account answered ${said(opened)}`)
      const acct = opened.value
      const empty = await account(ctx, acct.id, 'the agent’s GBP account before anything')
      if (typeof empty === 'string') return fail(empty)

      // Test money in: an invoice from the agent's account, paid by card on its pay page by a stranger.
      const invoice = await call<{ pay_url?: string }>(ctx, 'POST', '/v1/money/invoices', {
        account_id: acct.id, customer_name: `Funding customer ${RUN_SALT}`, lines: [{ description: 'Funding', quantity: 1, unit_amount_minor: FUND_MINOR, vat_rate_bps: 0 }],
        due_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), send: true,
      })
      ctx.evidence.push({ note: `the owner issues and sends a ${FUND_MINOR} minor invoice from the agent’s account, to fund it`, answer: said(invoice) })
      const token = /\/pay\/([A-Za-z0-9_-]+)/.exec(invoice.value?.pay_url ?? '')?.[1] ?? ''
      if (invoice.status !== 201 || token === '') return fail(`issuing the funding invoice answered ${said(invoice)}`)
      const browser = ctx.app.page.context().browser()
      if (browser === null) return fail('the run’s browser is gone')
      const stranger = await browser.newContext()
      try {
        const pay = await stranger.newPage()
        const appURL = new URL(ctx.app.page.url()).origin
        await pay.goto(`${appURL}/pay/${token}`)
        const headline = pay.getByTestId('pay-headline')
        await headline.waitFor({ timeout: TIMEOUT_MS })
        const card = pay.getByRole('button', { name: /^Pay .* by card$/ })
        if (!(await card.isVisible())) return fail('the funding invoice’s pay page offers no card: Lens has no Stripe test-mode key, or the invoice is not payable')
        await card.click()
        await pay.waitForURL((u) => u.origin !== appURL, { timeout: CHECKOUT_MS })
        await payWithTestCard(pay, 'funding@example.com')
        await pay.waitForURL((u) => u.origin === appURL && u.pathname === `/pay/${token}`, { timeout: CHECKOUT_MS })
        await headline.filter({ hasText: 'Paid — thank you' }).waitFor({ timeout: CHECKOUT_MS }).catch(() => undefined)
        const read = ((await headline.textContent()) ?? '').trim()
        if (read !== 'Paid — thank you') return fail(`after the card payment the funding invoice’s pay page reads "${read}", not "Paid — thank you"`)
      } finally {
        await stranger.close().catch(() => undefined)
      }
      const funded = await account(ctx, acct.id, 'the agent’s GBP account after the card payment')
      if (typeof funded === 'string') return fail(funded)
      if (funded.test_minor !== empty.test_minor + FUND_MINOR) {
        return fail(`the funding invoice read paid, but the agent’s GBP account holds ${funded.test_minor} minor of test money, not ${empty.test_minor + FUND_MINOR}`)
      }

      // The screen: a payee, a payment, a standing order, a mandate and a payouts file.
      let payeeID = ''
      let batchID = ''
      let rowsValid = 0
      const reference = `Nightly ${RUN_SALT}`
      const page = await ctx.app.tab('/money/pay')
      try {
        await page.locator('header h1').filter({ hasText: 'Pay' }).waitFor({ timeout: TIMEOUT_MS })
        if (!((await page.getByTestId('pay-preview').textContent()) ?? '').includes('Preview — test money only')) {
          return fail('the Pay screen does not say "Preview — test money only"')
        }
        const refusalOf = async (form: ReturnType<typeof page.getByTestId>) => (await form.getByRole('alert').allTextContents()).join(' ').trim()

        const payeeForm = page.getByTestId('new-payee')
        await payeeForm.waitFor({ timeout: TIMEOUT_MS })
        await payeeForm.getByLabel('Payee’s name').fill(`Nightly Pay Payee ${RUN_SALT} Ltd`)
        await payeeForm.getByLabel('Sort code').fill('040004')
        await payeeForm.getByLabel('Account number').fill('12345678')
        await payeeForm.getByRole('button', { name: 'Save payee' }).click()
        const payeeRow = page.locator('[data-testid^="payee-"]').first()
        await payeeRow.or(payeeForm.getByRole('alert')).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        if (!(await payeeRow.isVisible())) return fail(`saving the payee on the screen: ${(await refusalOf(payeeForm)) || 'no payee row appeared'}`)
        payeeID = (await payeeRow.getAttribute('data-testid'))?.replace('payee-', '') ?? ''
        const payeeShown = ((await payeeRow.textContent()) ?? '').trim()
        ctx.evidence.push({ note: `the payee row on the screen: ${payeeShown.slice(0, 200)}` })
        if (!payeeShown.includes('Exact match')) return fail(`the saved payee reads "${payeeShown.slice(0, 120)}", not Exact match`)

        const send = page.getByTestId('send-payment')
        await send.getByLabel('From', { exact: true }).selectOption(acct.id)
        await send.getByLabel('To', { exact: true }).selectOption(payeeID)
        await send.getByLabel('Amount in GBP').fill('20.00')
        await send.getByLabel('Reference').fill(reference)
        await send.getByRole('button', { name: 'Send' }).click()
        const paymentRow = page.locator('[data-testid^="payment-"]').first()
        await paymentRow.or(send.getByRole('alert')).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        if (!(await paymentRow.isVisible())) return fail(`sending £20.00 on the screen: ${(await refusalOf(send)) || 'no payment row appeared'}`)
        const paymentShown = ((await paymentRow.textContent()) ?? '').trim()
        ctx.evidence.push({ note: `the payment row on the screen: ${paymentShown.slice(0, 200)}` })
        if (!paymentShown.includes('£20.00')) return fail(`the payment row reads "${paymentShown.slice(0, 120)}", not £20.00`)

        const order = page.getByTestId('new-standing-order')
        await order.getByLabel('Standing order from').selectOption(acct.id)
        await order.getByLabel('Standing order to').selectOption(payeeID)
        await order.getByLabel('Standing order amount').fill('10.00')
        await order.getByLabel('Every').selectOption('week')
        await order.getByRole('button', { name: 'Set up standing order' }).click()
        const orderRow = page.locator('[data-testid^="standing-order-"]').first()
        await orderRow.or(order.getByRole('alert')).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        if (!(await orderRow.isVisible())) return fail(`setting up the standing order on the screen: ${(await refusalOf(order)) || 'no standing order row appeared'}`)
        ctx.evidence.push({ note: `the standing order row on the screen: ${((await orderRow.textContent()) ?? '').trim().slice(0, 200)}` })

        const mandate = page.getByTestId('new-mandate')
        await mandate.getByLabel('Mandate on').selectOption(acct.id)
        await mandate.getByLabel('Business id').fill(`nightly-business-${RUN_SALT}`)
        await mandate.getByLabel('Paid out to').selectOption(payeeID)
        await mandate.getByLabel('Most per pull').fill('5.00')
        await mandate.getByLabel('Most per month').fill('20.00')
        await mandate.getByRole('button', { name: 'Grant mandate' }).click()
        const mandateRow = page.locator('[data-testid^="mandate-"]').filter({ hasNot: page.getByTestId('mandate-pull-key') }).first()
        await mandateRow.or(mandate.getByRole('alert')).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        if (!(await mandateRow.isVisible())) return fail(`granting the mandate on the screen: ${(await refusalOf(mandate)) || 'no mandate row appeared'}`)
        const pullKey = ((await page.getByTestId('mandate-pull-key').textContent().catch(() => '')) ?? '').trim()
        if (pullKey === '') return fail('the granted mandate shows no pull key for the outside business')
        ctx.evidence.push({ note: `the mandate row on the screen: ${((await mandateRow.textContent()) ?? '').trim().slice(0, 200)}; a pull key of ${pullKey.length} characters shown once` })

        const upload = page.getByTestId('payout-upload')
        const csv = `payee_id,amount,currency,reference\n${payeeID},5.00,GBP,${reference} A\n${payeeID},6.00,GBP,${reference} B\nnobody-${RUN_SALT},1.00,GBP,${reference} C\n`
        await upload.getByLabel('Payouts CSV').setInputFiles({ name: 'payouts.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
        await upload.getByRole('button', { name: 'Upload and check' }).click()
        const batch = page.locator('[data-testid^="payout-mpob"]').first()
        await batch.or(upload.getByRole('alert')).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        if (!(await batch.isVisible())) return fail(`uploading the payouts CSV on the screen: ${(await refusalOf(upload)) || 'no batch appeared'}`)
        batchID = (await batch.getAttribute('data-testid'))?.replace('payout-', '') ?? ''
        const batchShown = ((await batch.textContent()) ?? '').trim()
        ctx.evidence.push({ note: `the batch on the screen: ${batchShown.slice(0, 300)}` })
        if (!batchShown.includes('3 rows')) return fail(`the batch reads "${batchShown.slice(0, 120)}", not 3 rows`)
        const unknown = ((await batch.getByTestId('payout-row-4').textContent()) ?? '').trim()
        if (!unknown.includes('invalid') || !/payee/i.test(unknown)) return fail(`the unknown payee’s row reads "${unknown}": not invalid naming the payee`)
        rowsValid = Number(/(\d+) valid/.exec(batchShown)?.[1] ?? '0')
        if (rowsValid > 0) {
          await batch.getByRole('button', { name: /^Approve and pay/ }).click()
          await batch.filter({ hasText: 'Approved' }).waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
          ctx.evidence.push({ note: `the batch after approval: ${((await batch.textContent()) ?? '').trim().slice(0, 300)}` })
        }
        ctx.evidence.push({ note: `the Pay screen, ${await screenshots(ctx, page, 'pay')}` })
      } finally {
        await page.close()
      }

      // Lens's own record: the payment and its posting, the standing order, the mandate, the batch and what it moved.
      const payments = await call<{ payments: Payment[] | null }>(ctx, 'GET', '/v1/money/payments')
      ctx.evidence.push({ note: 'Lens’s record of the payments out', answer: said(payments) })
      if (payments.status !== 200 || payments.value === undefined) return fail(`GET /v1/money/payments answered ${said(payments)}`)
      const p = (payments.value.payments ?? []).find((x) => x.reference === reference)
      if (p === undefined) return fail(`Lens lists no payment out referenced "${reference}"`)
      if (p.payee_id !== payeeID || p.amount_minor !== PAY_MINOR || p.currency !== 'GBP' || !['pending', 'sent', 'completed'].includes(p.status)) {
        return fail(`Lens records the payment as ${p.amount_minor} ${p.currency} to ${p.payee_id}, ${p.status}: not ${PAY_MINOR} GBP to ${payeeID}, on its way or completed`)
      }
      const afterPay = await account(ctx, acct.id, 'the agent’s GBP account after the payment')
      if (typeof afterPay === 'string') return fail(afterPay)
      if (afterPay.test_minor !== funded.test_minor - PAY_MINOR) {
        return fail(`the screen showed the payment, but the agent’s GBP account holds ${afterPay.test_minor} minor, not ${funded.test_minor - PAY_MINOR}: the payment posted nothing`)
      }
      const schedules = await call<{ schedules: Schedule[] | null }>(ctx, 'GET', '/v1/workspaces/{ws}/agents/schedules')
      ctx.evidence.push({ note: 'Lens’s record of the agents’ schedules', answer: said(schedules) })
      const order = (schedules.value?.schedules ?? []).find((s) => s.from_agent_id === agent.id && s.to_payee_id === payeeID)
      if (schedules.status !== 200 || order === undefined) return fail(`Lens lists no standing order from ${agent.id} to ${payeeID}: ${said(schedules)}`)
      if (order.amount_minor !== ORDER_MINOR || order.currency !== 'GBP' || order.every !== 'week' || !order.active) {
        return fail(`Lens records the standing order as ${order.amount_minor} ${order.currency} every ${order.every}, active ${order.active}: not ${ORDER_MINOR} GBP a week, active`)
      }
      const mandates = await call<{ granted: Mandate[] | null }>(ctx, 'GET', '/v1/money/mandates')
      ctx.evidence.push({ note: 'Lens’s record of the mandates granted', answer: said(mandates) })
      const m = (mandates.value?.granted ?? []).find((x) => x.payee_id === payeeID)
      if (mandates.status !== 200 || m === undefined) return fail(`Lens lists no mandate paid out to ${payeeID}: ${said(mandates)}`)
      if (m.max_per_pull_minor !== 500 || m.max_per_month_minor !== 2000 || m.status !== 'active') {
        return fail(`Lens records the mandate at ${m.max_per_pull_minor} a pull, ${m.max_per_month_minor} a month, ${m.status}: not 500, 2000, active`)
      }
      const read = await call<Batch>(ctx, 'GET', `/v1/money/payouts/${batchID}`)
      ctx.evidence.push({ note: 'Lens’s record of the payout batch', answer: said(read) })
      if (read.status !== 200 || read.value === undefined) return fail(`GET /v1/money/payouts/${batchID} answered ${said(read)}`)
      const b = read.value
      const rows = b.rows ?? []
      const bad = rows.find((r) => r.line === 4)
      if (b.rows_total !== 3 || bad === undefined || bad.status !== 'invalid' || !/payee/i.test(bad.detail ?? '')) {
        return fail(`Lens records the batch as ${b.rows_total} rows with line 4 ${bad?.status ?? 'missing'} (${bad?.detail ?? 'no reason'}): not 3 rows with the unknown payee invalid`)
      }
      const companyAfter = await account(ctx, company.value.id, 'the company’s GBP account after the batch')
      if (typeof companyAfter === 'string') return fail(companyAfter)
      if (rowsValid === 0) {
        // The company's account holds nothing until money in (B30.15), so the two good rows are invalid for want of funds and nothing is paid.
        if (b.status !== 'awaiting_approval' || b.rows_valid !== 0 || rows.some((r) => r.payment_id !== undefined) || companyAfter.test_minor !== 0) {
          return fail(`with nothing in the company’s account the batch reads ${b.status}, ${b.rows_valid} valid, ${rows.filter((r) => r.payment_id).length} paid, the account at ${companyAfter.test_minor}: something moved`)
        }
      } else {
        const paid = rows.filter((r) => r.payment_id !== undefined)
        if (b.status !== 'approved' || paid.length !== rowsValid || paid.some((r) => !['pending', 'sent', 'completed'].includes(r.status))) {
          return fail(`after approval the batch reads ${b.status} with ${paid.length} of ${rowsValid} valid rows paid (${paid.map((r) => r.status).join(', ')})`)
        }
      }
      return {
        pass: true,
        detail: `payee ${payeeID} saved (exact match); £20.00 paid on the screen, Lens records it ${p.status} at ${PAY_MINOR} minor and the agent’s account ` +
          `${funded.test_minor} → ${afterPay.test_minor}; a £10.00 weekly standing order and a mandate (500 a pull, 2000 a month) recorded; the payouts CSV ` +
          `read 3 rows, line 4 invalid (${bad.detail}), ${rowsValid} valid, ${rowsValid === 0 ? 'nothing moved from the empty company account' : 'paid on approval'}`,
      }
    },
  }
}
