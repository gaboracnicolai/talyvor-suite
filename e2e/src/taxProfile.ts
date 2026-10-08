// B32.92 — a buyer's tax profile (Lens B32.38), on Lens's API, once a run, on a workspace of its own.
//
// A new workspace — it has never paid, so it has no Stripe customer — reads its tax profile before saving one: there is
// none, and it resolves nowhere (decided_by unknown). It declares a German business with a VAT number the Test tax
// partner finds valid (DE123456789): the profile keeps the number, valid, with when it was checked, and the workspace
// resolves to a DE business on its declaration. It declares again with DE999999999, a well-formed number on the Test tax
// partner's list of numbers never issued: the number is kept, invalid, with why, and the workspace stays a consumer. A
// country written out ("Germany") is refused 400, and the workspace's agent key is refused 403 reading the profile and
// writing it.
//
// Lens's read of the profile is the oracle: after each save GET …/tax-profile must return the stored number and its
// check as the save answered them, and after the refusals it must still be the never-issued number, invalid, a consumer
// — both refused writes carry the valid number, so one that stored anything would make the workspace a business there.

import { fail } from './bank.ts'
import type { SyntheticUser, TaxProfileAnswer } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

const PATH = '/v1/workspaces/{ws}/tax-profile'
/** A German business; each save gives its VAT number. */
const DECLARED = { legal_name: 'Nightly Steuer GmbH', address: 'Teststraße 2, Berlin', country: 'DE', postal_code: '10115' }
/** Well formed and not on the Test tax partner's list of numbers never issued: valid. */
const VALID = 'DE123456789'
/** Well formed and on that list (talyvor-lens internal/partners/testdata/tax/invalid_tax_ids.txt): never issued. */
const NEVER_ISSUED = 'DE999999999'

/** The stored number and its check, as one string two answers can be compared on. */
const checkOf = (a: TaxProfileAnswer): string =>
  JSON.stringify({ tax_id: a.profile?.tax_id, tax_id_valid: a.profile?.tax_id_valid, tax_id_checked_at: a.profile?.tax_id_checked_at, tax_id_detail: a.profile?.tax_id_detail ?? '' })

/**
 * What is wrong with a profile answer after `taxID` was saved, `valid` or not as the Test tax partner finds it: undefined
 * when nothing. The number is kept either way, with when it was checked; an invalid one says why and makes no business.
 */
export function profileFault(a: TaxProfileAnswer, taxID: string, valid: boolean): string | undefined {
  const p = a.profile
  if (p === null) return 'it holds no profile'
  if (p.country !== 'DE') return `its profile's country is ${JSON.stringify(p.country)}, not DE`
  if (p.tax_id !== taxID) return `its profile holds tax id ${p.tax_id ?? '(none)'}, not ${taxID}`
  if (p.tax_id_valid !== valid) return `${taxID} is marked ${p.tax_id_valid ? 'valid' : 'invalid'}; the Test tax partner finds it ${valid ? 'valid' : 'never issued'}`
  if (Number.isNaN(Date.parse(p.tax_id_checked_at ?? ''))) return `${taxID} carries no tax_id_checked_at (${JSON.stringify(p.tax_id_checked_at)}): nothing says it was checked`
  if (!valid && (p.tax_id_detail ?? '') === '') return `${taxID} is marked invalid with no tax_id_detail saying why`
  const r = a.resolved
  if (r === null) return `it resolves to nothing: ${a.resolve_error ?? '(no resolve_error)'}`
  if (r.country !== 'DE' || r.business !== valid || r.decided_by !== 'declared') {
    return `it resolves to ${JSON.stringify(r)}: declared DE with ${valid ? 'a valid' : 'a never-issued'} VAT number, it is a DE ${valid ? 'business' : 'consumer'}, decided_by declared`
  }
  return undefined
}

