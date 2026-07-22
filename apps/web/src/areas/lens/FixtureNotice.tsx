// The honesty marker for data that is not live yet: sample data is NEVER
// silent. Reuses the CapabilityOff idiom (faint dot + quiet caption) because
// "not wired yet" is information, not a fault. Screens drop this marker the
// moment their data goes live — each area owns its own smoke test now, so
// nothing shared pins this wording.
// PROMOTION CANDIDATE for packages/ui (separate PR) if other areas want it.
export function FixtureNotice({ awaiting }: { awaiting: string }) {
  return (
    <div className="flex items-center gap-1.5 text-caption text-faint">
      <span className="h-1.5 w-1.5 rounded-pill bg-faint" aria-hidden="true" />
      <span>Sample data — awaiting {awaiting}.</span>
    </div>
  )
}
