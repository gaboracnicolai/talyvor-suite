// The shared-Docs notice. ONE source, so the words cannot drift between surfaces.
//
// Same shape as areas/lens/unpaidNotice.ts, deliberately: a fact a tester must know before they
// generate anything, kept in one module, rendered by the blocking signup disclosure, and pinned
// by a test that checks the CLAIM rather than the phrasing. This is a DIFFERENT fact from that
// notice — that one is about what earns LENS, this one is about who can read what — so it states
// its own thing and does not restate theirs.
//
// ── THE FACT ────────────────────────────────────────────────────────────────
//
// After talyvor-suite#36, Lens and Track are per-user: each signed-in person is provisioned their
// own Lens workspace and bootstrapped their own Track workspace at login. DOCS IS NOT. Docs has
// no workspaces table of its own — its tenancy is a MIRROR of Track's roster, full-pulled by its
// syncer — so giving it a per-user workspace needs Docs to have a tenancy root first. That is a
// PARKED decision with a stated reopening condition (talyvor-docs internal/membership/store.go:
// the first customer who wants Docs without Track).
//
// So on a deployment where Docs is pinned, every trial user shares one Docs workspace and can
// read each other's pages. The danger is specifically that this is now the ODD ONE OUT: someone
// who has just been told their Lens and Track workspaces are their own will reasonably generalise.
//
// ── WHY THIS ONE *IS* READ FROM A LIVE VALUE, WHERE THE UNPAID NOTICE IS NOT ─
//
// unpaidNotice.ts is worded to be true in every state because its underlying flag is only exposed
// on an admin-gated Lens route, and reading it would mean handing the BFF the Lens admin key —
// trading copy accuracy for cross-tenant escalation. Its header calls reading the value from
// /auth/me "the pattern that stopped a false claim recurring" and explains why it could not be
// applied there.
//
// It applies here. Whether Docs is pinned is the BFF's OWN configuration, not another service's
// operator setting: the BFF holds docsWorkspaceID because it builds the Docs path from it. There
// is no trust boundary to cross and no key to acquire, so `docs_shared` on /auth/me is derived
// from that field and this copy renders only when it is true.
//
// ── HOW IT STAYS TRUE WHEN DOCS BECOMES PER-USER ────────────────────────────
//
// Three things have to fail before this copy can outlive the fact:
//
//  1. The wire value is DERIVED, not hardcoded: `docs_shared` is
//     `docsBaseURL != "" && docsWorkspaceID != ""`. Give Docs a tenancy root and the pin goes the
//     way trackWorkspaceID just did — the field stops existing, `docs_shared` stops compiling.
//  2. TestDocs_RemainsPinnedByDesign (apps/bff) asserts docsWorkspaceID is still on the config.
//     Removing the pin fails that test first, so it is a deliberate act, and the failure names
//     this notice as something to revisit.
//  3. sharedDocsNotice.test.ts asserts the copy is CONDITIONAL on that value — a notice rendered
//     unconditionally fails there.
//
// The copy is additionally worded so it describes THIS DEPLOYMENT rather than the product: "on
// this deployment" is a statement about a configuration, which stops being rendered when the
// configuration changes, rather than "Docs is shared", which would become false.

/** The line someone who reads nothing else must still take away. */
export const DOCS_SHARED_HEADLINE = 'Docs is shared with the other people in this trial.'

/**
 * The explanation. States the asymmetry explicitly, because being the odd one out is the whole
 * hazard — a person told their Lens and Track workspaces are their own will assume Docs matches.
 */
export const DOCS_SHARED_NOTICE =
  'Your Lens and Track workspaces are your own — nobody else in the trial can see them. Docs on ' +
  'this deployment works differently: there is a single Docs workspace, so every page and space ' +
  'is visible to everyone else signed in here, and anything you write there should be treated ' +
  'as visible to the group.'

/**
 * What to DO about it. The fact alone does not prevent the harm; a person needs to know what to
 * change. Kept as its own export so a surface can show the guidance without the explanation, and
 * so the test can require that guidance exists at all.
 */
export const DOCS_SHARED_GUIDANCE =
  'Please don’t put anything private, personal or confidential in Docs during the trial — use it ' +
  'for notes you would be happy for the group to read.'
