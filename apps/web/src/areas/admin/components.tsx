// Area-local bits — third area to hand-roll a neutral Chip and a UTC date
// formatter (docs/components.tsx, lens/FixtureNotice.tsx are the siblings).
// Promotion into packages/ui is a separate PR per the ownership contract.

/** Neutral chip: hairline border, muted caption, NO dot and NO hue — for facts
 *  without lifecycle (fixture, kind, auth policy, parse error). Lifecycle
 *  states use the economy Pill instead. */
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

/** Marks fixture-backed data on every screen that renders it — the BFF does
 *  not proxy the edge-infra Admin API yet (see ./BFF-GAPS.md). */
export function FixtureChip() {
  return <Chip title="Local fixture data — the BFF does not proxy the edge Admin API yet (see BFF-GAPS.md)">fixture</Chip>
}

/** Under-card footnote explaining the fixture chip, once per screen. */
export function FixtureNote() {
  return (
    <p className="px-gutter text-caption font-normal text-faint">
      All admin data on this screen is a local fixture shaped exactly like the edge Admin API
      (cmd/server/admin.go) — the BFF proxies none of it yet. The missing routes are enumerated in
      areas/admin/BFF-GAPS.md.
    </p>
  )
}

/** Date-only, UTC, deterministic in every timezone. */
export function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d)
}

/** Date + time (minute precision), UTC-stamped so it cannot read as local. */
export function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const s = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(d)
  return `${s} UTC`
}

/** Long opaque identifiers (content-hash versions, fingerprints): first 12
 *  chars in mono with the full value on hover — never truncated silently. */
export function MonoId({ value }: { value: string }) {
  const short = value.length > 12 ? `${value.slice(0, 12)}…` : value
  return (
    <span title={value} className="font-mono text-caption font-normal tabular-nums text-muted">
      {short}
    </span>
  )
}

/** A boolean reported as text — deliberately NOT a Switch: this surface is
 *  read-only and a toggle control would imply a write path that must not
 *  exist (the ext_authz flip is an env var; a UI writer = a GitOps writer). */
export function OnOff({ on }: { on: boolean }) {
  return <span className="text-body tabular-nums text-ink">{on ? 'on' : 'off'}</span>
}
