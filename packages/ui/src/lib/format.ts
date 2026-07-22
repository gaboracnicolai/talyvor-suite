// Shared formatting utilities. Promoted when a second area independently built
// the same thing (docs' formatDay; lens keeps its own formatWhen, which carries
// a TIME and is deliberately different).

/** Date-only, UTC, deterministic in every timezone (tests included). Promoted
 *  verbatim from areas/docs. */
export function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d)
}
