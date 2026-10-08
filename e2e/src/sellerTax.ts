// B32.95 — a seller's tax details (Lens B32.41), on Lens's API, once a run, on a workspace of its own.
//
// A new workspace reads its seller tax details before giving any: incomplete, seller_type first among what is missing,
// no reminder sent and no payout hold. It saves an individual's details in full — a GB TIN, a date of birth and an IBAN
// — and the answer, and the read after it, are complete with the TIN and the account masked to their last four
// characters and the date of birth masked whole. It saves again with a new address, country DE and a VAT number on the
// Test tax partner's list of numbers never issued (DE999999999), giving the form's other fields again (a save replaces
// them) and leaving out the TINs, the date of birth and the account: those three are kept, still masked, and the details
// are incomplete again with only vat_number missing.
//
// No answer the scenario reads may carry the TIN, the date of birth or the IBAN as they were given. A Lens without
// LENS_PROVIDER_SECRET_KEK stores none of them (503): that is reported, not passed.

import { fail } from './bank.ts'
import type { SellerTax } from './lens.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

const PATH = '/v1/workspaces/{ws}/marketplace/seller-tax'
const TIN = '1234567890'
const BORN = '1985-04-12'
const IBAN = 'GB33BUKB20201555555555'
/** What the three sealed values read back as. */
const MASKED = { tins: [{ jurisdiction: 'GB', number: '••••7890' }], date_of_birth: '••••-••-••', account_identifier: '••••5555' }
/** The fields a save replaces: each save gives them again. */
const FORM = { seller_type: 'individual', first_name: 'Nightly', last_name: 'Seller', account_holder: 'Nightly Seller' }
const FULL = { ...FORM, address: '2 Test Street, London', country: 'GB', tins: [{ jurisdiction: 'GB', number: TIN }], date_of_birth: BORN, account_identifier: IBAN }
/** Well formed and on the Test tax partner's list of numbers never issued (talyvor-lens internal/partners/testdata/tax). */
const NEVER_ISSUED = 'DE999999999'
const MOVED = { ...FORM, address: 'Teststraße 2, Berlin', country: 'DE', vat_number: NEVER_ISSUED }

/** Lens sellertax.Details, as much of it as this scenario reads. */
export interface SellerTaxDetails extends SellerTax {
  address: string
  country: string
  date_of_birth: string
  account_identifier: string
  vat_number: string
  vat_valid: boolean
  vat_detail?: string
}

/** One call on the seller's details, its answer kept as evidence: the details, or what is wrong with the answer. */
type Call = (note: string, method: string, body?: object) => Promise<SellerTaxDetails | string>

/** The sealed values, as they were given, that `text` carries: none, on a Lens that masks them. */
export function leaked(text: string): string[] {
  return [['the TIN', TIN], ['the date of birth', BORN], ['the IBAN', IBAN]].filter(([, v]) => text.includes(v)).map(([what, v]) => `${what} ${v}`)
}

/** The sealed values as `d` shows them, as one string to compare with what they should read as. */
const sealedOf = (d: SellerTaxDetails): string => JSON.stringify({ tins: d.tins, date_of_birth: d.date_of_birth, account_identifier: d.account_identifier })

/**
 * What is wrong with details read after a save: undefined when nothing. The three sealed values read back masked, and
 * the details are complete, or missing exactly `missing`.
 */
export function detailsFault(d: SellerTaxDetails, address: string, missing: string[]): string | undefined {
  if (sealedOf(d) !== JSON.stringify(MASKED)) return `the TIN, date of birth and account read ${sealedOf(d)}; given once, they should read ${JSON.stringify(MASKED)}`
  if (d.address !== address) return `the address reads ${JSON.stringify(d.address)}, not the ${JSON.stringify(address)} saved`
  if (JSON.stringify(d.missing ?? []) !== JSON.stringify(missing) || d.complete !== (missing.length === 0)) {
    return `they read complete ${d.complete}, missing ${JSON.stringify(d.missing)}; they should be ${missing.length === 0 ? 'complete, nothing missing' : `incomplete, missing ${JSON.stringify(missing)}`}`
  }
  return undefined
}

