import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Mark, NavItem, Shell, ThemeToggle } from '@talyvor/ui'
import { AuthGate, SessionChip } from './components/AuthGate'
import { ApiError } from './lib/api'
import { Overview } from './areas/lens/Overview'
import { Ledger } from './areas/lens/Ledger'
import { Keys } from './areas/lens/Keys'
import { Spend } from './areas/lens/Spend'
import { Members } from './areas/lens/Members'
import { TopUp } from './areas/lens/TopUp'
import { BillingCancel, BillingSuccess } from './areas/lens/BillingReturn'
import { TrackArea } from './areas/track/TrackArea'
import { DocsArea } from './areas/docs/DocsArea'
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
  // /billing, /billing/success, /billing/cancel — the last two are where Stripe
  // returns a customer, so they must title as Billing too, not fall to Overview.
  if (pathname.startsWith('/billing')) return 'Billing'
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
      {/* The corner carries a MARK, not only text: the hold indicator abstracted
          (rounded hairline tile, accent fill) beside the wordmark, both themes free
          via tokens. */}
      <div className="flex items-center gap-2.5 px-3 pb-1 pt-2">
        <Mark size={26} />
        <div className="min-w-0">
          <div className="text-head leading-tight text-ink">Talyvor</div>
          <div className="text-caption font-normal leading-tight text-faint">Suite</div>
        </div>
      </div>
      <Group label="Workspace">
        {item('/', 'Overview')}
        {item('/ledger', 'Ledger')}
        {/* Buying LXC has to be findable, not a URL you have to be told. The
            wildcard keeps it highlighted on the Stripe return pages too. */}
        {item('/billing', 'Billing', true)}
        {item('/keys', 'API keys')}
        {item('/spend', 'Spend & routing')}
        {item('/members', 'Members')}
      </Group>
      <Group label="Products">
        {item('/track', 'Track', true)}
        {item('/docs', 'Docs', true)}
      </Group>
      {/* The "Operator" group held one item, /admin, and is gone with it: an operator
          console whose five screens were entirely fabricated (invented node ids, IPs,
          certificate fingerprints, a Let's Encrypt issuer string) with no BFF route and no
          path to real data in this deployment. A fixture badge cannot carry that content —
          a cert expiring in 17 days is not a placeholder to whoever is reading it.

          /specimen (the design-system gallery) is deliberately NOT in the nav either: it is
          an internal review tool, and a trial user clicking it sees a work-in-progress page.
          Its ROUTE stays (see <Routes>) — reviews open it by URL; unlinked, it costs
          nothing. Don't re-add the item. */}
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
        {/* THESE TWO PATHS ARE NOT OURS TO CHOOSE. Lens's Stripe redirect
            targets already default to app.talyvor.com/billing/success?session_id=
            {'{CHECKOUT_SESSION_ID}'} and /billing/cancel — the design assumed the
            suite owned them. A customer arrives here by full page load from
            Stripe, so both must resolve on a cold navigation, not only in-app. */}
        <Route path="/billing" element={<TopUp />} />
        <Route path="/billing/success" element={<BillingSuccess />} />
        <Route path="/billing/cancel" element={<BillingCancel />} />
        <Route path="/keys" element={<Keys />} />
        <Route path="/spend" element={<Spend />} />
        <Route path="/members" element={<Members />} />
        <Route path="/track/*" element={<TrackArea />} />
        <Route path="/docs/*" element={<DocsArea />} />
        <Route path="/specimen" element={<Specimen />} />
        {/* A catch-all, added when /admin was removed. Before it, an unmatched in-app path
            rendered the shell with an EMPTY content area and no explanation — so an
            operator's /admin bookmark would have shown a blank page. A silent blank is the
            same failure class as an invented number: the page says nothing true about what
            happened. This covers every mistyped or retired path, not just that one. */}
        <Route
          path="*"
          element={
            <div className="mx-auto max-w-3xl px-gutter py-4 text-body text-muted">
              Nothing at this address — pick a section from the sidebar.
            </div>
          }
        />
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
