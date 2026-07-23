// Effective configuration — REPORTED, NOT SETTABLE. The server stamps
// read_only:true into the response and this screen renders state as text
// (OnOff), never as a control: no Switch, no button, nothing that implies the
// ext_authz flip (an env var on the control plane) can be driven from here.
// A toggle would silently make this UI a GitOps writer.
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, Row } from '@talyvor/ui'
import { adminApi } from './api'
import { Chip, FixtureChip, FixtureNote, OnOff } from './components'

export function Config() {
  const q = useQuery({ queryKey: ['admin-config'], queryFn: adminApi.config })
  if (q.isLoading) return <div className="px-gutter py-3 text-body text-muted">Loading…</div>
  if (q.isError || !q.data) return <div className="px-gutter py-3 text-body text-muted">Couldn’t load config.</div>
  const { source, data } = q.data

  return (
    <div className="flex flex-col gap-2">
      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">
            Effective configuration
            {data.read_only ? <Chip title="Stamped by the server: this API offers no write path">read-only</Chip> : null}
            {source === 'fixture' ? <FixtureChip /> : null}
          </span>
        </CardHeader>
        <Row label="Control plane" hint={`reconcile every ${data.reconcile_interval_ms} ms`}>
          <span className="font-mono text-caption font-normal text-muted">{data.node_id}</span>
        </Row>
        <Row label="xDS listener" hint={data.xds.listen_addr}>
          <span className="text-caption font-normal uppercase tracking-wide text-muted">tls</span>
          <OnOff on={data.xds.tls} />
          <span className="text-caption font-normal uppercase tracking-wide text-muted">client ca</span>
          <OnOff on={data.xds.client_ca} />
        </Row>
      </Card>

      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">ext_authz</span>
        </CardHeader>
        {/* State without control, stated in words so nobody goes looking for the button. */}
        <p className="border-b border-rule px-gutter py-2 text-body text-muted">
          Reported, not settable: the flip is an environment variable on the control plane, changed
          through the deploy pipeline — this surface shows state and offers no control.
        </p>
        <Row label="Front-door auth" hint={data.ext_authz.enabled ? `${data.ext_authz.address}:${data.ext_authz.port}` : 'requests are not authenticated at the edge gateway'}>
          <OnOff on={data.ext_authz.enabled} />
        </Row>
        <Row label="Transport to auth service" hint="presence booleans — configured paths, not file contents">
          <span className="text-caption font-normal uppercase tracking-wide text-muted">tls</span>
          <OnOff on={data.ext_authz.tls} />
          <span className="text-caption font-normal uppercase tracking-wide text-muted">mtls</span>
          <OnOff on={data.ext_authz.mtls} />
        </Row>
      </Card>

      <Card>
        <CardHeader>Rate limiting</CardHeader>
        <Row
          label="Local token bucket"
          hint={
            data.rate_limit_local.enabled
              ? `${data.rate_limit_local.max_tokens} max · ${data.rate_limit_local.tokens_per_fill} per ${data.rate_limit_local.fill_interval_ms} ms`
              : 'not enabled'
          }
        >
          <OnOff on={data.rate_limit_local.enabled} />
        </Row>
        <Row
          label="Rate limit service"
          hint={
            data.rate_limit_service.enabled
              ? `${data.rate_limit_service.address}:${data.rate_limit_service.port} · domain ${data.rate_limit_service.domain}`
              : 'not enabled'
          }
        >
          <OnOff on={data.rate_limit_service.enabled} />
        </Row>
      </Card>

      <div className="flex flex-col gap-2">
        <Card>
          <CardHeader>HA</CardHeader>
          <Row label="Redis" hint={data.ha.redis_configured ? 'configured' : 'not configured — single instance'}>
            <OnOff on={data.ha.redis_configured} />
          </Row>
          <Row label="Instance">
            <span className="font-mono text-caption font-normal text-muted">{data.ha.instance_id}</span>
          </Row>
        </Card>
        {source === 'fixture' ? <FixtureNote /> : null}
      </div>
    </div>
  )
}
