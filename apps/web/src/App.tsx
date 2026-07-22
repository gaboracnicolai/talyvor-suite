import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { NavItem, Shell, ThemeToggle } from '@talyvor/ui'
import { AuthGate, SessionChip } from './components/AuthGate'
import { ApiError } from './lib/api'
import { Overview } from './areas/lens/Overview'
import { Ledger } from './areas/lens/Ledger'
import { Keys } from './areas/lens/Keys'
import { Spend } from './areas/lens/Spend'
import { Members } from './areas/lens/Members'
import { TrackArea } from './areas/track/TrackArea'
import { DocsArea } from './areas/docs/DocsArea'
import { AdminArea } from './areas/admin/AdminArea'
import { Landing } from './areas/marketing/Landing'
import { Specimen } from './routes/Specimen'

// App.tsx is a SHARED file (see README §Directory ownership): it owns routing
// and the nav for every area. Area work happens inside src/areas/<area>/ —
// changing THIS file requires its own PR, because five parallel tracks depend
// on it not moving under them.

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      // A 401 mid-session (expiry, signed out elsewhere) re-probes the gate, so
      // the sign-in card appears instead of a screen of silent per-card failures.
      if (err instanceof ApiError && err.status === 401) {
        void queryClient.invalidateQueries({ queryKey: ['auth-me'] })
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // A 401 is a verdict, not a flake — retrying it just delays the gate.
      retry: (failureCount, error) =>
        failureCount < 1 && !(error instanceof ApiError && error.status === 401),
    },
  },
})

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="px-3 pb-1 text-caption font-semibold uppercase tracking-wide text-faint">{label}</div>
      {children}
    </div>
  )
}

// Titles resolve by prefix so wildcard areas (/track/anything) title correctly.
function titleFor(pathname: string): string {
  if (pathname.startsWith('/track')) return 'Track'
  if (pathname.startsWith('/docs')) return 'Docs'
  if (pathname.startsWith('/admin')) return 'Admin'
  const exact: Record<string, string> = {
    '/': 'Overview',
    '/ledger': 'Ledger',
    '/keys': 'API keys',
    '/spend': 'Spend & routing',
    '/members': 'Members',
    '/specimen': 'Specimen',
  }
  return exact[pathname] ?? 'Overview'
}

function Sidebar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const item = (to: string, label: string, wildcard = false) => (
    <NavItem
      active={wildcard ? pathname.startsWith(to) : pathname === to}
      onClick={() => navigate(to)}
    >
      {label}
    </NavItem>
  )
  return (
    <nav className="flex flex-col gap-4 pb-2" aria-label="Sections">
      <div className="px-3 pb-1 pt-2">
        <div className="text-head text-ink">Talyvor</div>
        <div className="text-caption font-normal text-faint">Suite</div>
      </div>
      <Group label="Workspace">
        {item('/', 'Overview')}
        {item('/ledger', 'Ledger')}
        {item('/keys', 'API keys')}
        {item('/spend', 'Spend & routing')}
        {item('/members', 'Members')}
      </Group>
      <Group label="Products">
        {item('/track', 'Track', true)}
        {item('/docs', 'Docs', true)}
      </Group>
      <Group label="Operator">
        {item('/admin', 'Admin', true)}
        {item('/specimen', 'Specimen')}
      </Group>
    </nav>
  )
}

function AppShell() {
  const { pathname } = useLocation()
  return (
    <Shell
      sidebar={<Sidebar />}
      nav={
        <>
          <div className="text-head text-ink">{titleFor(pathname)}</div>
          <div className="flex items-center gap-3">
            <SessionChip />
            <ThemeToggle />
          </div>
        </>
      }
    >
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/keys" element={<Keys />} />
        <Route path="/spend" element={<Spend />} />
        <Route path="/members" element={<Members />} />
        <Route path="/track/*" element={<TrackArea />} />
        <Route path="/docs/*" element={<DocsArea />} />
        <Route path="/admin/*" element={<AdminArea />} />
        <Route path="/specimen" element={<Specimen />} />
      </Routes>
    </Shell>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public marketing landing — OUTSIDE the AuthGate by design. */}
          <Route path="/marketing/*" element={<Landing />} />
          <Route
            path="/*"
            element={
              <AuthGate>
                <AppShell />
              </AuthGate>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
