// B28.12 — Lens says what it is: "Agent Wallets and the gateway that enforces them", on its page at /, on /status and at
// the head of its API reference, which lists the wallet operations under an "Agent Wallets" tag with their schemas. A
// developer opens Lens's page, follows its API reference link and builds a wallet client from the document: the
// operations it names, the bodies they require and the fields they answer with. Then they drive the wallet by that
// document alone — create an agent, fund it 1 LXC, read its rules, the approvals and its statement — and the statement
// is what the document says it is: lines of AgentStatementLine, the one fund line +1,000,000 µLXC leaving 1,000,000.
// The oracle for the money is that statement row, never a status code.

import type { Scenario, ScenarioCtx, Verdict } from './scenarios.ts'

export const WALLET_LINE = 'Agent Wallets and the gateway that enforces them'
export const WALLET_TAG = 'Agent Wallets'
/** What the developer funds the agent with: 1 LXC. */
export const OPENAPI_FUND_ULXC = 1_000_000

/** The wallet operations B28.12 published: agents, keys, fund and withdraw, rules, approvals, statements, transfers, card. */
export const WALLET_OPS = [
  ['get', '/v1/workspaces/{wsID}/agents'],
  ['post', '/v1/workspaces/{wsID}/agents'],
  ['post', '/v1/workspaces/{wsID}/agents/{agentID}/keys'],
  ['post', '/v1/workspaces/{wsID}/agents/{agentID}/fund'],
  ['post', '/v1/workspaces/{wsID}/agents/{agentID}/withdraw'],
  ['get', '/v1/workspaces/{wsID}/agents/{agentID}/rules'],
  ['put', '/v1/workspaces/{wsID}/agents/{agentID}/rules'],
  ['get', '/v1/workspaces/{wsID}/agents/approvals'],
  ['post', '/v1/workspaces/{wsID}/agents/approvals/{approvalID}/approve'],
  ['post', '/v1/workspaces/{wsID}/agents/approvals/{approvalID}/deny'],
  ['get', '/v1/workspaces/{wsID}/agents/{agentID}/statement'],
  ['get', '/v1/workspaces/{wsID}/agents/statement'],
  ['post', '/v1/workspaces/{wsID}/agents/{agentID}/send'],
  ['get', '/v1/workspaces/{wsID}/agents/{agentID}/transfers'],
  ['get', '/v1/wallets/{address}'],
  ['get', '/v1/workspaces/{wsID}/agents/{agentID}/card'],
] as const

type Method = (typeof WALLET_OPS)[number][0]
type Path = (typeof WALLET_OPS)[number][1]
interface Schema { $ref?: string; type?: string; required?: string[]; properties?: Record<string, Schema>; items?: Schema; enum?: string[] }
interface Operation {
  tags?: string[]
  parameters?: { name: string; in: string }[]
  requestBody?: { content?: Record<string, { schema?: Schema }> }
  responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>
}
export interface Doc { info?: { description?: string }; tags?: { name: string }[]; paths?: Record<string, Record<string, Operation>>; components?: { schemas?: Record<string, Schema> } }

export const operation = (doc: Doc, method: Method, path: Path): Operation | undefined => doc.paths?.[path]?.[method]

/** A schema with its $ref followed, as a generated client resolves it; undefined when the ref dangles. */
export function resolve(doc: Doc, s: Schema | undefined): Schema | undefined {
  if (s?.$ref === undefined) return s
  return doc.components?.schemas?.[s.$ref.replace('#/components/schemas/', '')]
}

/** The schema an operation documents for one of its answers, or its JSON body. */
export function answerSchema(doc: Doc, op: Operation | undefined, status: string): Schema | undefined {
  return resolve(doc, op?.responses?.[status]?.content?.['application/json']?.schema)
}

export const bodySchema = (doc: Doc, op: Operation | undefined): Schema | undefined =>
  resolve(doc, op?.requestBody?.content?.['application/json']?.schema)

