import { useId, useLayoutEffect } from 'react'
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
import {
  Mark,
  NavIcon,
  NavItem,
  Shell,
  ThemeToggle,
  Wordmark,
  cn,
  focusRing,
  inlineLink,
  type NavIconName,
} from '@talyvor/ui'
import { AuthGate, SessionChip } from './components/AuthGate'
import { useDocumentTitle } from './documentTitle'
import { ApiError, UnreadableError } from './lib/api'
import { Overview } from './areas/lens/Overview'
import { Home } from './areas/lens/Home'
import { Ledger } from './areas/lens/Ledger'
import { Earnings, EarningsMoved } from './areas/lens/Earnings'
import { Keys } from './areas/lens/Keys'
import { Setup } from './areas/lens/Setup'
import { Spend } from './areas/lens/Spend'
import { Members } from './areas/lens/Members'
import { Settings } from './areas/lens/Sharing'
import { Features } from './areas/lens/Features'
import { AgentBank } from './areas/lens/AgentBank'
import { ApprovalsScreen, StatementsScreen, usePendingApprovals } from './areas/lens/WalletScreens'
import { MarketplaceArea } from './areas/marketplace/Marketplace'
import { TryConversion, TryTare } from './areas/lens/TryIt'
import { TopUp } from './areas/lens/TopUp'
import { Plans } from './areas/lens/Plans'
import { BillingCancel, BillingSuccess } from './areas/lens/BillingReturn'
import { Chat } from './areas/chat/Chat'
import { ChatHelp } from './areas/chat/ChatHelp'
import { CompareModels } from './areas/chat/CompareModels'
import { ConnectorsPage } from './areas/chat/ConnectorsPage'
import { InstructionsPage } from './areas/chat/InstructionsPage'
import { PromptsPage } from './areas/chat/PromptsPage'
import { ScheduledPage } from './areas/chat/ScheduledPage'
import { MemoryPage } from './areas/chat/MemoryPage'
import { RoomsArea } from './areas/rooms/Rooms'
import { TrackArea } from './areas/track/TrackArea'
import { PublicBoard } from './areas/board/PublicBoard'
import { SharedChat } from './areas/share/SharedChat'
import { DocsArea } from './areas/docs/DocsArea'
import { OperatorWorkspaces } from './areas/lens/OperatorWorkspaces'
import { Landing } from './areas/marketing/Landing'
import { Pricing } from './areas/marketing/Pricing'
import { Documentation } from './areas/documentation/Documentation'
import { DOCUMENTATION_PATH } from './areas/documentation/content'
import { Privacy } from './routes/Privacy'
import { Terms } from './routes/Terms'
import { SignIn, SignUp } from './areas/auth/Entry'
import { SessionExpiredBar } from './components/SessionExpiredBar'
import { ScreenBoundary } from './components/ScreenBoundary'
import { type DocRef, pageHref, useDocsNav } from './areas/docs/docsNav'
import { useAuthMeReader } from './lib/authMe'
import { useSidebarFold } from './sidebarFold'

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
      // A 401 or 403 is a verdict, not a flake — retrying it just delays the gate or the refusal.
      // So is an answer that arrived and cannot be read (B27.12): asking again a second later gets
      // the same body, and the screen's own "try again" is the person's to press.
      retry: (failureCount, error) =>
        failureCount < 1 &&
        !(error instanceof UnreadableError) &&
        !(error instanceof ApiError && (error.status === 401 || error.status === 403)),
    },
  },
})

/**
 * B24.1 — which group holds which addresses, so the group holding the current page opens on load.
 * A path owns itself and everything below it; `/` owns only itself.
 */
const GROUP_PATHS: Record<string, readonly string[]> = {
  Marketplace: ['/marketplace'],
  Work: ['/track', '/docs'],
  Developers: ['/setup', '/keys', '/spend', '/features'],
  Billing: ['/billing', '/plans', '/overview', '/ledger', '/pricing'],
  Settings: ['/settings', '/members'],
  Operator: ['/operator'],
}
const GROUPS = Object.keys(GROUP_PATHS)

function groupOf(pathname: string): string | undefined {
  return GROUPS.find((g) =>
    GROUP_PATHS[g].some((p) => pathname === p || (p !== '/' && pathname.startsWith(`${p}/`))),
  )
}

