import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, FixtureNotice, MuNumeral, Pill, Row, TierDot } from '@talyvor/ui'
import { api, ApiError, type Bond, type LedgerEntry } from '../../lib/api'
import { CapabilityOff } from './Capability'
import { fixtureCache, fixtureModelTiers } from './fixtures'
import { formatUSD, formatWhen, humanizeType, ledgerStatus } from './format'
import { byModel, debitTotal, inWindow } from './spendMath'

// Overview: the first screen a trial user sees. It answers, in order:
//   1. What have I got?            — the two balances (live).
//   2. What am I spending — and what am I earning? — the TWO token economies,
//      plainly separated and wearing their own metals: LXC debits (steel; the
//      lxc_ledger is what inference SPENDS) + month ≈USD, then LENS mint
//      attribution by model (copper; lens_token_ledger is what mining EARNS).
//   3. Is the cache earning me anything? — the product's claim. SAMPLE today,
//      visibly marked: no Lens per-workspace cache endpoint exists, and
//      cache-hit ledger visibility (lens #339) is not deployed. See the report.
//   4. Is anything wrong?          — the products strip. An unconfigured
//                                    product (BFF 503) reads as calm state,
//                                    never as an error.
//   5. What just happened?         — recent ledger activity, last and small.
//
// Density is the idiom: settings rows, not billboards. One 200-row history
// fetch feeds both the by-model table and recent activity (react-query dedupes
// on the shared key). Numbers: exact µ counts are MuNumerals; anything derived
// (month USD, hit rate) is a ≈-marked muted caption; plain counts are mono ink.

const HISTORY_KEY = ['tokens-history', 200, 0] as const
function useHistory() {
  return useQuery({ queryKey: HISTORY_KEY, queryFn: () => api.tokensHistory(200, 0) })
}

function Loading() {
  return <div className="px-gutter py-3 text-body text-muted">Loading…</div>
}

function Failed({ what }: { what: string }) {
  return <div className="px-gutter py-3 text-body text-muted">Couldn’t load {what}.</div>
}

/* ── 1 · Balances (live, unchanged) ─────────────────────────────────────── */

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
            <span className="text-body text-muted">≈ {formatUSD(q.data.usd_value_uusd)}</span>
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

/* ── 2 · Spend & earnings (the two token economies, plainly separated) ──── */
//
// THE INVERSION THIS FIXES: /api/tokens/history reads lens_token_ledger — LENS
// EARNED by pattern mining. /api/lxc/history reads lxc_ledger — LXC SPENT on
// inference. The first version of this card presented mint attribution labelled
// as spend. Now each economy wears its own metal: steel (lxc) for what left the
// balance, copper (lens) for what mining credited.
//
// Per-model granularity is asymmetric BY THE DATA: LENS mint rows carry
// metadata.model_used; LXC ledger rows carry NO model on any writer (the agent
// allocator debit — the live spend lane — writes metadata=nil, verified at lens
// 8c70d9e), so per-model spend is not derivable and the row says so.

function TokenSection({ token, children }: { token: 'lxc' | 'lens'; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-rule bg-canvas px-gutter py-1.5">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-pill ${token === 'lxc' ? 'bg-lxc' : 'bg-lens'}`}
        aria-hidden="true"
      />
      <span className="text-caption uppercase tracking-wide text-muted">{children}</span>
    </div>
  )
}

function SpendCard({ now }: { now: Date }) {
  const ledger = useHistory()
  const lxc = useQuery({ queryKey: ['lxc-history', 200, 0], queryFn: () => api.lxcLedger(200, 0) })
  const month = useQuery({ queryKey: ['spend-month'], queryFn: api.spendMonth })
  const agg = ledger.data ? byModel(inWindow(ledger.data, 30, now)).slice(0, 5) : []
  return (
    <Card>
      <CardHeader>Spend &amp; earnings — last 30 days</CardHeader>
      <TokenSection token="lxc">Spent — LXC</TokenSection>
      <Row label="This month" hint="provider spend — a float upstream, so it dresses as derived">
        {month.isLoading ? (
          <span className="text-body text-muted">Loading…</span>
        ) : month.isError || !month.data ? (
          <span className="text-body text-muted">Couldn’t load</span>
        ) : (
          <span className="text-body text-muted">≈ ${month.data.current_month_usd.toFixed(2)}</span>
        )}
      </Row>
      <Row label="Inference debits" hint="all models — LXC ledger rows carry no model attribution">
        {lxc.isLoading ? (
          <span className="text-body text-muted">Loading…</span>
        ) : lxc.isError || !lxc.data ? (
          <span className="text-body text-muted">Couldn’t load</span>
        ) : (
          <MuNumeral micros={debitTotal(lxc.data, 30, now)} unit="lxc" />
        )}
      </Row>
      <TokenSection token="lens">Earned — LENS · mint attribution</TokenSection>
      {ledger.isLoading ? (
        <Loading />
      ) : ledger.isError ? (
        <Failed what="the mint ledger" />
      ) : agg.length === 0 ? (
        <div className="px-gutter py-3 text-body text-muted">
          No mint-attributed LENS rows in the window yet.
        </div>
      ) : (
        agg.map((a) => (
          <Row
            key={a.model}
            label={
              <span className="inline-flex items-center gap-2">
                <TierDot tier={fixtureModelTiers[a.model] ?? 'cheap'} />
                {a.model}
              </span>
            }
            hint={`${a.requests} request${a.requests === 1 ? '' : 's'}`}
          >
            <MuNumeral micros={a.ulens} unit="lens" />
          </Row>
        ))
      )}
    </Card>
  )
}

