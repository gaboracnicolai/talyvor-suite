// Connected nodes + ACK divergence. THE SCOPE CAVEAT IS THE SCREEN'S FIRST
// SENTENCE: /nodes reports nodes with open xDS streams RIGHT NOW and nothing
// else — no expected-node registry exists anywhere, so "every listed node
// acked" must never read as "all nodes healthy". The server stamps
// scope:"connected-only" + a note into the response; this screen renders both
// and words its own summary against the connected set only.
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, Pill, Row } from '@talyvor/ui'
import { adminApi } from './api'
import { Chip, FixtureChip, FixtureNote, MonoId, formatWhen } from './components'

export function Nodes() {
  const q = useQuery({ queryKey: ['admin-nodes'], queryFn: adminApi.nodes })
  if (q.isLoading) return <div className="px-gutter py-3 text-body text-muted">Loading…</div>
  if (q.isError || !q.data) return <div className="px-gutter py-3 text-body text-muted">Couldn’t load nodes.</div>
  const { source, data } = q.data
  const inSync = data.nodes.filter((n) => !n.behind).length

  return (
    <div className="flex flex-col gap-2">
      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">
            Connected nodes
            <Chip title={data.note}>{data.scope}</Chip>
            {source === 'fixture' ? <FixtureChip /> : null}
          </span>
        </CardHeader>
        {/* The server's own caveat, verbatim and always visible — not a tooltip. */}
        <p className="border-b border-rule px-gutter py-2 text-caption font-normal text-muted">{data.note}</p>
        <Row
          label="Published version"
          hint={`last reconcile ${formatWhen(new Date(data.last_reconcile_unix * 1000).toISOString())} · ${(
            data.last_reconcile_duration_seconds * 1000
          ).toFixed(0)} ms`}
        >
          <MonoId value={data.published_version} />
        </Row>
        <Row
          label={`${data.nodes.length} connected · ${inSync} in sync · ${data.nodes_behind} behind`}
          hint="of the connected set only — nothing here counts nodes that are not connected"
        >
          <span className="text-caption font-normal tabular-nums text-muted">{data.active_streams} streams</span>
        </Row>
        {data.nodes.map((n) => (
          <Row key={n.node_id} label={<span className="font-mono text-body text-ink">{n.node_id}</span>} hint={<MonoId value={n.acked_version} />}>
            {n.behind ? <Pill status="held">behind</Pill> : <Pill status="settled">in sync</Pill>}
          </Row>
        ))}
      </Card>
      {source === 'fixture' ? <FixtureNote /> : null}
    </div>
  )
}
