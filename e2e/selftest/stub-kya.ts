// B30.118 SELF-TEST — the stand-in Lens's Know Your Agent credentials (Lens B30.5, docs/kya.md), as agent-credential reads
// them: GET …/agents/{id}/credential (409 while the agent is frozen or archived) and MCP wallet_credential on the agent's
// own key, each the credential the agent holds while it still says what is true, else a new one that supersedes it;
// GET /.well-known/talyvor-kya/jwks.json and revoked.json, and POST /v1/kya/verify. A credential is a JWT signed EdDSA
// with a key made when the stub starts, its kid the key's RFC 7638 thumbprint. Freezing, archiving and changing an
// agent's rules revoke its credential as they happen. Its defects:
//   kya-frozen-kept — freezing an agent leaves its credential unrevoked
//   kya-rules-kept  — changing an agent's rules leaves its credential unrevoked
//   kya-jwks-wrong  — the JWKS publishes a key the credentials are not signed with

import { createHash, generateKeyPairSync, type KeyObject, randomUUID, sign, verify } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** What an agent's credential says about it now (economy.AgentKYAFacts); standing is why it may have none. */
export interface KYAFacts {
  agent: { id: string; name: string }
  owner: { workspace_id: string; level: string; live_level: string }
  capabilities: { capability: string; money: string }[]
  limits: Record<string, number>
  standing: '' | 'frozen' | 'archived'
}

interface Issued { id: string; ws: string; agent: string; token: string; claims: object; digest: string; issued_at: string; expires_at: string; revoked_at?: string; reason?: string }
interface Key { priv: KeyObject; pub: KeyObject; x: string; kid: string }

const ISSUER = 'talyvor'
const TTL_MS = 24 * 3600e3

