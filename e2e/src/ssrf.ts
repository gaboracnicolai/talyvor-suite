// B28.285 — SSRF AND FILE PARSING ARE SAFE. Lens takes an address from a workspace in two places — a compute node it
// probes to verify (POST /v1/workspaces/{ws}/nodes; talyvor-lens internal/mining verifyNodeAsync) and a webhook it sends
// the workspace's audit export to (POST /v1/audit/webhook) — and it parses a document a workspace uploads (POST
// /v1/workspaces/{ws}/distill/preview; internal/distill). Two scenarios, each on a workspace of its own:
//   ssrf-refused — the cloud metadata address (169.254.169.254, and AWS's over IPv6), Lens's own port on loopback, and a
//        trap (a local HTTP server that answers every request with 200) on loopback, localhost, IPv6 loopback and this
//        machine's private address, each given as a compute node and as the audit webhook. Each is refused when given, or
//        taken and never reached: no node verifies (Lens marks a node verified only when its probe answers 2xx, and both
//        the trap and Lens's /healthz do), none is offered, and nobody reaches the trap.
//   file-bomb-bounded — a .docx whose document unpacks to 256 MiB, and a document one byte over Lens's 25 MiB cap: each is
//        refused or capped and answered within its time, Lens answers /healthz after without having restarted, and a
//        plain .docx (the control) converts before and after.
// The trap sees Lens where it runs on this machine (the self-test); on production, what Lens reaches is seen through the
// verified flag of a node aimed at Lens's own /healthz and at the metadata address, and its restart through /healthz.

import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { crc32, createDeflateRaw } from 'node:zlib'
import { fail } from './bank.ts'
import { verdictOf } from './gateway.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { call, ok, said } from './settings.ts'
import { until } from './trade.ts'

/** How long Lens is given to probe a node it was given: its probe has 5 s (cmd/lens newNodeHTTPClient), and runs at once. */
const VERIFY_WAIT_MS = 10_000
/** talyvor-lens internal/distill MaxInputBytes: the most a document, or any part unpacked from one, may be. */
const DOC_CAP = 25 << 20
/** What the bomb's document unpacks to: ten times the cap, from about 250 KB on the wire. */
const BOMB_BYTES = 256 << 20
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const UPLOAD_MS = 60_000
const HUGE_UPLOAD_MS = 180_000
/** Seconds of /healthz uptime that may go missing between two reads before Lens counts as restarted. */
const RESTART_SLACK_S = 10

/** A local HTTP server, on every address of this machine, that answers whatever reaches it with 200 and records it. */
interface Trap { port: number; path: string; hits: string[]; close: () => Promise<void> }

async function trap(): Promise<Trap> {
  const hits: string[] = []
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.headers.host ?? '?'}${req.url} from ${req.headers['user-agent'] ?? 'no user agent'}`)
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"models":[],"data":[]}')
  })
  await new Promise<void>((r) => server.listen(0, '::', r))
  return { port: (server.address() as AddressInfo).port, path: `/b28285-${RUN_SALT}`, hits, close: () => new Promise<void>((r) => {
    server.close(() => r())
    server.closeAllConnections()
  }) }
}

/** This machine's first private IPv4 address (10/8, 172.16/12, 192.168/16), where the trap also listens; none off a LAN. */
function privateAddress(): string | undefined {
  return Object.values(networkInterfaces()).flat().find((a) => a !== undefined && a.family === 'IPv4' && !a.internal &&
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))?.address
}

/**
 * The addresses Lens must never reach for a workspace. Each ends in `?probe=` so the path Lens adds to probe a node
 * (/health, /api/tags or /v1/models) lands in the query, and the probe reaches the path named here: one that answers 200.
 */
function targets(ctx: ScenarioCtx, t: Trap): { what: string; url: string }[] {
  // Lens's own port: the stub's in the self-test, else the one Lens listens on in its container (docker-compose.yaml).
  const lens = new URL(ctx.env.lens.baseURL)
  const lensPort = ['127.0.0.1', 'localhost', '[::1]'].includes(lens.hostname) ? lens.port : '8080'
  const lan = privateAddress()
  return [
    { what: 'the cloud metadata address', url: 'http://169.254.169.254/latest/meta-data/?probe=' },
    { what: "the cloud metadata address over IPv6 (AWS's)", url: 'http://[fd00:ec2::254]/latest/meta-data/?probe=' },
    { what: "Lens's own port on loopback", url: `http://127.0.0.1:${lensPort}/healthz?probe=` },
    { what: 'the trap on loopback', url: `http://127.0.0.1:${t.port}${t.path}/loopback?probe=` },
    { what: 'the trap on localhost', url: `http://localhost:${t.port}${t.path}/localhost?probe=` },
    { what: 'the trap on IPv6 loopback', url: `http://[::1]:${t.port}${t.path}/v6?probe=` },
    ...(lan === undefined ? [] : [{ what: `the trap on a private address (${lan})`, url: `http://${lan}:${t.port}${t.path}/private?probe=` }]),
  ]
}

