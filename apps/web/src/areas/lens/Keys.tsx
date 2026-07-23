import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader, Input, RevealOnce, Row } from '@talyvor/ui'
import { keysApi, type MintResult, type WorkspaceAPIKey } from './keysApi'
import { formatWhen } from './format'

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
          <div className="px-gutter py-3 text-body text-muted">Couldn’t load your keys.</div>
        ) : keys.length === 0 ? (
          <div className="px-gutter py-3 text-body text-muted">No keys yet. Create one above.</div>
        ) : (
          keys.map((k) => (
            <Row key={k.id} label={k.name} hint={`${k.scopes.join(', ')} · created ${formatWhen(k.created_at)}`}>
              <span className="font-mono text-caption tabular-nums text-muted">{k.key_prefix}</span>
            </Row>
          ))
        )}
      </Card>
    </div>
  )
}
