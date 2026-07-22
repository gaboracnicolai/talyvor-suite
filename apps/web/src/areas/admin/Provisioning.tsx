// OSB state: provisioned services + the request log INCLUDING failures.
// Request lifecycle uses the economy states (PENDING → held, COMPLETED →
// settled, FAILED → slashed) and a FAILED row shows its error text verbatim —
// the failure detail is what an operator opens this screen for.
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, Pill, Row } from '@talyvor/ui'
import type { PillStatus } from '@talyvor/ui'
import { adminApi, type ProvisionRequest } from './api'
import { Chip, FixtureChip, FixtureNote, formatWhen } from './components'

const statusPill: Record<ProvisionRequest['status'], PillStatus> = {
  PENDING: 'held',
  COMPLETED: 'settled',
  FAILED: 'slashed',
}

export function Provisioning() {
  const q = useQuery({ queryKey: ['admin-provisioning'], queryFn: adminApi.provisioning })
  if (q.isLoading) return <div className="px-gutter py-3 text-body text-muted">Loading…</div>
  if (q.isError || !q.data) return <div className="px-gutter py-3 text-body text-muted">Couldn’t load provisioning.</div>
  const { source, data } = q.data

  return (
    <div className="flex flex-col gap-gutter">
      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">
            Provisioned services
            {source === 'fixture' ? <FixtureChip /> : null}
          </span>
        </CardHeader>
        {data.services.length === 0 ? (
          <div className="px-gutter py-3 text-body text-muted">No services provisioned.</div>
        ) : (
          data.services.map((s) => (
            <Row
              key={s.id}
              label={s.name}
              hint={`${s.host}:${s.port} · ${s.protocol}${s.tls_secret_name ? ` · tls ${s.tls_secret_name}` : ''}`}
            >
              <Chip>{s.team}</Chip>
              <Chip title="Route auth policy">{s.auth_policy}</Chip>
              <span className="text-caption font-normal tabular-nums text-muted">upd {formatWhen(s.updated_at)}</span>
            </Row>
          ))
        )}
      </Card>

      <div className="flex flex-col gap-2">
        <Card>
          <CardHeader>
            <span className="inline-flex items-center gap-2">
              Requests
              <span className="text-caption font-normal tabular-nums text-muted">
                newest first · server-capped at {data.request_limit}
              </span>
            </span>
          </CardHeader>
          {data.requests.length === 0 ? (
            <div className="px-gutter py-3 text-body text-muted">No provision requests recorded.</div>
          ) : (
            data.requests.map((r) => (
              <Row
                key={r.id}
                label={
                  <span className="inline-flex items-center gap-2">
                    {r.operation}
                    <Chip>{r.team}</Chip>
                  </span>
                }
                // The error verbatim: this line is the reason the screen exists.
                hint={r.error ? r.error : `${formatWhen(r.created_at)}${r.completed_at ? ` → ${formatWhen(r.completed_at)}` : ''}`}
              >
                {r.error ? (
                  <span className="text-caption font-normal tabular-nums text-muted">{formatWhen(r.created_at)}</span>
                ) : null}
                <Pill status={statusPill[r.status]}>{r.status.toLowerCase()}</Pill>
              </Row>
            ))
          )}
        </Card>
        {source === 'fixture' ? <FixtureNote /> : null}
      </div>
    </div>
  )
}
