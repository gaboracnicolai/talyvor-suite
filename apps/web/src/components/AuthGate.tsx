import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button, Card } from '@talyvor/ui'
import { api } from '../lib/api'
import { PoolingConsent } from './PoolingConsent'
import { SignInCard } from '../areas/auth/Entry'

// The auth gate: one probe (/auth/me) decides whether the app or the sign-in
// card renders. ONLY an oidc-mode BFF reporting "no session" gates — disabled
// mode (loopback dev) and a live session render the app unchanged, and a probe
// failure falls through to the app, whose routes already render calm per-card
// failure states (a dead BFF is a fault, not a sign-in prompt).
export function AuthGate({ children }: { children: React.ReactNode }) {
  const q = useQuery({ queryKey: ['auth-me'], queryFn: api.me, staleTime: 60_000 })
  const qc = useQueryClient()
  const navigate = useNavigate()
  if (q.isLoading) {
    // One quiet beat while the probe answers; no spinner theatre for ~20ms.
    return null
  }
  if (q.data && q.data.mode === 'oidc' && !q.data.authenticated) {
    return <SignedOut />
  }
  // A workspace that this login just CREATED has sharing ON, and its owner has not been asked yet.
  // (The BFF sends NO cache_poolable field at provision — provisionForSession passes nil — so Lens's
  // default of true applies. This comment previously said "provisioned with sharing OFF", which was
  // the opposite of what the code does and misled a reader within an hour of #33 landing.)
  //
  // Ask before the app renders: cross-tenant pooling sends the content of this workspace's answers
  // to other companies, and that is not a thing to discover later in a settings page. Consent is
  // never granted by inaction — so the disclosure blocks, rather than the switch starting off.
  if (q.data?.authenticated && q.data.needs_pooling_choice) {
    // WHERE SETUP GOES, and why here. Setup is the only page that says how to point tools at
    // Lens; it existed as a nav item nobody was routed to, so a new user could finish signup
    // and land on an Overview of an empty workspace with no idea what to do next.
    //
    // It is placed AFTER the pooling choice, not before or beside it: the disclosure is about
    // consent and must not compete for attention with instructions, and it must not be possible
    // to skip it by reading Setup instead.
    //
    // It ROUTES rather than BLOCKS. The consent screen blocks because consent granted by
    // inaction is not consent; Setup is instructional, so blocking it would trap someone who
    // wants to look around first — worse than no step at all. Landing on /setup inside the
    // normal shell means every nav destination stays one click away.
    //
    // Fires only on the login that CREATED the workspace: needs_pooling_choice is false on
    // every later sign-in, so a returning user is never sent here again.
    return (
      <PoolingConsent
        onDone={() => {
          void qc.invalidateQueries({ queryKey: ['auth-me'] })
          navigate('/setup', { replace: true })
        }}
      />
    )
  }
  return <>{children}</>
}

function SignedOut() {
  // Land back where the user was heading; the BFF re-sanitises this server-side.
  const returnTo = window.location.pathname + window.location.search
  // THE SAME WORDS AS /signin, from the same component. This card used to read "This workspace
  // requires authentication. You'll be sent to your organisation's identity provider" — correct
  // for an enterprise SSO rollout, and wrong for the person this trial is for: a stranger reads
  // it as "you need a company account and an IT department". It also had no route out for
  // someone who does not have a workspace yet, so a mistaken landing was a dead end.
  //
  // Sharing the component is the point: two places that render sign-in cannot drift into
  // telling one reader something the other is not told.
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-gutter">
      <Card className="w-full max-w-sm">
        <SignInCard returnTo={returnTo} />
      </Card>
    </div>
  )
}

// SessionChip: who is signed in + the way out. Renders nothing when there is no
// session to show (disabled mode, or the gate is about to take over anyway).
export function SessionChip() {
  const q = useQuery({ queryKey: ['auth-me'], queryFn: api.me, staleTime: 60_000 })
  const qc = useQueryClient()
  if (!q.data?.authenticated || !q.data.user) return null
  return (
    <div className="flex items-center gap-2">
      <span className="text-caption text-muted">{q.data.user.email}</span>
      <Button
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
