import { Card, CardHeader } from '@talyvor/ui'

// Scaffold placeholder — replaced by the admin tab (this area's owner). All
// /admin/* client routes resolve here until that tab adds its own sub-routing.
export function AdminArea() {
  return (
    <div className="px-gutter py-4">
      <Card>
        <CardHeader>Admin</CardHeader>
        <p className="px-gutter py-3 text-body text-muted">
          The operator surface will live here: edge fleet, deploys and health. Needs a
          backend resource API that edge-infra does not expose yet. Scaffold placeholder —
          built by the admin tab.
        </p>
      </Card>
    </div>
  )
}
