// B30.126 — saved outside payees and confirmation of payee (Lens B30.16), on Lens's API, once a run, on a workspace of its own.
//
// The owner saves three payees outside Talyvor, each checked against its account by the Test partner, which answers by the
// name: an ordinary name (GBP, a sort code) is an exact match, TESTCLOSE a close match naming the holder, TESTNOMATCH (EUR,
// an IBAN) no match. A close or no match cannot be paid until the owner confirms it with a passkey, so the owner registers
// one — a software P-256 authenticator, signing as a phone's does — and confirms the no-match: with no assertion it must be
// refused 403, and only with an assertion signed over the payee's challenge is it confirmed, its check still no_match. A
// TESTSANCTION payee is refused 403 by screening and must be absent from the list.

import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { said } from './routes.ts'
import type { Scenario } from './scenarios.ts'

/** A saved payee as Lens answers it (economy.OutsidePayee). */
interface Payee { id: string; name: string; check: string; suggested_name?: string; checked_by: string; needs_confirmation: boolean; confirmed_by?: string }

const EXACT = { name: 'Nightly Exact Payee Ltd', country: 'GB', sort_code: '040004', account_number: '12345678' }
const CLOSE = { name: 'Nightly TESTCLOSE Payee Ltd', country: 'GB', sort_code: '040004', account_number: '87654321' }
const NOMATCH = { name: 'Nightly TESTNOMATCH Empfänger GmbH', country: 'DE', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' }
const SANCTIONED = { name: 'Nightly TESTSANCTION Payee Ltd', country: 'GB', sort_code: '040004', account_number: '11223344' }

const UP = 0x01
const UV = 0x04
const AT = 0x40

/** A software passkey: a P-256 key for `rpID`, registered and signing the way a browser's authenticator does (WebAuthn L2). */
export function softPasskey(rpID: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const id = randomBytes(16)
  const rpHash = createHash('sha256').update(rpID).digest()
  const clientData = (type: string, challenge: string) => Buffer.from(JSON.stringify({ type, challenge, origin: `https://${rpID}` }))
  let count = 0
  const authData = (flags: number, attested: Buffer = Buffer.alloc(0)) => {
    const c = Buffer.alloc(4)
    c.writeUInt32BE(count)
    return Buffer.concat([rpHash, Buffer.from([flags]), c, attested])
  }
  const credentialID = id.toString('base64url')
  return {
    credentialID,
    register(challenge: string, name: string) {
      const len = Buffer.alloc(2)
      len.writeUInt16BE(id.length)
      return { credential_id: credentialID, name, public_key: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
        client_data_json: clientData('webauthn.create', challenge).toString('base64url'),
        authenticator_data: authData(UP | UV | AT, Buffer.concat([Buffer.alloc(16), len, id])).toString('base64url') }
    },
    assert(challenge: string) {
      count++
      const cdj = clientData('webauthn.get', challenge)
      const ad = authData(UP | UV)
      const sig = sign('sha256', Buffer.concat([ad, createHash('sha256').update(cdj).digest()]), privateKey)
      return { credential_id: credentialID, client_data_json: cdj.toString('base64url'), authenticator_data: ad.toString('base64url'), signature: sig.toString('base64url') }
    },
  }
}

export function outsidePayees(): Scenario {
  return {
    id: 'outside-payees',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    items: ['B30.16'],
    title: 'saved outside payees: an exact, a close and a no-match payee saved with their checks; the no-match confirmed with no assertion 403, ' +
      'then with a passkey signed over its challenge, its check still no_match; a sanctioned payee refused 403 and not listed',
    run: async (ctx) => {
      const { lens } = ctx.env
      const [owner] = await lens.createUsers(1)
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(owner, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      const save = (p: object, note: string) => call<Payee>('POST', '/v1/money/payees', p, note)

      // Three payees, each with what its bank said of the name.
      const exact = await save(EXACT, 'the owner saves a GBP payee whose name matches its account')
      if (exact.status !== 201 || !exact.ok) return fail(`saving a payee must answer 201; Lens answered ${said(exact)}`)
      if (exact.value.check !== 'exact_match' || exact.value.needs_confirmation) {
        return fail(`a payee whose name matches is exact_match and needs no confirmation; Lens saved check ${exact.value.check}, needs_confirmation ${exact.value.needs_confirmation}`)
      }
      const close = await save(CLOSE, 'the owner saves a TESTCLOSE payee')
      if (close.status !== 201 || !close.ok) return fail(`saving a close-match payee must answer 201; Lens answered ${said(close)}`)
      if (close.value.check !== 'close_match' || (close.value.suggested_name ?? '') === '' || !close.value.needs_confirmation) {
        return fail(`a TESTCLOSE payee is close_match, names the account's holder and needs confirmation; Lens saved check ${close.value.check}, ` +
          `suggested_name "${close.value.suggested_name ?? ''}", needs_confirmation ${close.value.needs_confirmation}`)
      }
      const nomatch = await save(NOMATCH, 'the owner saves a TESTNOMATCH EUR payee')
      if (nomatch.status !== 201 || !nomatch.ok) return fail(`saving a no-match payee must answer 201; Lens answered ${said(nomatch)}`)
      if (nomatch.value.check !== 'no_match' || !nomatch.value.needs_confirmation) {
        return fail(`a TESTNOMATCH payee is no_match and needs confirmation; Lens saved check ${nomatch.value.check}, needs_confirmation ${nomatch.value.needs_confirmation}`)
      }
      const pid = nomatch.value.id

      // A passkey to confirm with.
      const reg = await call<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (!reg.ok) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
      const key = softPasskey(reg.value.rp_id)
      const registered = await call('POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, 'Nightly software passkey'), 'the owner registers a P-256 passkey')
      if (registered.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(registered)}`)

      // The no-match, confirmed with no assertion: refused, and still unconfirmed.
      const unsigned = await call<Payee>('POST', `/v1/money/payees/${pid}/confirm`, {}, 'the owner confirms the no-match payee with no assertion')
      if (unsigned.status !== 403) return fail(`confirming a no-match payee with no assertion must be refused 403; Lens answered ${said(unsigned)}`)

      // Then with the passkey, signed over the payee's challenge.
      const ch = await call<{ challenge: string; allow_credentials: string[] }>('POST', `/v1/money/payees/${pid}/challenge`, {}, 'the owner asks for the no-match payee\'s challenge')
      if (!ch.ok) return fail(`the no-match payee's challenge was refused: ${said(ch)}`)
      if (!(ch.value.allow_credentials ?? []).includes(key.credentialID)) return fail(`the payee's challenge does not allow the passkey just registered: ${said(ch)}`)
      const signed = await call<Payee>('POST', `/v1/money/payees/${pid}/confirm`, { assertion: key.assert(ch.value.challenge) }, 'the owner confirms the no-match payee with the passkey')
      if (signed.status !== 200 || !signed.ok) return fail(`confirming with an assertion signed over the payee's challenge must answer 200; Lens answered ${said(signed)}`)
      if (signed.value.needs_confirmation || signed.value.check !== 'no_match') {
        return fail(`the confirmed payee must need no confirmation and keep its check no_match; Lens answered needs_confirmation ${signed.value.needs_confirmation}, check ${signed.value.check}`)
      }

      // A sanctioned name: refused, and nothing saved.
      const sanctioned = await save(SANCTIONED, 'the owner saves a TESTSANCTION payee')
      if (sanctioned.status !== 403) return fail(`a payee on a sanctions list must be refused 403; Lens answered ${said(sanctioned)}`)
      const list = await call<{ payees: Payee[] }>('GET', '/v1/money/payees', undefined, 'the owner lists the payees')
      if (!list.ok) return fail(`the owner's list of payees was refused: ${said(list)}`)
      const payees = list.value.payees ?? []
      if (payees.some((p) => p.name.includes('TESTSANCTION'))) return fail('the refused TESTSANCTION payee is on the list: a sanctioned payee must not be saved')
      const want = [[exact.value.id, false], [close.value.id, true], [pid, false]] as const
      for (const [id, needs] of want) {
        const p = payees.find((x) => x.id === id)
        if (p === undefined) return fail(`the payee ${id} saved earlier is not on the list`)
        if (p.needs_confirmation !== needs) return fail(`the list reads ${p.name} needs_confirmation ${p.needs_confirmation}, not ${needs}`)
      }

      return {
        pass: true,
        detail: `exact_match, close_match (holder "${close.value.suggested_name}") and no_match payees saved, the last two needing confirmation; ` +
          'the no-match confirmed with no assertion refused 403, then confirmed by the passkey over its challenge, still no_match; ' +
          'the TESTSANCTION payee refused 403 and not listed',
      }
    },
  }
}
