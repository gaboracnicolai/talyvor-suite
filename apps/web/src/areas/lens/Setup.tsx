import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, RevealOnce } from '@talyvor/ui'

import { api } from '../../lib/api'
import { keysApi, type MintResult, type WorkspaceAPIKey } from './keysApi'
import { KEY_PLACEHOLDER, MECHANISM_CAVEATS, toolsFor, type Tool } from './setupSnippets'

// Setup — the page that was missing. A trial user signed in, minted a key, and was told nothing
// about what to do with it. The product is "point your existing tool at Lens instead of the
// provider" — two environment variables — and no screen, doc, or copy block said so.
//
// THREE THINGS THIS PAGE REFUSES TO DO, each because the alternative wastes the one thing a trial
// user has least of:
//
//  1. It does not print a base URL it cannot verify. The URL comes from /api/context's
//     lens_public_base_url, which is explicitly configured. cfg.lensBaseURL — the address the BFF
//     uses to reach Lens — is a loopback/compose address; printing it would hand every user a URL
//     that cannot resolve. Unset ⇒ this page says so and shows no snippets.
//  2. It does not fake a credential. Lens stores only a hash, so an EXISTING key's plaintext is
//     unrecoverable. Rather than print a realistic-looking placeholder, the page says why and
//     offers to mint a fresh one; the visible placeholder is deliberately not tlv_-shaped.
//  3. It does not claim a savings figure. None is measured (the README dropped its number for the
//     same reason), so the page describes the mechanism and lets the ledger show the number.
//
// TENANCY: the workspace comes from the SESSION — /api/context reads it via sessionWorkspaceID →
// a.tenantFrom(r) — and the key is minted through POST /api/keys, which the BFF scopes to that
// same session tenant. Nothing here is baked at startup; apps/bff/tenant_callsite_test.go fails
// if that regresses, and it should.

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1">
      <pre className="overflow-x-auto rounded border border-rule bg-canvas px-3 py-2 font-mono text-ink">
        {text}
      </pre>
      <Button
        variant="default"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? 'Copied' : `Copy ${label}`}
      </Button>
    </div>
  )
}

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Card>
      <CardHeader>{tool.name}</CardHeader>
      <div className="space-y-3 px-gutter py-3">
        {/* The hazard renders ABOVE the snippet, inside this tool's own card. A page-level
            warning banner is the thing nobody reads before pasting; this one sits between the
            reader and the instruction it qualifies. */}
        {tool.hazard ? (
          <p className="rounded border border-rule border-l-2 border-l-slashed bg-canvas px-3 py-2 text-body text-ink">
            <strong>Before you paste this:</strong> {tool.hazard}
          </p>
        ) : null}
        {tool.kind === 'env' ? (
          <CopyBlock text={tool.copyText} label="the two lines" />
        ) : (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-body text-ink">
              {tool.setting!.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <CopyBlock text={tool.copyText} label="the URL" />
          </>
        )}
        {tool.alternative ? (
          <div className="space-y-1">
            <p className="text-caption text-ink">{tool.alternative.title}</p>
            <CopyBlock text={tool.alternative.code} label="the example" />
          </div>
        ) : null}
        {tool.note ? <p className="text-caption text-muted">{tool.note}</p> : null}
      </div>
    </Card>
  )
}

