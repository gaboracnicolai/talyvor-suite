import { Button, Card, ThemeToggle } from '@talyvor/ui'
import { useSignupProbe } from '../../lib/signupOpen'

// The marketing landing (/marketing, OUTSIDE the AuthGate — see App.tsx). It must
// render with no session, no router context, and no providers: Landing.test.tsx
// renders <Landing /> bare, so nothing here may touch react-router or react-query.
//
// Design stance: this page is set from the SAME instrument the console uses — the
// locked tokens, the accent teal as architecture (ticks and rules, never text), the
// five named type sizes — but with landing-page air instead of control-panel
// density. Hierarchy comes from structure (numbered caption labels, hairline rules,
// mono for anything measured), not from display type the scale doesn't have.
//
// Copy stance: the buyer is a VP of Engineering, pre-launch. Every claim on this
// page is mechanically true of the shipped code; there are no customer logos, no
// testimonials, and deliberately NO cache-hit percentage — we haven't measured one,
// and Landing.test.tsx fails if anyone adds a % later.

// ── THE CONTACT ADDRESS ──────────────────────────────────────────────────────
//
// This page used to hardcode hello@talyvor.com as its only call to action, in two places,
// under a comment reading "hello@ is NOT ROUTING YET — the alias must be created before this
// page ships anywhere public". It shipped anyway. A buyer's first action on the one page they
// read went nowhere, and no gate could catch it because a comment cannot be executed.
//
// So the address is now CONFIGURATION, and its absence is a state the page renders rather than
// a warning someone has to remember. Unset ⇒ no email CTA is drawn at all: an absent contact
// route is better than a dead one, and the page keeps its other action ("See the suite"). Set
// VITE_CONTACT_EMAIL at build time once the alias actually delivers, and both CTAs appear with
// no code change.
//
// Deliberately NOT a default: a fallback address is how the dead link survived in the first
// place. Empty is the honest default, and it is visible.
export const CONTACT_EMAIL: string = import.meta.env.VITE_CONTACT_EMAIL ?? ''
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`
const HAS_CONTACT = CONTACT_EMAIL !== ''

/** Numbered section label: the 2px accent tick (colour on a tick, never on text),
 *  a mono index, and a muted caption — the page's recurring instrument marking. */
function SectionLabel({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-3 w-0.5 bg-accent" aria-hidden="true" />
      <span className="text-caption tabular-nums text-faint">{index}</span>
      <span className="text-caption uppercase tracking-wide text-muted">{children}</span>
    </div>
  )
}

/** Decorative measurement ruler — uniform neutral ticks on a hairline. Pure
 *  texture: every tick identical, so it cannot be misread as a reading. */
function Ruler() {
  return (
    <div className="border-t border-rule" aria-hidden="true">
      <div className="mx-auto flex w-full max-w-5xl justify-between px-gutter">
        {Array.from({ length: 41 }, (_, i) => (
          <span key={i} className="h-1.5 w-px bg-rule-strong" />
        ))}
      </div>
    </div>
  )
}

const PRODUCTS: Array<{ name: string; role: string; body: string; surfaces: string }> = [
  {
    name: 'Lens',
    role: 'Inference gateway',
    body:
      'Every model call from every tool goes through one self-hosted gateway: routing across providers, response caching, per-workspace keys and budgets, and a ledger that records what each request cost.',
    surfaces: 'OpenAI/Anthropic-compatible API · web console',
  },
  {
    name: 'Track',
    role: 'Issue tracker',
    body:
      'Issues, workflows, dependencies, and comments — with an MCP server, so an agent works the tracker through the same permission checks as a person.',
    surfaces: 'web · MCP',
  },
  {
    name: 'Docs',
    role: 'Team wiki',
    body:
      'Spaces and pages with versioned history and tiered sharing — readable and writable by people, and by agents through the same tier checks.',
    surfaces: 'web · MCP',
  },
  {
    name: 'Code',
    role: 'Coding agent',
    body:
      'An iterative, tool-using agent with a semantic index of your repository — in the terminal, VS Code, and JetBrains — with every model call routed through Lens.',
    surfaces: 'CLI · VS Code · JetBrains',
  },
]

const POSTURE: Array<{ title: string; body: string }> = [
  {
    title: 'Your keys stay yours.',
    body:
      'Provider keys live in your environment and requests leave from your machines. Nobody proxies your traffic but you.',
  },
  {
    title: 'Your data has one home.',
    body:
      'Prompts, issues, pages, and spend records sit in your Postgres. Retention is a per-workspace policy you set — including "log nothing" — not a plan tier.',
  },
  {
    title: 'The bill is legible.',
    body:
      'Per-workspace keys, budgets that block at the limit, and a ledger of what every request cost. Metering is built into the gateway, not reconstructed from invoices.',
  },
  {
    title: 'Audit is an export, not a request.',
    body:
      'The gateway writes an audit log you can stream out as NDJSON into whatever your security team already runs.',
  },
]

export function Landing() {
  // The ONE piece of server state this page reads: whether a stranger may sign up. Deliberately
  // a bare-fetch hook rather than react-query — this page renders with no providers at all (see
  // the header comment), and a probe that failed to answer leaves the page saying nothing about
  // access rather than guessing.
  const { signup } = useSignupProbe()
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
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
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section aria-labelledby="hero-heading">
          <div className="mx-auto w-full max-w-5xl px-gutter pb-16 pt-16 wide:pb-24 wide:pt-24">
            <SectionLabel index="00">Self-hosted · pre-launch</SectionLabel>
            <h1 id="hero-heading" className="mt-6 max-w-2xl text-title text-ink">
              Talyvor is the AI development suite you run yourself.
            </h1>
            <p className="mt-5 max-w-xl text-body text-muted">
              An inference gateway with a real ledger, an issue tracker, a team wiki, and a coding
              agent — four tools that behave as one system, on your infrastructure, with your
              provider keys.
            </p>
            {/* ── THE PRIMARY ACTION ───────────────────────────────────────────────────
                First a mailto:, then "Sign in" — the weakest and the second-weakest link a
                page for a product with working checkout can carry. It is now "Get started",
                pointing at /signup.

                THE ARGUMENT THAT PUT "SIGN IN" HERE HAS BEEN REFUTED, not merely revisited.
                It read: "Get started free" promises a stranger can complete the flow, and they
                cannot, because the Google OAuth app is in Testing mode and anyone not on the
                test-user list is stopped AT GOOGLE. That premise was inferred from config and
                never checked. Google's own current documentation (OAuth app state overview)
                says of the Testing state: "Only users explicitly added to the test user
                allowlist can access the app (limited to a hard cap of 100 test users).
                Exception: If the app only requests basic identity scopes (openid, email,
                profile), any user can access without being on the allowlist." We request
                exactly openid, email and profile (apps/bff/auth.go) and nothing else. Nobody is
                stopped at Google. The wall was ours, and it is OIDC_ALLOWED_EMAILS.

                So the destination is the SIGNUP PAGE rather than /auth/login directly: a
                stranger gets told what this is and what happens next before being redirected to
                a third party, and the signup page carries the one sentence about who may enter
                — DERIVED from the gate, so it is right in both configurations. Two links for
                two readers: "Get started" here, "Open the app" in the header for people who
                already have a workspace. */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild variant="primary">
                <a href="/signup">Get started</a>
              </Button>
              <Button asChild>
                <a href="#suite">See the suite</a>
              </Button>
            </div>
            {/* THE ACCESS SENTENCE IS THE SERVER'S, not the bundle's. It used to read "Talyvor
                is in a closed trial, so accounts are set up by hand" — true when written, and a
                lie from the moment an operator sets OIDC_ALLOWED_EMAILS=*, with nothing in the
                build able to notice. It now renders what the BFF reports, and renders NOTHING
                while the answer is unknown (first paint, BFF unreachable, older BFF): an
                unverified promise is not printed in either direction. */}
            {signup === 'closed' ? (
              <p className="mt-4 text-body text-muted">
                Talyvor is in a closed trial just now, so access is granted per address
                {HAS_CONTACT ? (
                  <>
                    {' — '}
                    <a href={CONTACT_MAILTO} className="underline">
                      get in touch
                    </a>
                    .
                  </>
                ) : (
                  '.'
                )}
              </p>
            ) : null}
            {signup === 'open' ? (
              <p className="mt-4 text-body text-muted">
                No invitation needed — sign in with an account you already have and you’ll have
                your own workspace in a few seconds.
              </p>
            ) : null}
            <p className="mt-4 text-micro text-faint">
              Pre-launch — onboarding a small number of engineering teams.
            </p>
          </div>
        </section>

        <Ruler />

        {/* ── 01 · What it is ──────────────────────────────────────────────── */}
        <section aria-labelledby="overview-heading" id="overview" className="scroll-mt-16">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:grid wide:grid-cols-12 wide:gap-gutter wide:py-24">
            <div className="wide:col-span-4">
              <SectionLabel index="01">What it is</SectionLabel>
            </div>
            <div className="mt-6 max-w-xl wide:col-span-8 wide:mt-0">
              <h2 id="overview-heading" className="text-title text-ink">
                One stack for AI-assisted engineering.
              </h2>
              <p className="mt-5 text-body text-muted">
                Four developer tools designed and operated as one system: Lens, an inference
                gateway; Track, an issue tracker; Docs, a team wiki; Code, a coding agent. The
                tracker and the wiki expose the same tools to agents as to people, and model calls
                run through the gateway — keyed, budgeted, and recorded per workspace.
              </p>
              <p className="mt-4 text-body text-muted">
                It covers the ground you would otherwise assemble from a project-management vendor,
                a wiki vendor, and a raft of per-seat AI subscriptions — except you run it, so the
                usage data and the spend data land in your database, not theirs.
              </p>
            </div>
          </div>
        </section>

        {/* ── 02 · The suite ───────────────────────────────────────────────── */}
        <section aria-labelledby="suite-heading" id="suite" className="scroll-mt-16 border-t border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-24">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <SectionLabel index="02">The suite</SectionLabel>
                <h2 id="suite-heading" className="mt-6 text-title text-ink">
                  Four products, one posture.
                </h2>
              </div>
            </div>
            <div className="mt-8 grid gap-gutter wide:grid-cols-2">
              {PRODUCTS.map((p) => (
                <Card key={p.name} className="transition-colors hover:border-rule-strong">
                  <div className="flex flex-col gap-3 p-gutter">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-head text-ink">{p.name}</div>
                      <div className="text-caption uppercase tracking-wide text-faint">{p.role}</div>
                    </div>
                    <p className="text-body text-muted">{p.body}</p>
                    <div className="border-t border-rule pt-3 font-mono text-micro text-faint">
                      {p.surfaces}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ── 03 · The economics ───────────────────────────────────────────── */}
        <section aria-labelledby="economics-heading" id="economics" className="scroll-mt-16 border-t border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:grid wide:grid-cols-12 wide:gap-gutter wide:py-24">
            <div className="wide:col-span-4">
              <SectionLabel index="03">The economics</SectionLabel>
            </div>
            <div className="mt-6 wide:col-span-8 wide:mt-0">
              <h2 id="economics-heading" className="text-title text-ink">
                The cache is the product.
              </h2>
              <p className="mt-5 max-w-xl text-body text-muted">
                Lens caches the responses it serves. When the same request comes back — same
                prompt, same model — it is served from cache and no provider is called. A cache
                hit costs nothing.
              </p>
              {/* proof-rule Card: the 2px accent rule marks contents backed by
                  measurement — which is exactly the claim this block makes. */}
              <Card proof className="mt-6 max-w-xl">
                <div className="flex flex-col gap-3 p-gutter">
                  <div className="rounded-control border border-rule bg-canvas p-3 font-mono text-micro text-muted">
                    <div className="flex items-center justify-between gap-3 py-1">
                      <span>first request</span>
                      <span className="text-faint">miss</span>
                      <span>provider billed</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-rule py-1">
                      <span>repeat request</span>
                      <span className="text-faint">hit</span>
                      <span>provider not called</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-rule py-1">
                      <span>the difference</span>
                      <span className="text-faint">&rarr;</span>
                      <span>recorded in your ledger</span>
                    </div>
                  </div>
                  <p className="text-body text-muted">
                    The saving is measured, not projected: Lens records what each cached response
                    would have cost, per workspace, in a ledger you can read. We don&rsquo;t quote
                    a cache-hit rate — we haven&rsquo;t finished measuring one, and a made-up
                    percentage is not a number to build a budget on. Run it against your workload
                    and read yours off the ledger.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* ── 04 · Self-hosting ────────────────────────────────────────────── */}
        <section aria-labelledby="posture-heading" id="self-hosting" className="scroll-mt-16 border-t border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-24">
            <SectionLabel index="04">Self-hosting</SectionLabel>
            <h2 id="posture-heading" className="mt-6 text-title text-ink">
              Why running it yourself is the point.
            </h2>
            <div className="mt-8 border-b border-rule">
              {POSTURE.map((row) => (
                <div
                  key={row.title}
                  className="border-t border-rule py-5 wide:grid wide:grid-cols-12 wide:gap-gutter"
                >
                  <div className="text-head text-ink wide:col-span-4">{row.title}</div>
                  <p className="mt-2 max-w-xl text-body text-muted wide:col-span-8 wide:mt-0">
                    {row.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 05 · Contact ─────────────────────────────────────────────────── */}
        <section aria-labelledby="contact-heading" id="contact" className="scroll-mt-16 border-t border-rule bg-sidebar">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-24">
            <SectionLabel index="05">Get in touch</SectionLabel>
            <h2 id="contact-heading" className="mt-6 max-w-2xl text-title text-ink">
              Pre-launch, deliberately.
            </h2>
            <p className="mt-5 max-w-xl text-body text-muted">
              The suite runs today, and we are onboarding a small number of engineering teams to
              trial it on real workloads.
              {HAS_CONTACT
                ? ' If you want to be one of them — or you just want the honest state of things — write to us.'
                : ' Introductions are happening directly for now, so there is no inbox to write to yet — this page will carry one the moment there is.'}
            </p>
            {HAS_CONTACT ? (
              <div className="mt-8">
                <Button asChild variant="primary">
                  <a href={CONTACT_MAILTO} className="font-mono">
                    {CONTACT_EMAIL}
                  </a>
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      </main>

      <Ruler />

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-gutter py-6">
          <div className="text-caption uppercase tracking-wide text-faint">
            Talyvor · self-hosted AI development
          </div>
          <div className="text-micro tabular-nums text-faint">pre-launch · 2026</div>
        </div>
      </footer>
    </div>
  )
}
