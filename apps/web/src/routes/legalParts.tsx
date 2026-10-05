import { Link } from 'react-router-dom'
import { useAuthMeReader } from '../lib/authMe'
import { useDocumentTitle } from '../documentTitle'
import { inlineLink } from '@talyvor/ui'
import { SiteFooter, SiteHeader } from '../components/SiteChrome'
import { TealRule } from '../areas/marketing/Landing'

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
  const q = useAuthMeReader()
  const signedOut = q.data?.mode === 'oidc' && !q.data.authenticated
  return (
    <Link
      to={signedOut ? '/marketing' : '/'}
      className={`text-caption text-faint ${inlineLink}`}
    >
      ‹ Back to Talyvor
    </Link>
  )
}

export function LegalHeader({ title }: { title: string }) {
  // The tab is told the SAME prop the h1 paints, from the one component both legal pages share.
  // Setting it in Privacy.tsx and Terms.tsx instead would be two more places a page name lives.
  useDocumentTitle(title)
  return (
    <header className="mb-8">
      <div className="mb-8">
        <ReturnLink />
      </div>
      <div className="text-eyebrow uppercase text-label">Talyvor</div>
      <h1 className="mt-4 text-display-2 text-ink">{title}</h1>
      <TealRule className="mt-6" />
      <p className="mt-6 text-reading text-muted">
        Last updated 28 July 2026. Written from the code, for a closed trial.{' '}
        <Link className={inlineLink} to={title === 'Privacy' ? '/terms' : '/privacy'}>
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
        'rounded-card border border-rule border-l-2 border-l-held bg-raised px-4 ' + (compact ? 'py-3 mt-4' : 'py-4 mb-10')
      }
    >
      <div className="text-caption font-medium text-ink">
        {compact ? 'Needs legal review' : 'Draft — needs legal review before it is relied on'}
      </div>
      <p className="mt-1 text-reading text-muted">{children}</p>
    </div>
  )
}

const HEADER_LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/documentation', label: 'Documentation' },
]
const FOOTER_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  ...HEADER_LINKS,
]

/**
 * LegalPage — the frame both documents sit in (B29.13): the site's logo header and footer, and
 * between them a reading column on canvas at the 15/24 reading step, left on the same edge as the
 * logo. `max-w-lg` (32rem) is what sets about 65 characters a line: measured in Chrome, a full line
 * here holds 66 on median. `max-w-prose` (65ch) set 82, because a `ch` is the width of a zero and
 * Space Grotesk's zero is wider than its average letter.
 *
 * `main` holds the whole document, title block included, so a reader deciding whether to hand us
 * their data can jump straight to it; LandmarkCoverage.test.tsx holds the proportion. The company
 * line (B32.2) is in the footer, as on every other page of the website.
 */
export function LegalPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      <SiteHeader product="Suite" links={HEADER_LINKS} />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-gutter pb-16 pt-10 wide:pt-14">
          <div className="max-w-lg text-reading">{children}</div>
        </div>
      </main>
      <SiteFooter links={FOOTER_LINKS} />
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-display-4 text-ink">{title}</h2>
      {children}
    </section>
  )
}