/** Every $ref under the wallet operations, and the ones the document does not hold. */
function danglingRefs(doc: Doc): string[] {
  const refs = new Set<string>()
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) x.forEach(walk)
    else if (x !== null && typeof x === 'object') {
      for (const [k, v] of Object.entries(x)) if (k === '$ref' && typeof v === 'string') refs.add(v); else walk(v)
    }
  }
  for (const [method, path] of WALLET_OPS) walk(operation(doc, method, path))
  walk(doc.components?.schemas)
  return [...refs].filter((r) => resolve(doc, { $ref: r }) === undefined)
}

/** The oracle for what Lens says it is: its two pages and the document its API reference link leads to. */
export function describedProblems(seen: { root: string; status: string; reference: string; doc: Doc | string }): string[] {
  const wrong: string[] = []
  if (!seen.root.includes(WALLET_LINE)) wrong.push(`Lens's page at / does not say "${WALLET_LINE}"`)
  if (!seen.status.includes(WALLET_LINE)) wrong.push(`/status does not say "${WALLET_LINE}"`)
  if (seen.reference !== '/openapi.json') wrong.push(`Lens's page at / links its API reference at ${seen.reference || 'nowhere'}, not /openapi.json`)
  if (typeof seen.doc === 'string') return [...wrong, `the API reference is not a document: ${seen.doc}`]
  const doc = seen.doc
  const description = doc.info?.description ?? ''
  if (!description.startsWith(WALLET_LINE)) wrong.push(`the API reference opens "${description.slice(0, 80)}", not "${WALLET_LINE}"`)
  if (doc.tags?.[0]?.name !== WALLET_TAG) wrong.push(`the API reference's first tag is ${doc.tags?.[0]?.name ?? 'none'}, not ${WALLET_TAG}`)
  const missing = WALLET_OPS.filter(([m, p]) => operation(doc, m, p) === undefined).map(([m, p]) => `${m.toUpperCase()} ${p}`)
  if (missing.length > 0) wrong.push(`the API reference lists no ${missing.join(', ')}`)
  const untagged = WALLET_OPS.filter(([m, p]) => { const op = operation(doc, m, p); return op !== undefined && op.tags?.[0] !== WALLET_TAG })
  if (untagged.length > 0) wrong.push(`${untagged.map(([m, p]) => `${m.toUpperCase()} ${p}`).join(', ')} not under ${WALLET_TAG}`)
  const dangling = danglingRefs(doc)
  if (dangling.length > 0) wrong.push(`the wallet operations name schemas the document does not hold: ${dangling.join(', ')}`)
  return wrong
}

/** What Lens answered as the developer drove the wallet by the document. */
export interface Driven {
  agentID: string
  fund: unknown
  rules: unknown
  approvals: unknown
  statement: unknown
  book: unknown
}

const fields = (x: unknown): Record<string, unknown> => (x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {})

