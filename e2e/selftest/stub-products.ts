// B17.8 SELF-TEST — stand-ins for Track and Docs, the two upstreams the BFF forwards /api/track/* and
// /api/docs/* to (apps/bff/lens.go forwardProduct). Like stub-lens.ts, it keeps only the contracts the
// app and the scenarios read: the workspace bootstrap, spaces and pages, issues and comments, and each
// product's AI routes, answered by rules simple enough for every oracle to have something true to check.
//
// STUB_BREAK=<name> plants one defect:
//   docs-ai      — Docs' Ask answers without citing any page
//   track-ai     — Track names no duplicate, however alike two issues are
//   export       — a list read of 250 issues (the export's page size) leaves the oldest one out
//   docs-export  — a Docs page's HTML export is set in Inter, its links in #f0a030
//   seats        — Track adds a member without asking Lens whether the plan has a seat for them (B32.71)
//   file-bug     — Track's MCP create_issue says it filed the issue and keeps nothing (B28.374)

import { randomBytes } from 'node:crypto'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'

const TRACK_PORT = Number(process.env.TRACK_PORT ?? 9912)
const DOCS_PORT = Number(process.env.DOCS_PORT ?? 9913)
const SECRET = process.env.GATEWAY_SECRET ?? 'selftest-gateway'
const BREAK = process.env.STUB_BREAK ?? ''
/** B32.71 — the stub Lens, which Track asks about a plan's seats (B32.73), and the stand-in for the credential it mints. */
const LENS_URL = process.env.LENS_URL ?? 'http://127.0.0.1:9911'
const LENS_KEY = process.env.LENS_SYNTHETIC_KEY ?? 'selftest-key'

const id = (): string => randomBytes(8).toString('hex')
const now = (): string => new Date().toISOString()

function json(res: ServerResponse, status: number, body: unknown): void {
  if (status === 204) return void res.writeHead(204).end()
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function body<T>(req: IncomingMessage): Promise<T> {
  let s = ''
  for await (const chunk of req) s += chunk
  return (s === '' ? {} : JSON.parse(s)) as T
}

const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? [])
function overlap(a: string, b: string): number {
  const [x, y] = [words(a), words(b)]
  const shared = [...x].filter((w) => y.has(w)).length
  return shared / Math.max(1, Math.min(x.size, y.size))
}
const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s !== '')

/** One workspace per identity, as Track's bootstrap makes it; Docs uses the same id. */
const byEmail = new Map<string, string>()

function serve(port: number, name: string, route: (req: IncomingMessage, res: ServerResponse, path: string, url: URL) => Promise<void>): void {
  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    try {
      // B34.5 — a published board is read by anyone with its link: the BFF sends no gateway proof for it (publicBoard).
      if (req.headers['x-gateway-auth'] !== SECRET && !url.pathname.startsWith('/v1/public/')) return json(res, 401, { error: 'gateway proof required' })
      if (url.pathname === '/v1/bootstrap' && req.method === 'POST') {
        const email = String(req.headers['x-user-email'] ?? '')
        if (email === '') return json(res, 400, { error: 'no identity' })
        const created = !byEmail.has(email)
        if (created) byEmail.set(email, 'tw-' + id())
        return json(res, 200, { workspace_id: byEmail.get(email), slug: email.split('@')[0], created })
      }
      await route(req, res, url.pathname, url)
    } catch (e) {
      json(res, 500, { error: String(e) })
    }
  }).listen(port, '127.0.0.1', () => console.log(`stub ${name} on http://127.0.0.1:${port}${BREAK !== '' ? ` (broken: ${BREAK})` : ''}`))
}

// ─── Track ───────────────────────────────────────────────────────────────────

interface Issue {
  id: string; workspace: string; identifier: string; title: string; description: string; status: string; priority: number
  team_id: string; project_id: null; assignee_id: null; ai_cost_usd: number; ai_tokens: number; created_at: string; updated_at: string
  cycle_id?: string | null
}
/** B34.5 — a team's cycles, the read-only board links a workspace published, and the workspaces deleted, as Track keeps them. */
interface Cycle { id: string; workspace: string; team_id: string; number: number; name: string; status: string; start_date: string; end_date: string }
interface BoardLink { id: string; workspace: string; token: string; created_at: string; project_id?: string }
const cycles: Cycle[] = []
const boards: BoardLink[] = []
const deletedAt = new Map<string, string>()
const RESTORE_DAYS = 14
const trackView = (ws: string) => ({ id: ws, name: 'Synthetic tracker', slug: 'synthetic',
  ...(deletedAt.has(ws) ? { deleted_at: deletedAt.get(ws), restorable_until: new Date(Date.parse(deletedAt.get(ws)!) + RESTORE_DAYS * 86400e3).toISOString() } : {}) })
