// B17.6 SELF-TEST — the stand-in Lens's Agent Bank (B19) and marketplace (B20), as much of each as
// Agent Wallets, the marketplace screens and the bank scenarios read and write: agents and their keys,
// funding, rules, approvals, pausing, payments inside a company and to another company's agent, the
// double-entry postings and the statements built from them; listings, uses, the buyer's bill and the
// seller's earnings. A bill is never paid here, so earnings stay pending, as a synthetic company's do.
//
// STUB_BREAK=agent-limit plants the defect the bank's DONE names: an agent's limit per request is
// recorded but never refuses.

import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface BankWorkspace {
  id: string
  balance: number
}

export interface BankDeps {
  brk: string
  workspace: (id: string) => BankWorkspace | undefined
  /** Runs one question on a model for ws, booking what it cost on ws's ledger as a spend row. */
  runModel: (ws: BankWorkspace, model: string, text: string) => { answer: string } | { error: string }
  json: (res: ServerResponse, status: number, body: unknown) => void
  read: (req: IncomingMessage) => Promise<string>
}

interface Rules {
  max_per_request_ulxc: number
  daily_limit_ulxc: number
  monthly_limit_ulxc: number
  approval_above_ulxc: number
  allowed_models: string[]
  allowed_providers: string[]
  allowed_listings: string[]
  active_from: string
  active_until: string
  timezone: string
  pause_on_unusual_spend: boolean
}
interface Agent { id: string; ws: string; name: string; owner_user_id: string; created_at: string; keys: string[]; paused_at?: string; paused_reason?: string; rules: Rules }
interface Posting { posting_id: number; entry_id: string; at: string; ws: string; account: string; kind: string; amount_ulxc: number; counterparty: string; ref?: string }
interface Approval { id: string; ws: string; agent_id: string; amount_ulxc: number; model: string; status: string; created_at: string; decided_at?: string; fingerprint: string }
interface Listing {
  id: string; workspace_id: string; kind: string; title: string; description: string; price_per_use_ulxc: number
  visibility: string; latest_version: number; created_at: string; updated_at: string; review_status: string
  artifact: Record<string, unknown>; changelog: string
}
interface Use { id: string; listing_id: string; seller: string; buyer: string; agent_id: string; price_ulxc: number; charge: string; used_at: string; payee_agent_id: string; memo: string }

const noRules = (): Rules => ({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0,
  allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: '', pause_on_unusual_spend: false })

const lxc = (ulxc: number): string => String(ulxc / 1e6)
const id = (prefix: string): string => prefix + randomBytes(8).toString('hex')

export class Bank {
  private readonly d: BankDeps
  private readonly agents = new Map<string, Agent>()
  private readonly keys = new Map<string, Agent>()
  private readonly postings: Posting[] = []
  private readonly approvals: Approval[] = []
  private readonly allPaused = new Map<string, { at: string; reason: string }>()
  private readonly listings = new Map<string, Listing>()
  private readonly uses: Use[] = []
  private nextPosting = 1

  constructor(d: BankDeps) {
    this.d = d
  }

  /** The workspace and agent an agent key belongs to. */
  agentOfKey(key: string): { ws: BankWorkspace; agent: Agent } | undefined {
    const a = this.keys.get(key)
    const ws = a === undefined ? undefined : this.d.workspace(a.ws)
    return a === undefined || ws === undefined ? undefined : { ws, agent: a }
  }

  private balance(account: string): number {
    return this.postings.filter((p) => p.account === account).reduce((s, p) => s + p.amount_ulxc, 0)
  }

  private post(ws: string, kind: string, legs: [string, number, string][], ref?: string): string {
    const entry = id('ent_')
    const at = new Date().toISOString()
    for (const [account, amount, counterparty] of legs) {
      this.postings.push({ posting_id: this.nextPosting++, entry_id: entry, at, ws, account, kind, amount_ulxc: amount, counterparty, ref })
    }
    return entry
  }

  private book(ws: BankWorkspace): object {
    const agents = [...this.agents.values()].filter((a) => a.ws === ws.id).map((a) => ({
      id: a.id, name: a.name, balance_ulxc: this.balance(`agent:${a.id}`),
      spent_ulxc: this.postings.filter((p) => p.account === `agent:${a.id}` && p.kind === 'spend').reduce((s, p) => s - p.amount_ulxc, 0),
      keys: a.keys, created_at: a.created_at, paused_at: a.paused_at, paused_reason: a.paused_reason, owner_user_id: a.owner_user_id, verified: false,
    }))
    const allocated = agents.reduce((s, a) => s + a.balance_ulxc, 0)
    const paused = this.allPaused.get(ws.id)
    return {
      workspace_balance_ulxc: ws.balance, allocated_ulxc: allocated, unallocated_ulxc: ws.balance - allocated,
      spent_ulxc: agents.reduce((s, a) => s + a.spent_ulxc, 0), agents,
      ...(paused === undefined ? {} : { all_paused_at: paused.at, all_paused_reason: paused.reason }),
    }
  }

