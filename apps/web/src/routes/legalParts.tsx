import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

// legalParts — the shared furniture for /privacy and /terms.
//
// One module so the two documents cannot drift in the ways that matter: the review warning reads
// identically on both, and the cross-links are generated rather than typed. The consent screen and
// the sharing settings share a module for the same reason, and for the same lesson — the first
// draft of the consent screen carried its own copy and promised a settings page that did not exist.

/**
 * ReturnLink — the way out of a document that is otherwise a dead end.
 *
 * ⚠ WHY THIS EXISTS AT ALL. /privacy and /terms sit OUTSIDE the AuthGate, so neither renders the
 * app shell and neither has a sidebar. Browser-back covers the reader who clicked through; it does
 * nothing for the one who typed the URL, followed a link from elsewhere, or opened a new tab —
 * which is how a policy page is most often reached. For them the page had no exit at all.
 *
 * ⚠ WHAT IT RETURNS TO IS NOT A CONSTANT, because these pages are reached from both sides. The
 * marketing page, the sign-in and sign-up cards and the consent screen all link here for readers
 * with NO session; the sidebar links here for readers who have one. Sending a stranger to `/`
 * lands them on a sign-in card they never asked for, and sending a signed-in person to `/marketing`
 * ejects them from their own session onto a sales page. So the destination is decided, not chosen.
 *
 * ⚠ IT DOES NOT ADD A THIRD READER OF /auth/me. This is the same useQuery key, queryFn and
 * staleTime the gate and the session chip already use, so a signed-in reader arriving from the
 * sidebar hits a warm cache: no second request, no flash of the wrong destination. It also reuses
 * the GATE'S OWN PREDICATE (`mode === 'oidc' && !authenticated`) rather than a fresh reading of
 * the same fields — in `disabled` mode there is no session concept and the app renders, so `/` is
 * correct there and a naive `!authenticated` test would have sent every local dev run to marketing.
 *
 * ⚠ AND `/` IS THE ANSWER WHEN WE DO NOT KNOW YET. The probe may be in flight or may have failed,
 * and the reader whose network just hiccuped is the one least able to guess a URL — so the way out
 * must render regardless. `/` is the one address that resolves ITSELF by auth state (signed in →
 * the app; signed out → the sign-in card), so it is never a dead end in either direction; it is
 * only less specific than /marketing would have been. `/marketing` is used exactly when the probe
 * has affirmatively said the reader has no session.
 *
 * Deliberately one small muted link and not a nav bar. The instinct that a policy should not carry
 * product chrome was right; what was missing is a way out, and that is a different thing.
 */
function ReturnLink() {
  const q = useQuery({ queryKey: ['auth-me'], queryFn: api.me, staleTime: 60_000 })
  const signedOut = q.data?.mode === 'oidc' && !q.data.authenticated
  return (
    <Link
      to={signedOut ? '/marketing' : '/'}
      className="text-caption text-faint underline hover:text-muted"
    >
      ← Back to Talyvor
    </Link>
  )
}

export function LegalHeader({ title }: { title: string }) {
  return (
    <header className="mb-8">
      <div className="mb-6">
        <ReturnLink />
      </div>
      <div className="text-caption text-faint">Talyvor</div>
      <h1 className="mt-2 text-title text-ink">{title}</h1>
      <p className="mt-3 text-body text-muted">
        Last updated 28 July 2026. Written from the code, for a closed trial.{' '}
        <Link className="underline" to={title === 'Privacy' ? '/terms' : '/privacy'}>
          {title === 'Privacy' ? 'Terms' : 'Privacy'}
        </Link>
      </p>
    </header>
  )
}

/**
 * LawyerReview — an explicit, visible marker that a draft is a draft.
 *
 * Deliberately not a footnote. A document that reads as final and is not is worse than no document:
 * the reader cannot tell which parts were checked by someone qualified. `compact` marks a single
 * clause; the full form marks a whole document.
 */
export function LawyerReview({
  children,
  compact = false,
}: {
  children: React.ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={
        'rounded-control border border-rule border-l-2 border-l-held bg-canvas px-4 ' + (compact ? 'py-3 mt-4' : 'py-4 mb-8')
      }
    >
      <div className="text-caption font-medium text-ink">
        {compact ? 'Needs legal review' : 'Draft — needs legal review before it is relied on'}
      </div>
      <p className="mt-1 text-body text-muted">{children}</p>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-head text-ink">{title}</h2>
      {children}
    </section>
  )
}