interface Comment { id: string; issue_id: string; author_id: string; body: string; created_at: string }

const issues: Issue[] = []
const comments: Comment[] = []
const TEAM = { id: 'team-eng', identifier: 'ENG', name: 'Engineering' }

/** Track's memberView. A workspace's roster starts as the identity that bootstrapped it, its owner. */
interface Member { id: string; name: string; email: string; role: 'owner' | 'member'; avatar_url: string }
const rosters = new Map<string, Member[]>()
function rosterOf(ws: string): Member[] {
  let roster = rosters.get(ws)
  if (roster === undefined) {
    const owner = [...byEmail].find(([, w]) => w === ws)?.[0] ?? ''
    roster = [{ id: id(), name: owner, email: owner, role: 'owner', avatar_url: '' }]
    rosters.set(ws, roster)
  }
  return roster
}

/**
 * B32.71 — POST /v1/workspaces/{ws}/members as Track answers it (internal/member/mgmt_handler.go Add): before
 * the add, Lens is asked whether the plan of the Lens workspace the BFF names (X-Lens-Workspace) has a seat for
 * one more; its 402 is relayed in its own words, and a check that cannot be made refuses as unchecked.
 */
async function addMember(req: IncomingMessage, res: ServerResponse, ws: string): Promise<void> {
  const { email = '', role = 'member' } = await body<{ email?: string; role?: string }>(req)
  if (email === '') return json(res, 400, { error: 'email is required', code: 'BAD_PARAMS' })
  const roster = rosterOf(ws)
  if (roster.some((m) => m.email === email)) return json(res, 409, { error: 'member already exists', code: 'MEMBER_EXISTS' })
  if (BREAK !== 'seats') {
    const lensWS = String(req.headers['x-lens-workspace'] ?? '')
    if (lensWS === '') return json(res, 503, { error: 'lens: seats check: no Lens workspace on the request (X-Lens-Workspace)', code: 'SEATS_UNCHECKED' })
    const asked = await fetch(`${LENS_URL}/v1/workspaces/${encodeURIComponent(lensWS)}/plan/seats?members=${roster.length + 1}`,
      { headers: { 'X-Talyvor-Synthetic-Key': LENS_KEY } })
    if (asked.status === 402) {
      const r = (await asked.json()) as { error: string; plan: string; limit: number; allows?: string }
      return json(res, 402, { error: r.error, code: 'PLAN_SEATS', plan: r.plan, limit: r.limit, allows: r.allows })
    }
    if (asked.status !== 200) return json(res, 503, { error: `lens: seats check: Lens answered ${asked.status}`, code: 'SEATS_UNCHECKED' })
  }
  const m: Member = { id: id(), name: email, email, role: role === 'owner' ? 'owner' : 'member', avatar_url: '' }
  roster.push(m)
  return json(res, 201, m)
}

