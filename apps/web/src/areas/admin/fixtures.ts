// ⚠ LOCAL FIXTURES — the BFF does not proxy edge-infra at all yet (see
// ./BFF-GAPS.md); until it does, all five admin screens run on this file and
// every screen shows a `fixture` chip. SHAPES are verbatim from the real
// handlers (cmd/server/admin.go @ 7e721f4): field names, nesting, the
// server-stamped scope/note on /nodes, read_only on /config, PENDING|COMPLETED|
// FAILED on provisioning requests. VALUES are synthetic; timestamps are
// computed relative to load time so the certificate demo (one valid, one
// expiring, one expired, one unparseable) stays in those states on any date.
import type { AdminConfig, Certificates, Nodes, Provisioning, Topology } from './api'

const DAY_MS = 24 * 60 * 60 * 1000
const now = Date.now()
const iso = (deltaMS: number) => new Date(now + deltaMS).toISOString()

/** Verbatim server constant (admin.go nodesScopeNote) — the response SHAPE
 *  carries the caveat, so the fixture carries the same bytes. */
export const NODES_SCOPE_NOTE =
  'no expected-node registry exists: entries are nodes with open xDS streams right now; ' +
  'a node absent from this list is not connected — absence is not health'

// Post-#47 versions are content hashes, not counters.
const PUBLISHED = 'c41d8f2ab9e64d0b7c53a1f08e92d6c4b5a7f3e1d2c8b9a0f1e2d3c4b5a69788'
const STALE = '9f8e7d6c5b4a39281706f5e4d3c2b1a0918273645546372819a0b1c2d3e4f506'

export const FIXTURE_NODES: Nodes = {
  scope: 'connected-only',
  note: NODES_SCOPE_NOTE,
  published_version: PUBLISHED,
  active_streams: 3,
  nodes_behind: 1,
  last_reconcile_unix: Math.floor((now - 42_000) / 1000),
  last_reconcile_duration_seconds: 0.184,
  nodes: [
    { node_id: 'edge-proxy-euwest1-a', acked_version: PUBLISHED, behind: false },
    { node_id: 'edge-proxy-euwest1-b', acked_version: PUBLISHED, behind: false },
    { node_id: 'edge-proxy-uswest2-a', acked_version: STALE, behind: true },
  ],
}

export const FIXTURE_TOPOLOGY: Topology = {
  gateways: [
    {
      id: 'gw-1',
      name: 'public-https',
      port: 443,
      protocol: 'HTTPS',
      tls_secret: 'wildcard-example-com',
      node_selector: { role: 'edge' },
    },
    {
      id: 'gw-2',
      name: 'internal-http',
      port: 8080,
      protocol: 'HTTP',
      tls_secret: '',
      node_selector: {},
    },
  ],
  routes: [
    {
      id: 'rt-1',
      name: 'api-v1',
      gateway_id: 'gw-1',
      hosts: ['api.example.com'],
      path_prefix: '/v1',
      cluster_name: 'api-backend',
      timeout_seconds: 30,
      rate_limit_per_unit: 100,
      rate_limit_unit: 'second',
      auth_policy: 'jwt',
      tls_secret_name: 'wildcard-example-com',
      client_ca_secret_name: '',
    },
    {
      id: 'rt-2',
      name: 'static-site',
      gateway_id: 'gw-1',
      hosts: ['www.example.com', 'example.com'],
      path_prefix: '/',
      cluster_name: 'static-site',
      timeout_seconds: 15,
      rate_limit_per_unit: 0,
      rate_limit_unit: '',
      auth_policy: 'none',
      tls_secret_name: 'wildcard-example-com',
      client_ca_secret_name: '',
    },
  ],
  clusters: [
    {
      id: 'cl-1',
      name: 'api-backend',
      connect_timeout_ms: 5000,
      lb_policy: 'ROUND_ROBIN',
      health_check_path: '/healthz',
      health_check_interval_s: 10,
    },
    {
      id: 'cl-2',
      name: 'static-site',
      connect_timeout_ms: 3000,
      lb_policy: 'LEAST_REQUEST',
      health_check_path: '',
      health_check_interval_s: 0,
    },
  ],
  endpoints: [
    { id: 'ep-1', cluster_id: 'cl-1', address: '10.0.1.11', port: 9000, weight: 1 },
    { id: 'ep-2', cluster_id: 'cl-1', address: '10.0.1.12', port: 9000, weight: 1 },
    { id: 'ep-3', cluster_id: 'cl-2', address: '10.0.2.21', port: 8043, weight: 1 },
  ],
}

