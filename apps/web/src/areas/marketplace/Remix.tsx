import { useId, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Row, inlineLink } from '@talyvor/ui'
import {
  type Listing,
  type ListingKind,
  type ListingVersion,
  type ParentRef,
  type RemixOpened,
  type RemixPolicy,
  type SimilarListing,
  marketApi,
  refusalText,
} from './marketApi'
import { CATALOG_KEY, MINE_KEY, Note, readFailure, selectClass } from './parts'

// Remix.tsx — B32.58: building on someone else's listing. Remix this accepts the listing's remix licence (Lens B32.25:
// one grant per workspace and version, its share locked) and opens Publish with the artifact and the parent filled in.
// Publish sets the new listing's own remix terms and picks the originals it builds on. A version Lens held as a
// near-copy (B32.46) names the listing it is nearest to and how similar it is, with Declare it as a parent when that
// listing allows remixes: its licence accepted, it publishes again with that listing as its parent, and is not held.

/** A parent as Publish shows it: the listing version, its title, and the share locked for it — null for your own. */
export interface ParentChoice extends ParentRef {
  title: string
  share_bps: number | null
}

/** What Publish opens with, from Remix this or from declaring a held listing's original (router state `prefill`). */
export interface PublishPrefill {
  kind: ListingKind
  title: string
  description: string
  artifact: Record<string, unknown>
  price_per_use_ulxc: number
  visibility: 'public' | 'unlisted' | 'private'
  remix_policy: RemixPolicy
  remix_share_bps: number
  parents: ParentChoice[]
}

/** The parent an accepted remix licence gives. */
export function parentOf(r: RemixOpened): ParentChoice {
  return { listing_id: r.listing_id, version: r.version, title: r.title, share_bps: r.grant?.share_bps ?? 0 }
}

/** Publish, opened on a remix: the artifact to change and its original as the parent. The rest is the remixer's. */
export function remixPrefill(r: RemixOpened): PublishPrefill {
  return {
    kind: r.kind,
    title: '',
    description: '',
    artifact: r.artifact ?? {},
    price_per_use_ulxc: 0,
    visibility: 'public',
    remix_policy: 'none',
    remix_share_bps: 0,
    parents: [parentOf(r)],
  }
}

/** Publish, opened again on a held listing of your own: everything it was published with, and the original declared. */
export function republishPrefill(
  l: Listing,
  v: ListingVersion,
  titles: Record<string, string>,
  declared: ParentChoice,
): PublishPrefill {
  const kept = (v.parents ?? [])
    .filter((p) => p.listing_id !== declared.listing_id)
    .map((p) => ({ listing_id: p.listing_id, version: p.version, title: titles[p.listing_id] ?? p.listing_id, share_bps: p.share_bps }))
  return {
    kind: l.kind,
    title: l.title,
    description: l.description,
    artifact: v.artifact ?? {},
    price_per_use_ulxc: l.price_per_use_ulxc,
    visibility: l.visibility,
    remix_policy: l.remix_policy ?? 'none',
    remix_share_bps: l.remix_share_bps ?? 0,
    parents: [...kept, declared],
  }
}