/** One JSON-RPC request to a stub's /mcp, and its answer: a result, or an error with JSON-RPC's code. */
type RPC = { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
const rpcResult = (res: ServerResponse, result: unknown) => json(res, 200, { jsonrpc: '2.0', id: 1, result })
const rpcError = (res: ServerResponse, code: number, message: string) => json(res, 200, { jsonrpc: '2.0', id: 1, error: { code, message } })
const rpcText = (res: ServerResponse, v: unknown) => rpcResult(res, { content: [{ type: 'text', text: JSON.stringify(v) }] })
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * B28.374 — Track's /mcp as Chat uses it (talyvor-track internal/mcp): create_issue and search_issues, each acting on
 * the workspace_id argument, which must be the caller's own — the authz chokepoint's check — and create_issue in one of
 * its teams. What create_issue files is an issue like any other, so /api/track/issues lists it.
 */
async function trackMCP(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rpc = await body<RPC>(req)
  if (rpc.method === 'tools/list') {
    return rpcResult(res, { tools: [
      { name: 'create_issue', description: 'Create a new issue in a team\'s queue. Returns the assigned identifier (e.g. ENG-42) and a URL that opens the issue in Track.',
        inputSchema: { type: 'object', properties: { workspace_id: { type: 'string' }, team_id: { type: 'string' }, title: { type: 'string', description: 'Short summary; appears in lists.' },
          description: { type: 'string', description: 'Markdown body; optional.' } }, required: ['workspace_id', 'team_id', 'title'] } },
      { name: 'search_issues', description: 'Full-text search over issue titles and descriptions.',
        inputSchema: { type: 'object', properties: { workspace_id: { type: 'string' }, query: { type: 'string' } }, required: ['workspace_id', 'query'] } },
      { name: 'update_issue', description: 'Patch one or more fields of an existing issue.', inputSchema: { type: 'object', properties: { issue_id: { type: 'string' } }, required: ['issue_id'] } },
    ] })
  }
  if (rpc.method !== 'tools/call') return rpcError(res, -32601, 'method not found')
  const args = rpc.params?.arguments ?? {}
  const ws = str(args.workspace_id)
  if (ws === '' || byEmail.get(String(req.headers['x-user-email'] ?? '')) !== ws) return rpcError(res, -32001, 'not a member of this workspace')
  const mine = issues.filter((i) => i.workspace === ws)
  if (rpc.params?.name === 'search_issues') {
    const q = str(args.query).toLowerCase().split(/\s+/).filter((w) => w !== '')
    return rpcText(res, mine.filter((i) => q.every((w) => `${i.title} ${i.description}`.toLowerCase().includes(w))).map((i) => ({ id: i.id, identifier: i.identifier, title: i.title, status: i.status })))
  }
  if (rpc.params?.name !== 'create_issue') return rpcError(res, -32601, `unknown tool: ${rpc.params?.name}`)
  if (str(args.team_id) !== TEAM.id) return rpcError(res, -32602, 'team_id required')
  if (str(args.title).trim() === '') return rpcError(res, -32602, 'title required')
  const at = now()
  const issue: Issue = { id: id(), workspace: ws, identifier: `ENG-${mine.length + 1}`, title: str(args.title), description: str(args.description), status: 'todo',
    priority: 0, team_id: TEAM.id, project_id: null, assignee_id: null, ai_cost_usd: 0, ai_tokens: 0, created_at: at, updated_at: at }
  if (BREAK !== 'file-bug') issues.push(issue)
  return rpcText(res, { id: issue.id, identifier: issue.identifier, title: issue.title, status: issue.status, priority: 0, url: `/issues/${issue.identifier}` })
}

/**
 * B28.376 — Track's syncer (talyvor-track lensintegration SyncFeatureSpend): each request's spend Lens kept is landed once,
 * by its request id, on the issue whose identifier it named, adding to that issue's AI cost. Track pulls every 15 minutes;
 * the stub pulls as issues are read. The Lens workspace is the synthetic sign-in's: its email is <workspace>@synthetic.talyvor.invalid.
 */
const landed = new Set<string>()
async function syncSpend(ws: string, email: string): Promise<void> {
  const lensWS = email.endsWith('@synthetic.talyvor.invalid') ? email.split('@')[0] : ''
  if (lensWS === '') return
  const r = await fetch(`${LENS_URL}/v1/api/spend/by-request?workspace_id=${encodeURIComponent(lensWS)}&days=1`,
    { headers: { 'X-Talyvor-Synthetic-Key': LENS_KEY } }).catch(() => undefined)
  if (r === undefined || !r.ok) return
  const { rows = [] } = (await r.json()) as { rows?: { request_id: string; issue_id: string; cost_usd: number; input_tokens: number; output_tokens: number }[] }
  for (const row of rows) {
    if (row.request_id === '' || landed.has(row.request_id)) continue
    landed.add(row.request_id)
    const issue = issues.find((i) => i.workspace === ws && row.issue_id !== '' && i.identifier === row.issue_id)
    if (issue === undefined) continue
    issue.ai_cost_usd += row.cost_usd
    issue.ai_tokens += row.input_tokens + row.output_tokens
  }
}

serve(TRACK_PORT, 'track', async (req, res, path, url) => {
  if (path === '/mcp' && req.method === 'POST') return trackMCP(req, res)
  if (path === '/v1/workspaces') {
    const ws = byEmail.get(String(req.headers['x-user-email'] ?? ''))
    const deleted = url.searchParams.get('deleted') === 'true'
    return json(res, 200, ws === undefined || deletedAt.has(ws) !== deleted ? [] : [trackView(ws)])
  }
  // B34.5 — a workspace deleted by its owner, confirmed by its slug, and restored within RESTORE_DAYS.
  const whole = /^\/v1\/workspaces\/([^/]+)(\/restore)?$/.exec(path)
  if (whole !== null && ((req.method === 'DELETE' && whole[2] === undefined) || (req.method === 'POST' && whole[2] === '/restore'))) {
    const ws = whole[1]
    if (byEmail.get(String(req.headers['x-user-email'] ?? '')) !== ws) return json(res, 403, { error: 'only the owner may do this', code: 'FORBIDDEN' })
    if (req.method === 'DELETE') {
      if ((await body<{ confirm?: string }>(req)).confirm !== 'synthetic') return json(res, 400, { error: 'type the workspace slug to confirm', code: 'CONFIRMATION_REQUIRED' })
      deletedAt.set(ws, now())
    } else {
      if (!deletedAt.has(ws)) return json(res, 404, { error: 'no deleted workspace with that id' })
      deletedAt.delete(ws)
    }
    return json(res, 200, trackView(ws))
  }
  const shared = /^\/v1\/public\/issue-boards\/([^/]+)$/.exec(path)
  if (shared !== null) {
    const b = boards.find((x) => x.token === shared[1])
    if (b === undefined) return json(res, 404, { error: 'no such board' })
    return json(res, 200, { workspace: 'Synthetic tracker', truncated: false, issues: issues.filter((i) => i.workspace === b.workspace).reverse()
      .map((i) => ({ identifier: i.identifier, title: i.title, status: i.status, priority: i.priority, updated_at: i.updated_at })) })
  }
  const m = /^\/v1\/workspaces\/([^/]+)(\/.*)$/.exec(path)
  if (m === null) return json(res, 404, { error: 'stub track: no such route' })
  const [, ws, rest] = m
  if (req.method === 'GET' && (rest === '/issues' || /^\/issues\/[^/]+$/.test(rest))) await syncSpend(ws, String(req.headers['x-user-email'] ?? ''))
  const mine = issues.filter((i) => i.workspace === ws)
  if (rest === '/teams') return json(res, 200, [TEAM])
  if (rest === '/members' && req.method === 'POST') return await addMember(req, res, ws)
  if (rest === '/members') return json(res, 200, rosterOf(ws))
  if (rest === '/projects') return json(res, 200, [])
  if (rest === `/teams/${TEAM.id}/cycles` && req.method === 'POST') {
    const b = await body<{ name?: string; start_date?: string; end_date?: string }>(req)
    if (!b.name || !b.start_date || !b.end_date) return json(res, 400, { error: 'name, start_date and end_date required' })
    const c: Cycle = { id: id(), workspace: ws, team_id: TEAM.id, number: cycles.filter((x) => x.workspace === ws).length + 1, name: b.name, status: 'active',
      start_date: b.start_date, end_date: b.end_date }
    cycles.push(c)
    return json(res, 201, c)
  }
  if (rest === `/teams/${TEAM.id}/cycles`) return json(res, 200, cycles.filter((c) => c.workspace === ws))
  const progress = /^\/teams\/[^/]+\/cycles\/([^/]+)\/progress$/.exec(rest)
  if (progress !== null) {
    const inIt = mine.filter((i) => i.cycle_id === progress[1])
    const done = inIt.filter((i) => i.status === 'done').length
    const going = inIt.filter((i) => i.status === 'in_progress').length
    return json(res, 200, { cycle_id: progress[1], total_issues: inIt.length, completed: done, in_progress: going, not_started: inIt.length - done - going,
      completion_pct: inIt.length === 0 ? 0 : (100 * done) / inIt.length, total_ai_cost_usd: 0, avg_ai_cost_per_issue: 0 })
  }
  if (rest === '/issue-boards' && req.method === 'POST') {
    const { project_id } = await body<{ project_id?: string }>(req)
    const b: BoardLink = { id: id(), workspace: ws, token: randomBytes(18).toString('base64url'), created_at: now(), ...(project_id ? { project_id } : {}) }
    boards.push(b)
    const { workspace: _w, ...out } = b
    return json(res, 201, out)
  }
  if (rest === '/issue-boards') return json(res, 200, boards.filter((b) => b.workspace === ws).map(({ workspace: _w, ...b }) => b))
  const board = /^\/issue-boards\/([^/]+)$/.exec(rest)
  if (board !== null && req.method === 'DELETE') {
    const at = boards.findIndex((b) => b.workspace === ws && b.id === board[1])
    if (at < 0) return json(res, 404, { error: 'no such board' })
    boards.splice(at, 1)
    return json(res, 204, null)
  }
  // Search: every word of the query in the issue's title or description (Track's full-text arm).
  if (rest === '/issues/semantic-search') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter((w) => w !== '')
    if (q.length === 0) return json(res, 400, { error: 'q required' })
    return json(res, 200, mine.filter((i) => q.every((w) => `${i.title} ${i.description}`.toLowerCase().includes(w))).slice(0, Number(url.searchParams.get('limit') ?? 25)))
  }
  if (rest === '/issues' && req.method === 'POST') {
    const { title = '' } = await body<{ title?: string }>(req)
    if (title.trim() === '') return json(res, 400, { error: 'title required' })
    const at = now()
    const issue: Issue = { id: id(), workspace: ws, identifier: `ENG-${mine.length + 1}`, title, description: '', status: 'backlog',
      priority: 0, team_id: TEAM.id, project_id: null, assignee_id: null, ai_cost_usd: 0, ai_tokens: 0, created_at: at, updated_at: at }
    issues.push(issue)
    return json(res, 201, issue)
  }
  if (rest === '/issues') {
    const limit = Number(url.searchParams.get('limit') ?? 50)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const cycle = url.searchParams.get('cycle_id')
    const page = [...mine].filter((i) => cycle === null || i.cycle_id === cycle).reverse().slice(offset, offset + limit)
    if (BREAK === 'export' && limit === 250 && page.length > 0) page.pop()
    return json(res, 200, page)
  }
  const one = /^\/issues\/([^/]+)(\/.*)?$/.exec(rest)
  const issue = one === null ? undefined : mine.find((i) => i.id === one[1])
  if (one === null || issue === undefined) return json(res, 404, { error: 'no such issue' })
  const sub = one[2] ?? ''
  const thread = comments.filter((c) => c.issue_id === issue.id)
  if (sub === '' && req.method === 'PATCH') {
    Object.assign(issue, await body<Partial<Issue>>(req), { updated_at: now() })
    return json(res, 200, issue)
  }
  if (sub === '') return json(res, 200, issue)
  if (sub === '/comments' && req.method === 'POST') {
    const c: Comment = { id: id(), issue_id: issue.id, author_id: 'synthetic', body: (await body<{ body?: string }>(req)).body ?? '', created_at: now() }
    comments.push(c)
    issue.updated_at = now()
    return json(res, 201, c)
  }
  if (sub === '/comments') return json(res, 200, thread)
  if (sub === '/summary') {
    if (thread.length < 10) return json(res, 200, { summary_available: false, min_comments: 10 })
    // The stand-in "model": the thread's sentences, the last one as the next step.
    const said = thread.flatMap((c) => sentences(c.body))
    return json(res, 200, { summary: `${issue.title}. ${said.join(' ')}`, key_points: said, next_action: said[said.length - 1], sentiment: 'neutral' })
  }
  if (sub === '/find-duplicates' && req.method === 'POST') {
    if (BREAK === 'track-ai') return json(res, 200, [])
    return json(res, 200, mine
      .filter((i) => i.id !== issue.id)
      .map((i) => ({ issue_id: i.id, identifier: i.identifier, title: i.title, similarity: overlap(i.title, issue.title) }))
      .filter((d) => d.similarity >= 0.6)
      .sort((a, b) => b.similarity - a.similarity))
  }
  if (sub === '/triage' && req.method === 'POST') {
    return json(res, 200, { suggested_priority: /times out|error|fail/i.test(issue.title) ? 2 : 3, suggested_labels: ['bug'],
      suggested_assignee: null, summary: issue.title, is_duplicate: false, confidence: 0.7 })
  }
  return json(res, 404, { error: 'stub track: no such route' })
})

