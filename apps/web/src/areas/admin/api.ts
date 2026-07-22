// Admin-area API layer. The backend is REAL — edge-infra's read-only Admin API
// (cmd/server/admin.go @ 7e721f4, merged #51): five GET endpoints on :18002
// behind a constant-time X-Admin-Key. The BFF proxies NONE of it yet, so every
// read here resolves from local fixtures shaped EXACTLY like those handlers'
// response DTOs and says so via the Sourced envelope. ./BFF-GAPS.md is the spec
// for the one BFF PR that flips these live (the key stays server-side, like
// every other credential in this suite).
//
// Types below mirror cmd/server/admin.go's pinned wire DTOs field-for-field —
// the admin wire shape is pinned THERE ("not borrowed from store types"), so
// this file is a projection of that contract, not of edge-infra internals.
import {
  FIXTURE_CERTIFICATES,
  FIXTURE_CONFIG,
  FIXTURE_NODES,
  FIXTURE_PROVISIONING,
  FIXTURE_TOPOLOGY,
} from './fixtures'

/** GET /admin/v1/topology → topologyResponse */
export interface Topology {
  gateways: Gateway[]
  routes: Route[]
  clusters: Cluster[]
  endpoints: Endpoint[]
}

export interface Gateway {
  id: string
  name: string
  port: number
  protocol: string
  /** A NAME reference — the API never carries material. */
  tls_secret: string
  node_selector: Record<string, string>
}

export interface Route {
  id: string
  name: string
  gateway_id: string
  hosts: string[]
  path_prefix: string
  cluster_name: string
  timeout_seconds: number
  rate_limit_per_unit: number
  rate_limit_unit: string
  auth_policy: string
  tls_secret_name: string
  client_ca_secret_name: string
}

export interface Cluster {
  id: string
  name: string
  connect_timeout_ms: number
  lb_policy: string
  health_check_path: string
  health_check_interval_s: number
}

export interface Endpoint {
  id: string
  cluster_id: string
  address: string
  port: number
  weight: number
}

/** GET /admin/v1/nodes → nodesResponse. `scope` + `note` are SERVER-stamped:
 *  there is no expected-node registry anywhere, so this is the connected set
 *  only — the UI must carry that caveat, never summarize past it. */
export interface Nodes {
  scope: 'connected-only'
  note: string
  published_version: string
  active_streams: number
  nodes_behind: number
  last_reconcile_unix: number
  last_reconcile_duration_seconds: number
  nodes: NodeEntry[]
}

export interface NodeEntry {
  node_id: string
  acked_version: string
  behind: boolean
}

/** GET /admin/v1/certificates → certificatesResponse. A parse_error row is
 *  reported, not dropped ("an admin list silently missing a row is how an
 *  expiry gets missed") — the UI keeps the row visible too. */
export interface Certificates {
  certificates: CertificateEntry[]
}

export interface CertificateEntry {
  name: string
  kind: string
  fingerprint_sha256?: string
  issuer?: string
  /** RFC3339 UTC. Absent when parse_error. */
  not_after?: string
  parse_error?: boolean
}

/** GET /admin/v1/provisioning → provisioningResponse. `requests` is newest-first
 *  and server-capped at `request_limit` (100). status ∈ PENDING|COMPLETED|FAILED
 *  (osb/models.py Literal); FAILED carries `error` verbatim. */
export interface Provisioning {
  services: ProvisionedService[]
  requests: ProvisionRequest[]
  request_limit: number
}

export interface ProvisionedService {
  id: string
  name: string
  team: string
  host: string
  port: number
  protocol: string
  auth_policy: string
  tls_secret_name: string
  created_at: string
  updated_at: string
}

export interface ProvisionRequest {
  id: string
  operation: string
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  team: string
  error: string
  created_at: string
  completed_at: string | null
}

/** GET /admin/v1/config → adminConfigView. `read_only` is stamped by the server
 *  so no client can mistake this surface for a control plane it may write to.
 *  ext_authz is REPORTED here and settable nowhere — the flip is an env var;
 *  a UI write path would silently make the UI a GitOps writer. No control is
 *  offered, so this UI renders none and implies none. */
export interface AdminConfig {
  read_only: boolean
  node_id: string
  reconcile_interval_ms: number
  xds: { listen_addr: string; tls: boolean; client_ca: boolean }
  ext_authz: { enabled: boolean; address: string; port: number; tls: boolean; mtls: boolean }
  rate_limit_local: { enabled: boolean; max_tokens: number; tokens_per_fill: number; fill_interval_ms: number }
  rate_limit_service: { enabled: boolean; address: string; port: number; domain: string; tls: boolean }
  ha: { redis_configured: boolean; instance_id: string }
}

/** Where a payload came from — 'fixture' renders a visible chip on every screen
 *  that shows the data; fixture-backed reads are never allowed to look live. */
export type DataSource = 'live' | 'fixture'

export interface Sourced<T> {
  source: DataSource
  data: T
}

const fixture = <T,>(data: T): Promise<Sourced<T>> => Promise.resolve({ source: 'fixture', data })

// Every function names the BFF route that replaces its body (see ./BFF-GAPS.md).
export const adminApi = {
  /** FIXTURE — needs BFF GET /api/admin/topology → upstream GET /admin/v1/topology */
  topology: (): Promise<Sourced<Topology>> => fixture(FIXTURE_TOPOLOGY),
  /** FIXTURE — needs BFF GET /api/admin/nodes → upstream GET /admin/v1/nodes */
  nodes: (): Promise<Sourced<Nodes>> => fixture(FIXTURE_NODES),
  /** FIXTURE — needs BFF GET /api/admin/certificates → upstream GET /admin/v1/certificates */
  certificates: (): Promise<Sourced<Certificates>> => fixture(FIXTURE_CERTIFICATES),
  /** FIXTURE — needs BFF GET /api/admin/provisioning → upstream GET /admin/v1/provisioning */
  provisioning: (): Promise<Sourced<Provisioning>> => fixture(FIXTURE_PROVISIONING),
  /** FIXTURE — needs BFF GET /api/admin/config → upstream GET /admin/v1/config */
  config: (): Promise<Sourced<AdminConfig>> => fixture(FIXTURE_CONFIG),
}