/* ── 3 · Cache (the claim — SAMPLE, and it says so) ─────────────────────── */

function CacheCard() {
  return (
    <Card>
      <CardHeader>Cache</CardHeader>
      <div className="flex flex-col gap-1.5 px-gutter pb-1 pt-2.5">
        <FixtureNotice awaiting="a Lens per-workspace cache endpoint (none exists; lens #339's per-request visibility is merged upstream but not deployed here)" />
        <div className="text-caption font-normal text-muted">
          A cache hit serves the response without calling the provider.
        </div>
      </div>
      <Row label="Cached serves" hint="responses answered from cache">
        <span className="font-mono text-body text-ink">
          {fixtureCache.cache_hits.toLocaleString('en-US')}
        </span>
      </Row>
      <Row label="Hit rate" hint={`${fixtureCache.cache_lookups.toLocaleString('en-US')} lookups`}>
        <span className="text-body text-muted">
          ≈ {Math.round(fixtureCache.cache_hit_rate * 100)}%
        </span>
      </Row>
    </Card>
  )
}

/* ── 4 · Products (configured / not configured — state, never a fault) ──── */

type ProbeState = 'on' | 'off'

// An unconfigured upstream is a 503 from the BFF's proxyProduct ("… upstream
// not configured on this BFF") and a plain-proxied absence is a 404 — both are
// INFORMATION. Anything else is a genuine failure and throws.
async function probeProduct(path: string): Promise<ProbeState> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (res.ok) return 'on'
  if (res.status === 503 || res.status === 404) return 'off'
  throw new ApiError(res.status, path)
}

function StateMark({ state }: { state: ProbeState }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption uppercase tracking-wide text-faint">
      <span
        className={`h-1.5 w-1.5 rounded-pill ${state === 'on' ? 'bg-settled' : 'bg-faint'}`}
        aria-hidden="true"
      />
      {state === 'on' ? 'Configured' : 'Not configured'}
    </span>
  )
}

function ProductRow({ name, hint, path }: { name: string; hint: string; path: string }) {
  const q = useQuery({ queryKey: ['probe', path], queryFn: () => probeProduct(path) })
  return (
    <Row label={name} hint={q.data === 'off' ? 'Not configured on this BFF deployment.' : hint}>
      {q.isLoading ? (
        <span className="text-caption text-muted">Checking…</span>
      ) : q.isError ? (
        <span className="text-caption text-muted">Couldn’t check</span>
      ) : (
        <StateMark state={q.data as ProbeState} />
      )}
    </Row>
  )
}

function ProductsCard() {
  // Lens's row rides the SAME query the balance card runs (shared key — no
  // second request): a served balance proves the gateway answers through the BFF.
  const lens = useQuery({ queryKey: ['lxc-balance'], queryFn: api.lxcBalance })
  const bonds = useQuery({ queryKey: ['bonds'], queryFn: api.bonds })
  return (
    <Card>
      <CardHeader>Products</CardHeader>
      <Row label="Lens" hint="Inference gateway — balances, ledger, keys">
        {lens.isLoading ? (
          <span className="text-caption text-muted">Checking…</span>
        ) : lens.isError ? (
          <span className="text-caption text-muted">Couldn’t check</span>
        ) : (
          <StateMark state="on" />
        )}
      </Row>
      <ProductRow name="Track" hint="Issues & workflows" path="/api/track/workspaces" />
      <ProductRow name="Docs" hint="Team wiki" path="/api/docs/spaces" />
      {bonds.isLoading ? (
        <Loading />
      ) : bonds.isError || !bonds.data ? (
        <Failed what="bonds" />
      ) : !bonds.data.enabled ? (
        <CapabilityOff
          name="Reputation bonds"
          note="Turned off in this workspace (H5 bonds is disabled)."
        />
      ) : (
        <Row
          label="Reputation bonds"
          hint={`${(bonds.data.data as Bond[]).length} bond${bonds.data.data.length === 1 ? '' : 's'}`}
        >
          <StateMark state="on" />
        </Row>
      )}
    </Card>
  )
}

/* ── 5 · Recent activity (last, small; rides the shared ledger fetch) ───── */

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
  const q = useHistory()
  const rows = (q.data ?? []).slice(0, 5)
  return (
    <Card>
      <CardHeader>Recent activity</CardHeader>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <Failed what="recent activity" />
      ) : rows.length === 0 ? (
        <div className="px-gutter py-3 text-body text-muted">No ledger entries yet.</div>
      ) : (
        rows.map((e) => <ActivityRow key={e.id} e={e} />)
      )}
    </Card>
  )
}

/* ── The screen ─────────────────────────────────────────────────────────── */

export function Overview({ now = new Date() }: { now?: Date } = {}) {
  return (
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-gutter wide:grid-cols-2">
      <LxcCard />
      <LensCard />
      <SpendCard now={now} />
      <CacheCard />
      <ProductsCard />
      <RecentActivity />
    </div>
  )
}
