import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button, Card, CardHeader, MuNumeral, Pill, Row } from "@talyvor/ui";
import { api, ApiError, type Bond, type LedgerEntry } from "../../lib/api";
import { CacheCard } from "./CacheCard";
import { ConvertLens } from "./ConvertLens";
import {
  InlineFailure,
  PanelFailure,
} from "../../components/SessionExpiredBar";
import { Region, RegionScreen } from "../../components/Region";
import { isUnconfigured } from "../../lib/productState";
import { CapabilityOff } from "./Capability";
import { ModelTier } from "./ModelTier";
import { formatUSD, formatWhen, humanizeType, ledgerStatus } from "./format";
import {
  LEDGER_PAGE,
  byModel,
  debitTotal,
  inWindow,
  lxcDebitsByModel,
  splitShortfall,
  windowExceedsPage,
} from "./spendMath";
import { SplitShortfall } from "./SplitShortfall";
import { WindowFigure, WindowIncomplete } from "./WindowFloor";

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

// LEDGER_PAGE, not a literal: the fetch and the truncation predicate must be talking about
// the same page, or the "at least" mark describes a number it is not attached to.
const HISTORY_KEY = ["tokens-history", LEDGER_PAGE, 0] as const;
function useHistory() {
  return useQuery({
    queryKey: HISTORY_KEY,
    queryFn: () => api.tokensHistory(LEDGER_PAGE, 0),
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
            {/* The same money as the MuNumeral beside it. It was set in the body sans, at the
                same baseline as a figure-faced number — one of the pair looked measured and the
                other looked typed. figureFace.test.ts now refuses that. */}
            <span className="font-figure text-body text-muted">
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
        </>
      )}
    </Card>
  );
}

/**
 * ⚠ THE CONVERSION MOVED OUT OF THE CARD ABOVE AND INTO ITS OWN REGION (W1.1.3). It was a
 * collapsed strip under three lifetime rows — an irreversible money action with no name of its
 * own, inside a card about something else. It is a region now, one idea, directly beneath the
 * balances so the number it is about is still on screen.
 *
 * ⚠ IT READS THE SAME QUERY THE LENS CARD DOES, so this costs no request: react-query dedupes on
 * `["lens-balance"]`, which is also how `useFirstRun` reads both balances for free.
 *
 * ⚠ AND IT RENDERS NOTHING UNTIL THE READ LANDS. `ConvertLens` takes a NUMBER, so it cannot tell
 * a balance of zero from a balance nobody could read — and the difference decides which of two
 * opposite things this region says. A failed read must not be drawn as "you have not earned any
 * LENS", so the branch is made here, where the query object still exists. The LENS card above is
 * already reporting the failure; a second panel repeating it is the voice SessionExpiredBar exists
 * to remove.
 */
