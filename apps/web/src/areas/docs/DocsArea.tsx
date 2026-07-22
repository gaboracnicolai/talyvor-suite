import { Card, CardHeader } from '@talyvor/ui'

// Scaffold placeholder — replaced by the docs tab (this area's owner). All
// /docs/* client routes resolve here until that tab adds its own sub-routing.
export function DocsArea() {
  return (
    <div className="px-gutter py-4">
      <Card>
        <CardHeader>Docs</CardHeader>
        <p className="px-gutter py-3 text-body text-muted">
          Spaces, pages and search will live here, on the BFF&apos;s gateway-authenticated
          Docs proxy. Scaffold placeholder — built by the docs tab.
        </p>
      </Card>
    </div>
  )
}
