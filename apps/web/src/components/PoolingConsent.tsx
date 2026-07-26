import { Card, CardHeader } from '@talyvor/ui'
import { SharingChoice, SharingFacts } from '../areas/lens/Sharing'

// PoolingConsent — the signup prompt, shown once: on the login that CREATED the workspace.
//
// The BFF provisions every workspace with sharing OFF and this asks whether to turn it on, so
// nothing produced here can reach another company before its owner has read this. Consent is only
// ever granted by someone choosing it.
//
// The words and the control come from areas/lens/Sharing.tsx, which the settings screen also uses.
// Sharing one source is deliberate: the first draft of this file carried its own copy and promised
// a settings screen that did not exist. A claim about consent must not be able to drift.
export function PoolingConsent({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-gutter py-8">
      <Card className="w-full max-w-2xl">
        <CardHeader>One choice before you start</CardHeader>
        <div className="flex flex-col gap-4 px-gutter py-4">
          <SharingFacts />
          <p className="text-body">
            Nothing of yours has been shared. This workspace was created with sharing off, and it
            stays off unless you turn it on — here, or later in Settings.
          </p>
          <SharingChoice onDone={onDone} />
        </div>
      </Card>
    </div>
  )
}