function keyPair(): Key {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const x = String(publicKey.export({ format: 'jwk' }).x)
  return { priv: privateKey, pub: publicKey, x, kid: createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`).digest('base64url') }
}

function digest(f: KYAFacts): string {
  const { standing: _s, ...said } = f
  return createHash('sha256').update(JSON.stringify(said)).digest('hex')
}

export class KYADesk {
  private readonly key = keyPair()
  /** What `kya-jwks-wrong` publishes instead of the signing key. */
  private readonly stranger = keyPair()
  private readonly issued = new Map<string, Issued>()

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  private readonly facts: (ws: string, agent: string) => KYAFacts | undefined

  constructor(json: KYADesk['json'], body: KYADesk['body'], broken: KYADesk['broken'], facts: KYADesk['facts']) {
    this.json = json
    this.body = body
    this.broken = broken
    this.facts = facts
  }

  /** The agent's credential, as the owner's route and wallet_credential answer it: its status and body. */
  current(ws: string, agentID: string): { status: number; body: object } {
    const f = this.facts(ws, agentID)
    if (f === undefined) return { status: 404, body: { error: 'economy: no such agent in this workspace' } }
    const now = new Date()
    const held = [...this.issued.values()].filter((c) => c.agent === agentID && c.revoked_at === undefined && Date.parse(c.expires_at) > now.getTime()).at(-1)
    if (f.standing !== '') {
      if (held !== undefined) this.revokeOne(held, f.standing)
      return { status: 409, body: { error: f.standing === 'archived' ? 'the agent is archived, so it has no Know Your Agent credential'
        : 'the agent is frozen, so its Know Your Agent credential is revoked until its owner resumes it' } }
    }
    const sum = digest(f)
    if (held !== undefined && held.digest === sum) return { status: 200, body: this.answer(held) }
    const id = `kya_${randomUUID()}`
    const iat = Math.floor(now.getTime() / 1000)
    const { standing: _s, ...said } = f
    const claims = { iss: ISSUER, sub: agentID, jti: id, iat, nbf: iat, exp: iat + TTL_MS / 1000, ...said }
    const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: this.key.kid, typ: 'kya+jwt' })).toString('base64url')
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const token = `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), this.key.priv).toString('base64url')}`
    if (held !== undefined) this.revokeOne(held, 'superseded')
    const c: Issued = { id, ws, agent: agentID, token, claims, digest: sum, issued_at: new Date(iat * 1000).toISOString(), expires_at: new Date((iat * 1000) + TTL_MS).toISOString() }
    this.issued.set(id, c)
    return { status: 200, body: this.answer(c) }
  }

  /** Freezing, archiving or changing the rules of an agent revokes its credential in force, for `reason`. */
  revoke(agentID: string, reason: 'frozen' | 'archived' | 'rules changed'): void {
    if (reason === 'frozen' && this.broken('kya-frozen-kept')) return
    if (reason === 'rules changed' && this.broken('kya-rules-kept')) return
    for (const c of this.issued.values()) if (c.agent === agentID) this.revokeOne(c, reason)
  }

  /** The three public routes: true when `p` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, p: string): Promise<boolean> {
    if (p === '/.well-known/talyvor-kya/jwks.json' && req.method === 'GET') {
      const k = this.broken('kya-jwks-wrong') ? this.stranger : this.key
      return this.json(res, 200, { keys: [{ kty: 'OKP', crv: 'Ed25519', x: k.x, kid: k.kid, alg: 'EdDSA', use: 'sig' }] }), true
    }
    if (p === '/.well-known/talyvor-kya/revoked.json' && req.method === 'GET') {
      const now = Date.now()
      const revoked = [...this.issued.values()].filter((c) => c.revoked_at !== undefined && Date.parse(c.expires_at) > now).reverse()
        .map((c) => ({ jti: c.id, reason: c.reason, revoked_at: c.revoked_at, expires_at: c.expires_at }))
      return this.json(res, 200, { issuer: ISSUER, generated_at: new Date(now).toISOString(), revoked }), true
    }
    if (p !== '/v1/kya/verify' || req.method !== 'POST') return false
    const token = ((await this.body<{ credential?: string }>(req)).credential ?? '').trim()
    if (token === '') return this.json(res, 400, { error: 'body must be {"credential": "<the agent\'s credential>"}' }), true
    return this.json(res, 200, this.verify(token)), true
  }

  private verify(token: string): object {
    const [head = '', body = '', sig = ''] = token.split('.')
    let header: { alg?: string; kid?: string }
    let claims: { iss?: string; jti?: string; sub?: string; exp?: number }
    try {
      header = JSON.parse(Buffer.from(head, 'base64url').toString()) as typeof header
      claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as typeof claims
    } catch {
      return { valid: false, reason: 'not a valid credential: token is malformed' }
    }
    if (header.alg !== 'EdDSA' || header.kid !== this.key.kid || !verify(null, Buffer.from(`${head}.${body}`), this.key.pub, Buffer.from(sig, 'base64url'))) {
      return { valid: false, reason: 'not a valid credential: token signature is invalid' }
    }
    if (claims.iss !== ISSUER || (claims.exp ?? 0) * 1000 <= Date.now()) return { valid: false, reason: 'not a valid credential: token has invalid claims' }
    const c = this.issued.get(claims.jti ?? '')
    if (c === undefined || c.agent !== claims.sub) return { valid: false, reason: 'Talyvor has no record of issuing this credential' }
    if (c.revoked_at !== undefined) return { valid: false, reason: `revoked: ${c.reason}`, claims }
    const f = this.facts(c.ws, c.agent)
    if (f === undefined) return { valid: false, reason: 'the agent no longer exists', claims }
    const reason = f.standing !== '' ? f.standing : digest(f) !== c.digest ? 'superseded' : ''
    if (reason === '') return { valid: true, claims }
    this.revokeOne(c, reason)
    return { valid: false, reason: `revoked: ${reason}`, claims }
  }

  private revokeOne(c: Issued, reason: string): void {
    if (c.revoked_at !== undefined || Date.parse(c.expires_at) <= Date.now()) return
    c.revoked_at = new Date().toISOString()
    c.reason = reason
  }

  private answer(c: Issued): object {
    return { id: c.id, credential: c.token, claims: c.claims, issued_at: c.issued_at, expires_at: c.expires_at,
      jwks_url: '/.well-known/talyvor-kya/jwks.json', verify_url: '/v1/kya/verify' }
  }
}
