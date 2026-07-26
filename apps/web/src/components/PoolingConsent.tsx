import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader } from '@talyvor/ui'
import { ApiError } from '../lib/api'

// PoolingConsent — the one screen where a new workspace's cross-tenant sharing is decided.
//
// WHY IT EXISTS AND WHY IT IS SHOWN BEFORE ANYTHING ELSE. Cross-tenant cache pooling means an
// answer produced for THIS workspace can be served to a DIFFERENT COMPANY, and answers produced
// for theirs can be served here. Lens's own default for a new workspace is ON, and its consent is
// recorded once at creation — so if nothing asked, a new tenant would be sharing before they had
// been told, and would have to discover it afterwards.
//
// So the BFF creates every workspace DECLINED and this screen asks whether to turn it on. Nothing
// is shared by inaction: consent is only ever granted by someone reading this and choosing it.
//
// It states the trade honestly in both directions — the benefit is real, and so is the exposure —
// and it says what is and is not shared, because "answers" is the kind of word people fill in
// wrongly. It renders the RECORDED state that came back from Lens, never the state that was
// requested: if the write is refused or partially applied, this shows the truth.
export function PoolingConsent({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'on' | 'off' | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  async function choose(cachePoolable: boolean) {
    setBusy(cachePoolable ? 'on' : 'off')
    setFailed(null)
    try {
      // Relative path ⇒ same-origin ⇒ the browser supplies the Origin the BFF requires.
      const res = await fetch('/api/signup/pooling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ cache_poolable: cachePoolable }),
      })
      if (!res.ok) throw new ApiError(res.status, '/api/signup/pooling')
      // Re-probe so the app renders with the RECORDED consent rather than what we asked for.
      await qc.invalidateQueries({ queryKey: ['auth-me'] })
      onDone()
    } catch {
      setFailed('That did not save. Your workspace is not sharing anything — you can try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-gutter">
      <Card className="w-full max-w-lg">
        <CardHeader>One choice before you start</CardHeader>
        <div className="flex flex-col gap-4 px-gutter py-4">
          <p className="text-body">
            Talyvor can reuse answers across companies. When it does, a response produced for
            your workspace may be served to another company that asks a near-identical question —
            and you may be served from theirs.
          </p>
          <p className="text-body text-muted">
            It makes repeated questions cheaper and faster for everyone taking part. It also means
            the content of your answers can leave your workspace. Your API keys, your balance and
            your ledger are never shared.
          </p>
          <p className="text-body">
            <strong>Sharing is currently off.</strong> Nothing of yours has been shared, and
            nothing will be unless you turn it on here.
          </p>

          {failed && <p className="text-body text-danger">{failed}</p>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="primary" disabled={busy !== null} onClick={() => void choose(false)}>
              {busy === 'off' ? 'Saving…' : 'Keep my answers private'}
            </Button>
            <Button disabled={busy !== null} onClick={() => void choose(true)}>
              {busy === 'on' ? 'Saving…' : 'Share to make everyone cheaper'}
            </Button>
          </div>

          <p className="text-caption text-muted">
            You can change this later in settings. Changing it applies from that moment on — it
            does not reach back to answers already shared.
          </p>
        </div>
      </Card>
    </div>
  )
}
