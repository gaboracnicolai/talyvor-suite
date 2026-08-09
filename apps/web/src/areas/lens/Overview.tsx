import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardHeader, MuNumeral, Pill, Row } from "@talyvor/ui";
import { api, ApiError, type Bond, type LedgerEntry } from "../../lib/api";
import { CacheCard } from "./CacheCard";
import { ConvertLens } from "./ConvertLens";
import {
  InlineFailure,
  PanelFailure,
} from "../../components/SessionExpiredBar";
import { CapabilityOff } from "./Capability";
import { ModelTier } from "./ModelTier";
import { formatUSD, formatWhen, humanizeType, ledgerStatus } from "./format";
import { byModel, debitTotal, inWindow, lxcDebitsByModel } from "./spendMath";

// Overview: the first screen a trial user sees. It answers, in order:
//   1. What have I got?            — the two balances (live).
//   2. What am I spending — and what am I earning? — the TWO token economies,
//      plainly separated and wearing their own metals: LXC debits (steel; the
//      lxc_ledger is what inference SPENDS) + month ≈USD, then LENS mint
//      attribution by model (copper; lens_token_ledger is what mining EARNS).
//   3. Is the cache earning me anything? — the product's claim, on MEASURED
//      numbers from /api/usage (Lens serve_source). This was a fixture reading
//      1,240 serves at 87% under a caption explaining that no endpoint served
//      it; the endpoint existed all along. See CacheCard.tsx.
//   4. Is anything wrong?          — the products strip. An unconfigured
//                                    product (BFF 503) reads as calm state,
//                                    never as an error.
//   5. What just happened?         — recent ledger activity, last and small.
//
// Density is the idiom: settings rows, not billboards. One 200-row history
// fetch feeds both the by-model table and recent activity (react-query dedupes
// on the shared key). Numbers: exact µ counts are MuNumerals; anything derived
// (month USD, hit rate) is a ≈-marked muted caption; plain counts are mono ink.

const HISTORY_KEY = ["tokens-history", 200, 0] as const;
function useHistory() {
  return useQuery({
    queryKey: HISTORY_KEY,
    queryFn: () => api.tokensHistory(200, 0),
  });
}

function Loading() {
  return <div className="px-gutter py-3 text-body text-muted">Loading…</div>;
}

// Delegates the WHAT-TO-SAY decision to the one component that makes it (see
// components/SessionExpiredBar.tsx). A panel knows its own request failed; it cannot know
// whether every other panel failed for the same reason, so it must not name a cause.
function Failed({ what, error }: { what: string; error: unknown }) {
  return <PanelFailure error={error} what={what} />;
}

/* ── 1 · Balances (live, unchanged) ─────────────────────────────────────── */