  /**
   * Lens's agent rules (economy/agent_rules.go), in its order: the pauses, the models, the limit per
   * request, the day's and month's limits, then the approval amount. A refusal is 403 naming the rule;
   * a request above the approval amount files an approval, and an approved one goes through once.
   */
  judge(agent: Agent, amount: number, req: { model?: string; payment?: boolean; fingerprint: string }): { status: number; error: string } | undefined {
    const rule = (s: string) => ({ status: 403, error: `the agent's spending rules refuse this request: ${s}` })
    const all = this.allPaused.get(agent.ws)
    if (all !== undefined) return rule(`every agent in this workspace is paused (${all.reason || "paused by the workspace's owner"}) — the workspace's owner can resume them`)
    if (agent.paused_at !== undefined) return rule(`the agent is paused (${agent.paused_reason || "paused by the workspace's owner"}) — the workspace's owner can resume it`)
    const r = agent.rules
    const what = req.payment ? 'payment' : 'request'
    if (r.allowed_models.length > 0 && !req.payment && !r.allowed_models.includes(req.model ?? '')) return rule(`the agent may not use the model "${req.model}"`)
    if (r.max_per_request_ulxc > 0 && amount > r.max_per_request_ulxc && this.d.brk !== 'agent-limit') {
      return rule(`this ${what} would cost up to ${lxc(amount)} LXC; the agent's limit per request is ${lxc(r.max_per_request_ulxc)} LXC`)
    }
    const spent = this.postings.filter((p) => p.account === `agent:${agent.id}` && (p.kind === 'spend' || (p.kind === 'pay' && p.amount_ulxc < 0)))
      .reduce((s, p) => s - p.amount_ulxc, 0)
    for (const [limit, name] of [[r.daily_limit_ulxc, 'daily'], [r.monthly_limit_ulxc, 'monthly']] as const) {
      if (limit > 0 && spent + amount > limit) {
        return rule(`the agent has spent ${lxc(spent)} LXC of its ${name} limit of ${lxc(limit)} LXC, and this ${what} would cost up to ${lxc(amount)} LXC`)
      }
    }
    if (r.approval_above_ulxc > 0 && amount > r.approval_above_ulxc) {
      const ok = this.approvals.find((a) => a.agent_id === agent.id && a.fingerprint === req.fingerprint && a.status === 'approved')
      if (ok !== undefined) {
        ok.status = 'used'
        return undefined
      }
      const a: Approval = { id: id('apr_'), ws: agent.ws, agent_id: agent.id, amount_ulxc: amount, model: req.model ?? '', status: 'pending',
        created_at: new Date().toISOString(), fingerprint: req.fingerprint }
      this.approvals.unshift(a)
      return { status: 403, error: `economy: this request would cost up to ${lxc(amount)} LXC, above the agent's approval amount — approval ${a.id} must be approved by the workspace's owner before it is retried` }
    }
    return undefined
  }

  /** An agent's proxied request, judged at its worst case before the model; undefined lets it through. */
  admit(agent: Agent, worst: number, model: string, prompt: string): { status: number; error: string } | undefined {
    const refused = this.judge(agent, worst, { model, fingerprint: createHash('sha256').update(`${agent.id}\0${model}\0${prompt}`).digest('hex') })
    if (refused !== undefined) return refused
    if (worst > this.balance(`agent:${agent.id}`)) return { status: 402, error: 'agent LXC sub-budget exceeded or insufficient balance' }
    return undefined
  }

  /** What a served request cost, posted from the agent to spend — beside the workspace's ledger row. */
  spent(agent: Agent, charge: number): void {
    if (charge > 0) this.post(agent.ws, 'spend', [[`agent:${agent.id}`, -charge, 'spend'], ['spend', charge, `agent:${agent.id}`]])
  }

