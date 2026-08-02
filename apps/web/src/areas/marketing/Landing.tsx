import { useState } from 'react'
import { Button, ThemeToggle } from '@talyvor/ui'
import { useSignupProbe } from '../../lib/signupOpen'
import { HOLDBACK_HOURS, LEDGER_HIT, billAt, micro, savedAt } from './economics'

// The marketing landing (/marketing, OUTSIDE the AuthGate — see App.tsx). It must render with no
// session, no router context, and no providers: Landing.test.tsx renders <Landing /> bare, so
// nothing here may touch react-router or react-query. Every internal destination is a plain anchor
// for that reason, and Journey.test.tsx drives the real router to each published href to prove it
// ARRIVES at a real screen rather than merely existing.
//
// ── DESIGN STANCE ────────────────────────────────────────────────────────────────────────────────
//
// The console's instrument language, given landing-page air: the accent is ARCHITECTURE (ticks,
// rules, the curve) and never coloured text; anything measured is set in mono; hierarchy comes from
// structure and space. What this page takes that the console does not have is DISPLAY TYPE — the
// locked scale stops at 24px because a control panel has no use for more, so the hero sizes are
// local arbitrary values. The tokens are NOT touched; packages/ui stays the authority for the app,
// and this page borrows its voice rather than editing it.
//
// The one thing a visitor should remember is the INVERSION: everything else in AI gets more
// expensive as you use it, and this gets cheaper. So the page is built around a single figure that
// descends, and the reader can move it themselves.
//
// ── COPY STANCE ──────────────────────────────────────────────────────────────────────────────────
//
// Two kinds of number live here and they are never mixed:
//   MEASURED — the settled pooled hit in economics.ts, from one real ledger row, labelled as real.
//   TARGET   — the compounding curve: the product claim drawn as a shape, labelled as the shape it
//              is built to reach. Stated confidently, not hedged into meaninglessness, and never
//              dressed up as data.
// Landing.test.tsx forbids a `%` anywhere on this page. Unmeasured rates are how the first version
// went wrong, and absolute µ-units keep every figure checkable against the ledger.

