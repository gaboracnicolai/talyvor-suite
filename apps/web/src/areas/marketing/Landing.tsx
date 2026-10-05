import { useState } from 'react'
import { Button, CaseSafe, Mark, ThemeToggle, Wordmark, focusRing, inlineLink } from '@talyvor/ui'
import { useSignupProbe } from '../../lib/signupOpen'
import { useDocumentTitle } from '../../documentTitle'
import { HOLDBACK_HOURS, LEDGER_HIT, SAVED_MICRO_LXC, micro } from './economics'

// The marketing landing (/marketing, OUTSIDE the AuthGate — see App.tsx). It must render with no
// session, no router context, and no providers: Landing.test.tsx renders <Landing /> bare, so
// nothing here may touch react-router or react-query. Every internal destination is a plain anchor
// for that reason, and Journey.test.tsx drives the real router to each published href to prove it
// ARRIVES at a real screen rather than merely existing.
//
// ── DESIGN STANCE ────────────────────────────────────────────────────────────────────────────────
//
// The console's instrument language, given landing-page air: the accent is ARCHITECTURE (ticks,
// rules) and never coloured text; anything measured is set in mono; hierarchy comes from structure
// and space. What this page takes that the console does not have is DISPLAY TYPE — the locked
// scale stops at 24px because a control panel has no use for more, so the hero sizes are local
// arbitrary values. The tokens are NOT touched; packages/ui stays the authority for the app, and
// this page borrows its voice rather than editing it.
//
// The one thing a visitor should remember is the PRODUCT: every AI agent gets a wallet, and the
// rules on it are enforced before the model call or the payment, not reconciled afterwards.
// Pooling is one cost-saving feature with one section, never the pitch (B28.2).
//
// ── COPY STANCE ──────────────────────────────────────────────────────────────────────────────────
//
// Every figure on this page is MEASURED — the settled pooled hit in economics.ts, from one real
// ledger row, labelled as real. The one percentage (the pooled discount) is DERIVED from that row
// below rather than typed, so it cannot disagree with the figures printed beside it. There is no
// projected curve and no "toward zero": a shape drawn from a claim is not a measurement.

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
export function SectionLabel({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-3 w-0.5 bg-accent" aria-hidden="true" />
      <span className="font-figure text-caption text-faint">{index}</span>
      <span className="font-figure text-eyebrow uppercase text-muted">{children}</span>
    </div>
  )
}

/** A measured figure. Mono and tabular, with the unit set quieter than the value.
 *
 *  ⚠ THE UNIT GOES THROUGH `CaseSafe` AND MUST. Every unit this page quotes is a µ-prefixed ledger
 *  amount — `µLXC list`, `µLENS earned` — and `uppercase` maps µ (U+00B5) to Μ (U+039C), so the
 *  label painted `MLXC`: the mega prefix on a micro figure, on the four numbers this page offers as
 *  checkable against the ledger. It is fixed HERE rather than at the call sites because the
 *  µ arrives as a prop from 130 lines away and no future caller should have to know. */
export function Figure({ value, unit, tone = 'ink' }: { value: string; unit: string; tone?: 'ink' | 'muted' }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className={`font-figure text-figure ${tone === 'ink' ? 'text-ink' : 'text-muted'}`}
      >
        {value}
      </span>
      <span className="font-figure text-eyebrow uppercase text-faint">
        <CaseSafe>{unit}</CaseSafe>
      </span>
    </span>
  )
}

/** The pooled discount, as a whole percentage of list — DERIVED from the settled row, so the
 *  "30% off" in the copy and the figures in the stepper are one number, not two. */
export const POOLED_DISCOUNT_PERCENT = Math.round((SAVED_MICRO_LXC / LEDGER_HIT.listMicroLXC) * 100)

/** What an agent's wallet does, in the order a request meets it. Each line is something the
 *  console already does — /agents is where a customer sets every one of them. */
const WALLET: Array<{ title: string; body: string }> = [
  {
    title: 'A budget of its own',
    body: 'Fund each agent from the workspace balance. It spends its own money, and when the money runs out the next call is refused rather than billed to you.',
  },
  {
    title: 'Spending rules',
    body: 'Caps per request, per day and per month, the models it may call and the hours it may work — checked before the model is called, not reconciled after.',
  },
  {
    title: 'Approvals',
    body: 'A payment above the line you set waits for a person. Nothing moves until someone approves it.',
  },
  {
    title: 'A live statement',
    body: 'Every hold, charge, payment and refund lands on the agent’s own statement as it happens, so you can read what an agent spent the way you read a bank account.',
  },
]

/** The worked pooled hit, stepped. The visitor advances it themselves — four beats, each one a real
 *  figure from the settled row, so the mechanism arrives as a sequence rather than a paragraph. */