/** 1000 basis points → `10%`; 1250 → `12.5%`. */
export function percent(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`
}

function Figure({ children }: { children: React.ReactNode }) {
  return <span className="font-figure">{children}</span>
}

/** A listing's remix licence, as the remixer reads it before accepting it. */
export function RemixTerms({ listing }: { listing: Pick<Listing, 'remix_policy' | 'remix_share_bps'> }) {
  return (
    <p className="text-body text-ink" data-testid="remix-terms">
      {listing.remix_policy === 'royalty' ? (
        <>
          Its remix licence gives it <Figure>{percent(listing.remix_share_bps ?? 0)}</Figure> of each sale of your remix,
          locked at that share when you remix it; you keep the rest.
        </>
      ) : (
        'Its remix licence is free: your remix owes it nothing, and its seller is credited as the original.'
      )}
    </p>
  )
}

/** The terms, and the button that accepts them: Lens records the grant and answers the artifact to build on. */
export function AcceptRemix({
  listing,
  action,
  onAccepted,
}: {
  listing: Pick<Listing, 'id' | 'remix_policy' | 'remix_share_bps'>
  action: string
  onAccepted: (r: RemixOpened) => void
}) {
  const accept = useMutation({ mutationFn: () => marketApi.remix(listing.id), onSuccess: onAccepted })
  return (
    <div className="flex flex-col gap-2">
      <RemixTerms listing={listing} />
      <span>
        <Button variant="primary" disabled={accept.isPending} onClick={() => accept.mutate()}>
          {accept.isPending ? 'Accepting…' : action}
        </Button>
      </span>
      {accept.isError ? <Note ok={false}>{refusalText(accept.error)}</Note> : null}
    </div>
  )
}

/** Lens's score, 0 to 1, as the whole percent it names in the hold (rounded down, as Lens's own sentence is). */
export function similarPercent(score: number): number {
  return Math.floor(Math.round(score * 10_000) / 100)
}

/**
 * A version Lens held as a near-copy: the listing it is nearest to and how similar, and — when that listing allows
 * remixes — Declare it as a parent, which accepts its remix licence and hands the parent to `onDeclare`.
 */
export function SimilarHold({
  similar,
  action,
  onDeclare,
}: {
  similar: SimilarListing
  action: string
  onDeclare: (parent: ParentChoice) => void
}) {
  const [open, setOpen] = useState(false)
  const original = useQuery({
    queryKey: ['market-listing', similar.listing_id, ''],
    queryFn: () => marketApi.listing(similar.listing_id),
    enabled: open,
  })
  return (
    <div role="status" className="flex flex-col gap-2 border-l-2 border-l-held pl-2" data-testid="similar-hold">
      <p className="text-body text-ink">
        Held for review: it is <Figure>{similarPercent(similar.score)}%</Figure> similar to{' '}
        <Link className={`text-ink ${inlineLink}`} to={`/marketplace/listings/${encodeURIComponent(similar.listing_id)}`}>
          {similar.title}
        </Link>
        , which it does not declare as a parent. Only you can see it until Talyvor reviews it.
      </p>
      {similar.remixable ? (
        <>
          <p className="text-body text-muted">
            That listing allows remixes. Accept its remix licence and declare it as a parent, and yours is published without
            waiting for a review.
          </p>
          <span>
            <Button aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              Declare it as a parent
            </Button>
          </span>
          {open ? (
            original.data ? (
              <AcceptRemix listing={original.data} action={action} onAccepted={(r) => onDeclare(parentOf(r))} />
            ) : (
              <p className="text-body text-muted">
                {original.isPending ? 'Reading…' : readFailure(original.error, 'Its remix licence')}
              </p>
            )
          ) : null}
        </>
      ) : (
        <p className="text-body text-muted">That listing does not allow remixes, so yours waits for Talyvor’s review.</p>
      )}
    </div>
  )
}

function shareOf(p: ParentChoice): string {
  if (p.share_bps === null) return 'Yours'
  return p.share_bps > 0 ? `${percent(p.share_bps)} of each sale` : 'Free'
}

/**
 * The originals a new listing builds on. Your own listings are added as they are; someone else's that allows remixes is
 * added once its remix licence is accepted, at the share that locks. Lens refuses any other, and a cycle, with its
 * sentence.
 */
export function ParentsPicker({ parents, onChange }: { parents: ParentChoice[]; onChange: (p: ParentChoice[]) => void }) {
  const mine = useQuery({ queryKey: MINE_KEY, queryFn: marketApi.mine })
  const catalog = useQuery({ queryKey: [...CATALOG_KEY, ''], queryFn: () => marketApi.catalog('') })
  const [pick, setPick] = useState('')
  const labelID = useId()
  const own = mine.data ?? []
  const ownIDs = new Set(own.map((l) => l.id))
  const chosen = new Set(parents.map((p) => p.listing_id))
  const others = (catalog.data ?? []).filter(
    (l) => !ownIDs.has(l.id) && (l.remix_policy === 'free' || l.remix_policy === 'royalty'),
  )
  const picked = [...own, ...others].find((l) => l.id === pick && !chosen.has(l.id))
  const add = (p: ParentChoice) => {
    onChange([...parents.filter((x) => x.listing_id !== p.listing_id), p])
    setPick('')
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelID} className="font-figure text-eyebrow uppercase text-label">
        Builds on
      </span>
      <span className="text-caption text-muted">
        The listings yours is made from. Each earns the share its remix licence locked, from every sale of yours.
      </span>
      {parents.length > 0 ? (
        <ul aria-labelledby={labelID} className="flex flex-col">
          {parents.map((p) => (
            <li key={p.listing_id} data-testid="publish-parent">
              <Row
                stack
                label={p.title}
                hint={
                  <>
                    Version <Figure>{p.version}</Figure> · {shareOf(p)}
                  </>
                }
              >
                <Button onClick={() => onChange(parents.filter((x) => x.listing_id !== p.listing_id))}>Remove</Button>
              </Row>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="text-caption text-muted">
        Add an original
        <select className={selectClass} value={picked ? pick : ''} onChange={(e) => setPick(e.target.value)}>
          <option value="">None</option>
          {own.some((l) => !chosen.has(l.id)) ? (
            <optgroup label="Yours">
              {own
                .filter((l) => !chosen.has(l.id))
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
            </optgroup>
          ) : null}
          {others.some((l) => !chosen.has(l.id)) ? (
            <optgroup label="Others allow remixes">
              {others
                .filter((l) => !chosen.has(l.id))
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
            </optgroup>
          ) : null}
        </select>
      </label>
      {picked && ownIDs.has(picked.id) ? (
        <span>
          <Button
            onClick={() => add({ listing_id: picked.id, version: picked.latest_version, title: picked.title, share_bps: null })}
          >
            Add it
          </Button>
        </span>
      ) : picked ? (
        <AcceptRemix
          key={picked.id}
          listing={picked}
          action="Accept its remix licence and add it"
          onAccepted={(r) => add(parentOf(r))}
        />
      ) : null}
    </div>
  )
}
