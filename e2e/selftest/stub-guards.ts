// B28.285 — the stub Lens's compute nodes, audit webhook and .docx conversion, guarded as talyvor-lens guards them: an
// address a workspace gives is dialled only when every address it resolves to is public (internal/safehttp), and a
// document's part is unpacked no further than the 25 MiB cap (internal/distill readZipPart). Their defects, planted:
//   ssrf     — nodes and the webhook are dialled wherever they point, and the cloud metadata address answers as on a cloud
//   zip-bomb — a .docx's document is unpacked however large it gets
//   doc-size — a document of any size is taken

import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { inflateRawSync } from 'node:zlib'

/** talyvor-lens internal/distill MaxInputBytes. */
export const DOC_CAP = 25 << 20

/** Lens's safehttp.blocked: loopback, link-local (the metadata address), unspecified, multicast and private. */
const BLOCKED = new BlockList()
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4]] as const) BLOCKED.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) BLOCKED.addSubnet(net, bits, 'ipv6')
const METADATA = new Set(['169.254.169.254', 'fd00:ec2::254'])

const hostOf = (u: string): string => new URL(u).hostname.replace(/^\[|\]$/g, '')

/** Whether Lens would dial `u`: it resolves, and to public addresses only. */
async function dialable(u: string): Promise<boolean> {
  const host = hostOf(u)
  const addrs = isIP(host) !== 0 ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address)
  return addrs.length > 0 && !addrs.some((a) => BLOCKED.check(a.replace(/^::ffff:/, ''), isIP(a.replace(/^::ffff:/, '')) === 6 ? 'ipv6' : 'ipv4'))
}

/** `u` fetched as Lens's node client fetches it; whether it answered 2xx. Guarded unless `broken`. */
async function reaches(u: string, init: RequestInit, broken: boolean): Promise<boolean> {
  if (broken && METADATA.has(hostOf(u))) return true // the cloud's metadata service answers whoever asks
  if (!broken && !(await dialable(u))) return false
  return fetch(u, { ...init, signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false)
}

interface Node { id: string; workspace_id: string; url: string; provider: string; models: string[]; gpu_type: string; active: boolean; verified: boolean; created_at: string }
const nodes = new Map<string, Node>()
const PROBE: Record<string, string> = { ollama: '/api/tags', vllm: '/v1/models' }

/** Lens's compute-node routes: register (verified once its probe answers), list, remove; and the nodes offered for a model. */
export function nodesRoute(method: string, rest: string, ws: string, body: string, broken: boolean): [number, unknown] | undefined {
  if (rest === '/nodes' && method === 'POST') {
    const n = JSON.parse(body || '{}') as Partial<Node>
    let ok = false
    try {
      const u = new URL(n.url ?? '')
      ok = (u.protocol === 'http:' || u.protocol === 'https:') && u.host !== ''
    } catch { /* not a URL */ }
    if (!ok) return [400, { error: 'compute mining: invalid node URL' }]
    if (!n.provider) return [400, { error: 'compute mining: provider required' }]
    const node: Node = { id: randomBytes(16).toString('hex'), workspace_id: ws, url: (n.url ?? '').replace(/\/+$/, ''), provider: n.provider, models: n.models ?? [],
      gpu_type: n.gpu_type ?? 'cpu', active: true, verified: false, created_at: new Date().toISOString() }
    nodes.set(node.id, node)
    void reaches(node.url + (PROBE[node.provider] ?? '/health'), {}, broken).then((yes) => { node.verified = yes })
    return [201, node]
  }
  if (rest === '/nodes' && method === 'GET') return [200, [...nodes.values()].filter((n) => n.workspace_id === ws)]
  const one = /^\/nodes\/([^/]+)$/.exec(rest)
  if (one !== null && method === 'DELETE') {
    const n = nodes.get(one[1])
    if (n === undefined || n.workspace_id !== ws) return [404, { error: 'node not found' }]
    n.active = false
    return [200, { ok: true }]
  }
  return undefined
}

export const nodesAvailable = (model: string): Node[] => [...nodes.values()].filter((n) => n.active && n.verified && n.models.includes(model))

/** POST /v1/audit/webhook as Lens answers it: taken at once, and the export sent where it points unless Lens's dialer refuses. */
export function auditWebhook(body: string, broken: boolean): [number, unknown] {
  const { webhook_url: to = '' } = JSON.parse(body || '{}') as { webhook_url?: string }
  if (to === '') return [400, { error: 'webhook_url required' }]
  void reaches(to, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' }, broken).catch(() => undefined)
  return [202, { ok: true, message: 'export started' }]
}

/** A .docx's word/document.xml, unpacked no further than `cap` bytes: undefined when it is not a zip holding one, 'too large' past the cap. */
export function docxDocument(zip: Buffer, cap: number): Buffer | 'too large' | undefined {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) return undefined
  let at = zip.readUInt32LE(end + 16)
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const nameLen = zip.readUInt16LE(at + 28)
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString()
    if (name === 'word/document.xml') {
      const local = zip.readUInt32LE(at + 42)
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      try {
        return inflateRawSync(zip.subarray(start, start + zip.readUInt32LE(at + 20)), Number.isFinite(cap) ? { maxOutputLength: cap + 1 } : {})
      } catch (e) {
        if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return 'too large'
        throw e
      }
    }
    at += 46 + nameLen + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
  }
  return undefined
}
