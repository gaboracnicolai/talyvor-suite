import { Card, CardHeader } from '@talyvor/ui'

// Scaffold placeholder — replaced by the lens tab (this area's owner).
export function Keys() {
  return (
    <div className="px-gutter py-4">
      <Card>
        <CardHeader>API keys</CardHeader>
        <p className="px-gutter py-3 text-body text-muted">
          Workspace API keys will live here: create, rotate, scope and revoke the keys this
          workspace calls Lens with. Scaffold placeholder — built by the lens tab.
        </p>
      </Card>
    </div>
  )
}
