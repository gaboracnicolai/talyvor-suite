import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { NavItem, Shell, ThemeToggle } from '@talyvor/ui'
import { Home } from './routes/Home'
import { Specimen } from './routes/Specimen'

// Scaffolding only — no queries yet (increment 1 makes no API calls).
const queryClient = new QueryClient()

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="px-3 pb-1 text-caption font-semibold uppercase tracking-wide text-faint">{label}</div>
      {children}
    </div>
  )
}

function Sidebar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <nav className="flex flex-col gap-4 pb-2" aria-label="Sections">
      <div className="px-3 pb-1 pt-2">
        <div className="text-head text-ink">Talyvor</div>
        <div className="text-caption font-normal text-faint">Suite · increment 1</div>
      </div>
      <Group label="Suite">
        <NavItem active={pathname === '/'} onClick={() => navigate('/')}>
          Overview
        </NavItem>
        <NavItem active={pathname === '/specimen'} onClick={() => navigate('/specimen')}>
          Specimen
        </NavItem>
      </Group>
      <Group label="Products">
        {['Lens', 'Track', 'Docs', 'Code'].map((p) => (
          <NavItem key={p} disabled title="Wired in a later increment">
            {p}
          </NavItem>
        ))}
      </Group>
      <Group label="System">
        <NavItem disabled title="Wired in a later increment">
          Admin
        </NavItem>
      </Group>
    </nav>
  )
}

function AppShell() {
  const { pathname } = useLocation()
  const title = pathname === '/specimen' ? 'Specimen' : 'Overview'
  return (
    <Shell
      sidebar={<Sidebar />}
      nav={
        <>
          <div className="text-head text-ink">{title}</div>
          <ThemeToggle />
        </>
      }
    >
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/specimen" element={<Specimen />} />
      </Routes>
    </Shell>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
