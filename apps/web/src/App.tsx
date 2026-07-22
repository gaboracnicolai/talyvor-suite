import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { NavItem, Shell, ThemeToggle } from '@talyvor/ui'
import { AuthGate, SessionChip } from './components/AuthGate'
import { ApiError } from './lib/api'
import { Overview } from './routes/Overview'
import { Ledger } from './routes/Ledger'
import { Specimen } from './routes/Specimen'

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

const TITLES: Record<string, string> = { '/': 'Overview', '/ledger': 'Ledger', '/specimen': 'Specimen' }

function Sidebar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <nav className="flex flex-col gap-4 pb-2" aria-label="Sections">
      <div className="px-3 pb-1 pt-2">
        <div className="text-head text-ink">Talyvor</div>
        <div className="text-caption font-normal text-faint">Suite · Lens</div>
      </div>
      <Group label="Lens">
        <NavItem active={pathname === '/'} onClick={() => navigate('/')}>
          Overview
        </NavItem>
        <NavItem active={pathname === '/ledger'} onClick={() => navigate('/ledger')}>
          Ledger
        </NavItem>
      </Group>
      <Group label="Products">
        {['Track', 'Docs', 'Code'].map((p) => (
          <NavItem key={p} disabled title="Wired in a later increment">
            {p}
          </NavItem>
        ))}
      </Group>
      <Group label="System">
        <NavItem active={pathname === '/specimen'} onClick={() => navigate('/specimen')}>
          Specimen
        </NavItem>
        <NavItem disabled title="Wired in a later increment">
          Admin
        </NavItem>
      </Group>
    </nav>
  )
}

function AppShell() {
  const { pathname } = useLocation()
  const title = TITLES[pathname] ?? 'Overview'
  return (
    <Shell
      sidebar={<Sidebar />}
      nav={
        <>
          <div className="text-head text-ink">{title}</div>
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
        <Route path="/specimen" element={<Specimen />} />
      </Routes>
    </Shell>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate>
          <AppShell />
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