function LxcCard() {
  const q = useQuery({ queryKey: ["lxc-balance"], queryFn: api.lxcBalance });
  return (
    <Card>
      <CardHeader>LXC balance</CardHeader>
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !q.data ? (
        <Failed what="the LXC balance" error={q.error} />
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-gutter px-gutter py-3">
            <MuNumeral micros={q.data.balance_ulxc} unit="lxc" />
            <span className="text-body text-muted">
              ≈ {formatUSD(q.data.usd_value_uusd)}
            </span>
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
  );
}

function LensCard() {
  const q = useQuery({ queryKey: ["lens-balance"], queryFn: api.lensBalance });
  return (
    <Card>
      <CardHeader>LENS balance</CardHeader>
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !q.data ? (
        <Failed what="the LENS balance" error={q.error} />
      ) : (
        <>
          <div className="px-gutter py-3">
            <MuNumeral micros={q.data.balance_ulens} unit="lens" />
          </div>
          {/* ⚠ THREE STATES, NOT ONE. A pool royalty credits HELD balance and becomes spendable
              only when Lens's finalize sweeper settles it (the operator-set holdback). The first
              real royalty was 822 µLENS held against a spendable balance of 0 — correct, and
              unreadable: the screen showed one number and the ledger showed another.

              Counting held in the headline would overstate what can be spent, and the conversion
              would then refuse an amount the user had just been shown. Omitting it loses money
              they earned. So it is its own row, labelled, and rendered ONLY when there is some —
              a permanent "Held 0" would be noise on every workspace that never earns a royalty.

              ⚠ THE HINT CARRIED TWO ERRORS OF THE SAME CLASS, both corrected here.
              (1) It said "about 72h". That is LENS_POOL_HOLDBACK_WINDOW — an operator setting,
                  which Lens publishes on NO endpoint. This screen therefore cannot read it and
                  was printing a figure it had no way to verify; on a deployment configured
                  differently it was simply wrong. Terms explicitly promises that this screen
                  "reflects how this deployment is currently configured", which a hardcoded
                  constant cannot do.
              (2) It said only that held LENS SETTLES. During the window it can also be REVOKED
                  (mining.RevokeHeldTx burns it) — that is what the window is FOR. Saying the
                  settlement and omitting the reversal is the pleasant half of the mechanism,
                  and Terms already states both, so this row contradicted it by omission. */}
          {(q.data.held_balance_ulens ?? 0) > 0 ? (
            <Row
              label="Held — not yet spendable"
              hint="settles on its own after a holding period — during which it can still be revoked"
            >
              <MuNumeral micros={q.data.held_balance_ulens ?? 0} unit="lens" />
            </Row>
          ) : null}
          <Row label="Lifetime earned">
            <MuNumeral micros={q.data.lifetime_earned_ulens} unit="lens" />
          </Row>
          <Row label="Lifetime spent">
            <MuNumeral micros={q.data.lifetime_spent_ulens} unit="lens" />
          </Row>
          <Row label="Updated" hint={formatWhen(q.data.updated_at)} />
          {/* The exit. Earned LENS was unspendable from the suite until this: Lens has had the
              conversion, nothing here offered it. Collapsed by default, so reading the balance
              costs the same one request it always did. */}
          <ConvertLens
            lensBalanceMicros={q.data.balance_ulens}
            heldMicros={q.data.held_balance_ulens ?? 0}
          />
        </>
      )}
    </Card>
  );
}

/* ── 2 · Spend & earnings (the two token economies, plainly separated) ──── */
//
// THE INVERSION THIS FIXES: /api/tokens/history reads lens_token_ledger — LENS
// EARNED by pattern mining. /api/lxc/history reads lxc_ledger — LXC SPENT on
// inference. The first version of this card presented mint attribution labelled
// as spend. Now each economy wears its own metal: steel (lxc) for what left the
// balance, copper (lens) for what mining credited.
//
// BOTH ledgers now split per model, from their own metadata: LENS mint rows carry
// metadata.model_used, and LXC rows carry requested_model on every agent-lane writer
// (#343) plus served_model on the delivered-charge row (#355). This card used to say
// per-model LXC spend was "not derivable" — true at lens 8c70d9e, false from #343, and
// it survived because api.lxcLedger discarded the field so nothing could contradict it.
// The two splits are kept in SEPARATE sections and never summed: µLXC charged to the
// workspace is not provider USD COGS.

function TokenSection({
  token,
  children,
}: {
  token: "lxc" | "lens";
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 border-b border-rule bg-canvas px-gutter py-1.5">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-pill ${token === "lxc" ? "bg-lxc" : "bg-lens"}`}
        aria-hidden="true"
      />
      <span className="font-figure text-eyebrow uppercase text-muted">
        {children}
      </span>
    </div>
  );
}

