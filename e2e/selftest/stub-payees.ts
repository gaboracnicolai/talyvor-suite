// B30.126 SELF-TEST — the stand-in Lens's saved outside payees (Lens B30.16), as outside-payees reads and writes them:
// POST and GET /v1/money/payees, POST …/{id}/challenge and …/{id}/confirm. The Test partner answers by the name
// (TESTNOMATCH no match, TESTCLOSE a close match whose holder is the name without the word), TESTSANCTION is refused 403
// and not saved, and a close or no match is confirmed only by an assertion from one of the workspace's passkeys, signed
// over the payee's challenge (checked here as Lens's passkey.VerifyAssertion does). Its defect:
//   payee-confirm-unsigned — a payee is confirmed with no assertion

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'

interface Payee { id: string; workspace_id: string; name: string; country: string; check: string; suggested_name?: string; checked_by: string
  needs_confirmation: boolean; confirmed_by?: string; created_at: string; [k: string]: unknown }
interface Assertion { credential_id?: string; client_data_json?: string; authenticator_data?: string; signature?: string }

export class PayeeDesk {
  private readonly payees = new Map<string, Payee[]>()
  private readonly challenges = new Map<string, string>()

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

  /** The payee routes, on workspace `ws`'s key: true when `path` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    const list = this.payees.get(ws) ?? []
    if (path === '/v1/money/payees' && req.method === 'GET') return this.json(res, 200, { payees: list }), true
    if (path === '/v1/money/payees' && req.method === 'POST') {
      const b = await this.body<Record<string, string>>(req)
      const name = (b.name ?? '').trim()
      if (name === '' || (b.country ?? '') === '') return this.json(res, 400, { error: 'economy: invalid payee: a payee has a name and a country' }), true
      if (/TESTSANCTION/i.test(name)) return this.json(res, 403, { error: 'screening: the payee is on a sanctions list' }), true
      const check = /TESTNOMATCH/i.test(name) ? 'no_match' : /TESTCLOSE/i.test(name) ? 'close_match' : 'exact_match'
      const p: Payee = { ...b, id: `payee_${randomUUID()}`, workspace_id: ws, name, country: b.country, check, checked_by: 'test',
        ...(check === 'close_match' ? { suggested_name: name.replace(/TESTCLOSE/gi, ' ').split(/\s+/).filter(Boolean).join(' ') } : {}),
        needs_confirmation: check !== 'exact_match', created_at: new Date().toISOString() }
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
}
