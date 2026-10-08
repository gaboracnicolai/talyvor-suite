// B30.118 — Know Your Agent (Lens B30.5, docs/kya.md), on Lens's API, once a run, on a workspace of its own.
//
// A new workspace creates an agent with a daily limit of 5,000,000 µLXC and gives it a key. The owner reads its credential
// (GET …/agents/{id}/credential) and the agent, on its own key, is handed the same one over MCP (wallet_credential). The
// scenario checks it as any other platform does, with nothing but the published keys (/.well-known/talyvor-kya/jwks.json):
// a JWT signed EdDSA by a key whose kid is in the JWKS, iss talyvor, the agent its sub, the credential's id its jti, in its
// time, naming the owner's workspace and stating the daily limit. The same token with that limit raised by hand must not
// verify, so the check is real. Lens's own check (POST /v1/kya/verify) must say valid.
//
// The owner raises the daily limit to 9,000,000 µLXC. The revocation list (revoked.json) must name the first credential
// "rules changed" at once, and verify must say "revoked: rules changed". The list is read before verify, because verify
// revokes a credential that no longer says what is true as it answers: only the rule change can have put it there. The
// credential read next must be a new one stating the new limit and verify against the JWKS. The owner pauses the agent:
// the list must name that credential "frozen" (read first, for the same reason), verify must say "revoked: frozen", the
// credential route must be 409, and wallet_credential must hand the frozen agent no credential.

import { createPublicKey, verify } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered, KYAClaims, KYACredential, KYARevocations, KYAVerification, LensClient } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

/** The agent's daily limit (µLXC) when its first credential is read, and after its owner raises it. */
export const DAILY_ULXC = 5_000_000
export const RAISED_DAILY_ULXC = 9_000_000
/** How far ahead of this machine Lens's clock may be for a credential just issued to be in its time (seconds). */
const SKEW_S = 120

const JWKS_PATH = '/.well-known/talyvor-kya/jwks.json'
const REVOKED_PATH = '/.well-known/talyvor-kya/revoked.json'
const VERIFY_PATH = '/v1/kya/verify'

interface JWK { kty?: string; crv?: string; x?: string; kid?: string; alg?: string }

const decoded = <T>(part: string): T => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T

/**
 * A credential checked as another platform checks it, with only the published JWKS (docs/kya.md, "Offline"): its claims,
 * or why it does not verify.
 */
export function checkWithJWKS(jwks: { keys?: JWK[] | null }, token: string, now = Date.now()): { claims: KYAClaims } | { error: string } {
  const parts = token.split('.')
  if (parts.length !== 3) return { error: `it is not a JWT: ${parts.length} parts, not 3` }
  const [head, body, sig] = parts
  let header: { alg?: string; kid?: string }
  let claims: KYAClaims
  try {
    header = decoded(head)
    claims = decoded(body)
  } catch (e) {
    return { error: `its header or claims are not base64url JSON: ${String(e)}` }
  }
  if (header.alg !== 'EdDSA') return { error: `its alg is ${header.alg}, not EdDSA` }
  const keys = jwks.keys ?? []
  const jwk = keys.find((k) => k.kid === header.kid)
  if (jwk === undefined) return { error: `its kid ${header.kid} is not in the published JWKS, which lists ${keys.map((k) => k.kid).join(', ') || 'no key'}` }
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') return { error: `the published key ${jwk.kid} is ${jwk.kty} ${jwk.crv}, not OKP Ed25519` }
  let good: boolean
  try {
    const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x ?? '' }, format: 'jwk' })
    good = verify(null, Buffer.from(`${head}.${body}`), pub, Buffer.from(sig, 'base64url'))
  } catch (e) {
    return { error: `the published key ${jwk.kid} could not check it: ${String(e)}` }
  }
  if (!good) return { error: `its Ed25519 signature does not verify with the published key ${jwk.kid}` }
  if (claims.iss !== 'talyvor') return { error: `its iss is ${claims.iss}, not talyvor` }
  const s = now / 1000
  if (!(claims.nbf <= s + SKEW_S && s < claims.exp)) return { error: `it is not in its time: nbf ${claims.nbf}, exp ${claims.exp}, now ${Math.floor(s)}` }
  return { claims }
}

/** What is wrong with `c` as `agent`'s credential stating `daily` µLXC, checked against `jwks`: undefined when nothing. */
function credentialFault(jwks: { keys?: JWK[] | null }, c: KYACredential, agentID: string, workspaceID: string, daily: number): string | undefined {
  const got = checkWithJWKS(jwks, c.credential)
  if ('error' in got) return `a platform holding only the published JWKS cannot verify it: ${got.error}`
  const t = got.claims
  if (t.sub !== agentID || t.agent?.id !== agentID) return `it is for ${t.sub} (agent ${t.agent?.id}), not the agent ${agentID}`
  if (t.jti !== c.id) return `its jti is ${t.jti}, but Lens gave it as ${c.id}`
  if (t.owner?.workspace_id !== workspaceID) return `it names ${t.owner?.workspace_id} as the owner, not ${workspaceID}`
  if (t.limits?.daily_limit_ulxc !== daily) return `it states a daily limit of ${t.limits?.daily_limit_ulxc ?? '(none)'} µLXC; the agent's rules say ${daily}`
  return undefined
}

