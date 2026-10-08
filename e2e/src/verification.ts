// B30.117 — verification levels (Lens B30.4), on Lens's API, once a run, on a workspace of its own.
//
// A new workspace asks for the identity check (L2) before the email and phone check (L1) and is refused 409 naming L1.
// It confirms its email and phone (201, level L1), then its identity (201, level L2). The Test provider checked both,
// so each check says test, carries the provider's evidence reference, and the live level stays L0: a Test pass counts
// for test money only. The record (GET …/verification) must hold exactly those two checks, passed, with the references
// the checks answered — the refused identity check left nothing. And the capabilities list must say what each level
// opens: paying outside Talyvor (payments_out) needs L2, credit to companies (b2b_credit) L3.

import { fail } from './bank.ts'
import type { Answered, VerificationCheck, WorkspaceVerification } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import type { Scenario } from './scenarios.ts'

const PATH = '/v1/workspaces/{ws}/verification'
/** What a check answers: the check, and the record after it. */
interface CheckAnswer { check: VerificationCheck; verification: WorkspaceVerification }
/** A person the Test provider passes: no TESTFAIL, TESTSANCTION, TESTRETURN or TESTPENDING in the name. */
const IDENTITY = { name: 'Nightly Verified Owner', country: 'GB', date_of_birth: '1990-04-12' }
/** The capabilities whose live money needs a level, and the level (Lens economy.Capabilities). */
export const LEVELS_NEEDED: Readonly<Record<string, string>> = { payments_out: 'L2', b2b_credit: 'L3' }

/** What is wrong with a passed check of `level`, answered or read back: undefined when nothing. */
function checkFault(c: VerificationCheck | undefined, level: string): string | undefined {
  if (c === undefined) return `there is no ${level} check`
  if (c.level !== level) return `the check is ${c.level}, not ${level}`
  if (c.status !== 'completed') return `the ${level} check is ${c.status}, not completed — the Test provider passes this name`
  if (c.test !== true) return `the ${level} check says test ${String(c.test)}: the Test provider checked it, so it counts for test money only`
  if ((c.evidence_ref ?? '') === '') return `the ${level} check carries no evidence_ref: nothing says who checked it`
  return undefined
}

export function verificationLevels(): Scenario {
  return {
    id: 'verification-levels',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    title: 'verification levels: an identity check before the email and phone check is 409 naming L1; email and phone make L1 and identity L2, ' +
      'each a Test check with its evidence reference and the live level still L0; the record holds both checks; payments_out needs L2 and b2b_credit L3',
    run: async (ctx) => {
      const { lens } = ctx.env
      const [owner] = await lens.createUsers(1)
      const post = async (kind: string, body: object, note: string): Promise<Answered<CheckAnswer>> => {
        const got = await lens.act<CheckAnswer>(owner, 'POST', `${PATH}/${kind}`, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }

      // The identity check first: refused, since it needs L1.
      const early = await post('identity', IDENTITY, 'the owner asks for the identity check before the email and phone check')
      if (early.status !== 409) {
        return fail(`an identity check (L2) before the email and phone check (L1) must be refused 409 naming L1; Lens answered ${said(early)}`)
      }
      if (early.ok || !early.error.includes('L1')) return fail(`the identity check before L1 was refused 409 without naming L1, the level it needs: ${said(early)}`)

      // Email and phone: L1.
      const contact = await post('contact', { email: `nightly-${RUN_SALT}@example.com`, phone: '+447700900123' }, 'the owner confirms an email and a phone')
      if (contact.status !== 201 || !contact.ok) return fail(`the email and phone check must answer 201; Lens answered ${said(contact)}`)
      const l1 = checkFault(contact.value.check, 'L1')
      if (l1 !== undefined) return fail(`the email and phone check: ${l1}`)
      if (contact.value.verification.level !== 'L1') return fail(`after the email and phone check the workspace is ${contact.value.verification.level}, not L1`)

      // Identity: L2, on the Test provider, so live money is still judged at L0.
      const identity = await post('identity', IDENTITY, 'the owner asks for the identity check at L1')
      if (identity.status !== 201 || !identity.ok) return fail(`the identity check at L1 must answer 201; Lens answered ${said(identity)}`)
      const l2 = checkFault(identity.value.check, 'L2')
      if (l2 !== undefined) return fail(`the identity check: ${l2}`)
      const v = identity.value.verification
      if (v.level !== 'L2') return fail(`after the identity check the workspace is ${v.level}, not L2`)
      if (v.live_level !== 'L0') return fail(`after two Test checks the live level is ${v.live_level}, not L0: a Test pass must count for test money only`)

      // The record: both checks, as they answered, and nothing from the refused one.
      const read = await lens.act<WorkspaceVerification>(owner, 'GET', PATH)
      ctx.evidence.push({ note: 'the owner reads the verification record', answer: said(read) })
      if (!read.ok) return fail(`the owner's read of the verification record was refused: ${said(read)}`)
      const checks = read.value.checks ?? []
      if (read.value.level !== 'L2' || read.value.live_level !== 'L0') return fail(`the record reads level ${read.value.level} and live level ${read.value.live_level}, not L2 and L0`)
      if (checks.length !== 2) return fail(`the record must hold exactly the two checks that passed; it holds ${checks.length}: ${checks.map((c) => `${c.level} ${c.status}`).join(', ')}`)
      for (const [level, answered] of [['L1', contact.value.check], ['L2', identity.value.check]] as const) {
        const c = checks.find((x) => x.level === level)
        const bad = checkFault(c, level)
        if (bad !== undefined) return fail(`the record: ${bad}`)
        if (c?.evidence_ref !== answered.evidence_ref) return fail(`the record's ${level} check carries ${c?.evidence_ref}; the check answered ${answered.evidence_ref}`)
      }

      // What each level opens.
      const caps = await lens.walletCapabilities(owner)
      ctx.evidence.push({ note: `Lens lists ${caps.length} capabilities: ${caps.map((c) => `${c.capability} ${c.level_needed ?? '(no level)'}`).join(', ')}` })
      for (const [key, want] of Object.entries(LEVELS_NEEDED)) {
        const c = caps.find((x) => x.capability === key)
        if (c === undefined) return fail(`${key} is not on GET /v1/wallets/capabilities`)
        if (c.level_needed !== want) return fail(`${key}'s live money needs ${want}; the capabilities list says level_needed ${c.level_needed ?? '(none)'}`)
      }

      return {
        pass: true,
        detail: `the identity check before L1 refused 409 naming L1; email and phone 201 at L1 and identity 201 at L2, each a Test check ` +
          `(${contact.value.check.evidence_ref}, ${identity.value.check.evidence_ref}) with the live level L0; the record holds both, as answered; ` +
          'payments_out needs L2 and b2b_credit L3',
      }
    },
  }
}
