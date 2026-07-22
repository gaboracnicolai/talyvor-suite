// The fixture marker. Any card rendered from fixtures.ts wears one — fixture data is
// never presented as live (the ownership brief's rule, and this repo's habit: nothing
// is faked silently). Pill grammar: amber dot = provisional, label in muted ink.
//
// `standsInFor` is the exact upstream route the fixture stands in for (threaded from
// the data hook), surfaced as the title so hovering answers "what is missing?" with a
// path, not a shrug. The badge disappears by deleting the fixture hook, nothing else.
export function FixtureBadge({ standsInFor }: { standsInFor: string }) {
  return (
    <span
      title={`Fixture data — awaiting BFF proxy for ${standsInFor}`}
      className="inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-pill border border-rule bg-surface px-2 text-caption uppercase tracking-wide text-muted"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-pill bg-held" aria-hidden="true" />
      Fixture
    </span>
  )
}
