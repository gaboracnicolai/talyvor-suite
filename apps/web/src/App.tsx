import { useLayoutEffect } from 'react'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  matchRoutes,
  useHref,
  useLinkClickHandler,
  useLocation,
  useNavigationType,
} from 'react-router-dom'
import { Mark, NavItem, Shell, ThemeToggle } from '@talyvor/ui'
import { AuthGate, SessionChip } from './components/AuthGate'
import { useDocumentTitle } from './documentTitle'
import { ApiError } from './lib/api'
import { Overview } from './areas/lens/Overview'
import { Ledger } from './areas/lens/Ledger'
import { Earnings } from './areas/lens/Earnings'
import { Keys } from './areas/lens/Keys'
import { Setup } from './areas/lens/Setup'
import { Spend } from './areas/lens/Spend'
import { Members } from './areas/lens/Members'
import { Settings } from './areas/lens/Sharing'
import { TopUp } from './areas/lens/TopUp'
import { BillingCancel, BillingSuccess } from './areas/lens/BillingReturn'
import { Chat } from './areas/chat/Chat'
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
  // W4.6.1 step 7 — the earnings screen. It sits beside the Ledger because they answer adjacent
  // questions off the SAME ledger table, and deliberately is NOT a panel on Overview: the field
  // Overview would have reached for, lifetime_earned, is lifetime CREDITED (talyvor-lens #472),
  // and putting an honest earnings figure next to a misleading one invites a reader to average
  // them.
  { path: '/earnings', title: 'Earnings', element: <Earnings /> },
  // W4.6.1 step 6 — the chat screen. It sits directly under Overview because it is the first
  // surface a subscriber uses, not an administrative one.
  { path: '/chat', title: 'Chat', element: <Chat /> },
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

/**
 * ⚠ A DESTINATION, NOT A COMMAND — AND THE RULE IS THE ONE THIS FILE ALREADY STATES BELOW FOR
 * PRIVACY AND TERMS. These ten rows were `<NavItem onClick={() => navigate(to)}>`: `<button>`s
 * with no `href`. MEASURED by driving the real app to all twelve gated addresses and clicking
 * every button on the page from a freshly mounted app — 9 or 10 of them changed the address, and
 * not one carried an href. So on every screen behind the gate, the whole product was unreachable
 * by cmd-click, by middle click (which raises `auxclick`, never `click`), by the context menu's
 * "Open link in new tab" or "Copy link address", and by a screen reader's links list, which held
 * Privacy and Terms and nothing else. See ConsoleNavLinks.test.tsx.
 *
 * ⚠ NOT `<Link>` WEARING THE ROW'S CLASSES, AND NOT A HAND-ROLLED MODIFIER CHECK. The row's
 * `truncate` span has to survive (240px sidebar), which rules out cloning the caller's element,
 * and "which clicks belong to the browser" is a rule react-router already owns. `useHref` +
 * `useLinkClickHandler` are exactly what `Link` itself is built from: the handler preventDefaults
 * and routes a plain left click, and returns untouched on a modified one, so the browser opens
 * the new tab it was asked for.
 */
function NavDestination({
  to,
  label,
  wildcard = false,
}: {
  to: string
  label: string
  wildcard?: boolean
}) {
  const { pathname } = useLocation()
  const href = useHref(to)
  const onClick = useLinkClickHandler<HTMLAnchorElement>(to)
  return (
    <NavItem
      active={wildcard ? pathname.startsWith(to) : pathname === to}
      href={href}
      onClick={onClick}
    >
      {label}
    </NavItem>
  )
}

function Sidebar() {
  const item = (to: string, label: string, wildcard = false) => (
    <NavDestination to={to} label={label} wildcard={wildcard} />
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
        {item('/earnings', 'Earnings')}
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
  // ONE expression, two consumers: the banner paints it and the browser tab is told it. They
  // cannot drift into naming different pages because there is nothing to drift between —
  // documentTitle.test.tsx asserts the tab's page half IS the banner's string, at every address.
  const page = titleFor(pathname)
  useDocumentTitle(page)
  return (
    <Shell
      sidebar={<Sidebar />}
      nav={
        <>
          {/* THE ONE HEADING ON A GATED SCREEN. This element already named the page; it was a
              `<div>`, so a probe over all twelve CONSOLE_ROUTES addresses counted ZERO heading
              elements in the rendered DOM at every one of them — nothing behind the gate could be
              reached with the H key or listed in a headings rotor. It is the same computed `page`
              the tab title takes, so the browser tab, the visible title and the heading are one
              answer rather than three that agree today. MEASURED ZERO-PIXEL out of the built
              stylesheet: the shipped sheet's only rules naming h1 are preflight's
              `h1,…,h6{font-size:inherit;font-weight:inherit}` and `…,h1,…{margin:0}`, and
              `.text-head` supplies 17px/600 either way. ConsoleHeading.test.tsx pins the name at
              every address. */}
          <h1 className="min-w-0 truncate text-head text-ink">{page}</h1>
          <div className="flex min-w-0 items-center gap-3">
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

/**
 * ⚠ THE ONE THING A REAL NAVIGATION DID FOR FREE, AND CLIENT-SIDE ROUTING DOES NOT.
 *
 * A browser puts a newly loaded document at the top. Replacing page loads with in-app
 * navigation replaced that too, with nothing: the scroll offset of the page you left was
 * carried into the page you asked for. MEASURED IN CHROME ON THE BUILT ARTIFACT, the same
 * pair of pages from the same offset, differing only in how the navigation was made:
 *
 *     /terms at y=900  --full page load-->    /privacy   y = 0
 *     /terms at y=900  --click the link-->    /privacy   y = 900   (its maximum is 1881, so
 *                                                                   900 was carried, not clamped)
 *
 * and from the tallest gated address, /setup at its bottom, both /settings and /privacy opened
 * at their LAST line. See scrollReset.test.tsx for the full rows.
 *
 * ⚠ ON PUSH AND REPLACE ONLY — POP IS THE BROWSER'S AND IT ALREADY DOES IT RIGHT.
 * `history.scrollRestoration` is `auto` and, measured in the same session, back and forward
 * restore the offsets of these client-side entries exactly (900 and 300). A scroll-to-top on
 * every location change would break the half that works: the back button would drop a reader
 * at the top of a page they had read most of. A first mount is a POP too, so a deep link and a
 * reload are left alone as well.
 *
 * Layout effect, not effect: the reset happens before paint, so there is no frame in which the
 * new page is shown scrolled. `theme.css` never sets `scroll-behavior: smooth`, so this is an
 * instant jump rather than an animation the reader watches.
 */
function ScrollToTopOnPush() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  useLayoutEffect(() => {
    if (navigationType === 'POP') return
    window.scrollTo(0, 0)
  }, [pathname, navigationType])
  return null
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* ABOVE `<Routes>`, NOT INSIDE THE CONSOLE'S SHELL. The legal pages, the two front
            doors and the marketing landing are siblings of the gate, not children of it — a
            reset mounted in `AppShell` would be correct on all twelve gated addresses and
            absent from every page a stranger sees. */}
        <ScrollToTopOnPush />
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