// ─── Docs ────────────────────────────────────────────────────────────────────

interface Space { id: string; workspace: string; name: string; slug: string; description: string; icon: string; private: boolean }
interface Page { id: string; space_id: string; title: string; content: string; content_text: string; ai_cost_usd: number; own_ai_cost_usd: number; total_ai_cost_usd: number }
/** B34.5 — the pages each workspace pinned, newest first. */
const pinned: { ws: string; page_id: string; space_id: string; at: string }[] = []

const spaces: Space[] = []
const pages: Page[] = []

/** The plain text of a stored ProseMirror document: its text nodes, one line per block. */
function plainText(content: string): string {
  const lines: string[] = []
  const walk = (n: { type?: string; text?: string; content?: unknown[] }, line: string[]): void => {
    if (typeof n.text === 'string') line.push(n.text)
    for (const c of (n.content ?? []) as (typeof n)[]) {
      if (c.type === 'text' || c.type === 'hard_break') walk(c, line)
      else {
        const inner: string[] = []
        walk(c, inner)
        if (inner.length > 0) lines.push(inner.join(''))
      }
    }
  }
  try {
    walk(JSON.parse(content), [])
  } catch {
    return content
  }
  return lines.join('\n')
}

// B29.31 — Docs' own export stylesheet (talyvor-docs internal/export/exporter.go htmlStyles), so the export the
// nightly brand check photographs here is the one Docs writes.
const EXPORT_STYLES = `:root{--tv-canvas:#F4F7FB;--tv-surface:#FFFFFF;--tv-line:rgba(6,10,18,.10);--tv-ink:#060A12;--tv-ink-muted:#46586E;--tv-label:#646B79;--tv-accent:#0F7A6C}
@media screen and (prefers-color-scheme:dark){:root{--tv-canvas:#060A12;--tv-surface:#081220;--tv-line:rgba(126,147,171,.18);--tv-ink:#E6EEF7;--tv-ink-muted:#7E93AB;--tv-label:#90ACC0;--tv-accent:#3AD6C0}}
body{font-family:"Space Grotesk",system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;background:var(--tv-canvas);color:var(--tv-ink);line-height:1.6}
h1{color:var(--tv-ink);font-weight:500;letter-spacing:-0.01em;line-height:1.25;font-size:2em;padding-bottom:0.3em}
a{color:var(--tv-accent)}
.meta{font-family:"IBM Plex Mono",ui-monospace,monospace;color:var(--tv-ink-muted);font-size:0.85em;margin-bottom:2em}
footer{margin-top:3em;padding-top:1em;border-top:1px solid var(--tv-line);color:var(--tv-label);font-size:0.85em;text-align:center}`
const BROKEN_STYLES = 'body{font-family:Inter,sans-serif}a{color:#f0a030}'

