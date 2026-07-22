import { Route, Routes, useInRouterContext, useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, CardHeader } from '@talyvor/ui'
import { Topology } from './Topology'
import { Nodes } from './Nodes'
import { Certificates } from './Certificates'
import { Provisioning } from './Provisioning'
import { Config } from './Config'

// The Admin area: /admin/* sub-routing over the edge-infra read-only Admin API
// (five endpoints on :18002 — see ./api.ts and ./BFF-GAPS.md).
//
//   /admin                → topology (the serving graph is the landing view)
//   /admin/nodes          → connected nodes + ACK divergence (connected-only)
//   /admin/certificates   → cert inventory with expiry states
//   /admin/provisioning   → OSB services + request log incl FAILED
//   /admin/config         → effective config, reported-not-settable
//
// Rendered OUTSIDE a router (the area-owned smoke test renders it bare), there
// is nothing to route and no query client, so the area shows its descriptive
// card instead — the same landing surface the scaffold promised.
const TABS = [
  { to: '/admin', label: 'Topology', match: (p: string) => p === '/admin' || p.startsWith('/admin/topology') },
  { to: '/admin/nodes', label: 'Nodes', match: (p: string) => p.startsWith('/admin/nodes') },
  { to: '/admin/certificates', label: 'Certificates', match: (p: string) => p.startsWith('/admin/certificates') },
  { to: '/admin/provisioning', label: 'Provisioning', match: (p: string) => p.startsWith('/admin/provisioning') },
  { to: '/admin/config', label: 'Config', match: (p: string) => p.startsWith('/admin/config') },
]

function AdminTabs() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Admin sections">
      {TABS.map((t) => (
        <Button
          key={t.to}
          variant={t.match(pathname) ? 'primary' : 'default'}
          aria-pressed={t.match(pathname)}
          onClick={() => navigate(t.to)}
        >
          {t.label}
        </Button>
      ))}
    </div>
  )
}

export function AdminArea() {
  const routed = useInRouterContext()
  if (!routed) {
    return (
      <div className="px-gutter py-4">
        <Card>
          <CardHeader>Admin</CardHeader>
          <p className="px-gutter py-3 text-body text-muted">
            The operator surface: edge topology, connected nodes, certificates, OSB provisioning and
            effective config, read-only from the edge Admin API. Outside the app router this card is
            a static placeholder; inside it, /admin routes to the live area.
          </p>
        </Card>
      </div>
    )
  }
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-gutter px-gutter py-4">
      <AdminTabs />
      <Routes>
        <Route index element={<Topology />} />
        <Route path="topology" element={<Topology />} />
        <Route path="nodes" element={<Nodes />} />
        <Route path="certificates" element={<Certificates />} />
        <Route path="provisioning" element={<Provisioning />} />
        <Route path="config" element={<Config />} />
        <Route
          path="*"
          element={<div className="px-gutter py-3 text-body text-muted">Nothing at this address — pick a section above.</div>}
        />
      </Routes>
    </div>
  )
}
