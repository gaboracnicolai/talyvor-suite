// B30.97 — the Invoices screen (/money/invoices) and an invoice's public pay page (/pay/{token}), once a run, in the browser,
// on a workspace of its own.
//
// On Lens's API the owner accepts the terms of currency_accounts and payments_in, opens the company's GBP account, makes an
// agent and opens the agent's GBP account (Lens B30.13: an agent's is a sub-account of the company's). On the screen the
// owner issues an invoice from that account — two lines, one with VAT — with "Create and send": the row must read Sent with
// a pay link. A stranger (a fresh browser context, signed out) opens the link: the page must say "Preview — test money
// only" and the total due, and "Pay … by card" must open a checkout that takes the 4242 test card and come back to the
// link reading "Paid — thank you". Then Lens's own record (GET /v1/money/invoices on the owner's token, not through the
// screen) must hold the invoice paid, with one card payment of the total, and the agent's GBP account (GET /v1/money/accounts)
// must hold the total more test money than before: the posting is what makes it paid. The screen must read Paid as well.
// Screenshots of both screens at 1440 and 390.


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
const CAPABILITIES = ['currency_accounts', 'payments_in']
/** Two lines: 2 × £50.00 at 20% VAT and 1 × £7.50 at 0%: £100.00 + £20.00 + £7.50 = £127.50. */
const LINES = [
  { description: `Research, ${RUN_SALT}`, quantity: '2', unit: '50.00', vat: '20' },
  { description: 'Delivery', quantity: '1', unit: '7.50', vat: '0' },
]
const TOTAL_MINOR = 12_750
const TOTAL_TEXT = '£127.50'

interface Terms { capability: string; version: number; accepted?: { version: number } }
interface Account { id: string; agent_id?: string; currency: string; purpose: string; status: string; test_minor: number }
interface Invoice {
  id: string; number: string; status: string; pay_url?: string; total_minor: number; paid_minor: number; due_minor: number; currency: string
  payments?: { entry_id: string; method: string; amount_minor: number }[] | null
}

/** The agent's GBP account as Lens reads it back, or why it could not be read. */
async function agentAccount(ctx: ScenarioCtx, id: string, note: string): Promise<Account | string> {
  const r = await call<{ accounts: Account[] | null }>(ctx, 'GET', '/v1/money/accounts')
  ctx.evidence.push({ note, answer: said(r) })
  if (r.status !== 200 || r.value === undefined) return `GET /v1/money/accounts answered ${said(r)}`
  return (r.value.accounts ?? []).find((a) => a.id === id) ?? `GET /v1/money/accounts no longer lists ${id}`
}