const escapeHTML = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function exportHTML(p: Page): string {
  const body = p.content_text.split('\n').filter((l) => l.trim() !== '').map((l) => `<p>${escapeHTML(l)}</p>`).join('\n')
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${escapeHTML(p.title)}</title>\n` +
    `<style>${EXPORT_STYLES}${BREAK === 'docs-export' ? BROKEN_STYLES : ''}</style>\n</head>\n<body>\n<h1>${escapeHTML(p.title)}</h1>\n` +
    `<div class="meta">Updated ${new Date().toDateString()}</div>\n${body}\n<p><a href="https://talyvor.com">talyvor.com</a></p>\n` +
    '<footer>Exported from Talyvor Docs</footer>\n</body>\n</html>\n'
}

serve(DOCS_PORT, 'docs', async (req, res, path, url) => {
  let m: RegExpExecArray | null
  // B28.374 — Docs' /mcp as Chat uses it (talyvor-docs internal/mcp): search_docs over the pages, by title and text.
  if (path === '/mcp' && req.method === 'POST') {
    const rpc = await body<RPC>(req)
    if (rpc.method === 'tools/list') {
      return rpcResult(res, { tools: [{ name: 'search_docs', description: 'Search Talyvor Docs by query string.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, workspace_id: { type: 'string' } }, required: ['query', 'workspace_id'] } }] })
    }
    if (rpc.method !== 'tools/call' || rpc.params?.name !== 'search_docs') return rpcError(res, -32601, 'method not found')
    const q = str(rpc.params.arguments?.query).toLowerCase()
    return rpcText(res, pages.filter((p) => `${p.title} ${p.content_text}`.toLowerCase().includes(q)).slice(0, 5).map((p) => ({ id: p.id, title: p.title, space_id: p.space_id })))
  }
  if ((m = /^\/v1\/spaces\/([^/]+)\/pages\/([^/]+)\/export$/.exec(path))) {
    const [, space, pageID] = m
    const p = pages.find((x) => x.space_id === space && x.id === pageID)
    if (p === undefined) return json(res, 404, { error: 'no such page' })
    if (url.searchParams.get('format') !== 'html') return json(res, 400, { error: 'stub docs: html only' })
    const slug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}.html"` })
    res.end(exportHTML(p))
    return
  }
  if (path === '/v1/spaces' && req.method === 'POST') {
    const b = await body<{ name?: string; workspace_id?: string }>(req)
    if (!b.name || !b.workspace_id) return json(res, 400, { error: 'name and workspace_id required' })
    const s: Space = { id: id(), workspace: b.workspace_id, name: b.name, slug: b.name.toLowerCase().replace(/\W+/g, '-'), description: '', icon: '', private: false }
    spaces.push(s)
    return json(res, 201, s)
  }
  if ((m = /^\/v1\/spaces\/([^/]+)\/pages\/([^/]+)\/(pin|changelog\/generate)$/.exec(path))) {
    const [, space, pageID, what] = m
    const sp = spaces.find((x) => x.id === space)
    const p = pages.find((x) => x.space_id === space && x.id === pageID)
    if (sp === undefined || p === undefined) return json(res, 404, { error: 'no such page' })
    if (what === 'pin') {
      const at = pinned.findIndex((x) => x.ws === sp.workspace && x.page_id === pageID)
      if (req.method === 'PUT' && at < 0) pinned.unshift({ ws: sp.workspace, page_id: pageID, space_id: space, at: now() })
      if (req.method === 'DELETE' && at >= 0) pinned.splice(at, 1)
      return json(res, 204, null)
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
    const { version = '', issue_ids = [] } = await body<{ version?: string; issue_ids?: string[] }>(req)
    if (issue_ids.filter((x) => x.trim() !== '').length === 0) return json(res, 400, { error: 'issue_ids required' })
    return json(res, 201, { id: id(), page_id: pageID, version, title: `Release ${version}`, summary: `${issue_ids.length} change(s): ${issue_ids.join(', ')}`,
      type: 'improvement', issue_ids })
  }
  if ((m = /^\/v1\/spaces\/([^/]+)$/.exec(path))) {
    const space = m[1]
    const s = spaces.find((x) => x.id === space)
    return s === undefined ? json(res, 404, { error: 'no such space' }) : json(res, 200, s)
  }
  if ((m = /^\/v1\/spaces\/([^/]+)\/pages$/.exec(path))) {
    const space = m[1]
    if (req.method === 'POST') {
      const { title = '' } = await body<{ title?: string }>(req)
      const p: Page = { id: id(), space_id: space, title, content: '', content_text: '', ai_cost_usd: 0, own_ai_cost_usd: 0, total_ai_cost_usd: 0 }
      pages.push(p)
      return json(res, 201, p)
    }
    return json(res, 200, pages.filter((p) => p.space_id === space))
  }
  if ((m = /^\/v1\/spaces\/([^/]+)\/pages\/([^/]+)$/.exec(path))) {
    const [, space, pageID] = m
    const p = pages.find((x) => x.space_id === space && x.id === pageID)
    if (p === undefined) return json(res, 404, { error: 'no such page' })
    if (req.method === 'PATCH') {
      const b = await body<{ title?: string; content?: string }>(req)
      if (b.title !== undefined) p.title = b.title
      if (b.content !== undefined) {
        p.content = b.content
        p.content_text = plainText(b.content)
      }
    }
    return json(res, 200, p)
  }
  if ((m = /^\/v1\/workspaces\/([^/]+)(\/.*)$/.exec(path)) === null) return json(res, 404, { error: 'stub docs: no such route' })
  const [, ws, rest] = m
  const mine = spaces.filter((s) => s.workspace === ws)
  if (rest === '/spaces') return json(res, 200, mine)
  if (rest === '/pins') {
    return json(res, 200, pinned.filter((x) => x.ws === ws).map((x) => ({ page_id: x.page_id, space_id: x.space_id, title: pages.find((p) => p.id === x.page_id)?.title ?? '', at: x.at })))
  }
  // Search: the pages of this workspace whose title or text holds every word asked (Docs' full-text arm).
  if (rest === '/search') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter((w) => w !== '')
    const hits = pages.filter((p) => mine.some((s) => s.id === p.space_id) && q.length > 0 && q.every((w) => `${p.title} ${p.content_text}`.toLowerCase().includes(w)))
    return json(res, 200, { results: hits.map((p) => ({ page_id: p.id, page_title: p.title, url: `/spaces/${p.space_id}/pages/${p.id}`,
      space_name: mine.find((s) => s.id === p.space_id)?.name ?? '', headline: p.content_text.slice(0, 120), source: 'fulltext' })), total: hits.length, query: q.join(' '), took_ms: 1 })
  }
  if (rest === '/ai/write' && req.method === 'POST') {
    const { prompt = '' } = await body<{ prompt?: string }>(req)
    const said = prompt.replace(/^one sentence saying\s+/i, '').replace(/\.$/, '')
    return json(res, 200, { text: `${said.charAt(0).toUpperCase()}${said.slice(1)}.` })
  }
  if (rest === '/ai/ask' && req.method === 'POST') {
    const { question = '' } = await body<{ question?: string }>(req)
    // A model takes a while to answer, so the card shows "Asking…" first (B17.39: the harness once read
    // that label as the answer, and an instant stub could never show it).
    await new Promise((r) => setTimeout(r, 1500))
    // Retrieval: the page sentence sharing the most words with the question.
    let best: { page: Page; sentence: string; score: number } | undefined
    for (const p of pages.filter((x) => mine.some((s) => s.id === x.space_id))) {
      for (const sentence of sentences(p.content_text)) {
        const score = overlap(sentence, question)
        if (best === undefined || score > best.score) best = { page: p, sentence, score }
      }
    }
    if (best === undefined || best.score === 0) return json(res, 200, { answer: 'Nothing in this workspace answers that.', sources: [] })
    const sources = BREAK === 'docs-ai' ? [] : [{ title: best.page.title, url: `/spaces/${best.page.space_id}/pages/${best.page.id}` }]
    return json(res, 200, { answer: best.sentence, sources })
  }
  if (rest === '/ai/transform' && req.method === 'POST') {
    const { text = '', action = '' } = await body<{ text?: string; action?: string }>(req)
    // B34.5 — grammar: each sentence begins with a capital, and "they checks" agrees.
    if (action === 'grammar') return json(res, 200, { text: sentences(text).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(' ').replace(/\b(T|t)hey (\w+)s\b/g, '$1hey $2') })
    if (action === 'shorter') return json(res, 200, { text: sentences(text)[0] ?? '' })
    if (action === 'longer') return json(res, 200, { text: `${text} That is the whole of it.` })
    // A summary: the sentences that carry a figure or a code, else the first one.
    const s = sentences(text)
    const kept = s.filter((x) => /\d/.test(x))
    return json(res, 200, { text: (kept.length > 0 ? kept : s.slice(0, 1)).join(' ') })
  }
  if (rest === '/ai/translate' && req.method === 'POST') {
    const { text = '', language = '' } = await body<{ text?: string; language?: string }>(req)
    return json(res, 200, { text: `[${language}] ${text.replace(/\bThe\b/g, 'Le').replace(/\bis\b/g, 'est')}` })
  }
  if (rest === '/ai/suggest-title' && req.method === 'POST') {
    const { content = '' } = await body<{ content?: string }>(req)
    return json(res, 200, { title: (sentences(content)[0] ?? 'Untitled').split(/\s+/).slice(0, 6).join(' ') })
  }
  return json(res, 404, { error: 'stub docs: no such route' })
})