/**
 * A group title is a real <button> that opens and closes its links; folded, the links are not
 * rendered at all, so nothing hidden can be tabbed to or read out.
 */
function Group({
  label,
  open,
  onToggle,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const regionId = useId()
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
        className={cn(
          'flex items-center justify-between gap-2 rounded-control px-3 pb-1.5 pt-1 text-left transition-colors duration-200 hover:text-ink',
          'font-figure text-eyebrow uppercase text-label',
          focusRing,
        )}
      >
        {label}
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={cn('h-3 w-3 shrink-0 transition-transform duration-200', !open && '-rotate-90')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 4.5 6 7.5l3-3" />
        </svg>
      </button>
      <div id={regionId} hidden={!open} className={open ? 'flex flex-col gap-0.5' : undefined}>
        {open ? children : null}
      </div>
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
  // B28.6 — the first screen after sign-in is the wallet home: total balance, credit not yet given to
  // agents, each agent's budget used, approvals waiting, the month forecast and pause-all. Overview —
  // what the workspace has, spends and earns across both tokens — moved one address over, unchanged.
  { path: '/', title: 'Home', element: <Home /> },
  // B28.7 — the wallet's own destinations, first in the sidebar after Home.
  { path: '/approvals', title: 'Approvals', element: <ApprovalsScreen /> },
  { path: '/statements', title: 'Statements', element: <StatementsScreen /> },
  { path: '/overview', title: 'Overview', element: <Overview /> },
  { path: '/ledger', title: 'Ledger', element: <Ledger /> },
  // W4.6.1 step 7 — the earnings screen. It sits beside the Ledger because they answer adjacent
  // questions off the SAME ledger table, and deliberately is NOT a panel on Overview: the field
  // Overview would have reached for, lifetime_earned, is lifetime CREDITED (talyvor-lens #472),
  // and putting an honest earnings figure next to a misleading one invites a reader to average
  // them.
  //
  // B28.10 — it is "Royalties" now, under Statements: a royalty on a shared answer is a side effect
  // of a cost saving, not the product's revenue, so it sits beside the agents' statements and
  // carries the LENS→LXC conversion. The old /earnings address redirects here (below the table).
  { path: '/statements/royalties', title: 'Royalties', element: <Earnings /> },
  // W4.6.1 step 6 — the chat screen. It sits directly under Overview because it is the first
  // surface a subscriber uses, not an administrative one.
  { path: '/chat', title: 'Chat', element: <Chat /> },
  // B10.3 — the chat carries no instructions; they live here, linked from its rail.
  { path: '/chat/help', title: 'How to use Talyvor Chat', element: <ChatHelp /> },
  // B28.369 — one question to three models at once, side by side, each answer priced. Linked from Chat's rail.
  { path: '/chat/compare', title: 'Compare models', element: <CompareModels /> },
  // B28.115 — custom instructions, sent with every question in every chat. Linked from Chat's rail.
  { path: '/chat/instructions', title: 'Custom instructions', element: <InstructionsPage /> },
  // B28.370 — the prompt library: the workspace's named prompts in Lens, used in any chat by name. Linked from Chat's rail.
  { path: '/chat/prompts', title: 'Prompt library', element: <PromptsPage /> },
  // B28.377 — prompts scheduled with /schedule, each asked on an agent's wallet, and their answers. Linked from Chat's rail.
  { path: '/chat/scheduled', title: 'Scheduled prompts', element: <ScheduledPage /> },
  // B28.371 — memory: what Chat remembers about the person, opt-in, every fact listed and deleted. Linked from Chat's rail.
  { path: '/chat/memory', title: 'Memory', element: <MemoryPage /> },
  // B28.122 — connectors: the person's own MCP servers, whose tools Chat offers beside Talyvor's. Linked from Chat's rail.
  { path: '/chat/connectors', title: 'Connectors', element: <ConnectorsPage /> },
  // B32.53 — rooms: open chats other workspaces join, the directory and a new room. Chat's rail lists them too.
  { path: '/rooms/*', title: 'Rooms', element: <RoomsArea /> },
  // THESE TWO PATHS ARE NOT OURS TO CHOOSE. Lens's Stripe redirect targets already default to
  // app.talyvor.com/billing/success?session_id={CHECKOUT_SESSION_ID} and /billing/cancel — the
  // design assumed the suite owned them. A customer arrives here by full page load from Stripe,
  // so both must resolve on a cold navigation, not only in-app. They title as Billing because
  // that is the page the customer is on, not as Overview.
  { path: '/billing', title: 'Billing', element: <TopUp /> },
  // B13.3 — Plus · Pro · Max, the usage meter and what a subscriber's answers earned.
  { path: '/plans', title: 'Plans', element: <Plans /> },
  { path: '/billing/success', title: 'Billing', element: <BillingSuccess /> },
  { path: '/billing/cancel', title: 'Billing', element: <BillingCancel /> },
  { path: '/keys', title: 'API keys', element: <Keys /> },
  // B19.4 — each AI agent's own wallet: balance, rules, statement, payments and approvals. B21.6: Agent Wallets.
  { path: '/agents', title: 'Agent Wallets', element: <AgentBank /> },
  // B20.3 — browse, use and publish agents, prompts, skills, evaluations and pipelines; what they earned.
  { path: '/marketplace/*', title: 'Marketplace', element: <MarketplaceArea /> },
  { path: '/setup', title: 'Setup', element: <Setup /> },
  { path: '/spend', title: 'Spend & routing', element: <Spend /> },
  { path: '/members', title: 'Members', element: <Members /> },
  { path: '/settings', title: 'Settings', element: <Settings /> },
  // B8.2 — every capability, what it does and costs, whether it is on, and its switch.
  { path: '/features', title: 'Features', element: <Features /> },
  // B11.3 — run Tare or document conversion on your own input: no model call, no charge.
  { path: '/features/try/tare', title: 'Try Tare', element: <TryTare /> },
  { path: '/features/try/conversion', title: 'Try document conversion', element: <TryConversion /> },
  { path: '/track/*', title: 'Track', element: <TrackArea /> },
  { path: '/docs/*', title: 'Docs', element: <DocsArea /> },
  // B18.25 — every workspace's spend, held LENS and last activity; the BFF answers only OPERATOR_SUBS.
  { path: '/operator', title: 'Operator', element: <OperatorWorkspaces /> },
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
  icon,
  wildcard = false,
  active,
  badge,
  className,
}: {
  to: string
  label: string
  /** B29.7 — the row's 20px line icon. */
  icon: NavIconName
  wildcard?: boolean
  /** Overrides the exact/prefix rule where a row shares its prefix with a sibling row. */
  active?: boolean
  /** B28.7 — a count beside the label (approvals waiting); nothing is drawn at zero or while unknown. */
  badge?: number | null
  className?: string
}) {
  const { pathname } = useLocation()
  const href = useHref(to)
  const onClick = useLinkClickHandler<HTMLAnchorElement>(to)
  return (
    <NavItem
      active={active ?? (wildcard ? pathname.startsWith(to) : pathname === to)}
      href={href}
      onClick={onClick}
      icon={<NavIcon name={icon} />}
      className={className}
    >
      {label}
      {badge ? (
        <span className="ml-2 rounded-pill border border-rule bg-surface px-1.5 font-figure text-caption text-ink">
          {badge}
          <span className="sr-only"> waiting</span>
        </span>
      ) : null}
    </NavItem>
  )
}

function Sidebar() {
  const { pathname } = useLocation()
  const me = useAuthMeReader()
  const pending = usePendingApprovals()
  const item = (
    to: string,
    label: string,
    icon: NavIconName,
    opts: { wildcard?: boolean; active?: boolean; badge?: number | null; indent?: boolean } = {},
  ) => (
    <NavDestination
      to={to}
      label={label}
      icon={icon}
      wildcard={opts.wildcard}
      active={opts.active}
      badge={opts.badge}
      className={opts.indent ? 'pl-8' : undefined}
    />
  )
  // B10.6 — Docs lists the pages a person PINNED and the last five they OPENED, never every page
  // (at fifty it was unusable); every page is one click away on "All documents". B8.1's reason for
  // naming things here stands: a page is one click from anywhere once it is pinned or recent.
  const docsNav = useDocsNav()
  // B24.1 — every group folds to its title; the one holding this page starts open.
  const fold = useSidebarFold(
    me.data?.operator ? GROUPS : GROUPS.filter((g) => g !== 'Operator'),
    groupOf(pathname),
  )
  const docsListed = [...docsNav.pinned, ...docsNav.recent]
  const onTrackIssues = pathname === '/track' || pathname.startsWith('/track/issues')
  const onDocsIndex = pathname.startsWith('/docs') && !docsListed.some((d) => pathname === pageHref(d))
  const docLink = (d: DocRef) => (
    <NavDestination
      key={`${d.spaceId}/${d.pageId}`}
      to={pageHref(d)}
      label={d.title}
      icon="page"
      active={pathname === pageHref(d)}
      className="pl-8"
    />
  )
  return (
    <nav className="flex flex-col gap-5 pb-2" aria-label="Sections">
      {/* The corner carries the brand-v4 mark and wordmark, both drawn SVG and themed by
          tokens. The mark is decorative beside the wordmark, which names the product once;
          the product label under it stays text, as an eyebrow. */}
      <div className="flex items-center gap-2.5 px-3 pb-2 pt-3">
        <Mark size={28} aria-hidden />
        <div className="shrink-0">
          <Wordmark height={13} />
          <div className="mt-1 text-eyebrow uppercase leading-tight text-label">Suite</div>
        </div>
        {/* An icon beside the wordmark, so the corner holds the board's mark and name without the two
            words crowding them; its name is the text a screen reader and a pointer's tooltip read. */}
        <button
          type="button"
          onClick={fold.toggleAll}
          title={fold.anyOpen ? 'Fold all' : 'Open all'}
          className={cn(
            'ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-200 hover:text-ink',
            focusRing,
          )}
        >
          <NavIcon name={fold.anyOpen ? 'fold' : 'unfold'} />
          <span className="sr-only">{fold.anyOpen ? 'Fold all' : 'Open all'}</span>
        </button>
      </div>
      {/* B28.7 — WALLET-FIRST. The product is agent wallets, so the wallet's own screens lead and never
          fold away: the home, what is waiting for a person, the agents and their statements, then Chat.
          Everything else is grouped below them, in the order a person reaches for it. */}
      <div className="flex flex-col gap-0.5">
        {item('/', 'Home', 'home')}
        {item('/approvals', 'Approvals', 'approvals', { badge: pending })}
        {/* The label is the page's title, so the row and the heading it opens are one name. */}
        {item('/agents', 'Agent Wallets', 'wallet')}
        {item('/statements', 'Statements', 'statement')}
        {item('/statements/royalties', 'Royalties', 'coins', { indent: true })}
        {item('/chat', 'Chat', 'chat', { wildcard: true })}
        {item('/rooms', 'Rooms', 'members', { indent: true, wildcard: true })}
      </div>
      <Group label="Marketplace" {...fold.group('Marketplace')}>
        {item('/marketplace', 'Browse', 'grid', {
          active: pathname === '/marketplace' || pathname.startsWith('/marketplace/listings'),
        })}
        {item('/marketplace/publish', 'Publish', 'upload')}
        {item('/marketplace/selling', 'Your listings & earnings', 'tag')}
        {item('/marketplace/licences', 'Your licences', 'key')}
        {item('/marketplace/bill', 'Your bill', 'receipt')}
        {/* B20.12 — offered only to someone the BFF's operator gate will admit. */}
        {me.data?.operator ? item('/marketplace/review', 'Review queue', 'prove') : null}
      </Group>
      {/* Docs is BACK. It left the nav because it served one PINNED workspace shared by every
          signed-in person; it now takes the SESSION's workspace, the same way Track does, so the
          condition written into the removal comment has been met rather than waived. See
          apps/bff docsWorkspaceFor and the Track↔Docs enumeration that broke the cold-start
          deadlock (talyvor-track bf60842, talyvor-docs c970329). */}
      <Group label="Work" {...fold.group('Work')}>
        {item('/track', 'Track', 'issues', { active: onTrackIssues })}
        {item('/track/board', 'Board', 'board', { indent: true })}
        {item('/track/cycles', 'Cycles', 'cycle', { indent: true })}
        {item('/track/projects', 'Projects', 'folder', { indent: true })}
        {item('/docs', 'Docs', 'docs', { active: onDocsIndex })}
        {docsNav.pinned.length > 0 ? (
          <>
            <p className="pl-8 pr-3 pt-1 text-caption text-faint">Pinned</p>
            {docsNav.pinned.map(docLink)}
          </>
        ) : null}
        {docsNav.recent.length > 0 ? (
          <>
            <p className="pl-8 pr-3 pt-1 text-caption text-faint">Recent</p>
            {docsNav.recent.map(docLink)}
          </>
        ) : null}
      </Group>
      <Group label="Developers" {...fold.group('Developers')}>
        {/* Connecting an agent sits beside Keys because minting a key and being told what to do with
            it are one task; a trial user who finds only Keys is stuck holding a credential. */}
        {item('/setup', 'Connect an agent', 'plug')}
        {item('/keys', 'API keys', 'key')}
        {item('/spend', 'Spend & routing', 'route')}
        {item('/features', 'Gateway features', 'sliders')}
      </Group>
      <Group label="Billing" {...fold.group('Billing')}>
        {/* Buying LXC has to be findable, not a URL you have to be told. The
            wildcard keeps it highlighted on the Stripe return pages too. */}
        {item('/billing', 'Plan & top up', 'card', { wildcard: true })}
        {item('/plans', 'Plans', 'layers')}
        {item('/overview', 'Overview', 'chart')}
        {item('/ledger', 'Ledger', 'ledger')}
        {/* The public price list (B5.2). It opens outside the console, as a buyer sees it. */}
        {item('/pricing', 'Pricing', 'price')}
      </Group>
      <Group label="Settings" {...fold.group('Settings')}>
        {item('/settings', 'Settings', 'settings')}
        {item('/members', 'Members', 'members')}
      </Group>
      {/* B18.25 — offered only to someone the BFF's operator gate will admit. */}
      {me.data?.operator ? (
        <Group label="Operator" {...fold.group('Operator')}>
          {item('/operator', 'Workspaces', 'server')}
        </Group>
      ) : null}
      {/* The first "Operator" group held one item, /admin, and went with it: an operator
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
        <Link className={inlineLink} to="/privacy">
          Privacy
        </Link>
        {' · '}
        <Link className={inlineLink} to="/terms">
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
              `.text-bar` supplies 20px/500 either way (B29.7). ConsoleHeading.test.tsx pins the name at
              every address.
              B28.267 — it wraps rather than ellipsises: at 390 "How to use Talyvor Chat" was cut to "H…". */}
          <h1 className="min-w-0 flex-1 break-words text-bar text-ink">{page}</h1>
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
      {/* B27.12 — a screen that throws while drawing shows "couldn't be read" here, with the shell
          still standing. Try again drops the failed screen's cached reads and asks for them anew. */}
      <ScreenBoundary address={pathname} onRetry={() => void queryClient.resetQueries({ type: 'inactive' })}>
        <Routes>
          {/* EVERY ROUTE COMES FROM CONSOLE_ROUTES, which is also what titles the header. A page
              declared here and nowhere else would be a page the top bar cannot name — that was
              the state this table replaced. */}
          {CONSOLE_ROUTES.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          {/* B28.10 — a retired address that still has somewhere to go. Not in CONSOLE_ROUTES for
              the catch-all's reason: a redirect is not a page, so it has no title of its own. */}
          <Route path="/earnings" element={<EarningsMoved />} />
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
                Nothing at this address — pick a section from the sidebar.{' '}
                <Link className={`text-ink ${inlineLink}`} to="/">
                  Go to Home
                </Link>
              </div>
            }
          />
        </Routes>
      </ScreenBoundary>
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
          {/* B5.2 — the price list, public for the same reason: a buyer reads it before signing up. */}
          <Route path="/pricing" element={<Pricing />} />
          {/* B27.31 — what the product does, each claim linked to its screen. Public for the same
              reason as the price list. Not /docs: that is the Docs product, behind the gate. */}
          <Route path={DOCUMENTATION_PATH} element={<Documentation />} />
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
          {/* B27.30 — a Track board its workspace published as a link, read by anyone holding it.
              Outside the gate: the reader has no account. Read-only — see areas/board/PublicBoard.tsx. */}
          <Route path="/board/:token" element={<PublicBoard />} />
          {/* B28.127 — a chat its person shared as a link, read by anyone holding it until it is turned off.
              Outside the gate for the same reason. Read-only — see areas/share/SharedChat.tsx. */}
          <Route path="/share/:token" element={<SharedChat />} />
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
