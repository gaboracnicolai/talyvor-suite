import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Members } from './Members'

// Members WAS fixture-backed: two invented people ("Sample Owner", "Sample Member") under a
// caption that already admitted "GET /api/members landed with the shared-unblock PR". The
// route did exist — apps/bff/lens.go registers it — and this screen simply never called it.
//
// It is a TRACK upstream, and this deployment runs no Track (no TRACK_* variables, the
// service is not in the compose stack), so /api/members answers 503 here. That is exactly
// why the not-configured state must be DETECTED from the response rather than written into
// the screen: hardcoding "Track isn't configured" would become the next stale caption the
// day Track ships. The screen asks, and reports what it finds.
//
// ── W1.1.6 — WHAT THE REBUILD CHANGED, AND THE MEASUREMENT THAT DECIDED IT ───────────────────
//
// The screen was ONE anonymous card: zero `<section>` landmarks, no heading of its own, and its
// only page-scale claim was a card header reading "Members". Measured against the real `<App/>`
// at `80825e12`, /members rendered `sections: 0, regionLabels: [], text-title: []` beside /keys
// (rebuilt under W1.1.5) at `sections: 3, regionLabels: 3, text-title: 1`.
//
// ⚠⚠ AND ITS EMPTY STATE WAS COPY FOR A STATE THAT CANNOT HAPPEN. The old branch said "No members
// in this workspace yet … a person appears here when they are added to this workspace in Track."
// MEASURED against a real Postgres with talyvor-track's 26 real migrations, its REAL
// authz.Middleware, its REAL MgmtHandler.List and its REAL member.Store (read-only `git archive`
// export at track `af7e08a`; that repo was held by another tab and was never written to):
//
//   P1  authorized caller           → 200 with the CALLER'S OWN ROW. Never [].
//   P2  authz gate BYPASSED         → 200 [] — so the handler CAN answer empty; P1 is the GATE.
//   P3  member of another workspace → 403 WORKSPACE_FORBIDDEN, never 200 [].
//   P4  caller's own row DELETED    → 403 WORKSPACE_FORBIDDEN, never 200 [].
//   P5  wire body                   → a JSON array; Track never sends `null` on this route.
//
// authz.Middleware authorizes from `SELECT workspace_id, id, role FROM members WHERE email = $1`
// and List reads `SELECT … FROM members WHERE workspace_id = $1` — the SAME TABLE. An authorized
// caller is therefore in their own result set, and a 200 with nobody in it is a CONTRADICTION
// rather than a new workspace. The branch stays (deleting it would render nothing at all if that
// ever changed) and now says what the state would MEAN, which is that something is wrong.
//
// ⚠ THE STATE A NEW SIGNUP ACTUALLY SEES FIRST ON THIS DEPLOYMENT IS THE 503, and that is where
// the "name the next action" half of W1.1.6 lands: the two variables, measured from
// apps/bff/main.go:236-256, not remembered.

const ROSTER = [
  { id: 'mem-owner', name: 'Ada Owner', email: 'ada@corp.example', role: 'owner', avatar_url: '' },
  { id: 'mem-1', name: 'Bo Member', email: 'bo@corp.example', role: 'member', avatar_url: '' },
]

/** The signed-in identity, in the exact shape /auth/me serves it (apps/bff/auth.go:664). */
function meBody(email: string | null) {
  return email === null
    ? { mode: 'disabled', authenticated: false, user: null }
    : { mode: 'oidc', authenticated: true, user: { sub: 'sub-1', email } }
}