  private statement(ws: string, agentID: string | undefined, url: URL): object | string {
    const day = (s: string | null, dflt: Date): Date | undefined => {
      if (s === null || s === '') return dflt
      const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s)
      return Number.isNaN(t.getTime()) ? undefined : t
    }
    const now = new Date()
    const from = day(url.searchParams.get('from'), new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))
    const to = day(url.searchParams.get('to'), now)
    if (from === undefined || to === undefined) return 'from and to must be RFC 3339 times or YYYY-MM-DD dates'
    const mine = this.postings.filter((p) => p.ws === ws && (agentID === undefined || p.account === `agent:${agentID}`))
    const before = mine.filter((p) => new Date(p.at) < from)
    const within = mine.filter((p) => new Date(p.at) >= from && new Date(p.at) < to)
    const names = [...new Set([...before, ...within].map((p) => p.account))].sort()
    const running = new Map(names.map((n) => [n, before.filter((p) => p.account === n).reduce((s, p) => s + p.amount_ulxc, 0)]))
    const accounts = names.map((n) => {
      const opening = running.get(n) ?? 0
      const moves = within.filter((p) => p.account === n)
      const inn = moves.filter((p) => p.amount_ulxc > 0).reduce((s, p) => s + p.amount_ulxc, 0)
      const out = moves.filter((p) => p.amount_ulxc < 0).reduce((s, p) => s - p.amount_ulxc, 0)
      return { account: n, opening_ulxc: opening, in_ulxc: inn, out_ulxc: out, closing_ulxc: opening + inn - out }
    })
    const lines = within.map((p) => {
      const after = (running.get(p.account) ?? 0) + p.amount_ulxc
      running.set(p.account, after)
      return { posting_id: p.posting_id, entry_id: p.entry_id, at: p.at, account: p.account, kind: p.kind, amount_ulxc: p.amount_ulxc,
        counterparty: p.counterparty, ref: p.ref, balance_after_ulxc: after }
    })
    return { workspace_id: ws, agent_id: agentID, from: from.toISOString(), to: to.toISOString(), accounts, lines }
  }

  private async body<T>(req: IncomingMessage): Promise<T> {
    return JSON.parse((await this.d.read(req)) || '{}') as T
  }

  private pay(res: ServerResponse, ws: BankWorkspace, from: Agent, to: string, amount: number, memo: string): void {
    const { json } = this.d
    if (!(amount > 0)) return json(res, 400, { error: 'body must be {"to_agent_id": "<agent>", "amount_ulxc": <positive µLXC>, "memo": "<optional>"}' })
    const payee = this.agents.get(to)
    if (payee === undefined) return json(res, 404, { error: 'economy: no such agent in this workspace' })
    if (payee.id === from.id) return json(res, 400, { error: 'economy: an agent cannot pay itself' })
    const refused = this.judge(from, amount, { payment: true, fingerprint: `pay\0${from.id}\0${to}\0${amount}\0${memo}` })
    if (refused !== undefined) return json(res, refused.status, { error: refused.error })
    if (payee.ws !== ws.id) {
      // B19.15: another company's agent, through the marketplace: one billed use on the payer's bill.
      const use: Use = { id: id('use_'), listing_id: '', seller: payee.ws, buyer: ws.id, agent_id: from.id, price_ulxc: amount, charge: 'billed',
        used_at: new Date().toISOString(), payee_agent_id: payee.id, memo }
      this.uses.push(use)
      return json(res, 200, { entry_id: use.id, from_agent_id: from.id, to_agent_id: payee.id, amount_ulxc: amount,
        from_balance_ulxc: this.balance(`agent:${from.id}`), to_balance_ulxc: 0, memo, to_workspace_id: payee.ws, via: 'marketplace' })
    }
    if (amount > this.balance(`agent:${from.id}`)) return json(res, 409, { error: `economy: the agent holds ${lxc(this.balance(`agent:${from.id}`))} LXC` })
    const entry = this.post(ws.id, 'pay', [[`agent:${from.id}`, -amount, `agent:${payee.id}`], [`agent:${payee.id}`, amount, `agent:${from.id}`]], memo || undefined)
    return json(res, 200, { entry_id: entry, from_agent_id: from.id, to_agent_id: payee.id, amount_ulxc: amount,
      from_balance_ulxc: this.balance(`agent:${from.id}`), to_balance_ulxc: this.balance(`agent:${payee.id}`), memo })
  }

  /** An agent key paying from its own agent — the one workspace route an agent's key may take. */
  async agentPay(req: IncomingMessage, res: ServerResponse, key: string, path: string): Promise<boolean> {
    const m = /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/pay$/.exec(path)
    const who = this.agentOfKey(key)
    if (m === null || who === undefined || req.method !== 'POST') return false
    if (who.ws.id !== m[1] || who.agent.id !== m[2]) {
      this.d.json(res, 403, { error: "only the paying agent's own key, the workspace's owner or an admin may pay from an agent" })
      return true
    }
    const b = await this.body<{ to_agent_id?: string; amount_ulxc?: number; memo?: string }>(req)
    this.pay(res, who.ws, who.agent, b.to_agent_id ?? '', b.amount_ulxc ?? 0, b.memo ?? '')
    return true
  }

  private listingOut(l: Listing, viewer: string): object {
    const vars = typeof l.artifact.template === 'string' ? [...new Set([...l.artifact.template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((x) => x[1]))] : []
    const { artifact, changelog, ...rest } = l
    return { ...rest, versions: [{ version: 1, artifact_sha256: createHash('sha256').update(JSON.stringify(artifact)).digest('hex'), changelog,
      scan: {}, created_at: l.created_at, needs: { input: l.kind === 'agent' || l.kind === 'skill', variables: vars, model: String(artifact.model ?? '') },
      ...(viewer === l.workspace_id ? { artifact } : {}) }] }
  }

  /** GET /v1/marketplace/listings[/{id}]: the public catalog, as anyone signed in reads it. */
  publicRoute(res: ServerResponse, path: string, url: URL, viewer: string): boolean {
    const { json } = this.d
    if (path === '/v1/marketplace/listings') {
      const kind = url.searchParams.get('kind') ?? ''
      json(res, 200, [...this.listings.values()].filter((l) => l.visibility === 'public' && (kind === '' || l.kind === kind))
        .map((l) => { const { artifact: _a, changelog: _c, ...rest } = l; return rest }))
      return true
    }
    const m = /^\/v1\/marketplace\/listings\/([^/]+)$/.exec(path)
    if (m === null) return false
    const l = this.listings.get(m[1])
    if (l === undefined || (l.visibility === 'private' && l.workspace_id !== viewer)) json(res, 404, { error: 'market: no such listing' })
    else json(res, 200, this.listingOut(l, viewer))
    return true
  }

  /** A route under /v1/workspaces/{ws}: answers true when it was one of the bank's or the marketplace's. */
  async workspaceRoute(req: IncomingMessage, res: ServerResponse, ws: BankWorkspace, rest: string, url: URL): Promise<boolean> {
    const { json } = this.d
    const method = req.method ?? 'GET'
    const now = new Date().toISOString()
    let m: RegExpExecArray | null
    if (rest === '/agents' && method === 'GET') return json(res, 200, this.book(ws)), true
    if (rest === '/agents' && method === 'POST') {
      const { name = '' } = await this.body<{ name?: string }>(req)
      if (name === '') return json(res, 400, { error: 'body must be {"name": "<agent name>"}' }), true
      const a: Agent = { id: id('agt_'), ws: ws.id, name, owner_user_id: ws.id, created_at: now, keys: [], rules: noRules() }
      this.agents.set(a.id, a)
      return json(res, 201, { ...a, rules: undefined, balance_ulxc: 0, spent_ulxc: 0 }), true
    }
    if (rest === '/agents/approvals') {
      return json(res, 200, { approvals: this.approvals.filter((a) => a.ws === ws.id).map(({ fingerprint: _f, ws: _w, ...a }) => a) }), true
    }
    if ((m = /^\/agents\/approvals\/([^/]+)\/(approve|deny)$/.exec(rest)) !== null && method === 'POST') {
      const a = this.approvals.find((x) => x.id === m?.[1] && x.ws === ws.id && x.status === 'pending')
      if (a === undefined) return json(res, 404, { error: 'economy: no such pending approval in this workspace' }), true
      a.status = m[2] === 'approve' ? 'approved' : 'denied'
      a.decided_at = now
      const { fingerprint: _f, ws: _w, ...out } = a
      return json(res, 200, out), true
    }
    if (rest === '/agents/statement' && method === 'GET') {
      const st = this.statement(ws.id, undefined, url)
      return json(res, typeof st === 'string' ? 400 : 200, typeof st === 'string' ? { error: st } : st), true
    }
    if (rest === '/agents/alerts') return json(res, 200, { alerts: [], rule: 'an alert when an agent\'s last hour reaches 5× its usual hourly rate' }), true
    if (rest === '/agents/forecast') {
      const d = new Date()
      return json(res, 200, { at: now, month_start: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(),
        month_end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString(), spent_ulxc: 0, forecast_ulxc: 0, agents: [] }), true
    }
    if (rest === '/agents/schedules') return json(res, 200, { schedules: [] }), true
    if (rest === '/agents/passkeys') return json(res, 200, { passkeys: [] }), true
    if (rest === '/agents/push/public-key') return json(res, 404, { error: 'economy: web push is not configured' }), true
    if (rest === '/agents/pause-all' || rest === '/agents/resume-all') {
      if (rest === '/agents/pause-all') this.allPaused.set(ws.id, { at: now, reason: (await this.body<{ reason?: string }>(req)).reason ?? '' })
      else this.allPaused.delete(ws.id)
      return json(res, 200, { all_paused: rest === '/agents/pause-all' }), true
    }
    if ((m = /^\/agents\/([^/]+)(\/[a-z-]+)?$/.exec(rest)) !== null) {
      const a = this.agents.get(m[1])
      if (a === undefined || a.ws !== ws.id) return json(res, 404, { error: 'economy: no such agent in this workspace' }), true
      const action = m[2] ?? ''
      if (action === '/keys' && method === 'POST') {
        const key = 'tlv_' + randomBytes(24).toString('hex')
        const keyID = id('key_')
        this.keys.set(key, a)
        a.keys.push(keyID)
        return json(res, 201, { agent_id: a.id, key, id: keyID, prefix: key.slice(0, 12), warning: 'Store this key securely. It will not be shown again.' }), true
      }
      if ((action === '/fund' || action === '/withdraw') && method === 'POST') {
        const { amount_ulxc: n = 0 } = await this.body<{ amount_ulxc?: number }>(req)
        if (!(n > 0)) return json(res, 400, { error: 'body must be {"amount_ulxc": <positive µLXC>}' }), true
        const have = action === '/fund' ? ws.balance - ((this.book(ws) as { allocated_ulxc: number }).allocated_ulxc) : this.balance(`agent:${a.id}`)
        if (n > have) return json(res, 409, { error: `economy: there are only ${lxc(have)} LXC to move` }), true
        const sign = action === '/fund' ? 1 : -1
        this.post(ws.id, action.slice(1), [['workspace', -sign * n, `agent:${a.id}`], [`agent:${a.id}`, sign * n, 'workspace']])
        return json(res, 200, { agent_id: a.id, balance_ulxc: this.balance(`agent:${a.id}`) }), true
      }
      if (action === '/rules' && method === 'GET') return json(res, 200, a.rules), true
      if (action === '/rules' && method === 'PUT') {
        const r = await this.body<Partial<Rules>>(req)
        a.rules = { ...noRules(), ...r, allowed_listings: r.allowed_listings ?? a.rules.allowed_listings,
          allowed_models: r.allowed_models ?? [], allowed_providers: r.allowed_providers ?? [] }
        return json(res, 200, a.rules), true
      }
      if (action === '/statement' && method === 'GET') {
        if (['from', 'to', 'format'].some((k) => url.searchParams.has(k))) {
          const st = this.statement(ws.id, a.id, url)
          return json(res, typeof st === 'string' ? 400 : 200, typeof st === 'string' ? { error: st } : st), true
        }
        const own = this.postings.filter((p) => p.account === `agent:${a.id}`)
        let after = 0
        const lines = own.map((p) => ({ entry_id: p.entry_id, kind: p.kind, amount_ulxc: p.amount_ulxc, counterparty: p.counterparty, ref: p.ref,
          balance_after_ulxc: (after += p.amount_ulxc), at: p.at }))
        return json(res, 200, { agent_id: a.id, lines: lines.reverse() }), true
      }
      if (action === '/pay' && method === 'POST') {
        const b = await this.body<{ to_agent_id?: string; amount_ulxc?: number; memo?: string }>(req)
        return this.pay(res, ws, a, b.to_agent_id ?? '', b.amount_ulxc ?? 0, b.memo ?? ''), true
      }
      if ((action === '/pause' || action === '/resume') && method === 'POST') {
        if (action === '/pause') {
          a.paused_at = now
          a.paused_reason = (await this.body<{ reason?: string }>(req)).reason ?? ''
        } else {
          a.paused_at = undefined
          a.paused_reason = undefined
        }
        return json(res, 200, { agent_id: a.id, paused: action === '/pause' }), true
      }
      if (action === '/topup' && method === 'GET') return json(res, 404, { error: 'the agent has no automatic top-up' }), true
      if (action === '/claim' && method === 'POST') return json(res, 200, { agent_id: a.id, owner_user_id: a.owner_user_id }), true
      return json(res, 404, { error: 'stub: no such agent route' }), true
    }

    // ── the marketplace ──
    if (rest === '/marketplace/listings' && method === 'POST') {
      const b = await this.body<Partial<Listing> & { artifact?: Record<string, unknown> }>(req)
      if (!b.title || b.artifact === undefined) return json(res, 400, { error: 'market: a listing needs a title and its artifact' }), true
      const l: Listing = { id: id('lst_'), workspace_id: ws.id, kind: b.kind ?? 'prompt', title: b.title, description: b.description ?? '',
        price_per_use_ulxc: b.price_per_use_ulxc ?? 0, visibility: b.visibility ?? 'public', latest_version: 1, created_at: now, updated_at: now,
        review_status: 'approved', artifact: b.artifact, changelog: b.changelog ?? '' }
      this.listings.set(l.id, l)
      return json(res, 201, this.listingOut(l, ws.id)), true
    }
    if (rest === '/marketplace/listings' && method === 'GET') {
      return json(res, 200, [...this.listings.values()].filter((l) => l.workspace_id === ws.id).map((l) => this.listingOut(l, ws.id))), true
    }
    if ((m = /^\/marketplace\/listings\/([^/]+)\/use$/.exec(rest)) !== null && method === 'POST') {
      const l = this.listings.get(m[1])
      if (l === undefined) return json(res, 404, { error: 'market: no such listing' }), true
      const b = await this.body<{ model?: string; variables?: Record<string, string> }>(req)
      const template = String(l.artifact.template ?? '')
      const missing = [...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((x) => x[1]).filter((v) => !(b.variables?.[v] ?? '').trim())
      if (missing.length > 0) return json(res, 400, { error: `market: the prompt needs ${missing.map((v) => `{{${v}}}`).join(', ')}` }), true
      const model = b.model || String(l.artifact.model ?? '')
      if (model === '') return json(res, 400, { error: 'market: this listing names no model, so the use must' }), true
      const ran = this.d.runModel(ws, model, template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, v: string) => b.variables?.[v] ?? ''))
      if ('error' in ran) return json(res, 400, { error: ran.error }), true
      const charge = l.workspace_id === ws.id ? 'own' : l.price_per_use_ulxc === 0 ? 'free' : 'billed'
      const use: Use = { id: id('use_'), listing_id: l.id, seller: l.workspace_id, buyer: ws.id, agent_id: '', price_ulxc: charge === 'billed' ? l.price_per_use_ulxc : 0,
        charge, used_at: now, payee_agent_id: '', memo: '' }
      this.uses.push(use)
      return json(res, 200, { id: use.id, listing_id: l.id, version: 1, kind: l.kind, model, charge, price_ulxc: use.price_ulxc, output: ran.answer, used_at: now }), true
    }
    if (rest === '/marketplace/earnings') {
      const pending = this.uses.filter((u) => u.seller === ws.id && u.charge === 'billed')
      const gross = pending.reduce((s, u) => s + u.price_ulxc, 0)
      return json(res, 200, { pending_uses: pending.length, pending_usd_micros: Math.floor(gross / 10), payable_usd_micros: 0, in_holdback_usd_micros: 0,
        available_usd_micros: 0, paid_out_usd_micros: 0, owed_usd_micros: 0, lifetime_gross_usd_micros: 0, refunded_usd_micros: 0, earnings: [] }), true
    }
    if (rest === '/marketplace/bill') {
      const month = url.searchParams.get('month') ?? now.slice(0, 7)
      const lines = this.uses.filter((u) => u.buyer === ws.id && u.charge === 'billed' && u.used_at.startsWith(month)).map((u) => ({
        use_id: u.id, listing_id: u.listing_id,
        title: u.listing_id !== '' ? this.listings.get(u.listing_id)?.title ?? '' : `Payment to ${this.agents.get(u.payee_agent_id)?.name ?? ''}`,
        agent_id: u.agent_id || undefined, price_ulxc: u.price_ulxc, used_at: u.used_at, payee_agent_id: u.payee_agent_id || undefined, memo: u.memo || undefined,
      }))
      const total = lines.reduce((s, l) => s + l.price_ulxc, 0)
      return json(res, 200, { month, total_ulxc: total, total_usd_micros: Math.floor(total / 10), refunded_ulxc: 0, lines }), true
    }
    return false
  }
}
