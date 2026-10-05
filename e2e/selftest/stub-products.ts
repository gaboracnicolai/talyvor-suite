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

import { randomBytes } from 'node:crypto'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'

const TRACK_PORT = Number(process.env.TRACK_PORT ?? 9912)
const DOCS_PORT = Number(process.env.DOCS_PORT ?? 9913)
const SECRET = process.env.GATEWAY_SECRET ?? 'selftest-gateway'
const BREAK = process.env.STUB_BREAK ?? ''

const id = (): string => randomBytes(8).toString('hex')
const now = (): string => new Date().toISOString()

function json(res: ServerResponse, status: number, body: unknown): void {
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
      if (req.headers['x-gateway-auth'] !== SECRET) return json(res, 401, { error: 'gateway proof required' })
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
}
interface Comment { id: string; issue_id: string; author_id: string; body: string; created_at: string }

const issues: Issue[] = []
const comments: Comment[] = []
const TEAM = { id: 'team-eng', identifier: 'ENG', name: 'Engineering' }

serve(TRACK_PORT, 'track', async (req, res, path, url) => {
  if (path === '/v1/workspaces') {
    const ws = byEmail.get(String(req.headers['x-user-email'] ?? ''))
    return json(res, 200, ws === undefined ? [] : [{ id: ws, name: 'Synthetic tracker', slug: 'synthetic' }])
  }
  const m = /^\/v1\/workspaces\/([^/]+)(\/.*)$/.exec(path)
  if (m === null) return json(res, 404, { error: 'stub track: no such route' })
  const [, ws, rest] = m
  const mine = issues.filter((i) => i.workspace === ws)
  if (rest === '/teams') return json(res, 200, [TEAM])
  if (rest === '/members' || rest === '/projects') return json(res, 200, [])
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
    const page = [...mine].reverse().slice(offset, offset + limit)
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
  if (rest === '/pins') return json(res, 200, [])
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
    const { text = '' } = await body<{ text?: string }>(req)
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
