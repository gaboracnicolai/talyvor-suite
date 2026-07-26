import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader } from '@talyvor/ui'
import { api, ApiError } from '../../lib/api'

// Sharing.tsx — cross-tenant answer sharing: the explanation, and the control.
//
// ONE FILE ON PURPOSE. The signup prompt and the settings control describe the same thing and
// write to the same endpoint. Kept apart they drift, and the first draft of the signup screen
// already shipped a claim the product could not honour ("you can change this later in settings"
// — there was no settings screen). A claim about CONSENT is the worst kind to let go stale, so
// the words and the control live together and are used by both screens.
//
// THE COPY STATES BOTH SIDES AND SELLS NEITHER. Sharing is what makes the earning half of the
// product work: opt in and this workspace's answers earn LENS when another company reuses them,
// and it is served instantly from theirs. It is also a real disclosure: the content of answers
// leaves the workspace. Both facts are load-bearing, so both are stated, in parallel structure
// and with the same weight. No recommendation, no default-highlighted button, no language that
// makes one option feel like the sensible one. A consent screen that sells is worse than one that
// only warns — the person has to be able to read it and decide.

/** SharingFacts — the whole description, used verbatim by both screens. */
export function SharingFacts() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body">
        Talyvor can reuse answers across companies. A response produced for this workspace may be
        served to another company asking a near-identical question, and this workspace may be
        served from theirs.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <p className="text-body text-ink">If sharing is on</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-body text-muted">
            <li>Your answers earn you LENS each time another company reuses one.</li>
            <li>You are served instantly, and without paying a model, from theirs.</li>
            <li>The content of your answers leaves this workspace.</li>
          </ul>
        </div>
        <div className="flex-1">
          <p className="text-body text-ink">If sharing is off</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-body text-muted">
            <li>Nothing produced here is served to anyone else.</li>
            <li>You are never served another company&rsquo;s answers.</li>
            <li>You earn nothing from reuse, and pay full price for repeated questions.</li>
          </ul>
        </div>
      </div>

      <p className="text-body text-muted">
        Your API keys, your balance and your ledger are never shared, in either setting. Changing
        this applies from that moment on — it does not reach back to answers already shared.
      </p>
    </div>
  )
}

/**
 * SharingChoice — the control. Reads the RECORDED value from the session probe and writes through
 * POST /api/pooling, which the BFF forwards to Lens as PUT /v1/workspaces/{wsID}/cache-poolable
 * with this session's own token.
 *
 * It renders what is STORED, never what was requested: the BFF returns the consent Lens actually
 * recorded, and this re-probes after every write. If a write is refused or only partly applied,
 * the screen says so instead of showing an optimistic result.
 */
export function SharingChoice({ onDone }: { onDone?: () => void }) {
  const q = useQuery({ queryKey: ['auth-me'], queryFn: api.me, staleTime: 60_000 })
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'on' | 'off' | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const recorded = q.data?.cache_poolable

  async function choose(cachePoolable: boolean) {
    setBusy(cachePoolable ? 'on' : 'off')
    setFailed(null)
    try {
      // Relative path ⇒ same-origin ⇒ the browser supplies the Origin the BFF requires.
      const res = await fetch('/api/pooling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ cache_poolable: cachePoolable }),
      })
      if (!res.ok) throw new ApiError(res.status, '/api/pooling')
      await qc.invalidateQueries({ queryKey: ['auth-me'] })
      onDone?.()
    } catch {
      setFailed('That did not save, so nothing changed. You can try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The stored state, stated before the buttons — so the person is choosing against what is
          actually true, not against what they last clicked. */}
      {q.isLoading ? (
        <p className="text-body text-muted">Checking this workspace&rsquo;s setting…</p>
      ) : recorded === undefined ? (
        <p className="text-body text-muted">
          This workspace&rsquo;s sharing setting could not be read, so it is not shown. The buttons
          below still work, and the result is re-read afterwards.
        </p>
      ) : (
        <p className="text-body">
          Sharing is currently <strong>{recorded ? 'on' : 'off'}</strong> for this workspace.
        </p>
      )}

      {failed && <p className="text-body text-danger">{failed}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button disabled={busy !== null} onClick={() => void choose(false)}>
          {busy === 'off' ? 'Saving…' : 'Do not share my answers'}
        </Button>
        <Button disabled={busy !== null} onClick={() => void choose(true)}>
          {busy === 'on' ? 'Saving…' : 'Share my answers'}
        </Button>
      </div>
    </div>
  )
}

/** Settings — the standing control, reachable any time from the nav. */
export function Settings() {
  return (
    <div className="flex flex-col gap-gutter">
      <Card>
        <CardHeader>Sharing answers with other companies</CardHeader>
        <div className="flex flex-col gap-4 px-gutter py-4">
          <SharingFacts />
          <SharingChoice />
        </div>
      </Card>
    </div>
  )
}
