import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, MuNumeral, Pill, Row } from '@talyvor/ui'
import { api, type Bond, type LedgerEntry } from '../lib/api'
import { CapabilityOff } from '../components/Capability'
import { formatUSD, formatWhen, humanizeType, ledgerStatus } from '../lib/ledger'

// Overview: the two token balances and recent activity, driven entirely by the BFF
// (which holds the Lens key). Numbers are MuNumerals; status is a Pill; nothing is faked.

function Loading() {
  return <div className="px-gutter py-3 text-body text-muted">Loading…</div>
}

function Failed({ what }: { what: string }) {
  return <div className="px-gutter py-3 text-body text-muted">Couldn’t load {what}.</div>
}

function LxcCard() {
  const q = useQuery({ queryKey: ['lxc-balance'], queryFn: api.lxcBalance })
  return (
    <Card>
      <CardHeader>LXC balance</CardHeader>
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !q.data ? (
        <Failed what="the LXC balance" />
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-gutter px-gutter py-3">
            <MuNumeral micros={q.data.balance_ulxc} unit="lxc" />
            <span className="text-caption text-muted">≈ {formatUSD(q.data.usd_value_uusd)}</span>
          </div>
          <Row label="Lifetime minted">
            <MuNumeral micros={q.data.lifetime_minted_ulxc} unit="lxc" />
          </Row>
          <Row label="Lifetime spent">
            <MuNumeral micros={q.data.lifetime_spent_ulxc} unit="lxc" />
          </Row>
        </>
      )}
    </Card>
  )
}

function LensCard() {
  const q = useQuery({ queryKey: ['lens-balance'], queryFn: api.lensBalance })
  return (
    <Card>
      <CardHeader>LENS balance</CardHeader>
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !q.data ? (
        <Failed what="the LENS balance" />
      ) : (
        <>
          <div className="px-gutter py-3">
            <MuNumeral micros={q.data.balance_ulens} unit="lens" />
          </div>
          <Row label="Lifetime earned">
            <MuNumeral micros={q.data.lifetime_earned_ulens} unit="lens" />
          </Row>
          <Row label="Lifetime spent">
            <MuNumeral micros={q.data.lifetime_spent_ulens} unit="lens" />
          </Row>
          <Row label="Updated" hint={formatWhen(q.data.updated_at)} />
        </>
      )}
    </Card>
  )
}

function ActivityRow({ e }: { e: LedgerEntry }) {
  const status = ledgerStatus(e.type)
  return (
    <Row label={e.description || humanizeType(e.type)} hint={formatWhen(e.created_at)}>
      <MuNumeral micros={e.amount_ulens} unit="lens" />
      {status ? (
        <Pill status={status}>{status}</Pill>
      ) : (
        <span className="text-caption uppercase tracking-wide text-muted">{humanizeType(e.type)}</span>
      )}
    </Row>
  )
}

function RecentActivity() {
  const q = useQuery({ queryKey: ['tokens-history', 5, 0], queryFn: () => api.tokensHistory(5, 0) })
  return (
    <Card>
      <CardHeader>Recent activity</CardHeader>
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !q.data ? (
        <Failed what="recent activity" />
      ) : q.data.length === 0 ? (
        <div className="px-gutter py-3 text-body text-muted">No ledger entries yet.</div>
      ) : (
        q.data.map((e) => <ActivityRow key={e.id} e={e} />)
      )}
    </Card>
  )
}

// Bonds is a capability-gated feature (H5). When off, the BFF reports { enabled: false }
// and this reads as OFF — calm information — never as an error. When on, it lists bonds.
function BondsCard() {
  const q = useQuery({ queryKey: ['bonds'], queryFn: api.bonds })
  return (
    <Card>
      <CardHeader>Bonds</CardHeader>
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !q.data ? (
        <Failed what="bonds" />
      ) : !q.data.enabled ? (
        <CapabilityOff name="Reputation bonds" note="Turned off in this workspace (H5 bonds is disabled)." />
      ) : q.data.data.length === 0 ? (
        <div className="px-gutter py-3 text-body text-muted">No bonds yet.</div>
      ) : (
        q.data.data.map((b: Bond) => <Row key={b.id} label={b.id} hint={b.kind} />)
      )}
    </Card>
  )
}

export function Overview() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-gutter">
      <div className="grid grid-cols-1 gap-gutter wide:grid-cols-2">
        <LxcCard />
        <LensCard />
      </div>
      <RecentActivity />
      <BondsCard />
    </div>
  )
}
