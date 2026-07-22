import { Link, Route, Routes, useInRouterContext } from 'react-router-dom'
import { Card, CardHeader } from '@talyvor/ui'
import { SpaceList } from './SpaceList'
import { SpaceView } from './SpaceView'
import { PageView } from './PageView'

// The Docs area: /docs/* sub-routing (App.tsx owns the mount, this file owns
// everything under it).
//
//   /docs                          → space list (LIVE /api/docs/spaces)
//   /docs/spaces/:spaceId          → page tree   (fixtures until the BFF route lands)
//   /docs/spaces/:spaceId/pages/:pageId → reader (fixtures until the BFF route lands)
//
// Rendered OUTSIDE a router (the scaffold contract renders every area bare), there
// is nothing to route and no query client to fetch with, so the area shows its
// descriptive card instead — same landing surface the scaffold promised, kept
// deliberately so the shared scaffold test needs no edit from this tab.
export function DocsArea() {
  const routed = useInRouterContext()
  if (!routed) {
    return (
      <div className="px-gutter py-4">
        <Card>
          <CardHeader>Docs</CardHeader>
          <p className="px-gutter py-3 text-body text-muted">
            Spaces, page trees and a read-only page renderer, on the BFF&apos;s Docs proxy. Outside the app
            router this card is a static placeholder; inside it, /docs routes to the live area.
          </p>
        </Card>
      </div>
    )
  }
  return (
    <div className="px-gutter py-4">
      <Routes>
        <Route index element={<SpaceList />} />
        <Route path="spaces/:spaceId" element={<SpaceView />} />
        <Route path="spaces/:spaceId/pages/:pageId" element={<PageView />} />
        <Route
          path="*"
          element={
            <div className="mx-auto flex max-w-3xl flex-col gap-2">
              <Card>
                <CardHeader>Docs</CardHeader>
                <p className="px-gutter py-3 text-body text-muted">
                  Nothing at this address.{' '}
                  <Link to="/docs" className="underline underline-offset-2">
                    Back to spaces
                  </Link>
                  .
                </p>
              </Card>
            </div>
          }
        />
      </Routes>
    </div>
  )
}
