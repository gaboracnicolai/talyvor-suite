// Certificate inventory: names, issuers, expiry. Expiry is the one admin
// surface where a warning colour earns its keep — economy states, not new
// ones: valid → settled, <30d → held, expired → slashed (certExpiry.ts).
// A parse_error row is reported by the server rather than dropped; here it
// stays visible with a neutral chip and NO expiry claim — no data, no verdict.
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, Pill, Row } from '@talyvor/ui'
import { adminApi, type CertificateEntry } from './api'
import { daysUntil, expiryLabel, expiryPill, expiryState } from './certExpiry'
import { Chip, FixtureChip, FixtureNote, MonoId, formatDay } from './components'

function CertRow({ cert, nowMS }: { cert: CertificateEntry; nowMS: number }) {
  if (cert.parse_error || !cert.not_after) {
    return (
      <Row
        label={cert.name}
        hint="stored PEM could not be parsed — no expiry data, so no expiry verdict"
      >
        <Chip>{cert.kind}</Chip>
        <Chip title="The server reports this row rather than dropping it; the certificate needs replacing or re-importing">
          parse error
        </Chip>
      </Row>
    )
  }
  const state = expiryState(cert.not_after, nowMS)
  const days = daysUntil(cert.not_after, nowMS)
  return (
    <Row
      label={cert.name}
      hint={
        <span className="inline-flex items-center gap-2">
          {cert.issuer ? <span>{cert.issuer}</span> : null}
          {cert.fingerprint_sha256 ? <MonoId value={cert.fingerprint_sha256} /> : null}
        </span>
      }
    >
      <Chip>{cert.kind}</Chip>
      <span className="text-caption font-normal tabular-nums text-muted">
        {formatDay(cert.not_after)}
        {days !== null ? (days >= 0 ? ` · ${days}d left` : ` · ${-days}d ago`) : ''}
      </span>
      <Pill status={expiryPill[state]}>{expiryLabel[state]}</Pill>
    </Row>
  )
}

export function Certificates() {
  const q = useQuery({ queryKey: ['admin-certificates'], queryFn: adminApi.certificates })
  if (q.isLoading) return <div className="px-gutter py-3 text-body text-muted">Loading…</div>
  if (q.isError || !q.data) return <div className="px-gutter py-3 text-body text-muted">Couldn’t load certificates.</div>
  const { source, data } = q.data
  const nowMS = Date.now()

  return (
    <div className="flex flex-col gap-2">
      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">
            Certificates
            {source === 'fixture' ? <FixtureChip /> : null}
          </span>
        </CardHeader>
        {data.certificates.length === 0 ? (
          <div className="px-gutter py-3 text-body text-muted">No certificates in the store.</div>
        ) : (
          data.certificates.map((c) => <CertRow key={c.name} cert={c} nowMS={nowMS} />)
        )}
      </Card>
      {source === 'fixture' ? <FixtureNote /> : null}
    </div>
  )
}