function ConvertRegionBody() {
  const q = useQuery({ queryKey: ["lens-balance"], queryFn: api.lensBalance });
  if (q.isLoading)
    return <p className="text-body text-muted">Loading…</p>;
  if (q.isError || !q.data) return null;
  return (
    <ConvertLens
      lensBalanceMicros={q.data.balance_ulens}
      heldMicros={q.data.held_balance_ulens ?? 0}
    />
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
// THE LXC LEDGER SPLITS PER MODEL AND THE MINT LEDGER DOES NOT. LXC rows carry
// requested_model on every agent-lane writer (#343) plus served_model on the
// delivered-charge row (#355). This card used to say per-model LXC spend was "not
// derivable" — true at lens 8c70d9e, false from #343, and it survived because
// api.lxcLedger discarded the field so nothing could contradict it.
//
// ⚠ THE SENTENCE HERE USED TO CLAIM THE SAME OF THE MINT LEDGER — "LENS mint rows carry
// metadata.model_used" — AND THAT WAS NEVER MEASURED. Every settled mint row is written by
// one of two sweepers, whose metadata maps are literals: traffic_holds.go:181
// {"request_id", "traffic_hold"} and poolroyalty/sweeper.go:257 {"request_id"}. Neither
// names a model. The one lens_token_ledger writer that does (pattern_mining.go:486) stamps
// it on the HELD row of an earning stage COORDINATION.md records as not switched on. So
// `byModel` is empty over every window this product can produce, and the empty state below
// says so instead of reporting it as an empty ledger. See mintAttribution.test.tsx.
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
    queryKey: ["lxc-history", LEDGER_PAGE, 0],
    queryFn: () => api.lxcLedger(LEDGER_PAGE, 0),
  });
  const month = useQuery({
    queryKey: ["spend-month"],
    queryFn: api.spendMonth,
  });
  // ⚠ "WHAT IS IN THE WINDOW" AND "WHAT IN THE WINDOW NAMES A MODEL" ARE NOT THE SAME SET,
  // and the empty state below used to report the second as the first. See Spend.tsx and
  // mintAttribution.test.tsx: on the settled mint rows talyvor-lens writes, the second set
  // is empty over every window.
  const windowRows = ledger.data ? inWindow(ledger.data, 30, now) : [];
  const agg = byModel(windowRows).slice(0, 5);
  const lxcSplit = lxc.data
    ? lxcDebitsByModel(lxc.data, 30, now).slice(0, 5)
    : [];
  // ⚠ THE SLICE IS A SECOND WAY THIS SPLIT UNDER-SUMS THE TOTAL ABOVE IT, and unlike the
  // unattributed rows it is this screen's own doing. `lxcSplit` is what is RENDERED, so the
  // shortfall is measured against the five rows a reader can actually add up — not against the
  // full split, which would report a number the screen does not show.
  const lxcUnsplit = lxc.data
    ? splitShortfall(lxc.data, lxcSplit, 30, now)
    : { unattributed: 0, notShown: 0 };
  // THIRTY days summed from ONE 200-row page. A reserved request writes three lxc_ledger
  // rows, so this card's window overflows its page at about 67 requests a MONTH — see
  // spendMath.ts §LEDGER_PAGE for the measurement.
  const mintTruncated = ledger.data
    ? windowExceedsPage(ledger.data, LEDGER_PAGE, 30, now)
    : false;
  const lxcTruncated = lxc.data
    ? windowExceedsPage(lxc.data, LEDGER_PAGE, 30, now)
    : false;
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
          <span className="font-figure text-body text-muted">
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
          <WindowFigure
            micros={debitTotal(lxc.data, 30, now)}
            unit="lxc"
            floor={lxcTruncated}
            testId="lxc-debit-total"
          />
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
                hint={`${lxcTruncated ? "at least " : ""}${a.requests} charge${a.requests === 1 ? "" : "s"}`}
              >
                <WindowFigure micros={a.ulxc} unit="lxc" floor={lxcTruncated} />
              </Row>
            ))}
          </div>
        </>
      ) : null}
      <SplitShortfall
        {...lxcUnsplit}
        shownCount={lxcSplit.length}
        floor={lxcTruncated}
        testId="lxc-unsplit"
      />
      {lxcTruncated ? (
        <WindowIncomplete days={30} pageSize={LEDGER_PAGE} testId="lxc-window-incomplete" />
      ) : null}
      <TokenSection token="lens">Earned — LENS · mint attribution</TokenSection>
      {ledger.isLoading ? (
        <Loading />
      ) : ledger.isError ? (
        <Failed what="the mint ledger" error={ledger.error} />
      ) : agg.length === 0 && windowRows.length > 0 ? (
        <div
          data-testid="lens-unattributed"
          className="px-gutter py-3 text-body text-muted"
        >
          {/* ⚠ THIS BRANCH EXISTS BECAUSE THE ONE BELOW WAS PRINTED HERE. "No earnings yet"
              sat directly under the LENS balance card's non-zero "Lifetime earned" — one
              card saying the workspace earned LENS and the next saying it had not. The
              ledger is not empty; the model attribution is. */}
          {mintTruncated ? "At least " : ""}
          {windowRows.length} ledger row{windowRows.length === 1 ? "" : "s"} landed in the
          last 30 days, and none of them records which model it came from — so there is
          nothing to split by model. The rows themselves are on the{" "}
          <Link className="underline" to="/ledger">
            ledger
          </Link>
          .
        </div>
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
              hint={`${mintTruncated ? "at least " : ""}${a.requests} request${a.requests === 1 ? "" : "s"}`}
            >
              <WindowFigure micros={a.ulens} unit="lens" floor={mintTruncated} />
            </Row>
          ))}
        </div>
      )}
      {mintTruncated ? (
        <WindowIncomplete days={30} pageSize={LEDGER_PAGE} testId="lens-window-incomplete" />
      ) : null}
    </Card>
  );
}