/** The oracle for the drive: every answer carries the field the document names, and the statement is the funding's row. */
export function drivenProblems(doc: Doc, d: Driven): string[] {
  const wrong: string[] = []
  const fundOp = operation(doc, 'post', '/v1/workspaces/{wsID}/agents/{agentID}/fund')
  if (answerSchema(doc, fundOp, '200')?.properties?.balance_ulxc === undefined) wrong.push('the fund operation documents no balance_ulxc')
  const balance = fields(d.fund).balance_ulxc
  if (balance !== OPENAPI_FUND_ULXC) wrong.push(`funding ${OPENAPI_FUND_ULXC} µLXC answered balance_ulxc ${String(balance)}`)

  if (typeof d.rules !== 'object' || d.rules === null || Array.isArray(d.rules)) wrong.push(`the agent's rules answered ${JSON.stringify(d.rules)}, not the documented AgentRules object`)
  const approvalsSchema = answerSchema(doc, operation(doc, 'get', '/v1/workspaces/{wsID}/agents/approvals'), '200')
  if (approvalsSchema?.properties?.approvals === undefined) wrong.push('the approvals operation documents no approvals list')
  else if (!Array.isArray(fields(d.approvals).approvals)) wrong.push(`the approvals answered ${JSON.stringify(d.approvals).slice(0, 120)}, with no approvals list`)

  const bookSchema = answerSchema(doc, operation(doc, 'get', '/v1/workspaces/{wsID}/agents'), '200')
  const agents = fields(d.book).agents
  const listed = Array.isArray(agents) ? agents.map(fields).find((a) => a.id === d.agentID) : undefined
  if (bookSchema?.properties?.agents === undefined) wrong.push('the agents operation documents no agents list')
  else if (listed === undefined) wrong.push(`the workspace's agents do not list ${d.agentID}`)
  else if (listed.balance_ulxc !== OPENAPI_FUND_ULXC) wrong.push(`the workspace's agents list ${d.agentID} at ${String(listed.balance_ulxc)} µLXC, not ${OPENAPI_FUND_ULXC}`)

  const statementSchema = answerSchema(doc, operation(doc, 'get', '/v1/workspaces/{wsID}/agents/{agentID}/statement'), '200')
  const lineSchema = resolve(doc, statementSchema?.properties?.lines?.items)
  const lines = fields(d.statement).lines
  if (lineSchema?.properties === undefined) return [...wrong, 'the statement operation documents no lines of AgentStatementLine']
  if (!Array.isArray(lines)) return [...wrong, `the statement answered ${JSON.stringify(d.statement).slice(0, 120)}, with no lines`]
  const named = Object.keys(lineSchema.properties)
  const kinds = lineSchema.properties.kind?.enum ?? []
  for (const line of lines.map(fields)) {
    const extra = Object.keys(line).filter((k) => !named.includes(k))
    if (extra.length > 0) wrong.push(`a statement line carries ${extra.join(', ')}, which AgentStatementLine does not name`)
    if (!kinds.includes(String(line.kind))) wrong.push(`a statement line's kind "${String(line.kind)}" is not one AgentStatementLine allows (${kinds.join(', ')})`)
  }
  const shown = lines.map(fields).map((l) => `${String(l.kind)} ${String(l.amount_ulxc)} → ${String(l.balance_after_ulxc)}`).join('; ') || 'no lines'
  const fund = lines.map(fields)
  if (fund.length !== 1 || fund[0].kind !== 'fund' || fund[0].amount_ulxc !== OPENAPI_FUND_ULXC || fund[0].balance_after_ulxc !== OPENAPI_FUND_ULXC) {
    wrong.push(`the agent's statement is not the one fund line of +${OPENAPI_FUND_ULXC} µLXC leaving ${OPENAPI_FUND_ULXC}: ${shown}`)
  }
  return wrong
}

/** Where the page's API reference link goes, as a path on Lens when it is one. */
export function referenceOf(html: string, base: string): string {
  const a = [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].find(([, , inner]) => /API reference/.test(inner))
  if (a === undefined) return ''
  const url = new URL(a[1], base)
  return url.origin === new URL(base).origin ? url.pathname : url.href
}