function SpendCard({ now }: { now: Date }) {
  const ledger = useHistory();
  const lxc = useQuery({
    queryKey: ["lxc-history", 200, 0],
    queryFn: () => api.lxcLedger(200, 0),
  });
  const month = useQuery({
    queryKey: ["spend-month"],
    queryFn: api.spendMonth,
  });
  const agg = ledger.data
    ? byModel(inWindow(ledger.data, 30, now)).slice(0, 5)
    : [];
  const lxcSplit = lxc.data
    ? lxcDebitsByModel(lxc.data, 30, now).slice(0, 5)
    : [];
  return (
    <Card>
      <CardHeader>Spend &amp; earnings — last 30 days</CardHeader>
      <TokenSection token="lxc">Spent — LXC</TokenSection>
      <Row
        label="This month"
        hint="provider spend — a float upstream, so it dresses as derived"
      >
        {month.isLoading ? (
          <span className="text-body text-muted">Loading…</span>
        ) : month.isError || !month.data ? (
          <InlineFailure error={month.error} />
        ) : (
          <span className="text-body text-muted">
            ≈ ${month.data.current_month_usd.toFixed(2)}
          </span>
        )}
      </Row>
      <Row
        label="Inference debits"
        hint="every model — the window total that left the balance"
      >
        {lxc.isLoading ? (
          <span className="text-body text-muted">Loading…</span>
        ) : lxc.isError || !lxc.data ? (
          <InlineFailure error={lxc.error} />
        ) : (
          <MuNumeral micros={debitTotal(lxc.data, 30, now)} unit="lxc" />
        )}
      </Row>
      {/* The per-model split of that total. This row is the correction of a caption that
          said it was impossible: Lens stamps requested_model on every agent-lane writer
          and served_model on the delivered-charge row, and api.lxcLedger was discarding
          the field before any screen could read it. Attribution is to the model that
          SERVED, falling back to the requested one (a hold predates routing). */}
      {lxcSplit.length > 0 ? (
        <>
          <TokenSection token="lxc">Spend by model — LXC</TokenSection>
          <div data-testid="lxc-by-model">
            {lxcSplit.map((a) => (
              <Row
                key={a.model}
                label={
                  <span className="inline-flex items-center gap-2">
                    <ModelTier model={a.model} />
                    {a.model}
                  </span>
                }
                hint={`${a.requests} charge${a.requests === 1 ? "" : "s"}`}
              >
                <MuNumeral micros={a.ulxc} unit="lxc" />
              </Row>
            ))}
          </div>
        </>
      ) : null}
      <TokenSection token="lens">Earned — LENS · mint attribution</TokenSection>
      {ledger.isLoading ? (
        <Loading />
      ) : ledger.isError ? (
        <Failed what="the mint ledger" error={ledger.error} />
      ) : agg.length === 0 ? (
        <div className="px-gutter py-3 text-body text-muted">
          {/* ⚠ CORRECT AND UNHELPFUL IS THE FAILURE MODE. "No rows yet" is true on every
              brand-new workspace and leaves a first user unable to tell working from broken.
              Say what PUTS a row here. */}
          No earnings yet. A row appears here when another company is served an answer this
          workspace produced — which needs sharing left on, and needs your traffic to have
          answered something they later ask.
        </div>
      ) : (
        // Scoped like the LXC split above: the same model name legitimately appears in
        // BOTH sections now (earned here, charged there), so a test asserting "the mint
        // table lists sonnet" must say WHICH table — an unscoped getByText would resolve
        // to whichever came first and quietly stop testing what it names.
        <div data-testid="lens-by-model">
          {agg.map((a) => (
            <Row
              key={a.model}
              label={
                <span className="inline-flex items-center gap-2">
                  <ModelTier model={a.model} />
                  {a.model}
                </span>
              }
              hint={`${a.requests} request${a.requests === 1 ? "" : "s"}`}
            >
              <MuNumeral micros={a.ulens} unit="lens" />
            </Row>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── 4 · Products (configured / not configured — state, never a fault) ──── */

type ProbeState = "on" | "off";

// An unconfigured upstream is a 503 from the BFF's proxyProduct ("… upstream
// not configured on this BFF") and a plain-proxied absence is a 404 — both are
// INFORMATION. Anything else is a genuine failure and throws.
async function probeProduct(path: string): Promise<ProbeState> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (res.ok) return "on";
  if (res.status === 503 || res.status === 404) return "off";
  throw new ApiError(res.status, path);
}

function StateMark({ state }: { state: ProbeState }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-figure text-eyebrow uppercase text-faint">
      <span
        className={`h-1.5 w-1.5 rounded-pill ${state === "on" ? "bg-settled" : "bg-faint"}`}
        aria-hidden="true"
      />
      {state === "on" ? "Configured" : "Not configured"}
    </span>
  );
}

function ProductRow({
  name,
  hint,
  path,
}: {
  name: string;
  hint: string;
  path: string;
}) {
  const q = useQuery({
    queryKey: ["probe", path],
    queryFn: () => probeProduct(path),
  });
  return (
    <Row
      label={name}
      hint={q.data === "off" ? "Not configured on this BFF deployment." : hint}
    >
      {q.isLoading ? (
        <span className="text-caption text-muted">Checking…</span>
      ) : q.isError ? (
        <InlineFailure
          error={q.error}
          className="text-caption text-muted"
          failed="Couldn’t check"
        />
      ) : (
        <StateMark state={q.data as ProbeState} />
      )}
    </Row>
  );
}

function ProductsCard() {
  // Lens's row rides the SAME query the balance card runs (shared key — no
  // second request): a served balance proves the gateway answers through the BFF.
  const lens = useQuery({ queryKey: ["lxc-balance"], queryFn: api.lxcBalance });
  const bonds = useQuery({ queryKey: ["bonds"], queryFn: api.bonds });
  return (
    <Card>
      <CardHeader>Products</CardHeader>
      <Row label="Lens" hint="Inference gateway — balances, ledger, keys">
        {lens.isLoading ? (
          <span className="text-caption text-muted">Checking…</span>
        ) : lens.isError ? (
          <InlineFailure
            error={lens.error}
            className="text-caption text-muted"
            failed="Couldn’t check"
          />
        ) : (
          <StateMark state="on" />
        )}
      </Row>
      <ProductRow
        name="Track"
        hint="Issues & workflows"
        path="/api/track/workspaces"
      />
      <ProductRow name="Docs" hint="Team wiki" path="/api/docs/spaces" />
      {bonds.isLoading ? (
        <Loading />
      ) : bonds.isError || !bonds.data ? (
        <Failed what="bonds" error={bonds.error} />
      ) : !bonds.data.enabled ? (
        <CapabilityOff
          name="Reputation bonds"
          note="Turned off in this workspace (H5 bonds is disabled)."
        />
      ) : (
        <Row
          label="Reputation bonds"
          hint={`${(bonds.data.data as Bond[]).length} bond${bonds.data.data.length === 1 ? "" : "s"}`}
        >
          <StateMark state="on" />
        </Row>
      )}
    </Card>
  );
}

/* ── 5 · Recent activity (last, small; rides the shared ledger fetch) ───── */

function ActivityRow({ e }: { e: LedgerEntry }) {
  const status = ledgerStatus(e.type);
  return (
    <Row
      label={e.description || humanizeType(e.type)}
      hint={formatWhen(e.created_at)}
    >
      <MuNumeral micros={e.amount_ulens} unit="lens" />
      {status ? (
        <Pill status={status}>{status}</Pill>
      ) : (
        <span className="font-figure text-eyebrow uppercase text-muted">
          {humanizeType(e.type)}
        </span>
      )}
    </Row>
  );
}

function RecentActivity() {
  const q = useHistory();
  const rows = (q.data ?? []).slice(0, 5);
  return (
    <Card>
      <CardHeader>Recent activity</CardHeader>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <Failed what="recent activity" error={q.error} />
      ) : rows.length === 0 ? (
        <div className="px-gutter py-3 text-body text-muted">
          {/* ⚠ Same class as the earnings empty state above. It now names the one action that
              creates the first entry, and points at it. */}
          No activity yet. The first entry appears the moment a request goes through Lens —{' '}
          <Link className="underline" to="/setup">
            point a tool at it
          </Link>{' '}
          and refresh.
        </div>
      ) : (
        rows.map((e) => <ActivityRow key={e.id} e={e} />)
      )}
    </Card>
  );
}

/* ── The screen ─────────────────────────────────────────────────────────── */

export function Overview({ now = new Date() }: { now?: Date } = {}) {
  return (
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-gutter wide:grid-cols-2">
      <LxcCard />
      <LensCard />
      <SpendCard now={now} />
      <CacheCard days={30} />
      <ProductsCard />
      <RecentActivity />
    </div>
  );
}
