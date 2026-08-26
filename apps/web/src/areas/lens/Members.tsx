import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, Row, cn } from '@talyvor/ui'
import { getJSONArray } from '../../lib/api'
import { useAuthMeReader } from '../../lib/authMe'
import { isUnconfigured, notConfiguredCopy } from '../../lib/productState'
import { PanelFailure } from '../../components/SessionExpiredBar'
import { Region, RegionScreen } from '../../components/Region'

// Members — the workspace roster, LIVE from GET /api/members (the BFF proxies Track's
// /v1/workspaces/{ws}/members, the workspace resolved from the session per request, the session
// email sent as the membership join key).
//
// This screen used to render two invented people under a caption that already said the route
// had landed. It had: apps/bff/lens.go registers /api/members. Nothing called it.
//
// Track is an OPTIONAL upstream and is not deployed here, so the route answers 503 today. That
// state is DETECTED from the response, not written into this file — see lib/productState.ts
// for why a hardcoded "not configured" would just become the next stale caption. When the
// TRACK_* pair appears, this screen starts showing the real roster with no change here.
//
// Rows mirror Track's memberView exactly: {id, name, email, role, avatar_url}, roles
// owner | member. Owner sorts first; the distinction is WEIGHT, not a hue — role text is a
// category label, and text is never a hue.
//
// ── W1.1.6 — THE REBUILD, AND THE THREE THINGS MEASUREMENT CHANGED ──────────────────────────
//
// (1) IT WAS ONE ANONYMOUS CARD. Measured against the real `<App/>` at `80825e12`: /members
// rendered ZERO `<section>` landmarks, zero region labels and no page-scale heading, beside
// /keys (rebuilt under W1.1.5) at three of each. A reader moving by region got one stop on the
// screen that says who can reach this workspace. It is three named regions now.
//
// (2) ⚠⚠ THE EMPTY STATE WAS COPY FOR A STATE THAT CANNOT OCCUR. The branch said "No members in
// this workspace yet … a person appears here when they are added to this workspace in Track."
// MEASURED against a real Postgres with talyvor-track's 26 real migrations applied, its REAL
// authz.Middleware, its REAL MgmtHandler.List and its REAL member.Store (read-only `git archive`
// export at track `af7e08a`; that repo was held by another tab and was never written to):
// authz authorizes from `SELECT workspace_id, id, role FROM members WHERE email = $1` and List
// reads `SELECT … FROM members WHERE workspace_id = $1` — THE SAME TABLE. So an authorized
// caller is always in their own result set: 200 carried the caller's row, a non-member got 403,
// and deleting the caller's row got 403 rather than an empty 200. With the gate bypassed the
// same handler DID answer `[]`, which is how we know the instrument could have found otherwise.
// The branch survives — deleting it would render nothing at all if that ever changed — but it
// now says what the state would MEAN, which is that two things disagree.
//
// (3) ⚠ THE PROVENANCE LINE STATED A PINNING THIS BFF REFUSES TO BOOT WITH. It read "the
// workspace is pinned server-side". `TRACK_WORKSPACE_ID` is gone and apps/bff/main.go:116
// refuses the boot if it is set — "leaving it set would state a pinning that does not happen". The
// workspace comes from the SESSION per request (apps/bff/track_tenant.go), and a browser-named
// one is ignored (apps/bff/keys_test.go:318). That is what the line says now, and it is the
// half a reader actually needs: the browser cannot choose whose roster this is.

/** Track internal/member/mgmt_handler.go memberView, verbatim. */
export interface RosterMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  avatar_url: string
}

