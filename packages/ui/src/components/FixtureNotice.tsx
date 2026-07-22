// The honesty marker for data that is not live yet: sample data is NEVER
// silent. Faint dot + quiet caption — the CapabilityOff idiom — because "not
// wired yet" is information, not a fault. Promoted from areas/lens once three
// areas were building ahead of their BFF routes.
//
// REMOVAL CONDITION: this component exists for the build-out period in which
// areas run ahead of their routes. The day no screen renders one, delete it —
// an unproducible marker is dead surface (the 'idle' lesson).
export function FixtureNotice({ awaiting }: { awaiting: string }) {
  return (
    <div className="flex items-center gap-1.5 text-caption text-faint">
      <span className="h-1.5 w-1.5 shrink-0 rounded-pill bg-faint" aria-hidden="true" />
      <span>Sample data — awaiting {awaiting}.</span>
    </div>
  )
}