/** The published JWKS, the revocation list or verify's answer, read as anyone reads them: no credential. */
async function publicRead<T>(lens: LensClient, ctx: ScenarioCtx, method: string, path: string, note: string, body?: unknown): Promise<T | string> {
  const got = await lens.as('', method, path, body)
  ctx.evidence.push({ note, answer: `${got.status} ${got.text.slice(0, 400)}` })
  if (got.status !== 200) return `${method} ${path} with no credential must answer 200; Lens answered ${got.status} ${got.text.slice(0, 200)}`
  try {
    return JSON.parse(got.text) as T
  } catch {
    return `${method} ${path} answered something that is not JSON: ${got.text.slice(0, 200)}`
  }
}

export function agentCredential(i: number): Scenario {
  return {
    id: 'kya-credential',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    title: `an agent's Know Your Agent credential: the owner's read and the agent's wallet_credential hand over one credential that verifies with ` +
      `only the published JWKS (EdDSA, its kid, iss talyvor) stating its daily limit, and Lens's verify says valid; a rule change puts it on ` +
      `revoked.json as "rules changed" and the next one states the new limit; pausing the agent puts that one on revoked.json as "frozen" and ` +
      'the credential route is 409',
    run: async (ctx) => {
      const { lens } = ctx.env
      const [owner] = await lens.createUsers(1)

      // The agent, its daily limit and its own key.
      const agent = await lens.createAgent(owner, `KYA check ${i}-${RUN_SALT}`)
      const setDaily = async (daily: number): Promise<string | undefined> => {
        const rules = await lens.agentRules(owner, agent.id)
        const put = await lens.act<{ daily_limit_ulxc: number }>(owner, 'PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { ...rules, daily_limit_ulxc: daily })
        ctx.evidence.push({ note: `the owner sets ${agent.name}'s daily limit to ${daily} µLXC`, answer: said(put) })
        if (!put.ok || put.value.daily_limit_ulxc !== daily) return `setting ${agent.name}'s daily limit to ${daily} µLXC was answered ${said(put)}`
        return undefined
      }
      const limited = await setDaily(DAILY_ULXC)
      if (limited !== undefined) return fail(limited)
      const k = await lens.act<{ key: string }>(owner, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'kya-credential' })
      if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${said(k)}`)

      const read = async (note: string): Promise<Answered<KYACredential>> => {
        const got = await lens.act<KYACredential>(owner, 'GET', `/v1/workspaces/{ws}/agents/${agent.id}/credential`)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      // wallet_credential on the agent's own key: the credential, or why there is none.
      const shown = async (note: string): Promise<KYACredential | string> => {
        const got = await lens.as(k.value.key, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wallet_credential', arguments: {} } })
        ctx.evidence.push({ note, answer: `${got.status} ${got.text.slice(0, 400)}` })
        try {
          const rpc = JSON.parse(got.text) as { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } }
          const text = rpc.result?.content?.[0]?.text ?? ''
          if (got.status !== 200 || rpc.result === undefined || rpc.result.isError === true) return `${got.status}${rpc.result?.isError ? ' isError' : ''} ${text || rpc.error?.message || ''}`.trim()
          return JSON.parse(text) as KYACredential
        } catch {
          return `${got.status} ${got.text.slice(0, 200)}`
        }
      }
      const verdictOf = async (c: KYACredential, note: string): Promise<KYAVerification | string> =>
        publicRead<KYAVerification>(lens, ctx, 'POST', VERIFY_PATH, note, { credential: c.credential })
      const revocationOf = async (c: KYACredential, note: string): Promise<string | undefined | { reason: string }> => {
        const list = await publicRead<KYARevocations>(lens, ctx, 'GET', REVOKED_PATH, note)
        if (typeof list === 'string') return list
        return (list.revoked ?? []).find((r) => r.jti === c.id)
      }

      // The first credential: the owner's and the agent's are one, and it verifies with only the published keys.
      const first = await read(`the owner reads ${agent.name}'s credential`)
      if (!first.ok) return fail(`the owner's read of ${agent.name}'s credential must answer 200; Lens answered ${said(first)}`)
      const own = await shown(`${agent.name} asks for its credential over MCP (wallet_credential) on its own key`)
      if (typeof own === 'string') return fail(`wallet_credential on ${agent.name}'s own key handed it no credential: ${own}`)
      if (own.id !== first.value.id) return fail(`wallet_credential handed ${agent.name} ${own.id}, but its owner read ${first.value.id} with nothing changed between`)
      const jwks = await publicRead<{ keys?: JWK[] | null }>(lens, ctx, 'GET', JWKS_PATH, 'a platform fetches the published keys')
      if (typeof jwks === 'string') return fail(jwks)
      const bad = credentialFault(jwks, first.value, agent.id, owner.workspaceID, DAILY_ULXC)
      if (bad !== undefined) return fail(`${agent.name}'s first credential: ${bad}`)
      const [head, body, sig] = first.value.credential.split('.')
      const raised = Buffer.from(JSON.stringify({ ...decoded<object>(body), limits: { ...first.value.claims.limits, daily_limit_ulxc: DAILY_ULXC * 100 } })).toString('base64url')
      if (!('error' in checkWithJWKS(jwks, `${head}.${raised}.${sig}`))) return fail(`the credential with its daily limit raised to ${DAILY_ULXC * 100} µLXC by hand verified against the published keys: this check proves nothing`)
      const fresh = await verdictOf(first.value, 'a platform asks Talyvor to verify the first credential')
      if (typeof fresh === 'string') return fail(fresh)
      if (!fresh.valid) return fail(`Talyvor's verify says ${agent.name}'s fresh credential is not valid: ${fresh.reason ?? '(no reason)'}`)

      // A rule change revokes it, and the next credential states the new limit.
      const relimited = await setDaily(RAISED_DAILY_ULXC)
      if (relimited !== undefined) return fail(relimited)
      const ruled = await revocationOf(first.value, 'a platform reads the revocation list after the rule change')
      if (typeof ruled === 'string') return fail(ruled)
      if (ruled === undefined) return fail(`after ${agent.name}'s daily limit changed, ${REVOKED_PATH} does not list its credential ${first.value.id}: a rule change must revoke it as it happens`)
      if (ruled.reason !== 'rules changed') return fail(`${REVOKED_PATH} lists ${first.value.id} as "${ruled.reason}", not "rules changed"`)
      const stale = await verdictOf(first.value, 'a platform asks Talyvor to verify the credential from before the rule change')
      if (typeof stale === 'string') return fail(stale)
      if (stale.valid || stale.reason !== 'revoked: rules changed') return fail(`the credential from before the rule change verified as valid ${stale.valid}, "${stale.reason ?? ''}"; want "revoked: rules changed"`)
      const second = await read(`the owner reads ${agent.name}'s credential after the rule change`)
      if (!second.ok) return fail(`the owner's read of ${agent.name}'s credential after the rule change must answer 200; Lens answered ${said(second)}`)
      if (second.value.id === first.value.id) return fail(`after the rule change the owner was handed the revoked credential ${first.value.id} again`)
      const jwksNow = await publicRead<{ keys?: JWK[] | null }>(lens, ctx, 'GET', JWKS_PATH, 'a platform fetches the published keys again')
      if (typeof jwksNow === 'string') return fail(jwksNow)
      const bad2 = credentialFault(jwksNow, second.value, agent.id, owner.workspaceID, RAISED_DAILY_ULXC)
      if (bad2 !== undefined) return fail(`${agent.name}'s credential after the rule change: ${bad2}`)

      // Pausing the agent revokes that one: the list names it frozen, verify says so, and the agent is given no other.
      const paused = await lens.act(owner, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/pause`, { reason: `nightly KYA check ${RUN_SALT}` })
      ctx.evidence.push({ note: `the owner pauses ${agent.name}`, answer: said(paused) })
      if (!paused.ok) return fail(`pausing ${agent.name} was refused: ${said(paused)}`)
      const frozen = await revocationOf(second.value, 'a platform reads the revocation list after the pause')
      if (typeof frozen === 'string') return fail(frozen)
      if (frozen === undefined) return fail(`after ${agent.name} was paused, ${REVOKED_PATH} does not list its credential ${second.value.id}: freezing an agent must revoke its credential as it happens`)
      if (frozen.reason !== 'frozen') return fail(`${REVOKED_PATH} lists the paused agent's credential ${second.value.id} as "${frozen.reason}", not "frozen"`)
      const cold = await verdictOf(second.value, 'a platform asks Talyvor to verify the paused agent\'s credential')
      if (typeof cold === 'string') return fail(cold)
      if (cold.valid || cold.reason !== 'revoked: frozen') return fail(`the paused agent's credential verified as valid ${cold.valid}, "${cold.reason ?? ''}"; want "revoked: frozen"`)
      const none = await read(`the owner reads the paused ${agent.name}'s credential`)
      if (none.status !== 409) return fail(`the credential route for a paused agent must be 409; Lens answered ${said(none)}`)
      const refused = await shown(`the paused ${agent.name} asks for its credential over MCP`)
      if (typeof refused !== 'string') return fail(`wallet_credential handed the paused ${agent.name} the credential ${refused.id}`)

      return {
        pass: true,
        detail: `${agent.name}'s credential ${first.value.id} — the owner's and wallet_credential's — verified with only the published JWKS at ` +
          `${DAILY_ULXC} µLXC a day, a copy raised by hand did not, and verify said valid; the rule change listed it "rules changed" and the next, ` +
          `${second.value.id}, states ${RAISED_DAILY_ULXC}; paused, ${second.value.id} is listed "frozen", verify says "revoked: frozen", the route ` +
          'is 409 and wallet_credential hands it none',
      }
    },
  }
}