// The three headlines, written together so the screen's one page-scale claim is readable in one
// place and cannot drift from the predicate that selects it.
const HEADLINE = 'Everyone who can reach this workspace.'
const HEADLINE_UNCONFIGURED = 'This deployment runs no Track, so it has no roster.'
const HEADLINE_CONTRADICTION = 'The roster came back with nobody in it.'
// ⚠ A FAILED READ GETS ITS OWN, and the reason is the one this screen already applies to the
// provenance line. "Everyone who can reach this workspace." is a claim ABOUT A ROSTER, and under a
// failed read there is no roster to be about — the reader would have to get past a page-scale
// sentence describing a list before reaching the card that says the list is missing.
const HEADLINE_FAILED = 'The roster could not be read.'

/**
 * The membership join key, compared the way the upstream compared it.
 *
 * The BFF sends `X-User-Email: sess.email` and calls it "the workspace-membership join key"
 * (apps/bff/lens.go:697); /auth/me serves that SAME `s.email` (apps/bff/auth.go:664); Track
 * authorizes and lists from `members.email` with SQL `=`.
 *
 * ⚠ SO THE COMPARISON IS EXACT, DELIBERATELY. Case-folding here would be a DIFFERENT rule from
 * the one that produced the row, and it would mark a row the upstream did not match — a claim
 * about who you are, made by the browser, on the screen whose whole subject is identity. Track's
 * `members` table has UNIQUE (workspace_id, email), so at most one row can match; there is no
 * ambiguity to resolve by being clever.
 */
function isSessionRow(m: RosterMember, sessionEmail: string | null): boolean {
  return sessionEmail !== null && m.email === sessionEmail
}