function mockBff(res: { status?: number; body: unknown }, me: string | null = 'ada@corp.example') {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      return new Response(JSON.stringify(meBody(me)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

function renderMembers() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Members />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('Members reads the live roster', () => {
  it('lists real members from /api/members, owner first, with no sample marking', async () => {
    mockBff({ body: [ROSTER[1], ROSTER[0]] }) // deliberately unsorted on the wire
    renderMembers()

    expect(await screen.findByText('Ada Owner')).toBeInTheDocument()
    expect(screen.getByText('bo@corp.example')).toBeInTheDocument()
    const roles = screen.getAllByText(/^(owner|member)$/)
    expect(roles[0]).toHaveTextContent('owner')
    // nothing here is a sample any more
    expect(screen.queryByText(/sample data/i)).toBeNull()
    expect(screen.queryByText('Sample Owner')).toBeNull()
  })

  // Lens list endpoints serialise an empty result as JSON null, not [] — the bug lib/api
  // normalises centrally. Track's roster goes through the same reader, so pin it.
  //
  // ⚠ MEASURED AS DEFENSIVE, NOT LOAD-BEARING, AND RECORDED SO NOBODY READS IT AS EVIDENCE ABOUT
  // TRACK. Control P5 above read the bytes off Track's real handler: `out := make([]memberView,
  // 0, …)` marshals as `[]`, so Track cannot produce the body this case sends. It pins the READER,
  // which is shared with the Lens routes that DO send `null`.
  it('a null body reads as empty, never as a failure', async () => {
    mockBff({ body: null })
    renderMembers()
    expect(await screen.findByText(/came back with nobody in it/i)).toBeInTheDocument()
    expect(screen.queryByText(/Couldn’t load/)).toBeNull()
  })
})

describe('the screen has a shape a reader can move through', () => {
  it('is regions with one page-scale heading, not one anonymous card', async () => {
    mockBff({ body: ROSTER })
    const { container } = renderMembers()
    await screen.findByText('Ada Owner')

    const sections = container.querySelectorAll('section')
    expect(
      sections.length,
      'the screen was ONE undifferentiated card — a reader moving by region got one stop on it',
    ).toBeGreaterThan(1)

    // Exactly one page-scale claim. `text-page` is the console's one display step and Region only
    // writes it for the region that OPENS a screen; two would be two answers to what the page is.
    const titles = container.querySelectorAll('.text-page')
    expect(titles.length).toBe(1)

    // Every region names itself, and the eyebrow carries `uppercase` in its OWN class list —
    // eyebrowAudit's source rule, which exists because an inherited transform is invisible at the
    // call site.
    const labels = container.querySelectorAll('[data-testid="region-label"]')
    expect(labels.length).toBe(sections.length)
    for (const l of labels) {
      const eyebrow = l.querySelector('.text-eyebrow')
      expect(eyebrow?.className).toContain('uppercase')
    }

    // ⚠ THE INDICES MUST BE DISTINCT — and as of W1.1.13 this is a READER assertion, not a
    // landmark one, which is a correction to what stood here one merge ago.
    //
    // It read: "this is a landmark assertion rather than a tidiness one. Region derives
    // `aria-labelledby` from the index, so two regions sharing one would point BOTH landmarks at
    // the same name." That was true when it was written and is now FALSE — Region generates its
    // ids with `useId`, so a duplicate index no longer touches the landmark at all. The sentence
    // was caught by `pointerAudit.test.ts` on the very next merge, which is the whole reason that
    // register is line-keyed: the citation had not moved, the CLAIM had stopped being true.
    //
    // What survives is the visible half: the index is what a reader sees beside each eyebrow, and
    // two regions both numbered 01 is a numbering that says nothing. The landmark half is now
    // covered for every address at once by `landmarkIds.test.tsx`, which is where it belongs —
    // this screen cannot check a shared component's contract for the other eleven.
    const indices = Array.from(container.querySelectorAll('[data-testid="region-index"]')).map(
      (e) => e.textContent,
    )
    expect(new Set(indices).size, `region indices are not distinct: ${indices.join(',')}`).toBe(
      indices.length,
    )
    // ...and every section is actually labelled by an element that EXISTS.
    for (const s of Array.from(sections)) {
      const id = s.getAttribute('aria-labelledby')
      expect(id).toBeTruthy()
      expect(container.querySelector(`#${id}`), `no element with id ${id}`).not.toBeNull()
    }
  })

  it('the count of people is a numeral on the figure face', async () => {
    mockBff({ body: ROSTER })
    const { container } = renderMembers()
    await screen.findByText('Ada Owner')

    const count = container.querySelector('[data-testid="member-count"]')
    expect(count, 'the roster size is a figure this screen states').not.toBeNull()
    expect(count).toHaveTextContent('2')
    expect(
      count?.className,
      'preset.ts §THE FIGURE FACE: every numeral in the product renders on the figure face',
    ).toContain('font-figure')
  })
})

describe('which row is YOU — the same key the roster was joined on', () => {
  // The BFF forwards `X-User-Email: sess.email` as "the workspace-membership join key"
  // (apps/bff/lens.go:689) and /auth/me serves that SAME `s.email` (apps/bff/auth.go:664). Track
  // authorizes with `WHERE email = $1` — an exact SQL comparison — so the marking uses an exact
  // comparison too. Lower-casing here would be a DIFFERENT rule from the one that produced the
  // row, and would claim a match the upstream did not make.
  it('marks exactly the row whose email is the session email', async () => {
    mockBff({ body: ROSTER }, 'ada@corp.example')
    renderMembers()

    const ada = (await screen.findByText('Ada Owner')).closest('div[class*="min-h-row"]')
    const bo = screen.getByText('Bo Member').closest('div[class*="min-h-row"]')
    expect(within(ada as HTMLElement).getByText(/^you$/i)).toBeInTheDocument()
    expect(within(bo as HTMLElement).queryByText(/^you$/i)).toBeNull()
  })

  // POSITIVE CONTROL. The marking must MOVE with the session, or it is decoration that happens to
  // sit on the first row: `role === 'owner'` and "is the session" are the same row in the case
  // above, and a marking keyed on the wrong one would pass it.
  it('CONTROL: a different session moves the marking to the other row', async () => {
    mockBff({ body: ROSTER }, 'bo@corp.example')
    renderMembers()

    const bo = (await screen.findByText('Bo Member')).closest('div[class*="min-h-row"]')
    const ada = screen.getByText('Ada Owner').closest('div[class*="min-h-row"]')
    expect(within(bo as HTMLElement).getByText(/^you$/i)).toBeInTheDocument()
    expect(within(ada as HTMLElement).queryByText(/^you$/i)).toBeNull()
  })

  // NEGATIVE CONTROL. `mode:"disabled"` is loopback dev: /auth/me answers `user: null`, so there
  // is no identity to mark with. Marking a row anyway would be an assertion about who is signed in
  // made from nothing.
  it('CONTROL: with no session identity, no row is marked at all', async () => {
    mockBff({ body: ROSTER }, null)
    renderMembers()

    await screen.findByText('Ada Owner')
    expect(screen.queryByText(/^you$/i)).toBeNull()
  })

  // ⚠ THE COMPARISON IS EXACT, AND THIS IS THE CASE THAT SAYS SO. Track authorises and lists from
  // `members.email` with SQL `=`, which in Postgres is case-SENSITIVE, so a session spelled
  // ADA@… did not match the row spelled ada@… upstream either. Case-folding here would mark a row
  // the join did not make — the browser asserting an identity the server declined.
  it('CONTROL: a case-different email is not a match, because upstream would not have matched it', async () => {
    mockBff({ body: ROSTER }, 'ADA@corp.example')
    renderMembers()

    await screen.findByText('Ada Owner')
    expect(screen.queryByText(/^you$/i)).toBeNull()
  })

  // The email that matches nobody must mark nobody — the marking is a JOIN, not a fallback to the
  // first row.
  it('CONTROL: a session email absent from the roster marks nothing', async () => {
    mockBff({ body: ROSTER }, 'nobody@corp.example')
    renderMembers()

    await screen.findByText('Ada Owner')
    expect(screen.queryByText(/^you$/i)).toBeNull()
  })
})

describe('an unconfigured Track upstream is DETECTED, never asserted', () => {
  it('503 reads as "not configured on this deployment" — calm state, not a fault', async () => {
    mockBff({ status: 503, body: { error: 'track upstream not configured on this BFF' } })
    renderMembers()

    expect(await screen.findByText(/Track is not configured on this deployment/)).toBeInTheDocument()
    // off is information: no error copy, and no invented roster to fall back on
    expect(screen.queryByText(/Couldn’t load/)).toBeNull()
    expect(screen.queryByText('Sample Owner')).toBeNull()
  })

  // W1.1.6: "the empty state names the absence without naming the next action". On THIS deployment
  // the 503 is the state a new signup meets first, so the next action lands here. Both names are
  // measured from apps/bff/main.go:236-256, and the all-or-none rule with them: setting one alone
  // makes the BFF refuse to boot.
  it('names the next action — the two variables that wire Track, and that they go together', async () => {
    mockBff({ status: 503, body: { error: 'track upstream not configured on this BFF' } })
    renderMembers()

    await screen.findByText(/Track is not configured on this deployment/)
    expect(screen.getByText('TRACK_BASE_URL')).toBeInTheDocument()
    expect(screen.getByText('TRACK_GATEWAY_SECRET')).toBeInTheDocument()
    expect(screen.getByText(/both or neither/i)).toBeInTheDocument()
  })

  it('the not-configured copy is reached only via the response — a 200 never shows it', async () => {
    mockBff({ body: ROSTER })
    renderMembers()
    await screen.findByText('Ada Owner')
    // This is the anti-rot assertion: the sentence cannot be static markup, or it would
    // still be on screen the day Track appears.
    expect(screen.queryByText(/not configured on this deployment/)).toBeNull()
    expect(screen.queryByText('TRACK_BASE_URL')).toBeNull()
  })

  it('a genuine failure is an error, never laundered into "not configured"', async () => {
    mockBff({ status: 500, body: { error: 'boom' } })
    renderMembers()

    expect(await screen.findByText(/Couldn’t load the members/)).toBeInTheDocument()
    expect(screen.queryByText(/not configured/)).toBeNull()
    // and a failure is not an occasion to explain how rosters work
    expect(screen.queryByText('TRACK_BASE_URL')).toBeNull()
  })

  // The page-scale claim is a claim ABOUT A ROSTER. Under a failed read there is no roster for it
  // to be about, and leaving it up makes the reader walk past a sentence describing a list to
  // reach the card saying the list is missing.
  it('the page-scale heading describes the state the reader is actually in', async () => {
    mockBff({ status: 500, body: { error: 'boom' } })
    const { container } = renderMembers()

    await screen.findByText(/Couldn’t load the members/)
    const title = container.querySelector('.text-page')
    expect(title?.textContent).toMatch(/could not be read/i)
    expect(title?.textContent).not.toMatch(/Everyone who can reach/)
  })
})

describe('an empty roster is a CONTRADICTION on this route, and says so', () => {
  // See the file header: P1–P4 against real Postgres. An authorized caller is in their own result
  // set, so a 200 with nobody in it cannot describe "a workspace nobody has joined yet". The old
  // copy — "a person appears here when they are added to this workspace in Track" — is a calm
  // sentence for a state that, if it ever renders, means the roster and the thing that authorized
  // the read disagree.
  it('does not tell the reader to wait for someone to be added', async () => {
    mockBff({ body: [] })
    renderMembers()

    await screen.findByText(/came back with nobody in it/i)
    expect(screen.queryByText(/No members in this workspace yet/)).toBeNull()
    expect(screen.queryByText(/appears here when they are added/i)).toBeNull()
  })

  it('names what it means and that it should not happen', async () => {
    mockBff({ body: [] })
    renderMembers()

    const said = await screen.findByTestId('roster-contradiction')
    expect(said.textContent).toMatch(/should not be possible|cannot happen/i)
    // it must name the reason, not just the mood
    expect(said.textContent).toMatch(/member/i)
  })

  // POSITIVE CONTROL on the two branches being distinct: the contradiction copy must NOT appear
  // when the roster served rows, or it is markup that is always there and the case above is
  // passing on static text.
  it('CONTROL: a served roster shows none of the contradiction copy', async () => {
    mockBff({ body: ROSTER })
    renderMembers()
    await screen.findByText('Ada Owner')
    expect(screen.queryByTestId('roster-contradiction')).toBeNull()
    expect(screen.queryByText(/came back with nobody in it/i)).toBeNull()
  })
})

describe('the screen offers no control this product does not have', () => {
  // MEASURED, not assumed: apps/bff/track_tenant.go:178 answers anything but GET with
  // methodNotAllowed, and /api/members is the only member route apps/bff/lens.go registers. Track
  // DOES have Add/ChangeRole/Remove and owner-gates all three — they are simply not proxied here.
  // An "Invite someone" button would be a sentence true of an intention over a product that
  // cannot do it, which is the exact defect ClaimsAudit exists to catch.
  it('renders no button at all — the roster is read-only through this BFF', async () => {
    mockBff({ body: ROSTER })
    renderMembers()
    await screen.findByText('Ada Owner')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByText(/invite/i)).toBeNull()
  })

  it('says who CAN change it, since this screen cannot', async () => {
    mockBff({ body: ROSTER })
    renderMembers()
    await screen.findByText('Ada Owner')
    const said = screen.getByTestId('who-can-change')
    expect(said.textContent).toMatch(/owner/i)
    expect(said.textContent).toMatch(/Track/)
  })
})

describe('the provenance line states the mechanism this deployment actually uses', () => {
  // ⚠ THE OLD LINE SAID "the workspace is pinned server-side", AND THIS PRODUCT REFUSES TO BOOT
  // INTO THAT DESIGN. `TRACK_WORKSPACE_ID` — the variable that pinned one workspace at startup —
  // is gone, and apps/bff/main.go:116 refuses the boot if it is set, with the reason spelled out:
  // "Track is per-session … this variable is not read. Remove it; leaving it set would state a
  // pinning that does not happen". The screen was stating exactly that pinning.
  //
  // What is TRUE, and is the fact worth stating: the workspace is resolved from the SESSION per
  // request (apps/bff/track_tenant.go), and a browser-named workspace is ignored — apps/bff/
  // keys_test.go:318 drives `/api/members?workspace_id=SOMEBODY-ELSE` and asserts the upstream
  // path is still the session's.
  it('does not claim a pinned workspace', async () => {
    mockBff({ body: ROSTER })
    renderMembers()
    await screen.findByText('Ada Owner')
    const line = screen.getByTestId('roster-provenance')
    expect(line.textContent).not.toMatch(/pinned/i)
    expect(line.textContent).toMatch(/session/i)
    expect(line.textContent).toMatch(/Track/)
  })

  // Stated only when a roster was actually served — a provenance line under a failed or
  // unconfigured read is the "Live from …" bug the Docs area was reviewed for.
  it('is absent when nothing was served', async () => {
    mockBff({ status: 503, body: { error: 'track upstream not configured on this BFF' } })
    renderMembers()
    await screen.findByText(/Track is not configured on this deployment/)
    expect(screen.queryByTestId('roster-provenance')).toBeNull()
  })
})