export function invoicesScreen(): Scenario {
  return {
    id: 'invoices-screen',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    items: ['B30.97'],
    title: 'the Invoices screen issues and sends an invoice from an agent’s GBP account; its public pay page, opened signed out, says ' +
      '"Preview — test money only", takes the test card and reads paid; Lens records the invoice paid by one card payment of the ' +
      'total and the agent’s account holds the total more test money; the screen reads Paid',
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
      if (company.status !== 201) return fail(`opening the company’s GBP account answered ${said(company)}`)
      const made = await call<{ id: string; name: string }>(ctx, 'POST', '/v1/workspaces/{ws}/agents', { name: `Invoicing agent ${RUN_SALT}` })
      ctx.evidence.push({ note: 'the owner makes the agent that invoices', answer: said(made) })
      if (made.status !== 201 || made.value?.id === undefined) return fail(`making an agent answered ${said(made)}`)
      const agent = made.value
      const opened = await call<Account>(ctx, 'POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id })
      ctx.evidence.push({ note: `the owner opens ${agent.name}’s GBP account`, answer: said(opened) })
      if (opened.status !== 201 || opened.value?.id === undefined) return fail(`opening the agent’s GBP account answered ${said(opened)}`)
      const account = opened.value
      const before = await agentAccount(ctx, account.id, 'the agent’s GBP account before the invoice')
      if (typeof before === 'string') return fail(before)

      // The invoice, issued and sent on the screen.
      let token = ''
      let number = ''
      const page = await ctx.app.tab('/money/invoices')
      try {
        await page.locator('header h1').filter({ hasText: 'Invoices' }).waitFor({ timeout: TIMEOUT_MS })
        if (!((await page.getByTestId('invoices-preview').textContent()) ?? '').includes('Preview — test money only')) {
          return fail('the Invoices screen does not say "Preview — test money only"')
        }
        const form = page.getByTestId('new-invoice')
        await form.waitFor({ timeout: TIMEOUT_MS })
        await form.getByLabel('Paid into').selectOption(account.id)
        await form.getByLabel('Customer', { exact: true }).fill(`Nightly Customer ${RUN_SALT} Ltd`)
        await form.getByLabel('Customer’s email').fill('customer@example.com')
        await form.getByRole('button', { name: 'Add a line' }).click()
        for (const [i, l] of LINES.entries()) {
          await form.getByLabel(`Line ${i + 1}: description`).fill(l.description)
          await form.getByLabel(`Line ${i + 1}: quantity`).fill(l.quantity)
          await form.getByLabel(`Line ${i + 1}: unit price in GBP`).fill(l.unit)
          await form.getByLabel(`Line ${i + 1}: VAT %`).fill(l.vat)
        }
        const total = ((await form.getByTestId('new-invoice-total').textContent()) ?? '').trim()
        if (total !== TOTAL_TEXT) return fail(`the form totals the two lines as "${total}", not ${TOTAL_TEXT}`)
        await form.getByRole('button', { name: 'Create and send' }).click()
        const row = page.locator('[data-testid^="invoice-INV-"]').first()
        const refused = form.getByRole('alert')
        await row.or(refused).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        if (!(await row.isVisible())) return fail(`issuing the invoice on the screen: ${(await refused.allTextContents()).join(' ').trim() || 'no invoice row appeared'}`)
        const shown = ((await row.textContent()) ?? '').trim()
        ctx.evidence.push({ note: `the invoice row on the screen: ${shown.slice(0, 300)}` })
        number = (await row.getAttribute('data-testid'))?.replace('invoice-', '') ?? ''
        if (!shown.includes('Sent')) return fail(`the issued invoice ${number} reads "${shown.slice(0, 80)}", not Sent`)
        if (!shown.includes(TOTAL_TEXT)) return fail(`the issued invoice ${number} does not show its total ${TOTAL_TEXT}: "${shown.slice(0, 120)}"`)
        const link = await row.getByTestId('pay-link').inputValue()
        token = /\/pay\/([A-Za-z0-9_-]+)/.exec(link)?.[1] ?? ''
        if (token === '') return fail(`the invoice row shows no pay link of the form …/pay/<token>: "${link}"`)
        ctx.evidence.push({ note: `the Invoices screen, sent, ${await screenshots(ctx, page, 'invoices')}` })
      } finally {
        await page.close()
      }

      // A stranger opens the pay link, signed out, and pays by card.
      const browser = ctx.app.page.context().browser()
      if (browser === null) return fail('the run’s browser is gone')
      const stranger = await browser.newContext()
      try {
        const pay = await stranger.newPage()
        const appURL = new URL(ctx.app.page.url()).origin
        await pay.goto(`${appURL}/pay/${token}`)
        const headline = pay.getByTestId('pay-headline')
        await headline.waitFor({ timeout: TIMEOUT_MS })
        const preview = ((await pay.getByTestId('pay-preview').textContent().catch(() => '')) ?? '').trim()
        if (!preview.includes('Preview — test money only')) return fail(`the pay page does not say "Preview — test money only": "${preview || 'nothing'}"`)
        const due = ((await pay.getByTestId('pay-due').textContent()) ?? '').trim()
        if (due !== TOTAL_TEXT) return fail(`the pay page says ${due} is due, not ${TOTAL_TEXT}`)
        ctx.evidence.push({ note: `the pay page, signed out, before paying, ${await screenshots(ctx, pay, 'pay-page')}` })
        const card = pay.getByRole('button', { name: /^Pay .* by card$/ })
        if (!(await card.isVisible())) return fail('the pay page offers no card: Lens has no Stripe test-mode key, or the invoice is not payable')
        await card.click()
        await pay.waitForURL((u) => u.origin !== appURL, { timeout: CHECKOUT_MS })
        ctx.evidence.push({ note: `the card button opened ${new URL(pay.url()).origin}` })
        await payWithTestCard(pay, 'customer@example.com')
        await pay.waitForURL((u) => u.origin === appURL && u.pathname === `/pay/${token}`, { timeout: CHECKOUT_MS })
        ctx.evidence.push({ note: `the checkout came back to ${pay.url()}` })
        await headline.filter({ hasText: 'Paid — thank you' }).waitFor({ timeout: CHECKOUT_MS }).catch(() => undefined)
        const read = ((await headline.textContent()) ?? '').trim()
        if (read !== 'Paid — thank you') return fail(`after the card payment the pay page reads "${read}", not "Paid — thank you"`)
        ctx.evidence.push({ note: `the pay page, paid, ${await screenshots(ctx, pay, 'pay-page-paid')}` })
      } finally {
        await stranger.close().catch(() => undefined)
      }

      // Lens's own record: the invoice paid by one card payment of the total, and the posting into the agent's account.
      const list = await call<{ invoices: Invoice[] | null }>(ctx, 'GET', '/v1/money/invoices')
      ctx.evidence.push({ note: 'Lens’s record of the workspace’s invoices after the payment', answer: said(list) })
      if (list.status !== 200 || list.value === undefined) return fail(`GET /v1/money/invoices answered ${said(list)}`)
      const inv = (list.value.invoices ?? []).find((i) => i.number === number)
      if (inv === undefined) return fail(`Lens lists no invoice ${number}: it lists ${(list.value.invoices ?? []).map((i) => i.number).join(', ') || 'none'}`)
      if (inv.total_minor !== TOTAL_MINOR) return fail(`Lens records ${number}’s total as ${inv.total_minor} minor, not ${TOTAL_MINOR}`)
      const cards = (inv.payments ?? []).filter((p) => p.method === 'card')
      if (inv.status !== 'paid' || inv.paid_minor !== TOTAL_MINOR || inv.due_minor !== 0 || cards.length !== 1 || cards[0].amount_minor !== TOTAL_MINOR) {
        return fail(`the pay page read paid, but Lens records ${number} as ${inv.status}, paid ${inv.paid_minor} of ${inv.total_minor} with ` +
          `${cards.length} card payment(s) of ${cards.map((p) => p.amount_minor).join(', ') || 'nothing'}`)
      }
      const after = await agentAccount(ctx, account.id, 'the agent’s GBP account after the payment')
      if (typeof after === 'string') return fail(after)
      if (after.test_minor !== before.test_minor + TOTAL_MINOR) {
        return fail(`the invoice reads paid, but the agent’s GBP account holds ${after.test_minor} minor of test money, not ${before.test_minor + TOTAL_MINOR}: ` +
          'the card payment posted nothing into it')
      }

      // The screen reads it paid too.
      const again = await ctx.app.tab('/money/invoices')
      try {
        const row = again.getByTestId(`invoice-${number}`)
        await row.waitFor({ timeout: TIMEOUT_MS })
        const shown = ((await row.textContent()) ?? '').trim()
        if (!shown.includes('Paid')) return fail(`after the payment the Invoices screen reads ${number} as "${shown.slice(0, 80)}", not Paid`)
        ctx.evidence.push({ note: `the Invoices screen, paid, ${await screenshots(ctx, again, 'invoices-paid')}` })
      } finally {
        await again.close()
      }
      return {
        pass: true,
        detail: `${number} for ${TOTAL_TEXT} issued and sent on the screen; its pay page, signed out, said Preview — test money only, took the test ` +
          `card and read Paid — thank you; Lens records it paid by one card payment of ${TOTAL_MINOR} minor, the agent’s GBP account ` +
          `${before.test_minor} → ${after.test_minor}; the screen reads Paid`,
      }
    },
  }
}
