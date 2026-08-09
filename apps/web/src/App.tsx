import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  matchRoutes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { Mark, NavItem, Shell, ThemeToggle } from '@talyvor/ui'
import { AuthGate, SessionChip } from './components/AuthGate'
import { ApiError } from './lib/api'
import { Overview } from './areas/lens/Overview'
import { Ledger } from './areas/lens/Ledger'
import { Keys } from './areas/lens/Keys'
import { Setup } from './areas/lens/Setup'
import { Spend } from './areas/lens/Spend'
import { Members } from './areas/lens/Members'
import { Settings } from './areas/lens/Sharing'
import { TopUp } from './areas/lens/TopUp'
import { BillingCancel, BillingSuccess } from './areas/lens/BillingReturn'
import { TrackArea } from './areas/track/TrackArea'
import { DocsArea } from './areas/docs/DocsArea'
import { Landing } from './areas/marketing/Landing'
import { Privacy } from './routes/Privacy'
import { Terms } from './routes/Terms'
import { SignIn, SignUp } from './areas/auth/Entry'
import { SessionExpiredBar } from './components/SessionExpiredBar'

// App.tsx is a SHARED file (see README §Directory ownership): it owns routing
// and the nav for every area. Area work happens inside src/areas/<area>/ —
// changing THIS file requires its own PR, because five parallel tracks depend
// on it not moving under them.

// Exported as a test seam: route-level tests need to clear cached probes between cases so one
// test's /auth/me answer cannot be read as the next one's.
export const queryClient: QueryClient = new QueryClient({
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
      <div className="px-3 pb-1 font-figure text-eyebrow font-semibold uppercase text-faint">{label}</div>
      {children}
    </div>
  )
}

/**
 * THE CONSOLE'S PAGES — ONE TABLE, because two tables that must agree do not.
 *
 * ⚠ WHAT THIS REPLACED, MEASURED AT `c9e1e8a` WITH EVERY GATE GREEN. The route list and a
 * separate `titleFor()` each held their own copy of the paths, and they disagreed on every
 * address that has no page:
 *   · `titleFor` ended `exact[pathname] ?? 'Overview'`, so /admin — the retired operator
 *     console someone still has bookmarked — rendered the header "Overview" above the body
 *     "Nothing at this address". The sidebar highlighted nothing, so the ONLY name on the
 *     screen was the wrong one.
 *   · the three prefix rules over-matched by a character: /billingx titled "Billing",
 *     /trackers "Track", /docs-old "Docs", each of them routed to the catch-all.
 * Eight addresses measured, eight titled as a page they were not. ConsoleTitle.test.tsx drives
 * the real `<App />` to each one and reads the banner, so the assertion survives this table
 * being replaced again.
 *
 * The title now travels WITH the route, so a new page cannot be added without naming itself,
 * and `matchRoutes` answers "which page is this" with the same matcher `<Routes>` uses —
 * `startsWith` was never that matcher, which is the whole defect above.
 */
export const NOT_FOUND_TITLE = 'Not found'

export interface ConsoleRoute {
  /** Exactly the string `<Route path>` receives — splats included, so the two cannot drift. */
  path: string
  /** What the sticky top bar says while this route is matched. */
  title: string
  element: React.ReactElement
}

export const CONSOLE_ROUTES: readonly ConsoleRoute[] = [
  { path: '/', title: 'Overview', element: <Overview /> },
  { path: '/ledger', title: 'Ledger', element: <Ledger /> },
  // THESE TWO PATHS ARE NOT OURS TO CHOOSE. Lens's Stripe redirect targets already default to
  // app.talyvor.com/billing/success?session_id={CHECKOUT_SESSION_ID} and /billing/cancel — the
  // design assumed the suite owned them. A customer arrives here by full page load from Stripe,
  // so both must resolve on a cold navigation, not only in-app. They title as Billing because
  // that is the page the customer is on, not as Overview.
  { path: '/billing', title: 'Billing', element: <TopUp /> },
  { path: '/billing/success', title: 'Billing', element: <BillingSuccess /> },
  { path: '/billing/cancel', title: 'Billing', element: <BillingCancel /> },
  { path: '/keys', title: 'API keys', element: <Keys /> },
  { path: '/setup', title: 'Setup', element: <Setup /> },
  { path: '/spend', title: 'Spend & routing', element: <Spend /> },
  { path: '/members', title: 'Members', element: <Members /> },
  { path: '/settings', title: 'Settings', element: <Settings /> },
  { path: '/track/*', title: 'Track', element: <TrackArea /> },
  { path: '/docs/*', title: 'Docs', element: <DocsArea /> },
]

// Built once: matchRoutes only needs the paths, and rebuilding this per render would allocate
// a table on every navigation for an answer that cannot change.
const TITLE_MATCHERS = CONSOLE_ROUTES.map(({ path }) => ({ path }))