export function Members() {
  const q = useQuery({
    queryKey: ['members'],
    // getJSONArray, not getJSON: an empty list arrives as JSON `null` from Go's
    // `var out []T` idiom, and a bare read would make a real empty roster throw. Defensive on
    // THIS route — Track builds its slice with `make(…, 0, …)` and marshals `[]` — and
    // load-bearing on the Lens reads that share the reader.
    queryFn: () => getJSONArray<RosterMember>('/api/members'),
  })

  // The gate owns the /auth/me probe; this is a passive reader of it (see lib/authMe.ts for the
  // remount loop that rule exists to prevent). `user` is null in disabled mode, which is the
  // state where nothing may be marked.
  const me = useAuthMeReader()
  const sessionEmail = me.data?.user?.email ?? null

  const roster = [...(q.data ?? [])].sort(
    (a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.name.localeCompare(b.name),
  )

  // ⚠ EACH STATE IS COMPUTED FROM THE QUERY OBJECT, NOT INFERRED FROM THE ARRAY. `data` is
  // undefined both while loading and on error, so a helper handed the bare array cannot tell a
  // workspace apart from a failed read — and the direction that matters is the one these are
  // FALSE for: told wrongly, a reader whose roster failed to load is shown a screen saying their
  // workspace has nobody in it. emptyVsFault.test.ts states the rule.
  const unconfigured = isUnconfigured(q.error)
  const failed = q.isError && !unconfigured
  const served = !q.isError && !q.isLoading && q.data !== undefined
  const contradiction = served && roster.length === 0

  const owners = roster.filter((m) => m.role === 'owner').length

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Members"
        heading={
          unconfigured
            ? HEADLINE_UNCONFIGURED
            : failed
              ? HEADLINE_FAILED
              : contradiction
                ? HEADLINE_CONTRADICTION
                : HEADLINE
        }
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-2xl"
      >
        <p className="text-body text-muted">
          Membership belongs to Track, which owns identity for this product. This screen reads
          that roster; it is the same list Track authorises every workspace read against.
        </p>
      </Region>

      <Region index="01" label="Who is in this workspace">
        {/* The count is stated ABOVE the list rather than inside its header, so it is a fact
            about the workspace rather than a caption on a box — and it renders only when a
            roster was actually served. A "0 people" under a failed read is the same lie as an
            empty list under one. */}
        {served && roster.length > 0 ? (
          <p className="mb-4 text-body text-muted">
            <span data-testid="member-count" className="font-figure text-ink">
              {roster.length}
            </span>{' '}
            {roster.length === 1 ? 'person' : 'people'}, of whom{' '}
            <span className="font-figure text-ink">{owners}</span>{' '}
            {owners === 1 ? 'is an owner' : 'are owners'}.
          </p>
        ) : null}

        <Card>
          <CardHeader>Workspace members</CardHeader>
          {q.isLoading ? (
            <div className="px-gutter py-3 text-body text-muted">Loading…</div>
          ) : unconfigured ? (
            <div className="px-gutter py-3 text-body text-muted">{notConfiguredCopy('Track')}</div>
          ) : failed ? (
            <PanelFailure error={q.error} what="the members" />
          ) : contradiction ? (
            // ⚠ NOT "NOBODY HAS JOINED YET". See the file header: on this route an authorized
            // caller is in their own result set, so this state is the roster and the thing that
            // authorised the read disagreeing. Told as a calm empty it would send a reader to
            // Track to add someone who, from Track's own point of view, is already there.
            <div
              data-testid="roster-contradiction"
              className="space-y-2 px-gutter py-3 text-body text-muted"
            >
              <p className="text-ink">
                Track answered, and listed nobody — including you. That should not be possible.
              </p>
              <p>
                Reading this roster requires being a member of it: Track authorises the request
                from the same table it then lists. An empty answer means those two disagree, so
                nothing is shown here rather than an emptiness that reads like a fresh workspace.
              </p>
            </div>
          ) : (
            roster.map((m) => {
              const you = isSessionRow(m, sessionEmail)
              return (
                <Row key={m.id} label={m.name} hint={m.email}>
                  {you ? (
                    <span className="font-figure text-eyebrow uppercase text-faint">You</span>
                  ) : null}
                  <span
                    className={cn(
                      'font-figure text-eyebrow uppercase',
                      m.role === 'owner' ? 'font-semibold text-ink' : 'text-muted',
                    )}
                  >
                    {m.role}
                  </span>
                </Row>
              )
            })
          )}
        </Card>

        {/* Stated only when Track actually served one — a provenance line under a failed or
            unconfigured read is exactly the "Live from …" bug the Docs area was reviewed for. */}
        {served && roster.length > 0 ? (
          <p data-testid="roster-provenance" className="mt-4 text-caption font-normal text-faint">
            Live from Track via the BFF. The workspace is the one your session resolved at login,
            server-side — a workspace named by the browser is ignored.
          </p>
        ) : null}
      </Region>

      {/* ⚠ ONE REGION, TWO DEPLOYMENTS, AND IT IS NOT DRAWN AT ALL WHEN THE ANSWER IS UNKNOWN. A
          failed read tells the reader nothing about whether Track is wired, so neither sentence
          below can be earned from it — and a screen that explains how membership works while the
          roster is missing is answering a question nobody asked. */}
      {unconfigured ? (
        <Region index="02" label="Wiring Track">
          <p className="text-body text-muted">
            Two variables on the BFF wire this upstream, and they go together:{' '}
            <span className="font-mono text-caption text-ink">TRACK_BASE_URL</span> and{' '}
            <span className="font-mono text-caption text-ink">TRACK_GATEWAY_SECRET</span>. Set both
            or neither — with one of them alone the BFF refuses to start, naming the one that is
            missing.
          </p>
          <p className="mt-3 text-caption font-normal text-muted">
            There is no third variable. A workspace is created per identity at login, so the BFF
            reads none from configuration and refuses to start if one is set.
          </p>
        </Region>
      ) : served && roster.length > 0 ? (
        <Region index="02" label="Changing the roster">
          <p data-testid="who-can-change" className="text-body text-muted">
            Nothing on this screen can add or remove anyone. This BFF proxies one member route and
            it is a GET; the add, role-change and remove routes exist in Track and are owner-only
            there. So an owner of this workspace changes the roster in Track, and it appears here
            on the next read.
          </p>
        </Region>
      ) : null}
    </RegionScreen>
  )
}
