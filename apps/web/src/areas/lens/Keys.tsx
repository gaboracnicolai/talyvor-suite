import { useState } from 'react'
import { Button, Card, CardHeader, Row } from '@talyvor/ui'
import { FixtureNotice } from './FixtureNotice'
import { fixtureKeys, fixtureMint, type MintResult, type WorkspaceAPIKey } from './fixtures'
import { formatWhen } from './format'

// API keys. This screen exists because of one real failure: Lens's mint
// response returns `key` and `prefix` ADJACENT in one line of JSON, they look
// nearly identical, and the wrong one got copied — ten minutes of "invalid API
// key". The design makes that mistake structurally impossible:
//
//   · The CREDENTIAL appears exactly once, in its own reveal card, with one
//     primary action — Copy key — that copies the key and nothing else.
//   · The PREFIX never sits beside the key at equal weight. It lives in a
//     separated, labeled block ("Identifier — not a credential") in caption
//     type, and in the list rows — where a credential never appears at all.
//   · Dismissing the reveal is explicit ("Done — I stored it") and final: the
//     key leaves the DOM and there is no way back to it.
//
// FIXTURE-BACKED: the BFF proxies no key routes yet (and minting is a WRITE —
// the BFF is read-only today). Wire target, from Lens source at 839b447:
//   GET  /v1/workspaces/{ws}/api-keys            → list (WorkspaceAPIKey rows)
//   POST /v1/workspaces/{ws}/api-keys            → 201 {key, prefix, name, scopes}
// via BFF routes GET+POST /api/keys. See the lens-area report for the gap list.
export function Keys() {
  const [keys, setKeys] = useState<WorkspaceAPIKey[]>(fixtureKeys)
  const [minted, setMinted] = useState<MintResult | null>(null)
  const [spent, setSpent] = useState(false)

  const mint = () => {
    if (minted || spent) return
    setMinted(fixtureMint)
  }

  // Consuming the reveal is one-way: the new key joins the list BY PREFIX and
  // the credential is gone from this page's state entirely.
  const dismiss = () => {
    if (!minted) return
    setKeys((ks) => [
      {
        id: 'key_new',
        workspace_id: ks[0]?.workspace_id ?? 'trial-ws-1',
        key_prefix: minted.prefix,
        name: minted.name,
        scopes: minted.scopes,
        created_at: new Date().toISOString(),
      },
      ...ks,
    ])
    setMinted(null)
    setSpent(true)
  }

  return (
    <div className="flex flex-col gap-4 px-gutter py-4">
      <FixtureNotice awaiting="live wiring in the lens area — the BFF routes (GET + POST /api/keys) landed with the shared-unblock PR" />

      {minted ? <RevealOnce minted={minted} onDone={dismiss} /> : null}

      <Card>
        <CardHeader>API keys</CardHeader>
        <Row
          label="Create a key"
          hint="Minted server-side; the key is shown once, then only its identifier remains"
        >
          <Button variant="primary" onClick={mint} disabled={minted !== null}>
            Create key
          </Button>
        </Row>
        {keys.map((k) => (
          <Row key={k.id} label={k.name} hint={`${k.scopes.join(', ')} · created ${formatWhen(k.created_at)}`}>
            <span className="font-mono text-caption tabular-nums text-muted">{k.key_prefix}</span>
          </Row>
        ))}
      </Card>
    </div>
  )
}

// RevealOnce is the one place a credential is ever visible. Hierarchy does the
// safety work: the key is the only body-size string on the card and owns the
// only primary action; the identifier is caption-size, physically separated,
// and labeled as not a credential — in type and in words, never by a hue.
function RevealOnce({ minted, onDone }: { minted: MintResult; onDone: () => void }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(minted.key).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Card>
      <CardHeader>Workspace key — shown once</CardHeader>

      <div className="flex flex-col gap-3 px-gutter py-3">
        <div className="select-all break-all font-mono text-body font-medium text-ink">{minted.key}</div>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={copy}>
            {copied ? 'Copied' : 'Copy key'}
          </Button>
          <span className="text-caption text-muted">Store it now — it will not be shown again.</span>
          <span aria-live="polite" className="sr-only">
            {copied ? 'Key copied to clipboard' : ''}
          </span>
        </div>
      </div>

      <div className="border-t border-rule px-gutter py-3">
        <div className="text-caption font-semibold uppercase tracking-wide text-faint">
          Identifier — not a credential
        </div>
        <div className="pt-1 text-caption text-muted">
          <span className="font-mono tabular-nums">{minted.prefix}</span>
          <span className="pl-2 text-faint">Safe to share; this is how the key appears in lists.</span>
        </div>
      </div>

      <div className="border-t border-rule px-gutter py-3">
        <Button onClick={onDone}>Done — I stored it</Button>
      </div>
    </Card>
  )
}
