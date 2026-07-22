// The serving graph: gateways → routes → clusters → endpoints, as the control
// plane publishes it. Secret fields are NAME references by API construction —
// rendered as plain identifiers, never treated as sensitive material.
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, Row } from '@talyvor/ui'
import { adminApi } from './api'
import { Chip, FixtureChip, FixtureNote } from './components'

export function Topology() {
  const q = useQuery({ queryKey: ['admin-topology'], queryFn: adminApi.topology })
  if (q.isLoading) return <div className="px-gutter py-3 text-body text-muted">Loading…</div>
  if (q.isError || !q.data) return <div className="px-gutter py-3 text-body text-muted">Couldn’t load topology.</div>
  const { source, data } = q.data
  const clusterName = new Map(data.clusters.map((c) => [c.id, c.name]))

  return (
    <div className="flex flex-col gap-gutter">
      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">
            Gateways
            <span className="text-caption font-normal tabular-nums text-muted">{data.gateways.length}</span>
            {source === 'fixture' ? <FixtureChip /> : null}
          </span>
        </CardHeader>
        {data.gateways.map((g) => (
          <Row
            key={g.id}
            label={g.name}
            hint={
              Object.entries(g.node_selector).length
                ? `selector ${Object.entries(g.node_selector)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')}`
                : 'no node selector'
            }
          >
            {g.tls_secret ? <Chip title="TLS secret NAME reference — never material">{g.tls_secret}</Chip> : null}
            <span className="text-caption font-normal tabular-nums text-muted">
              {g.protocol} :{g.port}
            </span>
          </Row>
        ))}
      </Card>

      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">
            Routes
            <span className="text-caption font-normal tabular-nums text-muted">{data.routes.length}</span>
          </span>
        </CardHeader>
        {data.routes.map((r) => (
          <Row
            key={r.id}
            label={r.name}
            hint={`${r.hosts.join(', ')}${r.path_prefix ? ` ${r.path_prefix}` : ''} → ${r.cluster_name} · ${r.timeout_seconds}s timeout${
              r.rate_limit_per_unit > 0 ? ` · ${r.rate_limit_per_unit}/${r.rate_limit_unit}` : ''
            }`}
          >
            <Chip title="Route auth policy">{r.auth_policy}</Chip>
          </Row>
        ))}
      </Card>

      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">
            Clusters
            <span className="text-caption font-normal tabular-nums text-muted">{data.clusters.length}</span>
          </span>
        </CardHeader>
        {data.clusters.map((c) => (
          <Row
            key={c.id}
            label={c.name}
            hint={
              c.health_check_path
                ? `health ${c.health_check_path} every ${c.health_check_interval_s}s`
                : 'no health check'
            }
          >
            <span className="text-caption font-normal tabular-nums text-muted">
              {c.lb_policy} · {c.connect_timeout_ms}ms connect
            </span>
          </Row>
        ))}
      </Card>

      <div className="flex flex-col gap-2">
        <Card>
          <CardHeader>
            <span className="inline-flex items-center gap-2">
              Endpoints
              <span className="text-caption font-normal tabular-nums text-muted">{data.endpoints.length}</span>
            </span>
          </CardHeader>
          {data.endpoints.map((e) => (
            <Row
              key={e.id}
              label={
                <span className="font-mono text-body text-ink">
                  {e.address}:{e.port}
                </span>
              }
              hint={`cluster ${clusterName.get(e.cluster_id) ?? e.cluster_id}`}
            >
              <span className="text-body tabular-nums text-muted">weight {e.weight}</span>
            </Row>
          ))}
        </Card>
        {source === 'fixture' ? <FixtureNote /> : null}
      </div>
    </div>
  )
}
