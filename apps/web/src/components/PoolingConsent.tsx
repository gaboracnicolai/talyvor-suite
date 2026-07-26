import { Card, CardHeader } from '@talyvor/ui'
import { SharingChoice, SharingFacts } from '../areas/lens/Sharing'
import { UNPAID_CONTRIBUTION_NOTICE, UNPAID_NOTICE_HEADLINE } from '../areas/lens/unpaidNotice'

// PoolingConsent — the signup DISCLOSURE, shown once: on the login that created the workspace.
//
// ⚠ THIS IS THE ONLY THING BETWEEN A PERSON AND SHARING. The workspace is created with
// cross-tenant sharing ON (Lens's default — see tenant.go's provisionForSession for why that is
// the product decision), so this screen is not asking permission, it is TELLING SOMEONE WHAT IS
// ALREADY HAPPENING and putting one click between them and stopping it.
//
// That raises what this screen has to be:
//
//   · It BLOCKS. AuthGate renders it INSTEAD of the app, not above it. There is no route to the
//     product around it, so nobody can generate an answer before they have read this. That is the
//     property that makes an on-by-default defensible rather than merely convenient.
//   · It says the state PLAINLY and FIRST — "sharing is on right now" — before the explanation,
//     because a person who reads one line should still learn the thing that matters.
//   · Declining is ONE CLICK, of equal prominence. Not a link, not a smaller button, not buried
//     under a "manage preferences" affordance. The two buttons in SharingChoice are the same
//     component at the same weight.
//
// The words and the control come from areas/lens/Sharing.tsx, which the settings screen also
// uses. One source, deliberately: the first draft carried its own copy and promised a settings
// screen that did not exist. A claim about consent must not be able to drift.
export function PoolingConsent({ onDone }: { onDone: () => void }) {
  // Whether Docs is one workspace shared by everyone here. Read from /auth/me — the same query
  // the gate already ran, so no extra request — and derived by the BFF from its own config.
  // Unlike the unpaid-contribution notice above, this value CAN be read live: it is the BFF's own
  // configuration, not another service's admin-gated operator setting, so there is no trust
  // boundary to cross. See areas/docs/sharedDocsNotice.ts for that comparison in full.
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-gutter py-8">
      <Card className="w-full max-w-2xl">
        <CardHeader>Your answers are being shared</CardHeader>
        <div className="flex flex-col gap-4 px-gutter py-4">
          {/* The state, before the explanation. Someone who reads one sentence and nothing else
              must still leave knowing what is true and that they can stop it. */}
          <p className="text-body text-ink">
            <strong>
              Sharing is on for this workspace right now. Answers you generate here may be served
              to other companies.
            </strong>{' '}
            You can turn it off below — one click, and nothing of yours is shared.
          </p>
          <SharingFacts />
          {/* ⚠ THE UNPAID-CONTRIBUTION NOTICE, and it sits ABOVE the choice deliberately: a tester
              who reads as far as the first control and clicks must already have passed it.
              Enabling shadow mode in Lens (LENS_SHADOW_MINTS_ENABLED) is a statement to testers
              rather than a config value, so this copy is a PRECONDITION for that flag — if it
              ships first we run unpaid mints without having said so.
              Words come from areas/lens/unpaidNotice, shared with the ledger, for the same reason
              the sharing copy is shared with settings: a claim about payment must not be able to
              drift between the two places it appears. */}
          <p className="text-body text-ink">
            <strong>{UNPAID_NOTICE_HEADLINE}</strong> {UNPAID_CONTRIBUTION_NOTICE}
          </p>
          {/* THE SHARED-DOCS NOTICE IS GONE, and its absence is the point: it said Docs was one
              wiki every signed-in person shared, and that stopped being true when Docs started
              taking the SESSION's workspace (see apps/bff docsWorkspaceFor). It was built to be
              derived — `docs_shared` came from whether DOCS_WORKSPACE_ID was set — and removing
              that pin did not merely make the flag false, it made the field fail to COMPILE, which
              is how a disclosure should expire. A notice that outlives the arrangement it
              describes is a false claim in the one place a person is being asked to consent. */}
          <SharingChoice onDone={onDone} />
        </div>
      </Card>
    </div>
  )
}
