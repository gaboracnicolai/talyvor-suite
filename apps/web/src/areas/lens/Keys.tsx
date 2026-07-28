import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader, Input, RevealOnce, Row } from '@talyvor/ui'
import { keysApi, type MintResult, type WorkspaceAPIKey } from './keysApi'
import { formatWhen } from './format'
import { ApiError } from '../../lib/api'
import { PanelFailure } from '../../components/SessionExpiredBar'

// API keys — LIVE. This screen exists because of one real failure: Lens's mint
// response returns `key` and `prefix` ADJACENT in one line of JSON, they look
// nearly identical, and the wrong one got copied — ten minutes of "invalid API
// key". The design makes that mistake structurally impossible:
//
//   · The CREDENTIAL appears exactly once, in a RevealOnce card, with one
//     primary action — Copy key — that copies the key and nothing else. On
//     dismissal it leaves the DOM and the mutation cache; there is no way back.
//   · The PREFIX never sits beside the key at equal weight — a labeled,
//     separated "not a credential" block — and in the list rows, where a
//     credential never appears at all.
//
// WIRED to the real BFF routes (apps/bff/keys.go), which hold the workspace key
// server-side:
//   GET  /api/keys → list (WorkspaceAPIKey rows, no credential)
//   POST /api/keys → mint (201 {key, prefix, …}; key shown once). The POST is a
//     write, guarded by the BFF's Origin check — satisfied automatically because
//     keysApi.mint posts to a same-origin relative path (see keysApi.ts).
/**
 * KeyRow — one key, with the way to destroy it.
 *
 * ⚠ WHAT THE CONFIRM IS FOR, ARGUED. The obvious confirm is "Are you sure?", and it guards the
 * wrong thing. Nobody revokes a key by accidentally pressing a button they did not mean to press;
 * they revoke THE WRONG KEY. This list makes that easy — every identifier is tlv_ws_ + eight hex,
 * they are the same length and shape, and names repeat because people call three of them "CI
 * pipeline". A yes/no dialog confirms the ACT, which was never in doubt, and says nothing about the
 * TARGET, which is the only thing that can go wrong.
 *
 * So the confirm is to type the identifier of the key being revoked. It cannot be satisfied without
 * looking at the row, and it fails closed against the specific mistake — reaching for the wrong row
 * — that a yes/no dialog waves straight through. It is the same standard used for deleting a
 * repository or a database, for the same reason: irreversible, and the damage is silent.
 *
 * The cost is real: cleaning up three dead keys means typing three identifiers. That is accepted
 * deliberately. The dangerous case is revoking a LIVE key by mistake, and that is exactly the case
 * that should be slow.
 */