export const FIXTURE_CERTIFICATES: Certificates = {
  certificates: [
    {
      name: 'wildcard-example-com',
      kind: 'tls',
      fingerprint_sha256: '7a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9',
      issuer: "CN=R11,O=Let's Encrypt,C=US",
      not_after: iso(400 * DAY_MS), // comfortably valid
    },
    {
      name: 'client-ca-partners',
      kind: 'client-ca',
      fingerprint_sha256: '11aa22bb33cc44dd55ee66ff7788990011aa22bb33cc44dd55ee66ff77889900',
      issuer: 'CN=Partners Root CA,O=Example Corp',
      not_after: iso(17 * DAY_MS), // inside the 30-day renewal window
    },
    {
      name: 'legacy-staging',
      kind: 'tls',
      fingerprint_sha256: 'deadbeefcafe00112233445566778899aabbccddeeff00112233445566778899',
      issuer: 'CN=Staging CA,O=Example Corp',
      not_after: iso(-21 * DAY_MS), // expired three weeks ago
    },
    {
      // Reported, not dropped — mirrors the server's parse_error contract.
      name: 'imported-opaque',
      kind: 'tls',
      parse_error: true,
    },
  ],
}

export const FIXTURE_PROVISIONING: Provisioning = {
  services: [
    {
      id: 'svc-1',
      name: 'payments-api',
      team: 'payments',
      host: 'payments.internal',
      port: 9443,
      protocol: 'https',
      auth_policy: 'jwt',
      tls_secret_name: 'payments-internal-tls',
      created_at: iso(-31 * DAY_MS),
      updated_at: iso(-2 * DAY_MS),
    },
    {
      id: 'svc-2',
      name: 'search',
      team: 'discovery',
      host: 'search.internal',
      port: 9200,
      protocol: 'http',
      auth_policy: 'none',
      tls_secret_name: '',
      created_at: iso(-90 * DAY_MS),
      updated_at: iso(-90 * DAY_MS),
    },
  ],
  requests: [
    {
      id: 'req-9',
      operation: 'provision',
      status: 'PENDING',
      team: 'ml-platform',
      error: '',
      created_at: iso(-8 * 60 * 1000),
      completed_at: null,
    },
    {
      id: 'req-8',
      operation: 'provision',
      status: 'FAILED',
      team: 'payments',
      error: 'route host collides with existing route api-v1 (api.example.com)',
      created_at: iso(-3 * 60 * 60 * 1000),
      completed_at: iso(-3 * 60 * 60 * 1000 + 20_000),
    },
    {
      id: 'req-7',
      operation: 'deprovision',
      status: 'COMPLETED',
      team: 'discovery',
      error: '',
      created_at: iso(-2 * DAY_MS),
      completed_at: iso(-2 * DAY_MS + 12_000),
    },
  ],
  request_limit: 100,
}

// Mirrors the fleet reality: ext_authz OFF everywhere (a naive enable is a
// prod deny-all until the proxy→auth-service mTLS wiring exists).
export const FIXTURE_CONFIG: AdminConfig = {
  read_only: true,
  node_id: 'edge-cp-euwest1',
  reconcile_interval_ms: 5000,
  xds: { listen_addr: ':18000', tls: true, client_ca: true },
  ext_authz: { enabled: false, address: 'auth-service.edge.svc', port: 9191, tls: false, mtls: false },
  rate_limit_local: { enabled: true, max_tokens: 200, tokens_per_fill: 100, fill_interval_ms: 1000 },
  rate_limit_service: { enabled: false, address: '', port: 0, domain: '', tls: false },
  ha: { redis_configured: false, instance_id: 'cp-7f3a' },
}
