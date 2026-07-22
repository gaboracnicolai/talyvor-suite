import { Card, CardHeader } from '@talyvor/ui'

// Scaffold placeholder — replaced by the track tab (this area's owner). All
// /track/* client routes resolve here until that tab adds its own sub-routing.
export function TrackArea() {
  return (
    <div className="px-gutter py-4">
      <Card>
        <CardHeader>Track</CardHeader>
        <p className="px-gutter py-3 text-body text-muted">
          Issues, projects, cycles and workflows will live here, on the BFF&apos;s
          gateway-authenticated Track proxy. Scaffold placeholder — built by the track tab.
        </p>
      </Card>
    </div>
  )
}
