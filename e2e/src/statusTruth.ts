// B37.7 — the status page told the truth about Lens itself. Read production's /status.json and its own /healthz and hold
// one to the other: the same version and uptime, healthy whenever the page reads operational (talyvor-lens B37.11), Lens's
// own components operational, every money rail on its Test partner and answering its 5-minute probe (B37.2) with its
// clearances read, rails_summary the rows', the documented keys and nothing else (B37.3), no error text (B37.1), and a
// public /healthz with no pool or request internals (B37.11). Every rail that is down or not called is named.

import { RAIL_SERVICES } from './moneyRails.ts'
import type { Scenario } from './scenarios.ts'

/** talyvor-lens internal/status contract_test.go's documentedKeys, as README.md's Status section lists them. */
export const DOCUMENTED_KEYS = [
  'status', 'version', 'uptime_hours', 'updated_at',
  'components', 'components[].name', 'components[].status', 'components[].latency_ms', 'components[].measured',
  'components[].message', 'components[].checked_at',
  'providers', 'providers[].name', 'providers[].status', 'providers[].latency_ms', 'providers[].checked_at',
  'rails', 'rails[].service', 'rails[].name', 'rails[].mode', 'rails[].status', 'rails[].last_success',
  'rails[].last_failure', 'rails[].capabilities', 'rails[].capabilities[].key', 'rails[].capabilities[].cleared',
  'rails_summary', 'rails_summary.up', 'rails_summary.down', 'rails_summary.idle', 'rails_summary.down_names',
] as const

/** Lens sends a component's message only when it has one (omitempty), so a page with every component quiet has none. */
const OPTIONAL_KEYS = new Set(['components[].message'])

/** Lens's own components, by the names the status page gives them. */
export const OWN_COMPONENTS = ['PostgreSQL', 'Redis', 'NATS', 'Proxy'] as const

/** What a dependency's error says that the fixed phrases (cannot connect, timed out, not configured, not connected) never do. */
const ERROR_TEXT = /error|failed|refused|panic|\bEOF\b|deadline|no such host|dial |user=|database=|host=|password|ref=|sk-\w|\b\d{1,3}(?:\.\d{1,3}){3}\b|[a-z][\w.-]*:\d{4,5}\b/i

const RAIL_FRESH_MS = 10 * 60_000
const UPTIME_SLACK_S = 3 * 60

interface Rail {
  service: string
  name: string
  mode: string
  status: string
  last_success: string | null
  last_failure: string | null
  capabilities: { key: string; cleared: boolean | null }[]
}

export interface StatusJSON {
  status: string
  version: string
  uptime_hours: number
  components: { name: string; status: string; message?: string }[]
  rails: Rail[] | null
  rails_summary: { up: number; down: number; idle: number; down_names: string[] | null }
}

export interface Healthz {
  status: string
  version: string
  uptime_seconds: number
  [section: string]: unknown
}

/** Every object key in `v` by its path, arrays as `[]`: components[].name. */
function keyPaths(v: unknown, path: string, out: Set<string>): Set<string> {
  if (Array.isArray(v)) for (const x of v) keyPaths(x, `${path}[]`, out)
  else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const p = path === '' ? k : `${path}.${k}`
      out.add(p)
      keyPaths(x, p, out)
    }
  }
  return out
}

/** Every string value in `v`, with its path. */
function strings(v: unknown, path: string, out: [string, string][]): [string, string][] {
  if (typeof v === 'string') out.push([path, v])
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out))
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, path === '' ? k : `${path}.${k}`, out)
  return out
}

