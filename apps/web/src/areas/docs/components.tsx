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

/** Marks fixture-backed data on every screen that renders it. The BFF serves only
 *  /api/docs/spaces today; the tree + reader run on local fixtures (BFF-GAPS.md). */
export function FixtureChip() {
  return <Chip title="Local fixture data — the BFF does not serve this read yet (see BFF-GAPS.md)">fixture</Chip>
}

/** Under-card footnote explaining the fixture chip, once per screen. */
export function FixtureNote() {
  return (
    <p className="px-gutter text-caption font-normal text-faint">
      Page tree and page content are local fixtures — the BFF serves only /api/docs/spaces today. The missing
      routes are enumerated in areas/docs/BFF-GAPS.md.
    </p>
  )
}

/** Date-only, UTC, deterministic in every timezone (tests included). */
export function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d)
}

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