/* ── 4 · Products (configured / not configured — state, never a fault) ──── */

type ProbeState = "on" | "off";

// ⚠ ONE SPELLING OF "NOT WIRED", AND IT IS lib/productState.ts's.
//
// This classified here, and it was a SECOND, HAND-ROLLED COPY of a predicate the shared one
// had already had 404 removed from: `if (res.status === 503 || res.status === 404) return
// "off"`, under a comment calling a 404 "INFORMATION". productState.ts records what that cost
// — the BFF asked Docs for a path Docs does not register, and the screen reported "Docs is not
// configured on this deployment" while Docs was RUNNING and had just served the space list.
// A 404 is a statement about an ADDRESS; it is never evidence about whether a product is
// deployed. Every OTHER read in the app already went through the shared classifier and took the
// repair with it; this strip was the site it never reached. (The count that stood here — "the
// shared classifier's two other call sites" — named `useTrackProbe`, which is deleted, and was
// already wrong: measured at `7474125`, `isUnconfigured` has seven production call sites in six
// files. A census written into prose decays with the thing it counts, so this one states the
// property instead.)
//
// So the probe now reports only what it saw and the CLASSIFICATION happens once, in the
// shared predicate, at the call site below.
async function probeProduct(path: string): Promise<ProbeState> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status, path);
  return "on";
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
  // The one predicate, shared with every other screen that draws this state.
  const off = isUnconfigured(q.error);
  return (
    <Row label={name} hint={off ? "Not configured on this BFF deployment." : hint}>
      {q.isLoading ? (
        <span className="text-caption text-muted">Checking…</span>
      ) : off ? (
        <StateMark state="off" />
      ) : q.isError ? (
        <InlineFailure
          error={q.error}
          className="text-caption text-muted"
          failed="Couldn’t check"
        />
      ) : (
        <StateMark state="on" />
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
  // Recent activity rides `useHistory()` — the MINT ledger, and its numeral says so
  // (`unit="lens"` below). The token is stated rather than defaulted so this row cannot
  // quietly start describing LXC if the query it rides ever changes.
  const status = ledgerStatus(e.type, "lens");
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
//
// W1.1.1 — WHAT THIS REPLACED. Six cards in a two-column grid, `max-w-3xl`, no heading of the
// screen's own and no label above any group of them. The sticky banner wrote "Overview" and
// everything below it was one undifferentiated run of panels — so the five questions this file's
// header says the screen answers "in order" were answered in an order nothing on the page stated.
// The empty state was six zeros with no next action above the fold.
//
// The language is the PUBLIC SITE's, in the console's type scale — the same port `6aecb0d` made
// of the palette and the faces, applied to a layout for the first time:
//
//   · the section marking from areas/marketing/Landing.tsx §SectionLabel — a 2px accent tick
//     (colour on a tick, never on text), a mono index, one uppercase eyebrow;
//   · ONE page-scale heading. `text-title` is the top of the console ramp (24px) and the
//     marketing display steps stop at the gate (displayScale.test.ts), so it is the largest type
//     a console screen may write — and it had never been written on this one;
//   · air between regions rather than a gutter between cards: a section is one idea, and the
//     rule under it is where that idea ends.
//
// ⚠ EVERY REGION IS A NAMED LANDMARK, which is the half of the marking that is not decoration.
// The screen used to be one `main` containing six anonymous panels; a reader moving by region got
// one stop. Six now, each named by the question it answers.

// The region marking and the screen wrapper now live in components/Region.tsx — they landed here
// with this screen and moved out the moment W1.1.2 wanted the same shape. Two copies of a marking
// are how a language stops being one.

// The two headlines. Written out here rather than inline so the screen's one page-scale claim is
// readable in one place, and so the first-run wording cannot drift from the predicate below it.
const HEADLINE = "Everything this workspace has, spends and earns.";
const HEADLINE_FIRST_RUN = "Nothing has arrived in this workspace yet.";

/**
 * ⚠ FIRST RUN IS A MEASUREMENT, NOT A DEFAULT — and the direction that matters is the one this
 * returns FALSE for. It is claimed only when BOTH balance reads ANSWERED and all four totals are
 * zero: nothing minted, nothing spendable, nothing earned, nothing held in LENS. A read that
 * FAILED is not a workspace with nothing in it, and this project has already paid twice for that
 * conflation (a Track fault drawn identically to an empty tracker; a held balance of 0 rendered
 * beside a ledger of 822). Told wrongly, it says to a paying customer, on the first screen after
 * sign-in, that nothing has ever arrived.
 *
 * Both queries share their keys with the two balance cards below, so this costs no request.
 */
function useFirstRun(): boolean {
  const lxc = useQuery({ queryKey: ["lxc-balance"], queryFn: api.lxcBalance });
  const lens = useQuery({ queryKey: ["lens-balance"], queryFn: api.lensBalance });
  if (!lxc.data || !lens.data) return false;
  return (
    lxc.data.balance_ulxc === 0 &&
    lxc.data.lifetime_minted_ulxc === 0 &&
    lens.data.balance_ulens === 0 &&
    lens.data.lifetime_earned_ulens === 0
  );
}

/**
 * The two steps that put the first number on this screen.
 *
 * ⚠ NEITHER STEP PROMISES ANYTHING THIS DEPLOYMENT MIGHT NOT HAVE. Billing is OFF by default
 * (`LENS_BILLING_ENABLED`, plus its Stripe keys — see TopUp.tsx, which draws a capability-off
 * panel instead of buy buttons), so "buy credit" is a claim this screen cannot check. The step
 * names the DESTINATION and lets that page state its own capability, which is the same rule the
 * held-LENS hint took when it stopped printing an operator's holdback window it could not read.
 */
function FirstSteps() {
  const steps = [
    {
      index: "01",
      title: "Point a tool at Lens.",
      body:
        "Mint a key and copy the base URL. The first request through it writes the first row on " +
        "this screen.",
      to: "/setup",
      cta: "Open Setup",
    },
    {
      index: "02",
      title: "Check what this workspace can spend.",
      body:
        "Inference is charged in LXC. Billing carries the balance, and says whether this " +
        "deployment can sell more of it.",
      to: "/billing",
      cta: "Open Billing",
    },
  ];
  return (
    <ol className="mt-8 grid gap-px border border-rule bg-rule wide:grid-cols-2">
      {steps.map((s) => (
        <li key={s.index} className="flex flex-col items-start bg-surface px-gutter py-5">
          <span className="font-figure text-eyebrow uppercase text-faint">
            Step {s.index}
          </span>
          <p className="mt-3 text-body text-ink">{s.title}</p>
          <p className="mt-1 text-caption font-normal text-muted">{s.body}</p>
          <Button asChild variant="primary" className="mt-5">
            <Link to={s.to}>{s.cta}</Link>
          </Button>
        </li>
      ))}
    </ol>
  );
}

export function Overview({ now = new Date() }: { now?: Date } = {}) {
  const firstRun = useFirstRun();
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Workspace"
        heading={firstRun ? HEADLINE_FIRST_RUN : HEADLINE}
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-none"
      >
        {/* ⚠ THE OPENING REGION HAS NO BODY WHEN THERE IS NOTHING TO SAY, and the branch is a
            RENDER rather than a `hidden` class: copy about a workspace that has nothing in it must
            not sit in the DOM of a workspace that does. */}
        {firstRun ? (
          <>
            <p className="max-w-2xl text-body text-muted">
              Both balances are zero: no LXC has been granted, bought or converted, and no LENS has
              been earned. Two things put the first number here.
            </p>
            <FirstSteps />
          </>
        ) : null}
      </Region>
      {/* `items-start`: a two-column grid stretches its children to the tallest, and the LENS card
          carries three more rows plus the conversion panel — so the LXC card was drawing 150px of
          empty surface under its last row. Measured in Chrome at 1280. */}
      <Region
        index="01"
        label="What you have"
        className="grid items-start gap-gutter wide:max-w-none wide:grid-cols-2"
      >
        <LxcCard />
        <LensCard />
      </Region>
      <Region index="02" label="What you can do with it">
        <ConvertRegionBody />
      </Region>
      <Region index="03" label="What it costs, and what it earns">
        <SpendCard now={now} />
      </Region>
      <Region index="04" label="What the cache answered">
        <CacheCard days={30} />
      </Region>
      <Region index="05" label="What is switched on">
        <ProductsCard />
      </Region>
      <Region index="06" label="What just happened">
        <RecentActivity />
      </Region>
    </RegionScreen>
  );
}