/** The oracle: every way /status.json and /healthz (read unauthenticated at `now`) disagree with Lens or with each other. */
export function statusTruthVerdict(page: StatusJSON, health: Healthz, now = Date.now()): { pass: boolean; detail: string } {
  const wrong: string[] = []

  if (typeof page.version !== 'string' || page.version === '' || page.version !== health.version) {
    wrong.push(`the page's version ${JSON.stringify(page.version)} is not /healthz's ${JSON.stringify(health.version)}`)
  }
  const drift = Math.abs(page.uptime_hours * 3600 - health.uptime_seconds)
  if (!Number.isFinite(drift) || drift > UPTIME_SLACK_S) {
    wrong.push(`uptime_hours ${page.uptime_hours} is ${Math.round(drift)}s from /healthz's uptime_seconds ${health.uptime_seconds}, more than 3 minutes`)
  }
  if (page.status === 'operational' && health.status !== 'healthy') wrong.push(`the page reads operational while /healthz reads ${JSON.stringify(health.status)}`)

  for (const name of OWN_COMPONENTS) {
    const c = (page.components ?? []).find((x) => x.name === name)
    if (c === undefined) wrong.push(`${name} is not listed`)
    else if (c.status !== 'operational') wrong.push(`${name} is ${c.status}${c.message === undefined ? '' : ` (${c.message})`}`)
  }

  const rails = Array.isArray(page.rails) ? page.rails : []
  for (const service of RAIL_SERVICES) {
    const rows = rails.filter((r) => r.service === service)
    if (rows.length !== 1) { wrong.push(`rail ${service} is listed ${rows.length} times`); continue }
    const r = rows[0]
    const label = `rail ${r.name} (${service})`
    if (r.mode !== 'test') wrong.push(`${label} is in mode ${JSON.stringify(r.mode)}, not "test"`)
    if (r.status === 'outage') wrong.push(`${label} is down (last success ${r.last_success ?? 'never'}, last failure ${r.last_failure ?? 'never'})`)
    else if (r.last_success === null) wrong.push(`${label} has not been called (status ${r.status})`)
    else if (now - Date.parse(r.last_success) > RAIL_FRESH_MS) wrong.push(`${label}'s last success ${r.last_success} is more than 10 minutes old`)
    const unread = (r.capabilities ?? []).filter((c) => typeof c.cleared !== 'boolean').map((c) => c.key)
    if (unread.length > 0) wrong.push(`${label} has no cleared value for ${unread.join(', ')}`)
  }

  const s = page.rails_summary
  const want = {
    up: rails.filter((r) => r.status === 'operational').length,
    down: rails.filter((r) => r.status === 'outage').length,
    idle: rails.filter((r) => r.status !== 'operational' && r.status !== 'outage').length,
    down_names: rails.filter((r) => r.status === 'outage').map((r) => r.name),
  }
  if (s === undefined || s.up !== want.up || s.down !== want.down || s.idle !== want.idle || JSON.stringify(s.down_names) !== JSON.stringify(want.down_names)) {
    wrong.push(`rails_summary ${JSON.stringify(s)} is not the rows' ${JSON.stringify(want)}`)
  }

  const keys = keyPaths(page, '', new Set())
  const extra = [...keys].filter((k) => !(DOCUMENTED_KEYS as readonly string[]).includes(k))
  const missing = DOCUMENTED_KEYS.filter((k) => !keys.has(k) && !OPTIONAL_KEYS.has(k))
  if (extra.length > 0) wrong.push(`/status.json has keys it does not document: ${extra.join(', ')}`)
  if (missing.length > 0) wrong.push(`/status.json lacks documented keys: ${missing.join(', ')}`)

  for (const [path, v] of [...strings(page, '', []).map(([p, v]) => [`/status.json ${p}`, v]), ...strings(health, '', []).map(([p, v]) => [`/healthz ${p}`, v])]) {
    if (ERROR_TEXT.test(v)) wrong.push(`${path} holds an error text: ${JSON.stringify(v.slice(0, 120))}`)
  }

  const internals = ['database_pool', 'requests'].filter((k) => k in health)
  if (internals.length > 0) wrong.push(`an unauthenticated /healthz carries ${internals.join(' and ')}`)

  if (wrong.length > 0) return { pass: false, detail: wrong.join('; ') }
  return {
    pass: true,
    detail: `/status.json agrees with /healthz (version ${page.version}, up ${page.uptime_hours}h, ${health.status}) and all ${RAIL_SERVICES.length} money rails answered within 10 minutes`,
  }
}

export function statusTruth(): Scenario {
  return {
    id: 'status-truth',
    owner: 'talyvor-lens',
    title: "Lens's status page agrees with its /healthz, and every money rail answered its probe in the last 10 minutes",
    feature: 'Lens API',
    items: ['B37.1', 'B37.2', 'B37.3', 'B37.11'],
    run: async (ctx) => {
      const [page, health] = await Promise.all([ctx.env.lens.as('', 'GET', '/status.json'), ctx.env.lens.as('', 'GET', '/healthz')])
      ctx.evidence.push({ note: `/status.json ${page.status}: ${page.text.slice(0, 2000)}` })
      ctx.evidence.push({ note: `/healthz ${health.status}: ${health.text.slice(0, 500)}` })
      let parsed: [StatusJSON, Healthz]
      try {
        parsed = [JSON.parse(page.text) as StatusJSON, JSON.parse(health.text) as Healthz]
      } catch {
        return { pass: false, detail: `GET /status.json answered ${page.status} and GET /healthz ${health.status}, not both JSON` }
      }
      return statusTruthVerdict(...parsed)
    },
  }
}