interface InferenceNode { id: string; url: string; active: boolean; verified: boolean }

export function ssrfRefused(): Scenario {
  return {
    id: 'ssrf-refused',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Compute nodes',
    title: "the cloud metadata address, Lens's own port and a trap on loopback, localhost, IPv6 loopback and a private address, each given as a " +
      'compute node and as the audit webhook: refused when given, or taken and never reached — no node verified or offered, the trap reached by nobody',
    run: async (ctx) => {
      const wrong: string[] = []
      const t = await trap()
      const model = `e2e-${RUN_SALT}-ssrf`
      const nodes: { what: string; id: string }[] = []
      const given: string[] = []
      try {
        const all = targets(ctx, t)
        for (const x of all) {
          const n = await call<InferenceNode>(ctx, 'POST', '/v1/workspaces/{ws}/nodes', { url: x.url, provider: 'ollama', models: [model], gpu_type: 'cpu', max_concurrent: 1, price_per_token: 0.000001 })
          if (n.status === 201 && n.value?.id !== undefined) nodes.push({ what: x.what, id: n.value.id })
          else if (n.status < 400 || n.status >= 500) wrong.push(`${x.what} as a compute node answered ${said(n)}, neither taken (201) nor refused (4xx)`)
          const hook = await call(ctx, 'POST', '/v1/audit/webhook', { webhook_url: x.url, filter: {} })
          if (!ok(hook.status) && (hook.status < 400 || hook.status >= 500)) wrong.push(`${x.what} as the audit webhook answered ${said(hook)}, neither taken nor refused (4xx)`)
          given.push(`${x.what}: node ${n.status === 201 ? 'taken' : `refused ${n.status} "${n.error}"`}, webhook ${ok(hook.status) ? `taken ${hook.status}` : `refused ${hook.status} "${hook.error}"`}`)
        }
        const mine = new Set(nodes.map((n) => n.id))
        const listed = await until(async () => (await call<InferenceNode[] | null>(ctx, 'GET', '/v1/workspaces/{ws}/nodes')).value ?? [],
          (ns) => ns.some((n) => mine.has(n.id) && n.verified), VERIFY_WAIT_MS)
        for (const n of listed.filter((x) => mine.has(x.id) && x.verified)) {
          wrong.push(`Lens reached ${nodes.find((x) => x.id === n.id)?.what} (${n.url}): its probe answered and the node is verified`)
        }
        const offered = await call<InferenceNode[] | null>(ctx, 'GET', `/v1/nodes/available?model=${encodeURIComponent(model)}`)
        for (const n of (offered.value ?? []).filter((x) => mine.has(x.id))) wrong.push(`Lens offers the node at ${n.url} to others for ${model}`)
        if (t.hits.length > 0) wrong.push(`the trap was reached: ${t.hits.join('; ')}`)
        ctx.evidence.push({ note: `${given.join('; ')}; after ${VERIFY_WAIT_MS / 1000} s: ${listed.filter((x) => mine.has(x.id)).map((x) => `${x.url} verified ${x.verified}`).join(', ') || 'no node of these listed'}; trap reached ${t.hits.length} time(s)` })
        const refused = all.length - nodes.length
        return verdictOf(wrong, `${all.length} addresses (${all.map((x) => x.what).join(', ')}) as a compute node and as the audit webhook: ` +
          `${refused} node(s) refused when given, ${nodes.length} taken and never reached — none verified or offered — and the trap reached by nobody`)
      } finally {
        for (const n of nodes) await call(ctx, 'DELETE', `/v1/workspaces/{ws}/nodes/${n.id}`).catch(() => undefined)
        await t.close()
      }
    },
  }
}