export function Setup() {
  const qc = useQueryClient()
  const [minted, setMinted] = useState<MintResult | null>(null)
  // ⚠ "STORED" IS A CLAIM ONLY THE USER CAN MAKE. The page cannot detect that a secret reached a
  // password manager, and a copy-button click is not the same thing either — people copy, then
  // paste somewhere that eats it. So this tracks an explicit acknowledgement and nothing infers it.
  const [stored, setStored] = useState(false)
  // While a minted secret is on screen and unacknowledged, the page must not point anywhere else.
  const unstoredSecret = minted !== null && !stored

  const ctx = useQuery({ queryKey: ['context'], queryFn: api.context, staleTime: 60_000 })
  const keys = useQuery({ queryKey: ['keys'], queryFn: keysApi.list })
  // Same query key the Settings screen uses, so the two never disagree.
  const me = useQuery({ queryKey: ['auth-me'], queryFn: api.me, staleTime: 60_000 })

  const mint = useMutation({
    mutationFn: () => keysApi.mint('Setup', ['proxy']),
    onSuccess: (res) => {
      setMinted(res)
      // A second mint is a second unstored secret. Carrying the previous acknowledgement forward
      // would leave the new key exposed to exactly the flow that lost the first one.
      setStored(false)
      void qc.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  // The customer-facing origin. NOT ctx.data.lens_base_url — see the header note.
  const publicBase = ctx.data?.lens_public_base_url ?? ''
  const existing: WorkspaceAPIKey[] = keys.data ?? []
  // The RECORDED sharing consent, read from Lens via /auth/me — never a hardcoded default.
  //
  // This page first shipped asserting "cross-tenant pooling is OFF unless you turn it on". #33
  // then reversed the default (the BFF sends no field at provision, so Lens's default of true
  // applies), and that sentence became false — in a privacy disclosure, shown to someone deciding
  // whether to route their company's traffic through us. Rendering the recorded value instead of
  // either default is the only version that cannot go stale when the default moves again.
  // undefined ⇒ say nothing and point at the setting; do not guess.
  const sharing = me.data?.cache_poolable

  // The credential to inline. Only a key minted in THIS session has plaintext; anything else is
  // a hash server-side, so the placeholder stands in and the page explains why.
  const credential = minted?.key ?? ''
  const tools = toolsFor(publicBase, credential)

  return (
    <div className="space-y-gutter">
      <Card>
        <CardHeader>Point your tools at Lens</CardHeader>
        <div className="space-y-2 px-gutter py-3 text-body text-ink">
          <p>
            You do not change your code or your model names. You change where the request goes:
            two environment variables, and your existing tool talks to Lens instead of the
            provider directly. Lens forwards it, records what it cost, and serves a repeat of the
            same request from cache.
          </p>
          <p className="text-caption text-muted">
            Workspace <span className="font-mono">{ctx.data?.workspace_id ?? '—'}</span> — the one
            this session signed in to. Keys you mint here belong to it.
          </p>
        </div>
      </Card>

      {/* ── Read this before pasting anything ─────────────────────────────── */}
      <Card>
        <CardHeader>What Talyvor does with your traffic</CardHeader>
        <div className="space-y-2 px-gutter py-3 text-body text-ink">
          <p>
            You are about to route AI requests through a third party, so here is what happens to
            them, before you paste anything.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>What is stored.</strong> To serve a repeat request from cache, Lens stores a
              hash of the prompt, an embedding of it, and the answer that came back. That happens
              whether or not request logging is on — it is what the cache is.
            </li>
            {/* ⚠ THIS SAID LOGGING WAS "who called what, when, and what it cost" AND STOPPED —
                which describes the DEFAULT setting and reads as though prompt text is never
                persisted. It is not the whole mechanism: under the `full` setting Lens writes
                prompt_text to token_events AND publishes the raw prompt and response to a
                30-day stream (proxy.go gates both on LoggingFull; `metadata`, the default,
                blanks the prompt). The Privacy page has always said so. The screen someone
                reads BEFORE pasting a key said the reassuring part only. */}
            <li>
              <strong>Logging is separate and configurable.</strong> On the default setting the
              audit trail is metadata — who called what, when, and what it cost — and your prompt
              text is not kept. There is a <em>full</em> setting that does keep prompt text, and
              also sends the prompt and the answer to a 30-day stream. Nothing in this app turns
              it on, but an operator can, and you would not be able to tell from here. Turning
              logging off does not turn off the cache, and we would rather say so than let you
              find out.
            </li>
            <li>
              <strong>
                {sharing === true
                  ? 'Sharing is currently ON for this workspace.'
                  : sharing === false
                    ? 'Sharing is currently OFF for this workspace.'
                    : 'Sharing: check the setting for this workspace.'}
              </strong>{' '}
              {sharing === true
                ? 'Answers generated here may be served to other companies. One click turns it off.'
                : sharing === false
                  ? 'Nothing generated here is reachable by another company.'
                  : 'We could not read the recorded value, so we will not guess at it.'}{' '}
              <Link className="underline" to="/settings">
                {sharing === undefined ? 'See the setting' : 'Change it'}
              </Link>
              .
            </li>
            <li>
              <strong>Your prompts are never served to another company.</strong> Even with pooling
              on, what can be shared is an <em>answer</em> to a semantically equivalent question —
              never your prompt, never your key, never your workspace’s identity. But an answer
              often restates the question it answered, so the fact to plan around is{' '}
              <em>the answer leaves this workspace</em>, not <em>the prompt does not</em>.
            </li>
          </ul>
        </div>
      </Card>

      {/* ── The key ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>Your key</CardHeader>
        <div className="space-y-3 px-gutter py-3">
          {minted ? (
            // ⚠ THIS SENTENCE IS PART OF WHAT WENT WRONG. It said "filled into the blocks below …
            // Copy the block now", which was true and useless: it pointed at snippets further down
            // instead of at the secret, and the only unmissable thing on the row was a link to
            // another screen. It now points at the card directly beneath it, and says the one
            // consequence that matters rather than restating the mechanism.
            <p className="text-body text-ink">
              Here it is, once. Copy it now — Lens keeps a hash, not the key, so nobody can show it
              to you again, and a key you did not copy has to be replaced rather than recovered.
            </p>
          ) : existing.length > 0 ? (
            <div className="space-y-2 text-body text-ink">
              <p>
                You already have {existing.length === 1 ? 'a key' : `${existing.length} keys`}, but
                a key is shown <strong>only once</strong>, at the moment it is created — Lens
                stores a hash, so it cannot be shown again. If you still have it, paste it over the
                placeholder below. If not, create a fresh one.
              </p>
              <ul className="space-y-0.5 text-caption text-muted">
                {existing.map((k) => (
                  <li key={k.id}>
                    <span className="font-mono">{k.key_prefix}</span> — {k.name} (identifier, not a
                    credential)
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-body text-ink">
              You do not have a key yet. Create one and it will be filled into every block below.
            </p>
          )}
          <div className="flex items-center gap-gutter">
            <Button onClick={() => mint.mutate()} disabled={mint.isPending}>
              {mint.isPending ? 'Creating…' : 'Create a key for setup'}
            </Button>
            {/* ⚠ THE LINK IS WITHHELD WHILE AN UNACKNOWLEDGED SECRET IS ON SCREEN, and this is the
                whole navigation argument in one line. It sat in THIS row — so the nearest control to
                the button someone just pressed was the one that destroys what pressing it produced.
                It is not blocked from anywhere: the sidebar, the back button, a typed URL and a
                reload all still work, and a modal that pretended otherwise would be theatre, since
                it cannot stop any of them either. What is removed is the PRODUCT'S OWN INVITATION to
                leave. You cannot stop someone walking out; you can stop holding the door open. */}
            {!unstoredSecret ? (
              <Link className="text-caption text-muted underline" to="/keys">
                Manage keys
              </Link>
            ) : null}
          </div>
          {minted && !stored ? (
            // The SAME component the Keys screen mints into — one presentation of "here is a secret,
            // once", not a second one invented here. Before this, Setup put the key only inside the
            // tool snippets below: present, but dressed as configuration, so the one thing that had
            // to be unmissable looked like the thing you skim past.
            <RevealOnce
              title="Your key — shown once"
              secret={minted.key}
              copyLabel="Copy key"
              identifier={minted.prefix}
              identifierNote="Safe to share; this is how the key appears in lists."
              onDone={() => setStored(true)}
            />
          ) : null}
          {mint.isError ? (
            <p className="border-l-2 border-l-slashed pl-2 text-body text-ink">
              Couldn’t create a key. Nothing was changed — try again, or use the Keys screen.
            </p>
          ) : null}
        </div>
      </Card>

      {/* ── The two lines, per tool ───────────────────────────────────────── */}
      {publicBase === '' ? (
        <Card>
          <CardHeader>Setup instructions unavailable</CardHeader>
          <div className="px-gutter py-3 text-body text-muted">
            This deployment has no public Lens URL configured, so we cannot tell you which address
            to use — and a guessed one would fail with an error that looks like a bad key. Ask your
            operator to set <span className="font-mono">LENS_PUBLIC_BASE_URL</span> on the app, then
            reload.
          </div>
        </Card>
      ) : (
        <>
          {!minted ? (
            <p className="text-caption text-muted">
              The blocks below show{' '}
              <span className="font-mono">{KEY_PLACEHOLDER}</span> where your key goes. Create a key
              above to have it filled in.
            </p>
          ) : null}
          {tools.map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
          <Card>
            <CardHeader>Worth knowing</CardHeader>
            <ul className="list-disc space-y-1 px-gutter py-3 pl-8 text-body text-ink">
              {MECHANISM_CAVEATS.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {/* ── The moment it proves itself ───────────────────────────────────── */}
      <Card proof>
        <CardHeader>Confirm it worked — two requests</CardHeader>
        <div className="space-y-2 px-gutter py-3 text-body text-ink">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <strong>Send one request</strong> from the tool you just configured. Anything —
              “write me a haiku about caching”.
            </li>
            <li>
              <strong>Open the{' '}
              <Link className="underline" to="/ledger">
                ledger
              </Link>
              .</strong>{' '}
              Within a few seconds a row appears for it, with what it cost. That row is the proof
              your traffic is flowing through Lens: no row means the request never arrived, and the
              base URL is the first thing to check.
            </li>
            <li>
              <strong>Send the same request again.</strong> The second one is a cache hit: a new row
              at no cost, answered without going to the provider at all. That is the mechanism, in
              two requests — the first one pays, the repeat does not.
            </li>
          </ol>
          <p className="text-caption text-muted">
            How much this saves depends entirely on how much your traffic repeats, so we do not
            print a number here. The ledger shows yours.
          </p>
        </div>
      </Card>
    </div>
  )
}
