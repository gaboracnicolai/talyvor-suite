// B30.122 SELF-TEST — the stand-in Lens's terms for each capability (Lens B30.9), as capability-terms reads and accepts them:
// GET …/terms (every capability with terms, its latest version and whether the workspace accepted it), GET …/terms/{capability}
// (with its text) and POST …/terms/{capability}/accept {"version": n} — 201 with the acceptance, 409 for a version that is not
// the latest. Every B30 capability has version 1 of a text headed "Draft — for legal review". Its defect:
//   terms-fx-accepted — a new workspace's list reads fx as already accepted

import type { IncomingMessage, ServerResponse } from 'node:http'

interface Acceptance { workspace_id: string; capability: string; version: number; person: string; accepted_at: string }

const VERSION = 1
const PUBLISHED_AT = '2026-10-09T00:00:00Z'
const text = (capability: string): string => `# Draft — for legal review\n\n## Terms for ${capability}\n\nThese terms are between TALYVOR LTD and the workspace.\n`

export class TermsDesk {
  private readonly accepted = new Map<string, Acceptance>()

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  private readonly capabilities: readonly { capability: string; name: string; class: string }[]

  constructor(json: TermsDesk['json'], body: TermsDesk['body'], broken: TermsDesk['broken'], capabilities: TermsDesk['capabilities']) {
    this.json = json
    this.body = body
    this.broken = broken
    this.capabilities = capabilities
  }

  /** The workspace's terms routes: true when `rest` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string, now: string): Promise<boolean> {
    if (rest === '/terms' && req.method === 'GET') return this.json(res, 200, { terms: this.capabilities.map((c) => this.terms(ws, c, false)) }), true
    const m = /^\/terms\/([^/]+)(\/accept)?$/.exec(rest)
    if (m === null) return false
    const c = this.capabilities.find((x) => x.capability === m[1])
    if (c === undefined) return this.json(res, 404, { error: 'economy: this capability has no terms' }), true
    if (m[2] === undefined) return req.method === 'GET' ? (this.json(res, 200, this.terms(ws, c, true)), true) : false
    if (req.method !== 'POST') return false
    const b = await this.body<{ version?: number }>(req)
    if (typeof b.version !== 'number' || b.version <= 0) return this.json(res, 400, { error: 'body must be {"version": n}, the version of the terms read' }), true
    if (b.version !== VERSION) return this.json(res, 409, { error: 'economy: a newer version of these terms is published' }), true
    const a: Acceptance = { workspace_id: ws, capability: c.capability, version: VERSION, person: `jwt:user:${ws}`, accepted_at: now }
    this.accepted.set(`${ws} ${c.capability}`, a)
    return this.json(res, 201, { acceptance: a }), true
  }

  private terms(ws: string, c: { capability: string; name: string; class: string }, withBody: boolean): object {
    const planted = c.capability === 'fx' && this.broken('terms-fx-accepted')
      ? { workspace_id: ws, capability: 'fx', version: VERSION, person: 'jwt:user:someone-earlier', accepted_at: PUBLISHED_AT } : undefined
    const accepted = this.accepted.get(`${ws} ${c.capability}`) ?? planted
    const body = text(c.capability)
    return { capability: c.capability, name: c.name, class: c.class, version: VERSION, text_path: `docs/terms/${c.capability}.md`, ...(withBody ? { body } : {}), body_sha256: 'stub', published_by: 'lens',
      published_at: PUBLISHED_AT, ...(accepted === undefined ? {} : { accepted }) }
  }
}