function WorkedHit() {
  const [step, setStep] = useState(0)
  const beats = [
    {
      label: 'An agent asks',
      figure: <Figure value={micro(LEDGER_HIT.listMicroLXC)} unit="µLXC list" />,
      body: 'Another workspace has already paid to have this answered. Billed straight to the provider, it would cost list price.',
    },
    {
      label: 'It is served from the pool',
      figure: <Figure value={micro(LEDGER_HIT.chargedMicroLXC)} unit="µLXC charged" />,
      body: `The answer is reused instead of generated again, and charged ${POOLED_DISCOUNT_PERCENT}% under list.`,
    },
    {
      label: 'The wallet keeps the difference',
      figure: <Figure value={micro(SAVED_MICRO_LXC)} unit="µLXC saved" />,
      body: 'Not a discount anyone funds. The saving is a generation cost nobody had to pay a second time.',
    },
    {
      label: 'The contributor is paid half',
      figure: <Figure value={micro(LEDGER_HIT.contributorEarnedMicroLENS)} unit="µLENS earned" />,
      body: `Half of what was charged is minted to the workspace whose answer was reused, spendable once the ${HOLDBACK_HOURS}-hour holdback elapses.`,
    },
  ]
  return (
    <div className="overflow-hidden rounded-card border border-rule bg-surface">
      <div className="flex flex-wrap gap-px border-b border-rule bg-rule">
        {beats.map((b, i) => (
          <button
            key={b.label}
            type="button"
            onClick={() => setStep(i)}
            aria-current={i === step ? 'step' : undefined}
            className={`flex-1 whitespace-nowrap px-4 py-2.5 text-left text-caption transition-colors duration-200 active:scale-98 ${focusRing} ${
              i === step ? 'bg-surface text-ink' : 'bg-canvas text-muted hover:text-ink'
            }`}
          >
            <span className="font-figure text-faint">{String(i + 1).padStart(2, '0')}</span>
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
              className={`h-0.5 flex-1 transition-colors duration-200 ${i <= step ? 'bg-accent' : 'bg-rule'}`}
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

export function Landing() {
  // The ONE piece of server state this page reads: whether a stranger may sign up. Deliberately a
  // bare-fetch hook rather than react-query — this page renders with no providers at all, and a
  // probe that failed to answer leaves the page saying nothing about access rather than guessing.
  const { signup } = useSignupProbe()
  // THE FRONT DOOR TAKES THE BRAND LINE — `null`, not a page name. That is what the marketing
  // site does with its own home page, while every inner page is `<page> | TALYVOR`, and this
  // page's own h1 is a sentence, not a name. See documentTitle.test.tsx for the fetched titles.
  useDocumentTitle(null)
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
        @media (prefers-reduced-motion: reduce) {
          .tal-rise, .tal-stagger > * { animation: none }
        }
      `}</style>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-rule bg-canvas">
        {/* `flex-wrap gap-y-2` — the ONE row in the product that could not survive the type scale
            becoming root-relative. MEASURED at 320px CSS width with a 24px root (Chrome's "Very
            Large"): this row's "Open the app" button is `whitespace-nowrap`, so with the wordmark
            beside it the header could not give the width back and /marketing's scrollWidth read
            346 against a 320 client width — the only one of fifteen addresses that did. With the
            wrap it reads 320. Zero-pixel while it fits: a row-gap applies only BETWEEN wrapped
            lines, and the header measured 63.29px high with and without at the default root. */}
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-y-2 px-gutter py-3">
          <div className="flex items-center gap-2.5">
            <Mark size={26} aria-hidden />
            <div className="min-w-0">
              <Wordmark height={12} />
              <div className="mt-1 text-eyebrow uppercase leading-tight text-label">Agent Wallets</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="/pricing" className={`text-body text-muted ${inlineLink}`}>
              Pricing
            </a>
            <a href="/documentation" className={`text-body text-muted ${inlineLink}`}>
              Documentation
            </a>
            <ThemeToggle />
            {/* The one "Open the app" link — Landing.test.tsx pins its name and href. */}
            <Button asChild>
              <a href="/">Open the app</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── 00 · The product ─────────────────────────────────────────────── */}
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
              <SectionLabel index="00">Agent wallets</SectionLabel>
              <h1
                id="hero-heading"
                className="mt-7 max-w-3xl text-display-1 text-ink"
              >
                Give every AI agent{' '}
                <span className="relative inline-block">
                  a wallet.
                  <span className="absolute -bottom-1 left-0 h-0.5 w-full bg-accent" aria-hidden="true" />
                </span>
              </h1>
              <p className="mt-8 max-w-2xl text-lede text-muted">
                A budget, spending rules, approvals and a live statement for each agent you run —
                enforced before the model call or the payment, not reconciled after the bill
                arrives.
              </p>
              <p className="mt-4 max-w-2xl text-body text-muted">
                An agent with a wallet can only spend what you gave it, on what you allowed, when
                you allowed it. Everything it does spend is on its own statement the moment it
                happens.
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
                  <a href="#wallets">See how it works</a>
                </Button>
              </div>
            </div>
            <p className="mt-4 text-caption text-faint">
              <a href="/privacy" className={inlineLink}>
                Privacy
              </a>
              {' · '}
              <a href="/terms" className={inlineLink}>
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

        {/* ── 01 · Wallets ─────────────────────────────────────────────────── */}
        <section
          id="wallets"
          aria-labelledby="wallets-heading"
          className="scroll-mt-16 border-b border-rule"
        >
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-20">
            <SectionLabel index="01">Wallets</SectionLabel>
            {/* THE ONE HEADING THAT NAMES THE PRODUCT. Landing.test.tsx asserts exactly one heading
                matches /talyvor/i, so nothing else on this page may put the name in a heading. */}
            <h2
              id="wallets-heading"
              className="mt-6 max-w-3xl text-display-3 text-ink"
            >
              Talyvor checks the rules before the money moves.
            </h2>
            <p className="mt-4 max-w-xl text-body text-muted">
              Every model call and every payment an agent makes passes through the gateway first.
              The wallet is consulted there — so a rule that says no stops the call, instead of
              showing up as a line on next month’s invoice.
            </p>
            <ol className="mt-10 grid gap-px border border-rule bg-rule wide:grid-cols-2">
              {WALLET.map((w, i) => (
                <li key={w.title} className="bg-surface p-6">
                  <div className="flex items-baseline gap-3">
                    <span className="font-figure text-caption text-faint">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-head text-ink">{w.title}</span>
                  </div>
                  <p className="mt-3 text-body text-muted">{w.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── 02 · Chat ────────────────────────────────────────────────────── */}
        <section aria-labelledby="chat-heading" className="border-b border-rule bg-canvas">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-20">
            <SectionLabel index="02">Chat</SectionLabel>
            <h2
              id="chat-heading"
              className="mt-6 max-w-3xl text-display-3 text-ink"
            >
              A chat app for you, and the console for your agents.
            </h2>
            <div className="mt-8 grid gap-x-12 gap-y-6 wide:grid-cols-2">
              <p className="text-body text-muted">
                Ask the models your workspace allows, attach documents, and keep your
                conversations. Your own messages go through the same gateway as your agents’
                calls.
              </p>
              <p className="text-body text-muted">
                The same app is where you fund an agent, set its rules, approve what it asked to
                spend and read its statement — the wallet console sits beside the conversation
                rather than in a separate admin product.
              </p>
            </div>
          </div>
        </section>

        {/* ── 03 · Marketplace ─────────────────────────────────────────────── */}
        <section aria-labelledby="marketplace-heading" className="border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-20">
            <SectionLabel index="03">Marketplace</SectionLabel>
            <h2
              id="marketplace-heading"
              className="mt-6 max-w-3xl text-display-3 text-ink"
            >
              Where agents spend.
            </h2>
            <div className="mt-8 grid gap-x-12 gap-y-6 wide:grid-cols-2">
              <p className="text-body text-muted">
                Browse and use agents, prompts, skills, evaluations and pipelines that other
                workspaces have published, instead of building every one yourself.
              </p>
              <p className="text-body text-muted">
                Publish your own, and the Marketplace shows you what each listing earned.
              </p>
            </div>
          </div>
        </section>

        {/* ── 04 · Repeated questions cost less ────────────────────────────── */}
        <section
          id="pooling"
          aria-labelledby="pooling-heading"
          className="scroll-mt-16 border-b border-rule bg-canvas"
        >
          <div className="mx-auto w-full max-w-5xl px-gutter py-16 wide:py-20">
            <SectionLabel index="04">Pooling</SectionLabel>
            <h2
              id="pooling-heading"
              className="mt-6 max-w-2xl text-display-3 text-ink"
            >
              Repeated questions cost less.
            </h2>
            <p className="mt-4 max-w-xl text-body text-muted">
              When an agent asks something another workspace has already paid to have answered, the
              answer is served from the pool at {POOLED_DISCOUNT_PERCENT}% off list, and the
              workspace whose answer it was is paid half of the charge. Only answers cross between
              workspaces — never the prompt that produced them. Step through one real settled
              transaction:
            </p>
            <div className="mt-8">
              <WorkedHit />
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
              Give your first agent a wallet.
            </h2>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild variant="primary">
                <a href="/signup">Create your workspace</a>
              </Button>
              {HAS_CONTACT ? (
                <Button asChild>
                  <a href={CONTACT_MAILTO} className="font-mono">
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
          <div className="font-figure text-eyebrow uppercase text-faint">
            Talyvor Ltd · wallets for AI agents
          </div>
          <div className="text-caption text-faint">
            <a href="/privacy" className={inlineLink}>
              Privacy
            </a>
            {' · '}
            <a href="/terms" className={inlineLink}>
              Terms
            </a>
            {' · '}
            <a href="/pricing" className={inlineLink}>
              Pricing
            </a>
            {' · '}
            <a href="/documentation" className={inlineLink}>
              Documentation
            </a>
            {' · '}
            <a href="#pooling" className={inlineLink}>
              Repeated questions
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