// ─── file-bomb-bounded ──────────────────────────────────────────────────────────────────────────────

/** A zip member: its bytes deflated, their CRC-32 and how many there were. */
interface Member { name: string; data: Buffer; crc: number; size: number }

/** `chunks` deflated as one zip member, streamed so a member that unpacks to hundreds of MiB is never held unpacked. */
async function member(name: string, chunks: Iterable<Buffer>): Promise<Member> {
  const z = createDeflateRaw({ level: 9 })
  const out: Buffer[] = []
  z.on('data', (c: Buffer) => out.push(c))
  let crc = 0
  let size = 0
  for (const c of chunks) {
    crc = crc32(c, crc)
    size += c.length
    if (!z.write(c)) await once(z, 'drain')
  }
  z.end()
  await once(z, 'end')
  return { name, data: Buffer.concat(out), crc, size }
}

/** A zip archive of `members`, as APPNOTE.TXT lays one out: each local header and its data, the central directory, its end. */
function zip(members: Member[]): Buffer<ArrayBuffer> {
  const DOS_DATE_1980_01_01 = (1 << 5) | 1
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const m of members) {
    const name = Buffer.from(m.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12)
    local.writeUInt32LE(m.crc >>> 0, 14)
    local.writeUInt32LE(m.data.length, 18)
    local.writeUInt32LE(m.size, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14)
    central.writeUInt32LE(m.crc >>> 0, 16)
    central.writeUInt32LE(m.data.length, 20)
    central.writeUInt32LE(m.size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, m.data)
    centrals.push(central, name)
    offset += local.length + name.length + m.data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(members.length, 8)
  end.writeUInt16LE(members.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const CONTENT_TYPES = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
const RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
const BODY_OPEN = `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>`
const BODY_CLOSE = '</w:t></w:r></w:p></w:body></w:document>'

/** A .docx of one paragraph: `text` as it is, then `padding` bytes of "A" — so 0 is a plain document, and more a bomb. */
export async function docx(text: string, padding = 0): Promise<Buffer<ArrayBuffer>> {
  function* document(): Generator<Buffer> {
    yield Buffer.from(BODY_OPEN + text)
    const mib = Buffer.alloc(1 << 20, 'A')
    for (let left = padding; left > 0; left -= mib.length) yield left >= mib.length ? mib : mib.subarray(0, left)
    yield Buffer.from(BODY_CLOSE)
  }
  return zip([await member('[Content_Types].xml', [Buffer.from(CONTENT_TYPES)]), await member('_rels/.rels', [Buffer.from(RELS)]),
    await member('word/document.xml', document())])
}

/** Lens's /healthz as it reads now: how long it has been up and its version; undefined when it does not answer. */
async function health(ctx: ScenarioCtx): Promise<{ uptime: number; version: string } | undefined> {
  try {
    const r = await fetch(`${ctx.env.lens.baseURL}/healthz`, { signal: AbortSignal.timeout(15_000) })
    const h = (await r.json()) as { uptime_seconds?: number; version?: string }
    return typeof h.uptime_seconds === 'number' ? { uptime: h.uptime_seconds, version: h.version ?? '' } : undefined
  } catch {
    return undefined
  }
}

export function fileBombBounded(): Scenario {
  return {
    id: 'file-bomb-bounded',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Document conversion',
    title: "a .docx that unpacks to 256 MiB and a document one byte over 25 MiB sent to Lens's document preview: each refused or capped in time, " +
      'Lens up after and not restarted, and a plain .docx converting before and after',
    run: async (ctx) => {
      const wrong: string[] = []
      const path = `/v1/workspaces/${ctx.app.user.workspaceID}/distill/preview`
      const send = (body: Buffer<ArrayBuffer>, type: string, ms: number) => ctx.env.lens.upload(ctx.app.user.token, path, body, type, ms)
      const marker = `e2e-${RUN_SALT}-docx`
      const plain = await docx(`The control paragraph ${marker}.`)
      const converts = async (when: string): Promise<string | undefined> => {
        const r = await send(plain, DOCX, UPLOAD_MS)
        return r.status === 200 && r.text.includes(marker) ? undefined : `a plain .docx ${when} answered ${r.status} ${r.text.slice(0, 200)}, not its paragraph`
      }
      const before = await health(ctx)
      if (before === undefined) return fail("Lens's /healthz did not say how long it has been up, so a restart could not be told")
      const t0 = Date.now()
      const control = await converts('before the bomb')
      if (control !== undefined) return fail(`${control}: a refusal of the bomb would show nothing`)

      const bomb = await docx(marker, BOMB_BYTES)
      const b = await send(bomb, DOCX, UPLOAD_MS)
      let unpacked = -1
      try {
        unpacked = (JSON.parse(b.text) as { savings?: { output_bytes?: number } }).savings?.output_bytes ?? -1
      } catch { /* not JSON: judged on its status */ }
      const bombSaid = b.status >= 400 && b.status < 500 ? `refused ${b.status}` : b.status === 200 && unpacked >= 0 && unpacked <= DOC_CAP ? `capped at ${unpacked} bytes` : undefined
      if (bombSaid === undefined) wrong.push(`a ${bomb.length}-byte .docx that unpacks to ${BOMB_BYTES} bytes answered ${b.status} after ${b.ms} ms ${b.text.slice(0, 200)}` +
        (b.status === 200 ? (unpacked >= 0 ? `: unpacked to ${unpacked} bytes, past the ${DOC_CAP}-byte cap` : ': taken, with no unpacked size to show it capped') : ', neither refused nor capped'))

      const h = await send(Buffer.alloc(DOC_CAP + 1, 'a'), 'text/plain', HUGE_UPLOAD_MS)
      // Lens may answer 413 before it has read the rest, then hang up: a cut-off upload is refused too, unless it timed out.
      const hugeSaid = h.status >= 400 && h.status < 500 ? `refused ${h.status}` : h.status === 0 && !/timeout|abort/i.test(h.text) ? `cut off (${h.text.slice(0, 80)})` : undefined
      if (hugeSaid === undefined) wrong.push(`a document of ${DOC_CAP + 1} bytes answered ${h.status} after ${h.ms} ms ${h.text.slice(0, 200)}, not refused`)

      const after = await health(ctx)
      const elapsed = (Date.now() - t0) / 1000
      if (after === undefined) wrong.push("Lens's /healthz did not answer after the bomb and the huge document")
      else if (after.version === before.version && after.uptime + RESTART_SLACK_S < before.uptime + elapsed) {
        wrong.push(`Lens restarted: up ${before.uptime} s before and ${after.uptime} s after, ${Math.round(elapsed)} s later`)
      }
      const still = await converts('after the bomb')
      if (still !== undefined) wrong.push(still)
      ctx.evidence.push({ note: `bomb ${bomb.length} bytes → ${b.status} in ${b.ms} ms ${b.text.slice(0, 160)}; ${DOC_CAP + 1} bytes → ${h.status} in ${h.ms} ms ${h.text.slice(0, 120)}; ` +
        `/healthz up ${before.uptime} s (${before.version.slice(0, 12)}) then ${after?.uptime ?? '?'} s (${after?.version.slice(0, 12) ?? '?'}) ${Math.round(elapsed)} s later` +
        (after !== undefined && after.version !== before.version ? ' — redeployed meanwhile, so a restart could not be told' : '') })
      return verdictOf(wrong, `a .docx unpacking to ${BOMB_BYTES >> 20} MiB ${bombSaid} in ${b.ms} ms and a ${DOC_CAP + 1}-byte document ${hugeSaid} in ${h.ms} ms; ` +
        `Lens up after${after !== undefined && after.version !== before.version ? ' (redeployed meanwhile)' : ', not restarted'}, and a plain .docx converts before and after`)
    },
  }
}
