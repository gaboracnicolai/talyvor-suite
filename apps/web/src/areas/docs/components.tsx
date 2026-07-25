// Area-local bits. Nothing here is shared — if one of these earns a second area,
// promotion into packages/ui is a separate PR (see the ownership contract).
import { Link } from 'react-router-dom'

/** Neutral chip: hairline border, muted caption, NO dot and NO hue — for states that
 *  are facts, not lifecycle (fixture, private, locked, doc_status). Distinct from
 *  packages/ui Pill, whose statuses are the semantic colour set. */
export function Chip({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className="inline-flex h-5 shrink-0 items-center rounded-pill border border-rule bg-canvas px-2 text-caption uppercase tracking-wide text-muted"
    >
      {children}
    </span>
  )
}

// FixtureChip and FixtureNote are GONE. Their own doctrine required it: the shared
// FixtureNotice carries a "REMOVAL CONDITION — the day no screen renders one, delete it; an
// unproducible marker is dead surface". No Docs screen renders fixture data any more, and the
// note's text ("the BFF serves only /api/docs/spaces today") had become false besides.

/** Breadcrumb trail: caption links, current leaf in ink. */
export function Crumbs({ trail }: { trail: Array<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-caption font-normal text-muted">
      {trail.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 ? <span aria-hidden="true">›</span> : null}
          {c.to ? (
            <Link to={c.to} className="underline-offset-2 hover:underline">
              {c.label}
            </Link>
          ) : (
            <span className="text-ink">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