export function buyerTaxProfile(): Scenario {
  return {
    id: 'buyer-tax-profile',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "a buyer's tax profile: none before it is saved, resolving nowhere; a German VAT number the tax partner finds valid is kept with its check " +
      'and makes a DE business, one never issued is kept invalid with why and leaves a consumer, each read back as saved; a country written out is ' +
      '400 and the agent key is 403, the profile unchanged',
    run: async (ctx) => {
      const { lens } = ctx.env
      const [buyer] = await lens.createUsers(1)
      const read = async (note: string) => {
        const got = await lens.act<TaxProfileAnswer>(buyer, 'GET', PATH)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      const save = async (taxID: string) => {
        const put = await lens.act<TaxProfileAnswer>(buyer, 'PUT', PATH, { ...DECLARED, tax_id: taxID })
        ctx.evidence.push({ note: `the owner declares a DE business with ${taxID}`, answer: said(put) })
        return put
      }

      // Before anything is saved: no profile, and no evidence of where the buyer is.
      const before = await read('the profile before anything is saved')
      if (!before.ok) return fail(`the owner's read of the tax profile before saving one was refused: ${said(before)}`)
      if (before.value.profile !== null) return fail(`a new workspace's tax profile should be null before one is saved; it is ${JSON.stringify(before.value.profile)}`)
      if (before.value.resolved?.decided_by !== 'unknown' || before.value.resolved.country !== '') {
        return fail(`a new workspace with no profile and no Stripe customer should resolve nowhere (decided_by unknown); it resolves to ${JSON.stringify(before.value.resolved)} ${before.value.resolve_error ?? ''}`.trim())
      }

      // Each number saved is checked, kept, and read back as it was saved.
      const declare = async (taxID: string, valid: boolean): Promise<TaxProfileAnswer | string> => {
        const put = await save(taxID)
        if (!put.ok) return `declaring a DE business with ${taxID} was refused: ${said(put)}`
        const saved = profileFault(put.value, taxID, valid)
        if (saved !== undefined) return `saving ${taxID}: ${saved}`
        const back = await read(`the profile read back after ${taxID}`)
        if (!back.ok) return `the owner's read of the tax profile after saving ${taxID} was refused: ${said(back)}`
        const got = profileFault(back.value, taxID, valid)
        if (got !== undefined) return `the read after saving ${taxID}: ${got}`
        if (checkOf(back.value) !== checkOf(put.value)) return `the read after saving ${taxID} returns ${checkOf(back.value)}; the save answered ${checkOf(put.value)}`
        return back.value
      }
      const business = await declare(VALID, true)
      if (typeof business === 'string') return fail(business)
      const consumer = await declare(NEVER_ISSUED, false)
      if (typeof consumer === 'string') return fail(consumer)

      // Refused: a country that is no ISO code, and the workspace's agent key. Both carry the valid number.
      const germany = await lens.act<TaxProfileAnswer>(buyer, 'PUT', PATH, { ...DECLARED, country: 'Germany', tax_id: VALID })
      ctx.evidence.push({ note: 'the owner declares the country as "Germany"', answer: said(germany) })
      if (germany.status !== 400) return fail(`a country of "Germany" must be refused 400 (it is two letters, DE); Lens answered ${said(germany)}`)
      const agent = await agentKey(ctx, buyer)
      if (typeof agent !== 'object') return fail(agent)
      const path = PATH.replace('{ws}', buyer.workspaceID)
      const agentRead = await lens.as(agent.key, 'GET', path)
      ctx.evidence.push({ note: "the workspace's agent key reads the profile", answer: `${agentRead.status} ${agentRead.text.slice(0, 300)}` })
      if (agentRead.status !== 403) return fail(`the workspace's agent key must be refused 403 reading its tax profile (its legal name and address); Lens answered ${agentRead.status} ${agentRead.text.slice(0, 200)}`)
      const agentWrite = await lens.as(agent.key, 'PUT', path, { ...DECLARED, tax_id: VALID })
      ctx.evidence.push({ note: `the workspace's agent key declares ${VALID}`, answer: `${agentWrite.status} ${agentWrite.text.slice(0, 300)}` })
      if (agentWrite.status !== 403) return fail(`the workspace's agent key must be refused 403 writing its tax profile; Lens answered ${agentWrite.status} ${agentWrite.text.slice(0, 200)}`)

      const after = await read('the profile after the refused writes')
      if (!after.ok) return fail(`the owner's read of the tax profile after the refused writes was refused: ${said(after)}`)
      const kept = profileFault(after.value, NEVER_ISSUED, false)
      if (kept !== undefined || checkOf(after.value) !== checkOf(consumer)) {
        return fail(`a refused write stored something: after "Germany" (400) and the agent key (403), each with ${VALID}, the profile should still be ${checkOf(consumer)}, a consumer; ${kept ?? `it is ${checkOf(after.value)}`}`)
      }

      return {
        pass: true,
        detail: `before saving, no profile and resolved unknown; ${VALID} checked valid at ${business.profile?.tax_id_checked_at}: a DE business, decided_by declared, read back as saved; ` +
          `${NEVER_ISSUED} checked at ${consumer.profile?.tax_id_checked_at}, invalid ("${consumer.profile?.tax_id_detail}"): a DE consumer, read back as saved; ` +
          `"Germany" refused 400 and the agent key 403 reading and writing, the profile unchanged`,
      }
    },
  }
}

/** A key for an agent made for the purpose in `who`'s workspace, or what went wrong. */
async function agentKey(ctx: ScenarioCtx, who: SyntheticUser): Promise<{ key: string } | string> {
  const { lens } = ctx.env
  const agent = await lens.createAgent(who, `Tax profile reader ${RUN_SALT}`)
  const k = await lens.act<{ key: string }>(who, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'buyer-tax-profile' })
  return k.ok ? { key: k.value.key } : `issuing ${agent.name} a key was refused: ${said(k)}`
}