function KeyRow({ k }: { k: WorkspaceAPIKey }) {
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')

  const revoke = useMutation({
    mutationFn: () => keysApi.revoke(k.id),
    onSuccess: async () => {
      setConfirming(false)
      setTyped('')
      await qc.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  // Exact match, trimmed only for stray whitespace — a prefix match would defeat the point, since
  // every identifier here shares the tlv_ws_ stem.
  const armed = typed.trim() === k.key_prefix

  return (
    <>
      <Row label={k.name} hint={`${k.scopes.join(', ')} · created ${formatWhen(k.created_at)}`}>
        <span className="font-mono text-caption tabular-nums text-muted">{k.key_prefix}</span>
        {!confirming ? (
          // The accessible name carries the identifier, so the control names WHICH key it destroys
          // rather than being one of several identical "Revoke" buttons.
          <Button variant="default" onClick={() => setConfirming(true)} aria-label={`Revoke ${k.key_prefix}`}>
            Revoke
          </Button>
        ) : null}
      </Row>
      {confirming ? (
        <div className="space-y-2 border-t border-hairline px-gutter py-3">
          <p className="text-body text-ink">
            Revoking <span className="font-mono">{k.key_prefix}</span> cannot be undone, and anything
            still using it stops working without warning.
          </p>
          {/* ⚠ THIS SENTENCE IS LOAD-BEARING AND WAS READ FROM SOURCE. Lens caches validated keys
              in-process for 5 minutes (internal/auth/apikeys.go, cacheTTL) and the revoke route
              deletes the row without purging that cache, so a key in active use keeps working for
              up to the TTL. An operator killing a LEAKED key has to know that; "revoked" implying
              "dead now" would be the most dangerous sentence on this screen. */}
          <p className="text-caption text-muted">
            Traffic already using this key can keep working for up to 5 minutes — Lens caches key
            checks for that long. Treat it as revoked in 5 minutes, not immediately.
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={k.key_prefix}
              aria-label={`Type ${k.key_prefix} to confirm`}
              className="w-52 font-mono"
            />
            <Button variant="danger" onClick={() => revoke.mutate()} disabled={!armed || revoke.isPending}>
              {revoke.isPending ? 'Revoking…' : 'Revoke key'}
            </Button>
            <Button
              variant="default"
              onClick={() => {
                setConfirming(false)
                setTyped('')
              }}
            >
              Cancel
            </Button>
          </div>
          {revoke.isError ? (
            <p className="text-body text-muted">
              {revoke.error instanceof ApiError && revoke.error.status === 404
                ? 'That key is already gone, or does not belong to this workspace. Nothing was changed.'
                : 'Couldn’t revoke that key — nothing was changed. Try again.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

export function Keys() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [minted, setMinted] = useState<MintResult | null>(null)

  const list = useQuery({ queryKey: ['keys'], queryFn: keysApi.list })

  const mint = useMutation({
    mutationFn: () => keysApi.mint(name.trim(), ['proxy']),
    onSuccess: (result) => setMinted(result), // held in local state only; rendered once
  })

  const submit = () => {
    if (minted || mint.isPending || name.trim() === '') return
    mint.mutate()
  }

  // Consuming the reveal is one-way and total: the credential leaves local state
  // AND the mutation cache (mint.reset), so no copy of it survives anywhere on
  // the page. The list refetches — the new key returns from the server BY PREFIX,
  // never as a value the client kept.
  const dismiss = () => {
    setMinted(null)
    setName('')
    mint.reset()
    void qc.invalidateQueries({ queryKey: ['keys'] })
  }

  const keys: WorkspaceAPIKey[] = list.data ?? []

  return (
    <div className="flex flex-col gap-4 px-gutter py-4">
      {minted ? (
        <RevealOnce
          title="Workspace key — shown once"
          secret={minted.key}
          copyLabel="Copy key"
          identifier={minted.prefix}
          identifierNote="Safe to share; this is how the key appears in lists."
          onDone={dismiss}
        />
      ) : null}

      <Card>
        <CardHeader>API keys</CardHeader>
          {/* The gap this closes: someone mints a key here and has nowhere to learn what to do
              with it. Setup is where the two environment variables live. */}
          <div className="px-gutter pt-3 text-caption text-muted">
            Got a key and not sure what to do with it?{' '}
            <Link className="underline" to="/setup">
              Setup
            </Link>{' '}
            has the two lines for Claude Code, Cursor, and anything on the OpenAI SDK.
          </div>
        <Row
          label="Create a key"
          hint="Minted server-side with the proxy scope; the key is shown once, then only its identifier remains"
        >
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="Key name"
              aria-label="New key name"
              className="w-44"
              disabled={minted !== null || mint.isPending}
            />
            <Button variant="primary" onClick={submit} disabled={minted !== null || mint.isPending || name.trim() === ''}>
              {mint.isPending ? 'Creating…' : 'Create key'}
            </Button>
          </div>
        </Row>

        {mint.isError ? (
          <div className="px-gutter py-2 text-body text-muted">
            {mint.error instanceof Error && mint.error.message.includes('403')
              ? 'Couldn’t mint the key — the request origin was rejected. Reach this app at its configured address.'
              : 'Couldn’t mint the key. Please try again.'}
          </div>
        ) : null}

        {list.isLoading ? (
          <div className="px-gutter py-3 text-body text-muted">Loading…</div>
        ) : list.isError ? (
          <PanelFailure error={list.error} what="your keys" />
        ) : keys.length === 0 ? (
          <div className="px-gutter py-3 text-body text-muted">No keys yet. Create one above.</div>
        ) : (
          keys.map((k) => <KeyRow key={k.id} k={k} />)
        )}
      </Card>
    </div>
  )
}
