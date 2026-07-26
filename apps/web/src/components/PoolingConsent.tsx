import { Card, CardHeader } from '@talyvor/ui'
import { SharingChoice, SharingFacts } from '../areas/lens/Sharing'

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
          <SharingChoice onDone={onDone} />
        </div>
      </Card>
    </div>
  )
}