// ── THE CONTACT ADDRESS ──────────────────────────────────────────────────────────────────────────
//
// This page used to hardcode hello@talyvor.com as its only call to action, under a comment saying
// the alias did not route yet. It shipped anyway: a buyer's first action went nowhere, and no gate
// could catch it because a comment cannot be executed. The address is now CONFIGURATION, and its
// absence is a state the page renders rather than a warning someone has to remember. Unset ⇒ no
// email CTA is drawn at all. Deliberately NOT defaulted: a fallback address is how the dead link
// survived the first time.
//
// ⚠ IT IS A BUILD-TIME VARIABLE. Vite inlines import.meta.env when the bundle is compiled, so
// setting VITE_CONTACT_EMAIL on the running container does nothing at all — the value has to be
// present in the environment of the `pnpm build` that produces the assets. See deploy/README.
export const CONTACT_EMAIL: string = import.meta.env.VITE_CONTACT_EMAIL ?? ''
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`
const HAS_CONTACT = CONTACT_EMAIL !== ''

/** Numbered section label: a 2px accent tick (colour on a tick, never on text), a mono index, and a
 *  muted caption — the page's recurring instrument marking, carried over from the console. */
function SectionLabel({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-3 w-0.5 bg-accent" aria-hidden="true" />
      <span className="text-caption tabular-nums text-faint">{index}</span>
      <span className="text-caption uppercase tracking-wide text-muted">{children}</span>
    </div>
  )
}

/** A measured figure. Mono and tabular, with the unit set quieter than the value. */
function Figure({ value, unit, tone = 'ink' }: { value: string; unit: string; tone?: 'ink' | 'muted' }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className={`text-mono text-figure tabular-nums ${tone === 'ink' ? 'text-ink' : 'text-muted'}`}
      >
        {value}
      </span>
      <span className="text-caption uppercase tracking-wide text-faint">{unit}</span>
    </span>
  )
}

/** The descending curve — the page's one piece of iconography, plotted from the SAME function the
 *  interactive control reads, so the picture and the number cannot disagree. */
function DescentCurve({ members }: { members: number }) {
  const y = (m: number) => 100 - (billAt(m) / LEDGER_HIT.listMicroLXC) * 88 - 6
  const points = Array.from({ length: 61 }, (_, i) => `${(i / 60) * 100},${y(1 + i)}`).join(' ')
  const cursorX = ((members - 1) / 60) * 100
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-40 w-full" aria-hidden="true">
      <defs>
        <linearGradient id="tal-descent" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[25, 50, 75].map((g) => (
        <line
          key={g}
          x1="0"
          y1={g}
          x2="100"
          y2={g}
          stroke="var(--rule)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <polygon points={`0,100 ${points} 100,100`} fill="url(#tal-descent)" />
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={cursorX}
        y1="0"
        x2={cursorX}
        y2="100"
        stroke="var(--rule-strong)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={cursorX} cy={y(members)} r="2.4" fill="var(--accent)" />
    </svg>
  )
}

const PRODUCTS: Array<{ name: string; role: string; body: string; surfaces: string }> = [
  {
    name: 'Lens',
    role: 'Inference gateway',
    body: 'Every model call from every tool goes through one self-hosted gateway: routing across providers, response caching, per-workspace keys and budgets, and a ledger that records what each request cost.',
    surfaces: 'OpenAI/Anthropic-compatible API · web console',
  },
  {
    name: 'Track',
    role: 'Issue tracker',
    body: 'Issues, workflows, dependencies, and comments — with an MCP server, so an agent works the tracker through the same permission checks as a person.',
    surfaces: 'web · MCP',
  },
  {
    name: 'Docs',
    role: 'Team wiki',
    body: 'Spaces and pages with versioned history and tiered sharing — readable and writable by people, and by agents through the same tier checks.',
    surfaces: 'web · MCP',
  },
  {
    name: 'Code',
    role: 'Coding agent',
    body: 'An iterative, tool-using agent with a semantic index of your repository — in the terminal, VS Code, and JetBrains — with every model call routed through Lens.',
    surfaces: 'CLI · VS Code · JetBrains',
  },
]

const POSTURE: Array<{ title: string; body: string }> = [
  {
    title: 'Your keys stay yours.',
    body: 'Provider keys live in your environment and requests leave from your machines. Nobody proxies your traffic but you.',
  },
  {
    title: 'Your data has one home.',
    body: 'Prompts, issues, pages, and spend records sit in your Postgres. Retention is a per-workspace policy you set — including "log nothing" — not a plan tier.',
  },
  {
    title: 'The bill is legible.',
    body: 'Per-workspace keys, budgets that block at the limit, and a ledger of what every request cost. Metering is built into the gateway, not reconstructed from invoices.',
  },
  {
    title: 'Audit is an export, not a request.',
    body: 'The gateway writes an audit log you can stream out as NDJSON into whatever your security team already runs.',
  },
]

/** The worked pooled hit, stepped. The visitor advances it themselves — four beats, each one a real
 *  figure from the settled row, so the mechanism arrives as a sequence rather than a paragraph. */
function WorkedHit() {
  const [step, setStep] = useState(0)
  const beats = [
    {
      label: 'A request arrives',
      figure: <Figure value={micro(LEDGER_HIT.listMicroLXC)} unit="µLXC list" />,
      body: 'Someone at another company has already asked this. Billed straight to the provider, the answer costs list price.',
    },
    {
      label: 'The pool has it',
      figure: <Figure value={micro(LEDGER_HIT.chargedMicroLXC)} unit="µLXC charged" />,
      body: 'It is served from the pool instead of the provider, and charged below list — this workspace did not pay to generate the answer, only to reuse it.',
    },
    {
      label: 'The consumer keeps the difference',
      figure: <Figure value={micro(LEDGER_HIT.savedMicroLXC)} unit="µLXC saved" />,
      body: 'Not a discount anyone funds. The saving is a generation cost nobody had to pay a second time.',
    },
    {
      label: 'The contributor is paid',
      figure: <Figure value={micro(LEDGER_HIT.contributorEarnedMicroLENS)} unit="µLENS earned" />,
      body: `Minted to the workspace whose answer was reused, and spendable once the ${HOLDBACK_HOURS}-hour holdback elapses — long enough that the gaming patterns are detectable before anything settles.`,
    },
  ]
  return (
    <div className="overflow-hidden rounded-lg border border-rule bg-surface">
      <div className="flex flex-wrap gap-px border-b border-rule bg-rule">
        {beats.map((b, i) => (
          <button
            key={b.label}
            type="button"
            onClick={() => setStep(i)}
            aria-current={i === step ? 'step' : undefined}
            className={`flex-1 whitespace-nowrap px-4 py-2.5 text-left text-caption transition-colors ${
              i === step ? 'bg-surface text-ink' : 'bg-canvas text-muted hover:text-ink'
            }`}
          >
            <span className="tabular-nums text-faint">{String(i + 1).padStart(2, '0')}</span>
            <span className="ml-2">{b.label}</span>
          </button>
        ))}
      </div>
      <div className="px-gutter py-6">
        <div key={step} className="tal-rise">
          {beats[step].figure}
          <p className="mt-3 max-w-xl text-body text-muted">{beats[step].body}</p>
        </div>
        <div className="mt-6 flex gap-1" aria-hidden="true">
          {beats.map((b, i) => (
            <span
              key={b.label}
              className={`h-0.5 flex-1 transition-colors ${i <= step ? 'bg-accent' : 'bg-rule'}`}
            />
          ))}
        </div>
      </div>
      <p className="border-t border-rule px-gutter py-3 text-caption text-faint">
        Real figures from one settled transaction — list, charge, saving and mint exactly as the
        ledger recorded them.
      </p>
    </div>
  )
}

/** The compounding, made movable: the visitor sets the pool size and watches the bill fall. */
function Compounding() {
  const [members, setMembers] = useState(1)
  return (
    <div className="overflow-hidden rounded-lg border border-rule bg-surface">
      <div className="flex flex-col gap-8 px-gutter py-6 wide:flex-row wide:items-end wide:justify-between">
        <div>
          <p className="text-caption uppercase tracking-wide text-muted">
            The same answer, at a pool of{' '}
            <span className="text-mono tabular-nums text-ink">{members}</span>
            {members === 1 ? ' contributor' : ' contributors'}
          </p>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-3">
            <Figure value={micro(billAt(members))} unit="µLXC you pay" />
            <Figure value={micro(savedAt(members))} unit="µLXC kept" tone="muted" />
          </div>
        </div>
        <label className="block wide:w-72">
          <span className="text-caption uppercase tracking-wide text-faint">
            Contributors in the pool
          </span>
          <input
            type="range"
            min={1}
            max={61}
            value={members}
            onChange={(e) => setMembers(Number(e.target.value))}
            aria-label="Contributors in the pool"
            className="tal-range mt-2 w-full"
          />
        </label>
      </div>
      <DescentCurve members={members} />
      <p className="border-t border-rule px-gutter py-3 text-caption text-faint">
        The shape this is built to reach, drawn from the claim — not a measurement. The settled
        figures above are the measured part of this page.
      </p>
    </div>
  )
}

export function Landing() {
  // The ONE piece of server state this page reads: whether a stranger may sign up. Deliberately a
  // bare-fetch hook rather than react-query — this page renders with no providers at all, and a
  // probe that failed to answer leaves the page saying nothing about access rather than guessing.
  const { signup } = useSignupProbe()
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      {/* One staggered reveal on load, plus the transition the stepper needs. Deliberately small:
          this page argues with structure, and motion competing with the argument is noise. Honours
          prefers-reduced-motion, because a page about trust should. */}
      <style>{`
        @keyframes tal-rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        .tal-rise { animation: tal-rise .42s cubic-bezier(.2,.7,.3,1) both }
        .tal-stagger > * { animation: tal-rise .5s cubic-bezier(.2,.7,.3,1) both }
        .tal-stagger > *:nth-child(2) { animation-delay: .06s }
        .tal-stagger > *:nth-child(3) { animation-delay: .12s }
        .tal-stagger > *:nth-child(4) { animation-delay: .18s }
        .tal-stagger > *:nth-child(5) { animation-delay: .24s }
        .tal-range { accent-color: var(--accent) }
        @media (prefers-reduced-motion: reduce) {
          .tal-rise, .tal-stagger > * { animation: none }
        }
      `}</style>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-rule bg-canvas">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-gutter py-3">
          <div>
            <div className="text-head text-ink">Talyvor</div>
            <div className="text-caption font-normal text-faint">Suite</div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {/* The one "Open the app" link — Landing.test.tsx pins its name and href. */}
            <Button asChild>
              <a href="/">Open the app</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── 00 · The inversion ───────────────────────────────────────────── */}
        <section aria-labelledby="hero-heading" className="relative overflow-hidden border-b border-rule">
          {/* Atmosphere rather than a flat fill: one accent wash bled off the top-right corner, so
              the display type has something to sit against without any coloured text. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-32 -top-48 h-96 w-96 rounded-pill opacity-15"
            style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 68%)' }}
          />
          <div className="relative mx-auto w-full max-w-5xl px-gutter pb-20 pt-16 wide:pb-28 wide:pt-24">
            <div className="tal-stagger">
              <SectionLabel index="00">Self-hosted · pre-launch</SectionLabel>
              <h1
                id="hero-heading"
                className="mt-7 max-w-3xl text-display-1 text-ink"
              >
                Everything in AI gets more expensive the more you use it.{' '}
                <span className="relative inline-block">
                  This gets cheaper.
                  <span className="absolute -bottom-1 left-0 h-0.5 w-full bg-accent" aria-hidden="true" />
                </span>
              </h1>
              <p className="mt-8 max-w-2xl text-lede text-muted">
                An answer generated by one company can serve another — with consent, attribution and
                payment. Bills fall toward zero as the community grows and usage compounds: the shape
                this is built to reach is near-zero at roughly ninety days of constant use, with a
                pool big enough to cover your work.
              </p>
              <p className="mt-4 max-w-2xl text-body text-muted">
                That is what the community <span className="text-ink">reaches</span>, the way a
                shared resource does — every workspace that contributes makes the next answer cheaper
                for everyone, including the one that arrives after yours. Day one is an ordinary bill
                with a real ledger under it. The curve is the product.
              </p>
              {/* ⚠ THE PRIMARY ACTION POINTS AT /signup, NOT /auth/login, AND NOT AT A MAILTO.
                  Preserved from the previous version because the reasoning is easy to "simplify"
                  away: an earlier draft sent people to sign-in on the theory that a stranger could
                  not complete OAuth anyway, since the Google app is in Testing mode. That premise
                  was inferred from config and was FALSE — Google's Testing state exempts apps
                  requesting only openid, email and profile, which is exactly what apps/bff/auth.go
                  requests. Nobody is stopped at Google; the only wall is ours
                  (OIDC_ALLOWED_EMAILS). /signup tells a stranger what this is and who may enter —
                  derived from the gate, so it is right in both configurations — before handing
                  them to a third party. "Open the app" in the header is the other reader. */}
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button asChild variant="primary">
                  <a href="/signup">Get started</a>
                </Button>
                <Button asChild>
                  <a href="#economics">See the arithmetic</a>
                </Button>
              </div>
            </div>
            <p className="mt-4 text-caption text-faint">
              <a href="/privacy" className="underline">
                Privacy
              </a>
              {' · '}
              <a href="/terms" className="underline">
                Terms
              </a>
            </p>
            {/* THE ACCESS SENTENCE IS THE SERVER'S, not the bundle's. A hardcoded "closed trial"
                line became a lie the moment an operator opened signups, with nothing in the build
                able to notice. This renders what the BFF reports, and renders NOTHING while the
                answer is unknown (first paint, BFF unreachable, older BFF): an unverified promise
                is not printed in either direction. */}
            {signup === 'closed' ? (
              <p className="mt-5 max-w-xl text-body text-muted">
                Talyvor is in a closed trial just now, so access is granted per address — start at
                sign-up and we will come back to you.
              </p>
            ) : null}
            {signup === 'open' ? (
              <p className="mt-5 max-w-xl text-body text-muted">
                No invitation needed — sign in with an account you already have and you’ll have your
                own workspace in a few seconds.
              </p>
            ) : null}
          </div>
        </section>

        {/* ── 01 · Why nobody else can offer it ────────────────────────────── */}
        <section aria-labelledby="moat-heading" className="border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-20">
            <SectionLabel index="01">Why this is not a discount</SectionLabel>
            <h2
              id="moat-heading"
              className="mt-6 max-w-3xl text-display-3 text-ink"
            >
              One company’s answer can serve another. That is the whole product.
            </h2>
            <div className="mt-8 grid gap-x-12 gap-y-6 wide:grid-cols-2">
              <p className="text-body text-muted">
                Anthropic and OpenAI cache too — per account, and only back to you. They cannot serve
                your answer to another customer: their agreements are with each customer separately,
                so one customer’s output is not theirs to hand to the next. That is a legal position
                rather than an engineering gap, and not one they can decide their way out of.
              </p>
              <p className="text-body text-muted">
                Talyvor is built the other way round. Sharing is a choice each workspace makes, and
                once made, an answer becomes an asset: the consumer pays under list, the contributor
                is paid for the reuse, and the pool gets richer with every request that passes
                through it. More people using it is the mechanism that makes it cheaper as more
                people use it — the opposite of how every other bill in this industry behaves.
              </p>
            </div>
          </div>
        </section>

        {/* ── 02/03 · The arithmetic, worked and compounded ────────────────── */}
        <section
          id="economics"
          aria-labelledby="economics-heading"
          className="scroll-mt-16 border-b border-rule bg-canvas"
        >
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-20">
            <SectionLabel index="02">The arithmetic</SectionLabel>
            <h2
              id="economics-heading"
              className="mt-6 max-w-2xl text-display-3 text-ink"
            >
              One pooled answer, as the ledger recorded it.
            </h2>
            <p className="mt-4 max-w-xl text-body text-muted">
              Step through it. These are not illustrative figures — they are the list price, the
              charge, the saving and the mint from a single settled transaction.
            </p>
            <div className="mt-8">
              <WorkedHit />
            </div>

            <div className="mt-16">
              <SectionLabel index="03">The compounding</SectionLabel>
              <h3 className="mt-6 max-w-2xl text-display-4 text-ink">
                Every member who contributes lowers the next bill — including yours.
              </h3>
              <p className="mt-4 max-w-xl text-body text-muted">
                More members means more answers in the pool, which means more requests already
                answered, which means a smaller share of list price paid. Move the pool and watch the
                same answer get cheaper.
              </p>
              <div className="mt-8">
                <Compounding />
              </div>
            </div>
          </div>
        </section>

        {/* ── 04 · Earning ─────────────────────────────────────────────────── */}
        <section aria-labelledby="earning-heading" className="border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-20">
            <SectionLabel index="04">Earning</SectionLabel>
            <h2
              id="earning-heading"
              className="mt-6 max-w-2xl text-display-3 text-ink"
            >
              Contribute answers, earn LENS, spend it on inference.
            </h2>
            <div className="mt-10 grid gap-x-12 gap-y-8 wide:grid-cols-3">
              <div>
                <div className="h-0.5 w-8 bg-accent" aria-hidden="true" />
                <p className="mt-4 text-head text-ink">Reuse mints</p>
                <p className="mt-2 text-body text-muted">
                  When your answer serves another workspace, LENS is minted to you against that
                  reuse. Nothing is minted for producing an answer nobody needed.
                </p>
              </div>
              <div>
                <div className="h-0.5 w-8 bg-accent" aria-hidden="true" />
                <p className="mt-4 text-head text-ink">It settles after {HOLDBACK_HOURS} hours</p>
                <p className="mt-2 text-body text-muted">
                  Earnings are held before they become spendable, sized so the statistical gaming
                  patterns are detectable inside the window. Held earnings are visible while they
                  wait, and the window is exactly when a payout can still be contested — a held
                  amount can be removed before it ever becomes spendable, which is the point of
                  holding it. The Terms say the same thing in full.
                </p>
              </div>
              <div>
                <div className="h-0.5 w-8 bg-accent" aria-hidden="true" />
                <p className="mt-4 text-head text-ink">Convert and spend</p>
                <p className="mt-2 text-body text-muted">
                  Settled LENS converts into the credit that pays for inference. A workspace that
                  contributes steadily is paying for a shrinking share of its own usage.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 05 · Consent ─────────────────────────────────────────────────── */}
        <section aria-labelledby="consent-heading" className="border-b border-rule bg-canvas">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-20">
            <SectionLabel index="05">Consent</SectionLabel>
            <h2
              id="consent-heading"
              className="mt-6 max-w-3xl text-display-3 text-ink"
            >
              Your prompts are never served to another company. Only answers, only with consent.
            </h2>
            <div className="mt-8 grid gap-x-12 gap-y-6 wide:grid-cols-2">
              <p className="text-body text-muted">
                Sharing is a decision, made per workspace, and it is reversible. A workspace that has
                not opted in contributes nothing and is served nothing from the pool — an ordinary
                gateway with an ordinary bill, which is a supported way to run this.
              </p>
              <p className="text-body text-muted">
                What crosses between companies is a generated answer, attributed and paid for. What
                never crosses is the prompt that produced it. If the mechanism only worked by moving
                your questions around, it would not be worth having — and we would not be able to
                describe it this plainly on a public page.
              </p>
            </div>
          </div>
        </section>

        {/* ── 06 · The suite ───────────────────────────────────────────────── */}
        <section id="suite" aria-labelledby="suite-heading" className="scroll-mt-16 border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-20">
            <SectionLabel index="06">The suite</SectionLabel>
            <h2
              id="suite-heading"
              className="mt-6 max-w-2xl text-display-3 text-ink"
            >
              Four tools that know what every piece of AI work cost.
            </h2>
            <p className="mt-4 max-w-xl text-body text-muted">
              The tracker, the wiki and the coding agent route their model calls through the same
              gateway — so the cost of an issue, a document or a change lands in one ledger instead
              of four invoices nobody can reconcile.
            </p>
            <div className="mt-10 grid gap-px border border-rule bg-rule wide:grid-cols-2">
              {PRODUCTS.map((p) => (
                <div key={p.name} className="bg-surface p-6">
                  <div className="flex items-baseline gap-3">
                    <span className="text-head text-ink">{p.name}</span>
                    <span className="text-caption uppercase tracking-wide text-faint">{p.role}</span>
                  </div>
                  <p className="mt-3 text-body text-muted">{p.body}</p>
                  <p className="mt-4 text-caption text-faint">{p.surfaces}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 07 · Where it runs ───────────────────────────────────────────── */}
        <section aria-labelledby="posture-heading" className="border-b border-rule bg-canvas">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-20">
            <SectionLabel index="07">Where it runs</SectionLabel>
            {/* THE ONE HEADING THAT NAMES THE PRODUCT. Landing.test.tsx asserts exactly one heading
                matches /talyvor/i, so nothing else on this page may put the name in a heading. */}
            <h2
              id="posture-heading"
              className="mt-6 max-w-3xl text-display-3 text-ink"
            >
              Talyvor runs on your infrastructure, with your provider keys.
            </h2>
            <p className="mt-4 max-w-xl text-body text-muted">
              Self-hosting is the moat, said plainly: none of the economics above require you to hand
              anyone your traffic. You run the gateway, your data stays in your Postgres, and the
              pool is something you opt into rather than something you are inside by default.
            </p>
            <div className="mt-10 grid gap-x-12 gap-y-8 wide:grid-cols-2">
              {POSTURE.map((p) => (
                <div key={p.title}>
                  <div className="h-0.5 w-8 bg-accent" aria-hidden="true" />
                  <p className="mt-4 text-head text-ink">{p.title}</p>
                  <p className="mt-2 text-body text-muted">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Close ────────────────────────────────────────────────────────── */}
        <section aria-labelledby="close-heading">
          <div className="mx-auto w-full max-w-5xl px-gutter py-20 wide:py-28">
            <h2
              id="close-heading"
              className="max-w-3xl text-display-2 text-ink"
            >
              Start on an ordinary bill. Stay for the one that keeps falling.
            </h2>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild variant="primary">
                <a href="/signup">Create your workspace</a>
              </Button>
              {HAS_CONTACT ? (
                <Button asChild>
                  <a href={CONTACT_MAILTO} className="text-mono">
                    {CONTACT_EMAIL}
                  </a>
                </Button>
              ) : null}
            </div>
            {HAS_CONTACT ? null : (
              <p className="mt-5 max-w-xl text-caption text-faint">
                Introductions are happening directly for now, so there is no inbox to write to yet —
                rather than print an address that drops your first message, this page shows none
                until the alias is wired into the build.
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-gutter py-6">
          <div className="text-caption uppercase tracking-wide text-faint">
            Talyvor Ltd · self-hosted AI development
          </div>
          <div className="text-caption text-faint">
            <a href="/privacy" className="underline">
              Privacy
            </a>
            {' · '}
            <a href="/terms" className="underline">
              Terms
            </a>
            {' · '}
            <a href="#suite" className="underline">
              See the suite
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