function titleFor(pathname: string): string {
  const matches = matchRoutes(TITLE_MATCHERS, pathname)
  const matched = matches?.[matches.length - 1]?.route.path
  return CONSOLE_ROUTES.find((r) => r.path === matched)?.title ?? NOT_FOUND_TITLE
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
        {/* Setup sits beside Keys because minting a key and being told what to do with it
            are one task; a trial user who finds only Keys is stuck holding a credential. */}
        {item('/setup', 'Setup')}
        {item('/keys', 'API keys')}
        {item('/spend', 'Spend & routing')}
        {item('/members', 'Members')}
        {item('/settings', 'Settings')}
      </Group>
      <Group label="Products">
        {item('/track', 'Track', true)}
        {/* Docs is BACK. It left the nav because it served one PINNED workspace shared by every
            signed-in person; it now takes the SESSION's workspace, the same way Track does, so the
            condition written into the removal comment has been met rather than waived. See
            apps/bff docsWorkspaceFor and the Track↔Docs enumeration that broke the cold-start
            deadlock (talyvor-track bf60842, talyvor-docs c970329). */}
        {item('/docs', 'Docs', true)}
      </Group>
      {/* The "Operator" group held one item, /admin, and is gone with it: an operator
          console whose five screens were entirely fabricated (invented node ids, IPs,
          certificate fingerprints, a Let's Encrypt issuer string) with no BFF route and no
          path to real data in this deployment. A fixture badge cannot carry that content —
          a cert expiring in 17 days is not a placeholder to whoever is reading it.

          /specimen (the design-system gallery) is GONE — route and component both. Unlinked
          was not the same as unreachable: a trial user given the URL, or one guessing it, got
          an internal work-in-progress component sheet. "Reviews open it by URL" was a reason to
          keep it in git history, which deleting does, not to serve it to customers. Pinned by
          FirstRunGaps.test.tsx. */}

      {/* ── THE POLICIES, AND WHY HERE ────────────────────────────────────────────────
          Both routes have always resolved, and until now nothing inside the app linked to
          them: they appeared on the marketing page, the sign-in card and the consent screen —
          three surfaces a signed-in person has already passed and does not return to. So the
          moment someone wanted to check what we do with their data, the answer was "type the
          URL", which is unreachable for anyone who does not already know it.

          NOT A PAGE FOOTER. A footer sits below the content, and this app's content-heavy
          routes (Ledger, Spend) scroll — so on exactly the pages where a person is looking at
          their data and thinks to ask, the footer is permanently below the fold. The sidebar
          is `sticky top-0`, which makes this reachable from any route without scrolling. It
          also avoids adding a region to the shared Shell in packages/ui for two links.

          NOT THE SETTINGS PAGE. Settings is where you look for YOUR settings; a person hunting
          for OUR policies has no reason to expect them there, and it costs a click and a guess.
          Fine as a second home, wrong as the only one.

          NOT A NAV ITEM. Rendered as small muted text rather than NavItem, below the product
          groups and after a rule: these are not destinations you visit in the course of work,
          and styling them like Overview or Keys would overstate them. Findable without being
          prominent is the whole requirement for a legal surface.

          Link, not <a href>: same-tab client-side navigation, and it keeps a real href so the
          link is a link to assistive tech and to a middle-click. */}
      <div className="mt-auto border-t border-rule px-3 pt-3 text-caption text-faint">
        <Link className="underline transition-colors duration-200 hover:text-muted" to="/privacy">
          Privacy
        </Link>
        {' · '}
        <Link className="underline transition-colors duration-200 hover:text-muted" to="/terms">
          Terms
        </Link>
      </div>
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
      {/* ABOVE THE CONTENT, ON EVERY ROUTE. When the workspace credential dies, every panel
          below is empty for one reason; this says it once. Renders nothing when nothing is
          refused, so it costs an unbroken app a null. */}
      <SessionExpiredBar />
      <Routes>
        {/* EVERY ROUTE COMES FROM CONSOLE_ROUTES, which is also what titles the header. A page
            declared here and nowhere else would be a page the top bar cannot name — that was
            the state this table replaced. */}
        {CONSOLE_ROUTES.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
        {/* A catch-all, added when /admin was removed. Before it, an unmatched in-app path
            rendered the shell with an EMPTY content area and no explanation — so an
            operator's /admin bookmark would have shown a blank page. A silent blank is the
            same failure class as an invented number: the page says nothing true about what
            happened. This covers every mistyped or retired path, not just that one.
            ⚠ It is NOT in CONSOLE_ROUTES: it is the absence of a page, and putting it there
            would make "no page" a page with a name, which is the lie this replaced. */}
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
          {/* Legal pages are public for the same reason: someone deciding whether to sign up must
              be able to read what the service does with their data BEFORE creating an account.
              Putting these behind the gate would mean you had to agree in order to read. */}
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          {/* The two front doors, also OUTSIDE the gate — a signup page you must already be
              signed in to read is not a signup page. Same mechanism (/auth/login), different
              words: see areas/auth/Entry.tsx. */}
          <Route path="/signup" element={<SignUp />} />
          <Route path="/signin" element={<SignIn />} />
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
