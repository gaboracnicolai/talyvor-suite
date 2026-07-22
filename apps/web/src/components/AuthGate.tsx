import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader } from '@talyvor/ui'
import { api } from '../lib/api'

// The auth gate: one probe (/auth/me) decides whether the app or the sign-in
// card renders. ONLY an oidc-mode BFF reporting "no session" gates — disabled
// mode (loopback dev) and a live session render the app unchanged, and a probe
// failure falls through to the app, whose routes already render calm per-card
// failure states (a dead BFF is a fault, not a sign-in prompt).
export function AuthGate({ children }: { children: React.ReactNode }) {
  const q = useQuery({ queryKey: ['auth-me'], queryFn: api.me, staleTime: 60_000 })
  if (q.isLoading) {
    // One quiet beat while the probe answers; no spinner theatre for ~20ms.
    return null
  }
  if (q.data && q.data.mode === 'oidc' && !q.data.authenticated) {
    return <SignedOut />
  }
  return <>{children}</>
}

function SignedOut() {
  // Land back where the user was heading; the BFF re-sanitises this server-side.
  const returnTo = window.location.pathname + window.location.search
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-gutter">
      <Card className="w-full max-w-sm">
        <CardHeader>Talyvor</CardHeader>
        <div className="flex flex-col gap-4 px-gutter py-4">
          <p className="text-body text-muted">
            This workspace requires authentication. You’ll be sent to your organisation’s
            identity provider and returned here.
          </p>
          <Button asChild variant="primary">
            <a href={`/auth/login?return_to=${encodeURIComponent(returnTo)}`}>Sign in</a>
          </Button>
        </div>
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