export function sellerTaxDetails(): Scenario {
  return {
    id: 'seller-tax-details',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "a seller's tax details: incomplete before any are given; saved in full they are complete with the TIN and account masked to their last " +
      'four and the date of birth masked, read back the same; saved again without them and with a never-issued VAT number, the three are kept ' +
      'masked and only vat_number is missing; no answer carries the TIN, the date of birth or the IBAN',
    run: async (ctx) => {
      const { lens } = ctx.env
      const [seller] = await lens.createUsers(1)
      const call: Call = async (note, method, body) => {
        const got = await lens.as(seller.token, method, PATH.replace('{ws}', seller.workspaceID), body)
        ctx.evidence.push({ note, answer: `${got.status} ${got.text.slice(0, 600)}` })
        const out = leaked(got.text)
        if (out.length > 0) return `${note}: the answer carries ${out.join(', ')} unmasked`
        if (got.status === 503 && method === 'PUT') {
          throw new CannotTest(`this Lens stores no seller's tax details (no LENS_PROVIDER_SECRET_KEK): ${note} answered 503 ${got.text.slice(0, 200)}`)
        }
        if (got.status !== 200) return `${note} was refused: ${got.status} ${got.text.slice(0, 300)}`
        return JSON.parse(got.text) as SellerTaxDetails
      }

      // Before anything is given: incomplete, nobody reminded, nothing held.
      const before = await call('the seller reads their tax details before giving any', 'GET')
      if (typeof before === 'string') return fail(before)
      if (before.complete || before.missing?.[0] !== 'seller_type' || before.reminders_sent !== 0 || (before.withheld_since ?? '') !== '') {
        return fail(`a new seller's tax details should be incomplete, seller_type first among what is missing, no reminder sent and no hold; they read ${JSON.stringify(before)}`)
      }

      // Saved in full: complete, the sealed three masked in the answer and in the read after it.
      const saved = await save(call, 'the seller saves their details in full', FULL, [])
      if (typeof saved === 'string') return fail(saved)

      // Saved again without the sealed three and with a never-issued VAT number: they are kept, and the VAT number is missing.
      const moved = await save(call, `the seller moves to DE with VAT number ${NEVER_ISSUED}, leaving the TIN, date of birth and account out`, MOVED, ['vat_number'])
      if (typeof moved === 'string') return fail(moved)
      if (moved.vat_valid) return fail(`${NEVER_ISSUED} is on the Test tax partner's list of numbers never issued; the details read it valid: ${JSON.stringify(moved)}`)

      return {
        pass: true,
        detail: `before any were given, incomplete (missing ${JSON.stringify(before.missing)}), 0 reminders, no hold; saved in full, complete with tins ` +
          `${JSON.stringify(saved.tins)}, date_of_birth ${saved.date_of_birth} and account_identifier ${saved.account_identifier}, read back the same; ` +
          `saved again from DE with ${NEVER_ISSUED} and without them, the three kept masked and incomplete, missing ["vat_number"] ` +
          `(${moved.vat_detail ?? 'no vat_detail'}); no answer carried the TIN, the date of birth or the IBAN`,
      }
    },
  }
}

/** `body` saved and its details read back, each judged by detailsFault: the read, or what is wrong. */
async function save(call: Call, note: string, body: { address: string }, missing: string[]): Promise<SellerTaxDetails | string> {
  const put = await call(note, 'PUT', body)
  if (typeof put === 'string') return put
  const answered = detailsFault(put, body.address, missing)
  if (answered !== undefined) return `${note}, the answer: ${answered}`
  const back = await call(`the details read back after: ${note}`, 'GET')
  if (typeof back === 'string') return back
  const read = detailsFault(back, body.address, missing)
  if (read !== undefined) return `${note}, the read after it: ${read}`
  return back
}
