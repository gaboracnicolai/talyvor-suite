import { Button, Card, Mark, ThemeToggle } from '@talyvor/ui'
import { useSignupProbe, type SignupState } from '../../lib/signupOpen'
import { useDocumentTitle } from '../../documentTitle'

// Entry.tsx — the two front doors: /signup for a stranger, /signin for someone coming back.
//
// ONE MECHANISM, TWO PAGES. Both actions go to /auth/login; the OIDC round-trip does not care
// which page you started on, and there is no "create account" API to call — the callback
// provisions a Lens workspace and bootstraps a Track one for any identity it has not seen
// before. So the difference between signing up and signing in is entirely a difference in what
// the reader needs to be told, which is exactly why it must not be one page:
//
//   A STRANGER needs to know what this is, that they may start, what happens when they click,
//   and what they will be holding afterwards. Everything before "Continue" is them deciding
//   whether to trust a redirect to a third party.
//
//   A RETURNING PERSON needs the shortest path back. Explaining the product is noise, and
//   "create your workspace" is wrong — they have one, with a balance and a ledger in it.
//
// WHAT THIS PAGE REFUSES TO SAY, and why:
//
//   "Your organisation's identity provider" — the old card's wording, and the reason this page
//   exists. It is correct for an enterprise SSO rollout and disastrous for someone arriving
//   from the internet: it tells them they need a company account and an IT department, when in
//   fact they need a Google login. Nobody complains about this; they leave.
//
//   The IdP's NAME. The deployment's issuer is configuration (OIDC_ISSUER) — Google for the
//   hosted trial, but Keycloak, Authentik, Dex or anything else for a self-hoster. "Continue
//   with Google" is a claim the bundle cannot check, and a self-hoster's users would read a
//   brand that has nothing to do with their login. So the copy describes the MECHANISM, which
//   is true of every issuer: an account you already have, and no new password.
//
//   Anything about who may enter — unless the server said. See lib/signupOpen.ts.

/** The BFF's OIDC entry point. Both pages end here; nothing else in this file is a destination. */
function loginHref(returnTo?: string): string {
  return returnTo ? `/auth/login?return_to=${encodeURIComponent(returnTo)}` : '/auth/login'
}

/** The shell both entry pages share: centred card, mark, theme toggle. Public pages, so no
 *  Shell/sidebar — there is no workspace to navigate yet. */
function EntryFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <header className="flex items-center justify-between px-gutter py-4">
        <div className="flex items-center gap-2.5">
          <Mark size={26} />
          <div className="min-w-0">
            <div className="text-head leading-tight text-ink">Talyvor</div>
            <div className="text-caption font-normal leading-tight text-faint">Suite</div>
          </div>
        </div>
        <ThemeToggle />
      </header>
      <div className="flex flex-1 items-start justify-center px-gutter pb-16 pt-4 wide:items-center wide:pt-0">
        <Card className="w-full max-w-md">{children}</Card>
      </div>
    </div>
  )
}

/** What you get on the other side. Three lines, each one a thing that exists in the product
 *  today — not a roadmap. The first is the one that matters: it is the promise the whole
 *  per-tenant provisioning chain was built to keep. */
const WHAT_YOU_GET: string[] = [
  'Your own workspace — a balance, keys and a ledger nobody else can see.',
  'An API key and a base URL to point your existing tools at.',
  'A record of what every model call cost, per request.',
]

/** The one line that says whether a stranger may actually start, DERIVED from the gate.
 *  `unknown` renders nothing: a promise we cannot verify is not printed. */
function AccessLine({ state }: { state: SignupState }) {
  if (state === 'open') {
    return (
      <p className="text-caption text-faint">
        Open to anyone — no invitation needed, and nothing to pay during the trial.
      </p>
    )
  }
  if (state === 'closed') {
    return (
      <p className="text-caption text-faint">
        Talyvor is in a closed trial right now, so access is granted per address. If you have
        already been added, continue below — otherwise there is nothing to fill in here yet.
      </p>
    )
  }
  return null
}

/** Rendered instead of the pitch when the browser already has a session: a signed-in person
 *  asked to "create your workspace" is being told their account does not exist. */
function AlreadyIn() {
  return (
    <div className="flex flex-col gap-4 p-gutter">
      <h1 className="text-title text-ink">You’re signed in</h1>
      <p className="text-body text-muted">
        This browser already has a Talyvor session, so there is nothing to sign up for.
      </p>
      <Button asChild variant="primary">
        <a href="/">Open the app</a>
      </Button>
    </div>
  )
}

