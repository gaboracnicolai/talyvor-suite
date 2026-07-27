import { Link } from 'react-router-dom'

// legalParts — the shared furniture for /privacy and /terms.
//
// One module so the two documents cannot drift in the ways that matter: the review warning reads
// identically on both, and the cross-links are generated rather than typed. The consent screen and
// the sharing settings share a module for the same reason, and for the same lesson — the first
// draft of the consent screen carried its own copy and promised a settings page that did not exist.

export function LegalHeader({ title }: { title: string }) {
  return (
    <header className="mb-8">
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
        'rounded-control border border-warn/40 bg-warn/5 px-4 ' + (compact ? 'py-3 mt-4' : 'py-4 mb-8')
      }
    >
      <div className="text-caption font-medium text-warn">
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
