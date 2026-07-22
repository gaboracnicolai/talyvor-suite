// The honesty marker for screens whose backing routes do not exist yet: sample
// data is NEVER silent. It reuses the CapabilityOff idiom (faint dot + quiet
// caption) because "not wired yet" is information, not a fault. The word
// "placeholder" is deliberate — these screens remain design-complete
// placeholders until their routes land, and the scaffold render-test holds
// every area to that word until the shared-test relaxation PR.
// PROMOTION CANDIDATE for packages/ui if other areas want the same marker.
export function FixtureNotice({ awaiting }: { awaiting: string }) {
  return (
    <div className="flex items-center gap-1.5 text-caption text-faint">
      <span className="h-1.5 w-1.5 rounded-pill bg-faint" aria-hidden="true" />
      <span>Design-complete placeholder over sample data — awaiting {awaiting}.</span>
    </div>
  )
}