// ─── /signup ────────────────────────────────────────────────────────────────

export function SignUp() {
  const { signup, authenticated } = useSignupProbe()
  // Both branches name themselves — `AlreadyIn` is a different screen at the same address, and
  // titling it "Create a workspace" would be the tab naming a screen the reader is not on. The
  // strings are these components' own `<h1>` and the label the product puts on links here.
  useDocumentTitle(authenticated ? 'You’re signed in' : 'Create a workspace')
  if (authenticated) {
    return (
      <EntryFrame>
        <AlreadyIn />
      </EntryFrame>
    )
  }
  return (
    <EntryFrame>
      <div className="flex flex-col gap-5 p-gutter">
        <div className="flex flex-col gap-3">
          <h1 className="text-title text-ink">Create your Talyvor workspace</h1>
          {/* WHAT IT IS, in one line. A stranger decides here whether to keep reading. */}
          <p className="text-body text-muted">
            Talyvor is a self-hosted AI development suite: an inference gateway with a real
            ledger, an issue tracker, a team wiki, and a coding agent.
          </p>
        </div>

        {/* WHAT HAPPENS WHEN YOU CONTINUE. A redirect to a third party is the moment a stranger
            is most likely to abandon, so it is described before it happens rather than
            explained afterwards. */}
        <div className="flex flex-col gap-3 border-t border-rule pt-4">
          <p className="text-body text-muted">
            You’ll be sent to sign in with an account you already have, then come straight back
            here. There is no form and no new password to create.
          </p>
        </div>

        {/* WHAT YOU GET. */}
        <ul className="flex flex-col gap-2 border-t border-rule pt-4">
          {WHAT_YOU_GET.map((line) => (
            <li key={line} className="flex gap-2.5 text-body text-muted">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-pill bg-accent" aria-hidden="true" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-3 border-t border-rule pt-4">
          <Button asChild variant="primary">
            <a href={loginHref('/')}>Continue</a>
          </Button>
          <AccessLine state={signup} />
          {/* ⚠ THIS WAS MISSING, ON THE ONE SURFACE THAT NEEDS IT MOST. The sign-in card's
              comment says the policies are "linked on every entry surface", and this is an
              entry surface — the one where a stranger is deciding whether to create an
              account at all. It had the claim without the link. */}
          <p className="text-caption text-faint">
            <a href="/privacy" className="underline">Privacy</a>
            {' · '}
            <a href="/terms" className="underline">Terms</a>
          </p>
          <p className="text-caption text-faint">
            Already have a workspace?{' '}
            <a href="/signin" className="underline">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </EntryFrame>
  )
}

// ─── /signin, and the gate's in-place card ──────────────────────────────────

/**
 * The returning person's page. Also rendered IN PLACE by AuthGate when a session is missing or
 * expired — same words, because the reader is the same person in both cases, and `returnTo`
 * carries them back to whatever they were trying to reach.
 *
 * It deliberately says nothing about what Talyvor is. Someone signing in knows.
 */
export function SignIn({ returnTo }: { returnTo?: string } = {}) {
  const { authenticated } = useSignupProbe()
  useDocumentTitle(authenticated ? 'You’re signed in' : 'Sign in')
  if (authenticated) {
    return (
      <EntryFrame>
        <AlreadyIn />
      </EntryFrame>
    )
  }
  return (
    <EntryFrame>
      <SignInCard returnTo={returnTo} />
    </EntryFrame>
  )
}

/** The card body on its own, so AuthGate can render the identical words without a second probe
 *  (it has already asked /auth/me — that is how it knows to show this at all). */
export function SignInCard({ returnTo }: { returnTo?: string }) {
  return (
    <div className="flex flex-col gap-4 p-gutter">
      <h1 className="text-title text-ink">Sign in to Talyvor</h1>
      {/* Linked on every entry surface, not only a footer: someone deciding whether to create an
          account must be able to read what the service does with their data BEFORE they do. Both
          routes are public for that reason. */}
      <p className="text-caption text-faint">
        <a href="/privacy" className="underline">Privacy</a>
        {' · '}
        <a href="/terms" className="underline">Terms</a>
      </p>
      <p className="text-body text-muted">
        Use the same account you signed up with. You’ll be taken there to confirm it’s you, and
        returned here — there is no password for Talyvor itself.
      </p>
      <Button asChild variant="primary">
        <a href={loginHref(returnTo)}>Sign in</a>
      </Button>
      <p className="text-caption text-faint">
        New to Talyvor?{' '}
        <a href="/signup" className="underline">
          Create a workspace
        </a>
      </p>
    </div>
  )
}
