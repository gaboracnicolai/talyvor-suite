// B30.109 — compliance (Lens B30.6, B30.17), on Lens's API, once a run, on a workspace of its own: a payment to a sanctioned
// name is blocked and opens a case, a payment to a name under review is held on its case, live money is refused while its
// capability is uncleared — and none of it posts.
//
// The owner accepts currency_accounts' terms and opens a GBP account on test money. Saving a TESTSANCTION payee is refused 403
// by screening, and the refusal names the compliance case the hit opened; a TESTPENDING payee is saved but held for review on a
// case of its own, and a payment to it is refused 403 naming that case. A live payment to a clean payee is refused naming live
// money, and a live EUR account is refused 403 naming currency_accounts' class, which takes test money only until Talyvor records
// a clearance. Then the GBP account must still hold 0 test and 0 live, no EUR account may exist and no payment row may have
// been made. With the operator read key, both cases are read on GET /v1/admin/screening: blocked and held, on this workspace.

import { fail } from './bank.ts'
import type { Answered, WorkspaceTerms } from './lens.ts'
import { said } from './routes.ts'
import type { Scenario } from './scenarios.ts'

/** A currency account as Lens answers it (economy.CurrencyAccount). */
interface Account { id: string; currency: string; purpose: string; balance_minor: number; test_minor: number; live_minor: number }
/** A saved payee (economy.OutsidePayee): `screening` is set when the name waits for an operator. */
interface Payee { id: string; name: string; check: string; screening?: string }
/** A compliance case as the operator reads it (screening.Case). */
interface Case { id: string; workspace_id: string; subject_kind: string; name: string; status: string }

const TERMS = '/v1/workspaces/{ws}/terms'
const SANCTIONED = { name: 'Nightly TESTSANCTION Counterparty Ltd', country: 'GB', sort_code: '040004', account_number: '11223344' }
const UNDER_REVIEW = { name: 'Nightly TESTPENDING Counterparty Ltd', country: 'GB', sort_code: '040004', account_number: '22334455' }
const CLEAN = { name: 'Nightly Clean Counterparty Ltd', country: 'GB', sort_code: '040004', account_number: '33445566' }
/** A screening refusal ends with the case it rests on: "… (compliance case cc_…)". */
const CASE = /\(compliance case ([^\s)]+)\)/