export function openapiWallets(seed: number): Scenario {
  return {
    id: 'openapi-wallets',
    owner: 'talyvor-lens',
    items: ['B28.12'],
    agents: 1,
    feature: 'Agent Wallets',
    title: "Lens's page, /status and API reference open on Agent Wallets, and a wallet driven by that document alone: an agent created, funded 1 LXC, its statement the documented fund line",
    run: async (ctx: ScenarioCtx): Promise<Verdict> => {
      const lens = ctx.env.lens
      const html = { Accept: 'text/html' }
      const root = await lens.as('', 'GET', '/', undefined, html)
      const status = await lens.as('', 'GET', '/status', undefined, html)
      const reference = referenceOf(root.text, lens.baseURL)
      // The developer follows the page's link; with none, they type the address the document is served at.
      const spec = await lens.as('', 'GET', reference.startsWith('/') ? reference : '/openapi.json')
      let doc: Doc | string
      try {
        doc = spec.status === 200 ? JSON.parse(spec.text) as Doc : `${spec.status} ${spec.text.slice(0, 120)}`
      } catch {
        doc = `not JSON: ${spec.text.slice(0, 120)}`
      }
      ctx.evidence.push({ note: `/ ${root.status}, /status ${status.status}; the API reference link ${reference || 'none'}; the document ${typeof doc === 'string' ? doc : `opens "${(doc.info?.description ?? '').slice(0, 80)}", tags ${JSON.stringify((doc.tags ?? []).map((t) => t.name))}`}` })
      const described = describedProblems({ root: root.text, status: status.text, reference, doc })
      if (typeof doc === 'string' || described.length > 0) return { pass: false, detail: described.join('; ') }

      // A client built from the document: each call is an operation it lists, its body the fields it requires.
      const { user } = ctx.app
      const call = async (method: Method, path: Path, ids: Record<string, string>, values: Record<string, unknown> = {}): Promise<{ status: number; value: unknown; wrong?: string }> => {
        const op = operation(doc as Doc, method, path)
        const required = bodySchema(doc as Doc, op)?.required ?? []
        const unknown = required.filter((f) => !(f in values))
        if (unknown.length > 0) return { status: 0, value: null, wrong: `${method.toUpperCase()} ${path} requires ${unknown.join(', ')}, which the document gives no value for` }
        const headers = Object.fromEntries((op?.parameters ?? []).filter((p) => p.in === 'header' && p.name === 'Idempotency-Key').map((p) => [p.name, `openapi-${ids.agentID ?? seed}`]))
        const filled = path.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(ids[k] ?? ''))
        const r = await lens.as(user.token, method.toUpperCase(), filled, op?.requestBody === undefined ? undefined : Object.fromEntries(required.map((f) => [f, values[f]])), headers)
        let value: unknown = r.text
        try { value = JSON.parse(r.text) } catch { /* the text is the answer */ }
        const documented = Object.keys(op?.responses ?? {})
        return documented.includes(String(r.status)) ? { status: r.status, value } : { status: r.status, value, wrong: `${method.toUpperCase()} ${path} answered ${r.status} (${r.text.slice(0, 120)}), which it documents no answer for` }
      }
      const ws = { wsID: user.workspaceID }
      const created = await call('post', '/v1/workspaces/{wsID}/agents', ws, { name: `OpenAPI reader ${seed}` })
      if (created.wrong !== undefined) return { pass: false, detail: created.wrong }
      const agentID = fields(created.value).id
      if (typeof agentID !== 'string' || answerSchema(doc, operation(doc, 'post', '/v1/workspaces/{wsID}/agents'), '201')?.properties?.id === undefined) {
        return { pass: false, detail: `creating an agent answered ${JSON.stringify(created.value).slice(0, 160)}: no id the documented Agent names` }
      }
      const ids = { ...ws, agentID }
      const fund = await call('post', '/v1/workspaces/{wsID}/agents/{agentID}/fund', ids, { amount_ulxc: OPENAPI_FUND_ULXC })
      const rules = await call('get', '/v1/workspaces/{wsID}/agents/{agentID}/rules', ids)
      const approvals = await call('get', '/v1/workspaces/{wsID}/agents/approvals', ws)
      const statement = await call('get', '/v1/workspaces/{wsID}/agents/{agentID}/statement', ids)
      const book = await call('get', '/v1/workspaces/{wsID}/agents', ws)
      ctx.evidence.push({ note: `agent ${agentID} funded by the document's fund operation: ${JSON.stringify(fund.value).slice(0, 160)}` })
      const lines = fields(statement.value).lines
      if (Array.isArray(lines)) ctx.evidence.push({ note: `the statement of ${agentID}`, ledger: lines.map(fields).map((l) => ({ type: String(l.kind), amount_ulxc: Number(l.amount_ulxc), created_at: String(l.at) })) })

      const wrong = [fund, rules, approvals, statement, book].flatMap((a) => (a.wrong === undefined ? [] : [a.wrong]))
      wrong.push(...drivenProblems(doc, { agentID, fund: fund.value, rules: rules.value, approvals: approvals.value, statement: statement.value, book: book.value }))
      return wrong.length === 0
        ? { pass: true, detail: `/ and /status say "${WALLET_LINE}" and / links /openapi.json, which opens on it with ${WALLET_TAG} first and its ${WALLET_OPS.length} wallet operations; driven by that document, agent ${agentID} holds the one fund line of +${OPENAPI_FUND_ULXC} µLXC leaving ${OPENAPI_FUND_ULXC}` }
        : { pass: false, detail: wrong.join('; ') }
    },
  }
}
