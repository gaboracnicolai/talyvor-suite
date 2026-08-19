import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader, Input, RevealOnce, Row } from '@talyvor/ui'
import { keysApi, type MintResult, type WorkspaceAPIKey } from './keysApi'
import { formatWhen } from './format'
import { ApiError } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { PanelFailure } from '../../components/SessionExpiredBar'
import { Region, RegionScreen } from '../../components/Region'

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
//
// ── W1.1.5 — WHAT THIS REPLACED ─────────────────────────────────────────────
//
// ONE card holding four different ideas — where to learn what a key is FOR, how to mint one, what
// went wrong, and the keys that exist — with no heading of the screen's own and no marking between
// them. The sticky banner wrote "Keys" and everything under it was one anonymous panel, so a reader
// moving by region got exactly one stop on the screen that hands out credentials and revokes them.
//
// ⚠ AND ITS EMPTY STATE WAS A ROW IN A LIST. "No keys yet. Create one above." is a sentence about
// the LIST. The state a new signup is in is a WORKSPACE with no credential at all, and the thing
// that state most needs said — that a key on its own does nothing until a tool is pointed at Lens
// — was a caption in the corner of the card. It is the screen's own state now, at page scale, with
// the two steps that end it. The list-level sentence is GONE rather than kept beside it: naming
// one absence twice is what W1.1.4 found on /billing one directory over.
//
// The region marking is components/Region.tsx's, shared with Overview, Setup and Billing.
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
        <span className="font-mono text-caption text-muted">{k.key_prefix}</span>
        {!confirming ? (
          // The accessible name carries the identifier, so the control names WHICH key it destroys
          // rather than being one of several identical "Revoke" buttons.
          <Button variant="default" onClick={() => setConfirming(true)} aria-label={`Revoke ${k.key_prefix}`}>
            Revoke
          </Button>
        ) : null}
      </Row>
      {confirming ? (
        <div className="space-y-2 border-t border-rule px-gutter py-3">
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

// The three headlines. Written out together so the screen's one page-scale claim is readable in
// one place and the empty-state wording cannot drift from the predicate below it.
//
// ⚠ THE REVEAL HEADLINE IS THE POINT OF THE WHOLE SCREEN. There is exactly one moment when a
// credential is on this page and exactly one thing the reader must do about it, and the file
// header records what happens when that is not said loudly enough: `key` and `prefix` sit adjacent
// in Lens's JSON, look alike, and the wrong one gets copied. The page-scale claim belongs to that
// moment while it lasts.
const HEADLINE = 'Mint and revoke the keys that reach Lens.'
const HEADLINE_EMPTY = 'This workspace has no keys.'
const HEADLINE_REVEAL = 'Copy your key now — it is not shown again.'

/**
 * What ends the empty state. Two steps, and the second is the one this screen never made:
 * a key on its own does nothing.
 *
 * ⚠ THE FIRST STEP HAS NO LINK BECAUSE THE ACTION IS ON THIS PAGE — offering a destination for
 * something two regions down would be a control that points at itself. The second names Setup,
 * which is where the two environment variables live (`areas/lens/Setup.tsx`, the screen first run
 * already routes to).
 */
function WaysToGetAKey() {
  return (
    <ol className="mt-8 grid gap-px border border-rule bg-rule wide:grid-cols-2">
      <li className="flex flex-col items-start bg-surface px-gutter py-5">
        <span className="font-figure text-eyebrow uppercase text-faint">Step 01</span>
        <p className="mt-3 text-body text-ink">Mint one below.</p>
        <p className="mt-1 text-caption font-normal text-muted">
          It is minted server-side with the proxy scope and shown once, here. Afterwards only its
          identifier remains, which is what the list and every error message use.
        </p>
      </li>
      <li className="flex flex-col items-start bg-surface px-gutter py-5">
        <span className="font-figure text-eyebrow uppercase text-faint">Step 02</span>
        <p className="mt-3 text-body text-ink">Point a tool at it.</p>
        <p className="mt-1 text-caption font-normal text-muted">
          A key on its own does nothing. Setup has the two environment variables that send Claude
          Code, Cursor and anything on the OpenAI SDK through Lens instead of the provider.
        </p>
        <Button asChild variant="primary" className="mt-5">
          <Link to="/setup">Open Setup</Link>
        </Button>
      </li>
    </ol>
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

  // ⚠ THE EMPTY STATE IS A MEASUREMENT, NOT A DEFAULT, and the direction that matters is the one
  // this is FALSE for: it is claimed only when the list read ANSWERED and the answer was an empty
  // array. A read that FAILED is not a workspace with no keys — told wrongly HERE it tells an
  // operator whose keys are live and serving traffic that they have none, on the screen whose
  // other control is REVOKE.
  //
  // ⚠ IT IS COMPUTED HERE, FROM THE QUERY OBJECT, AND MY FIRST DRAFT WAS A HELPER THAT TOOK THE
  // BARE ARRAY and asked whether it was an array holding nothing. That predicate is CORRECT —
  // `data` is undefined both while loading and on error — and `emptyVsFault.test.ts` refused it
  // anyway, for
  // a reason better than the one I had: its rule is that a failure state must be TESTED before an
  // empty-collection branch, and a helper handed an array has nothing to test. The distinction
  // belongs where the read still exists. It is the same argument ConvertLens.tsx's header makes
  // about a number prop, and all three states are now named in one line instead of one of them
  // being inferable from a type.
  const empty = !list.isError && !list.isLoading && list.data !== undefined && list.data.length === 0

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Keys"
        heading={minted ? HEADLINE_REVEAL : empty ? HEADLINE_EMPTY : HEADLINE}
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-2xl"
      >
        <p className="text-body text-muted">
          A workspace key is what a tool presents to Lens. It is minted here, shown once, and from
          then on identified only by its prefix — the list below, and every message about a key,
          use that.
        </p>
        {/* ⚠ THE STEPS RENDER ONLY WHEN THE WORKSPACE HAS NOTHING, and the branch is a RENDER
            rather than a `hidden` class: copy about a workspace with no credential must not sit in
            the DOM of one that has three. */}
        {empty && !minted ? <WaysToGetAKey /> : null}
        {/* The pointer a workspace that ALREADY has keys still needs — the same fact the empty
            state's step 02 makes, so it is drawn only in the state where that step is not. Two
            copies of one sentence on one screen is how the five docs cost sentences drifted. */}
        {!empty && !minted ? (
          <p className="mt-4 text-caption font-normal text-muted">
            Got a key and not sure what to do with it?{' '}
            <Link className="underline" to="/setup">
              Setup
            </Link>{' '}
            has the two lines for Claude Code, Cursor, and anything on the OpenAI SDK.
          </p>
        ) : null}
      </Region>

      <Region index="01" label="Create a key">
        {/* ⚠ THE REVEAL LIVES IN THE REGION THAT PRODUCED IT. It is the RESULT of the control
            below, so putting it anywhere else would separate the action from its outcome — and
            the heading above is already the page-scale claim about it while it exists. */}
        {minted ? (
          <div className="mb-gutter">
            <RevealOnce
              title="Workspace key — shown once"
              secret={minted.key}
              copyLabel="Copy key"
              identifier={minted.prefix}
              identifierNote="Safe to share; this is how the key appears in lists."
              onDone={dismiss}
            />
          </div>
        ) : null}

        <Card>
          <CardHeader>New key</CardHeader>
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
              {/* ⚠ THE STATUS, NOT THE MESSAGE. This read `mint.error.message.includes('403')` — a
                  substring match on ApiError's message format ("path -> HTTP status"), four lines
                  from a sibling mutation (revoke, above) reading `.status` off the same type. It
                  happens to be right today only because this path is a constant with no digits in
                  it; the diagnosis was coupled to a string nobody guards.
                  ⚠ AND A 401 GOT THE RETRY SENTENCE. Measured, real <App/>, /auth/me authenticated
                  and /api/* 401 — the live condition, since the BFF session outlives the workspace
                  token by four hours: the bar said "Signing in again fixes it" and this line said
                  "Please try again." two rows below it. Documents.tsx already decided what to do —
                  the OUTCOME still has to be stated, because the reader pressed a button and needs
                  to know it did not take, so ONLY THE ADVICE MOVES. */}
              {mint.error instanceof ApiError && mint.error.status === 403
                ? 'Couldn’t mint the key — the request origin was rejected. Reach this app at its configured address.'
                : isSessionExpired(mint.error)
                  ? 'Couldn’t mint the key. Nothing was changed.'
                  : 'Couldn’t mint the key. Please try again.'}
            </div>
          ) : null}
        </Card>
      </Region>

      {/* ⚠ NOT DRAWN WHEN THE WORKSPACE ANSWERED THAT IT HAS NONE. A region titled "The keys that
          exist" holding a sentence saying none do is the absence named a second time, three
          hundred pixels under the page-scale claim that already named it. A read that FAILED or is
          still loading is a different matter entirely and IS drawn — the reader has to be told the
          list is missing rather than shown nothing where their keys should be. */}
      {empty && !minted ? null : (
        <Region index="02" label="The keys that exist">
          <Card>
            <CardHeader>API keys</CardHeader>
            {list.isLoading ? (
              <div className="px-gutter py-3 text-body text-muted">Loading…</div>
            ) : list.isError ? (
              <PanelFailure error={list.error} what="your keys" />
            ) : keys.length === 0 ? (
              // Reachable only in the moment between a mint and its refetch, where `minted` holds
              // the reveal open over a list the server has not re-served yet.
              <div className="px-gutter py-3 text-body text-muted">Loading…</div>
            ) : (
              keys.map((k) => <KeyRow key={k.id} k={k} />)
            )}
          </Card>
        </Region>
      )}
    </RegionScreen>
  )
}