export function compliance(): Scenario {
  return {
    id: 'compliance',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    items: ['B30.6', 'B30.17'],
    title: 'compliance: a TESTSANCTION payee is refused 403 on a blocked compliance case; a TESTPENDING payee is held on its case and a payment to it ' +
      'refused 403 naming it; a live payment and a live account are refused, the account naming its class; nothing posts',
    run: async (ctx) => {
      const { lens, operatorReadKey } = ctx.env
      const [owner] = await lens.createUsers(1)
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(owner, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      const caseOf = (text: string): string | undefined => CASE.exec(text)?.[1]

      // The account's terms, then a GBP account on test money.
      const terms = await call<{ terms: WorkspaceTerms[] | null }>('GET', TERMS, undefined, 'the owner reads the workspace\'s terms')
      if (!terms.ok) return fail(`reading the workspace's terms was refused: ${said(terms)}`)
      const accountTerms = (terms.value.terms ?? []).find((t) => t.capability === 'currency_accounts')
      if (accountTerms !== undefined && accountTerms.accepted == null) {
        const accepted = await call('POST', `${TERMS}/currency_accounts/accept`, { version: accountTerms.version }, `the owner accepts version ${accountTerms.version} of currency_accounts' terms`)
        if (accepted.status !== 201) return fail(`accepting currency_accounts' terms must answer 201; Lens answered ${said(accepted)}`)
      }
      const opened = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the owner opens a GBP account on test money')
      if (opened.status !== 201 || !opened.ok) return fail(`opening a GBP account on test money must answer 201; Lens answered ${said(opened)}`)
      const account = opened.value

      // A sanctioned name: refused, on a blocked case.
      const sanctioned = await call<Payee>('POST', '/v1/money/payees', SANCTIONED, 'the owner saves a TESTSANCTION payee')
      if (sanctioned.status !== 403 || sanctioned.ok) return fail(`a payee on a sanctions list must be refused 403; Lens answered ${said(sanctioned)}`)
      if (!/sanctions list/.test(sanctioned.error)) return fail(`the refusal must say the name is on a sanctions list; Lens said ${JSON.stringify(sanctioned.error)}`)
      const blockedCase = caseOf(sanctioned.error)
      if (blockedCase === undefined) return fail(`a blocked payment opens a compliance case and the refusal names it; Lens said ${JSON.stringify(sanctioned.error)}`)

      // A name under review: saved and held, and a payment to it refused on the same case.
      const reviewed = await call<Payee>('POST', '/v1/money/payees', UNDER_REVIEW, 'the owner saves a TESTPENDING payee')
      if (reviewed.status !== 201 || !reviewed.ok) return fail(`a payee close to a listed name is saved and held; Lens answered ${said(reviewed)}`)
      const heldCase = caseOf(reviewed.value.screening ?? '')
      if (!/held/.test(reviewed.value.screening ?? '') || heldCase === undefined) {
        return fail(`a TESTPENDING payee is saved with screening held, naming its compliance case; Lens saved screening ${JSON.stringify(reviewed.value.screening ?? '')}`)
      }
      const toHeld = await call('POST', '/v1/money/payments', { payee_id: reviewed.value.id, amount_minor: 1000, currency: 'GBP', reference: 'Nightly compliance held',
        idempotency_key: `nightly-compliance-held-${owner.workspaceID}` }, 'the owner pays the TESTPENDING payee £10.00 of test money')
      if (toHeld.status !== 403 || toHeld.ok) return fail(`a payment to a name held for review must be refused 403; Lens answered ${said(toHeld)}`)
      if (!/held/.test(toHeld.error) || caseOf(toHeld.error) !== heldCase) {
        return fail(`the refusal must say the payment is held on compliance case ${heldCase}; Lens said ${JSON.stringify(toHeld.error)}`)
      }

      // Live money, while payments_out and currency_accounts are uncleared: a live payment, then a live account.
      const clean = await call<Payee>('POST', '/v1/money/payees', CLEAN, 'the owner saves a clean payee')
      if (clean.status !== 201 || !clean.ok) return fail(`saving a clean payee must answer 201; Lens answered ${said(clean)}`)
      const live = await call('POST', '/v1/money/payments', { payee_id: clean.value.id, amount_minor: 1000, currency: 'GBP', funding: 'live', reference: 'Nightly compliance live',
        idempotency_key: `nightly-compliance-live-${owner.workspaceID}` }, 'the owner pays the clean payee £10.00 of live money')
      if (live.ok || (live.status !== 403 && live.status !== 409)) return fail(`a live payment on an uncleared capability must be refused 403 or 409; Lens answered ${said(live)}`)
      if (!/live/.test(live.error)) return fail(`the refusal must name live money; Lens said ${JSON.stringify(live.error)}`)
      const liveAccount = await call('POST', '/v1/money/accounts', { currency: 'EUR', funding: 'live' }, 'the owner opens a EUR account on live money')
      if (liveAccount.ok || liveAccount.status !== 403) return fail(`a live account on an uncleared capability must be refused 403; Lens answered ${said(liveAccount)}`)
      if (!/class (RED|AMBER)/.test(liveAccount.error) || !/test money only/.test(liveAccount.error)) {
        return fail(`the refusal must name the capability's class and that it takes test money only; Lens said ${JSON.stringify(liveAccount.error)}`)
      }

      // Nothing posted: the GBP account as it opened, no EUR account, no payment row.
      const accounts = await call<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, 'the owner lists the accounts')
      if (!accounts.ok) return fail(`listing the accounts was refused: ${said(accounts)}`)
      const list = accounts.value.accounts ?? []
      const gbp = list.find((a) => a.id === account.id)
      if (gbp === undefined || gbp.test_minor !== 0 || gbp.live_minor !== 0 || gbp.balance_minor !== 0) {
        return fail(`the GBP account must still hold 0 test and 0 live after four refusals; it reads ${JSON.stringify(gbp)}`)
      }
      if (list.some((a) => a.currency === 'EUR')) return fail('the refused live EUR account is on the list: a refused account must not be opened')
      const payments = await call<{ payments: unknown[] | null }>('GET', '/v1/money/payments', undefined, 'the owner lists the payments out')
      if (!payments.ok) return fail(`listing the payments was refused: ${said(payments)}`)
      if ((payments.value.payments ?? []).length !== 0) return fail(`a refused payment makes no payment row; Lens lists ${JSON.stringify(payments.value.payments).slice(0, 300)}`)

      // The operator's view, when the run holds the operator read key.
      let seen = "; the operator's view not read: no LENS_OPERATOR_READ_KEY"
      if (operatorReadKey !== '') {
        for (const [id, status, word] of [[blockedCase, 'blocked', 'TESTSANCTION'], [heldCase, 'held', 'TESTPENDING']] as const) {
          const res = await lens.as(operatorReadKey, 'GET', `/v1/admin/screening?status=${status}`)
          ctx.evidence.push({ note: `the operator read key asks the ${status} cases`, answer: `${res.status} ${res.text.slice(0, 400)}` })
          if (res.status !== 200) return fail(`GET /v1/admin/screening?status=${status} on the operator read key answered ${res.status}: ${res.text.slice(0, 200)}`)
          const c = ((JSON.parse(res.text) as { cases: Case[] | null }).cases ?? []).find((x) => x.id === id)
          if (c === undefined) return fail(`compliance case ${id}, which the ${word} refusal named, is not among the operator's ${status} cases`)
          if (c.workspace_id !== owner.workspaceID || c.status !== status || c.subject_kind !== 'payee' || !c.name.includes(word)) {
            return fail(`case ${id} must be a ${status} payee case on ${owner.workspaceID} naming ${word}; it reads ${JSON.stringify(c)}`)
          }
        }
        seen = "; both cases on the operator's screening view, blocked and held"
      }

      return {
        pass: true,
        detail: 'a TESTSANCTION payee refused 403 by screening on a blocked compliance case; a TESTPENDING payee saved and held on its case, and a £10.00 ' +
          'payment to it refused 403 naming that case; a live £10.00 payment refused naming live money and a live EUR account refused 403 naming its class, ' +
          'test money only; the GBP account still 0 test and 0 live, no EUR account and no payment row' + seen,
      }
    },
  }
}
