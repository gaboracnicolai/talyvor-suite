import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button, Card } from '@talyvor/ui'
import { api } from '../lib/api'
import { useAuthMeReader } from '../lib/authMe'
import { useDocumentTitle } from '../documentTitle'
import { SignInCard } from '../areas/auth/Entry'

// The auth gate: one probe (/auth/me) decides whether the app or the sign-in
// card renders. ONLY an oidc-mode BFF reporting "no session" gates — disabled
// mode (loopback dev) and a live session render the app unchanged, and a probe
// failure falls through to the app, whose routes already render calm per-card
// failure states (a dead BFF is a fault, not a sign-in prompt).
export function AuthGate({ children }: { children: React.ReactNode }) {
  const q = useQuery({ queryKey: ['auth-me'], queryFn: api.me, staleTime: 60_000 })
  const navigate = useNavigate()
  // B28.8 — THE LOGIN THAT CREATED THE WORKSPACE OPENS HOME, AND NOTHING BLOCKS IT. This used to render
  // a full-screen sharing-consent page instead of the app. A new workspace now lands, once, on Home's
  // onboarding — create an agent with a budget, fund it, issue its key — and sharing is one line there
  // to untick (Sharing.tsx's SharingLine), stating what Lens recorded. needs_pooling_choice is false on
  // every later sign-in, so a returning user is never sent there again; routed once, they are free.
  const newWorkspace = q.data?.authenticated === true && q.data.needs_pooling_choice === true
  const routed = useRef(false)
  useEffect(() => {
    if (newWorkspace && !routed.current) {
      routed.current = true
      navigate('/', { replace: true })
    }
  }, [newWorkspace, navigate])
  const signedOut = q.data?.mode === 'oidc' && !q.data.authenticated
  useEffect(() => {
    if (q.data === undefined) return
    rememberSession(!signedOut)
  }, [q.data, signedOut])
  if (q.isLoading) {
    // B28.266 — never a blank page while the probe answers. It returned null here, and on the live
    // app a cold load of /keys, /members, /setup or /earnings measured 0 characters of text at the
    // load event: the 1.2 MB bundle had run, the probe had not answered. A browser that was signed
    // in last time draws the screen now, so its headings and its own reads start beside the probe;
    // the probe still decides, and a dead session swaps to the sign-in card when it answers.
    if (hadSession()) return <>{children}</>
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-gutter">
        <p className="text-body text-muted">Checking your session…</p>
      </main>
    )
  }
  if (signedOut) {
    return <SignedOut />
  }
  return <>{children}</>
}

// Whether this browser was signed in when the probe last answered. A hint for what to draw while
// the next probe is in flight, never a credential: the session is the BFF's cookie, and every read
// the screen makes is refused server-side without it.
const SESSION_HINT = 'talyvor.had-session'

function hadSession(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT) === '1'
  } catch {
    return false
  }
}

function rememberSession(on: boolean) {
  try {
    if (on) localStorage.setItem(SESSION_HINT, '1')
    else localStorage.removeItem(SESSION_HINT)
  } catch {
    // Storage refused (private mode, quota): the next cold load shows the wait line instead.
  }
}

function SignedOut() {
  // Land back where the user was heading; the BFF re-sanitises this server-side.
  const returnTo = window.location.pathname + window.location.search + window.location.hash
  // THE TAB NAMES THIS CARD, NOT THE PAGE BEHIND IT. The address is still /ledger, so anything
  // deriving the title from the location would title a page the reader was refused — the exact
  // shape ConsoleTitle.test.tsx removed from the banner ("a page you are not on", and the name
  // is the only one on the screen).
  useDocumentTitle('Sign in')
  // THE SAME WORDS AS /signin, from the same component. This card used to read "This workspace
  // requires authentication. You'll be sent to your organisation's identity provider" — correct
  // for an enterprise SSO rollout, and wrong for the person this trial is for: a stranger reads
  // it as "you need a company account and an IT department". It also had no route out for
  // someone who does not have a workspace yet, so a mistaken landing was a dead end.
  //
  // Sharing the component is the point: two places that render sign-in cannot drift into
  // telling one reader something the other is not told.
  return (
    // `main`, NOT `div` — same element, same classes, only the tag. THIS CARD IS A STATE, NOT AN
    // ADDRESS: it is what every gated address renders when /auth/me refuses the session, so it is
    // the most-seen screen in the product for a signed-out reader — and a DOM census found it had
    // ZERO landmark elements of any kind, with 215 of 215 characters outside every region. Every
    // address-shaped sweep in this repo is structurally blind to it, which is how it stayed that
    // way while twelve addresses were swept for headings twice. Zero-pixel: no rule in the built
    // stylesheet names a sectioning element. LandmarkCoverage.test.tsx asserts it as a state.
    <main className="flex min-h-screen items-center justify-center bg-canvas px-gutter">
      <Card className="w-full max-w-sm">
        <SignInCard returnTo={returnTo} />
      </Card>
    </main>
  )
}

// SessionChip: who is signed in + the way out. Renders nothing when there is no
// session to show (disabled mode, or the gate is about to take over anyway).
export function SessionChip() {
  const q = useAuthMeReader()
  const qc = useQueryClient()
  if (!q.data?.authenticated || !q.data.user) return null
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate text-caption text-muted" title={q.data.user.email}>
        {q.data.user.email}
      </span>
      <Button
        className="shrink-0"
        onClick={() => {
          void fetch('/auth/logout', { method: 'POST' }).then(() => {
            // The session is dead server-side; re-probe so the gate re-renders.
            void qc.invalidateQueries({ queryKey: ['auth-me'] })
          })
        }}
      >
        Sign out
      </Button>
    </div>
  )
}
