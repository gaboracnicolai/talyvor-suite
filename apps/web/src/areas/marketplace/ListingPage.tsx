import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CardHeader, Row, inlineLink } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { formatWhen } from '../lens/format'
import { LICENCES_KEY } from './Licences'
import { ListingOffers } from './ListingOffers'
import { FamilyTree, TrustPanel } from './ListingTrust'
import { kindLabel, marketApi } from './marketApi'
import { Card, Price, readFailure } from './parts'
import { SimilarHold, republishPrefill } from './Remix'
import { ReportListing } from './Report'
import { UseListing } from './UseListing'

// ListingPage.tsx — B20.3: one listing — what it is, what a use costs, using it, and its versions.
// Lens shows a version's artifact to the listing's owner and nobody else, which is how this page
// knows the listing is this workspace's own.
//
// B32.57 — and what a buyer needs to choose: its offers and licences, priced in their currency; the licence they hold
// for it, which covers their uses; its trust panel; and its family tree — the originals it builds on and the remixes
// that build on it.
//
// B32.58 — and to its seller, a version Lens held as a near-copy: the listing it is nearest to and how similar, with
// Declare it as a parent, which opens Publish on everything it was published with and that original as its parent.

export function ListingPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  // The buyer's pick of currency is theirs, not the listing's: it rides the address, so it follows them to the next.
  const [params, setParams] = useSearchParams()
  const currency = params.get('currency') ?? ''
  const setCurrency = (c: string) => setParams(c ? { currency: c } : {}, { replace: true })
  const listing = useQuery({
    queryKey: ['market-listing', id, currency],
    queryFn: () => marketApi.listing(id, currency),
    placeholderData: (prev) => (prev?.id === id ? prev : undefined),
  })
  const trust = useQuery({ queryKey: ['market-trust', id], queryFn: () => marketApi.trust(id) })
  const licences = useQuery({ queryKey: LICENCES_KEY, queryFn: marketApi.licences })
  if (listing.isError || listing.isPending) {
    const missing = listing.error instanceof ApiError && listing.error.status === 404
    return (
      <Region index="00" label="Listing" heading="Marketplace" sectionClassName="pb-10 pt-4 wide:pb-12">
        <p className="text-body text-muted">
          {listing.isPending
            ? 'Reading…'
            : missing
              ? 'This listing does not exist, or its seller made it private.'
              : readFailure(listing.error, 'This listing')}{' '}
          <Link className={`text-ink ${inlineLink}`} to="/marketplace">
            Back to the marketplace
          </Link>
        </p>
      </Region>
    )
  }
  const l = listing.data
  const versions = l.versions ?? []
  const own = versions.some((v) => v.artifact !== undefined)
  const held = own ? undefined : (licences.data ?? []).find((x) => x.listing_id === l.id && x.status === 'active')
  const latest = versions.find((v) => v.version === l.latest_version)
  const similar = own && l.review_status === 'held' ? latest?.scan?.similar : undefined
  const titles = Object.fromEntries((trust.data?.originals ?? []).flatMap((a) => (a.title ? [[a.listing_id, a.title]] : [])))
  return (
    <>
      <Region
        index="00"
        label={kindLabel(l.kind)}
        heading={l.title}
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-caption text-muted">
          <Link className={`text-ink ${inlineLink}`} to="/marketplace">
            Marketplace
          </Link>{' '}
          · <Price micros={l.price_per_use_ulxc} /> · version <span className="font-figure">{l.latest_version}</span> ·
          published <span className="font-figure">{formatWhen(l.created_at)}</span>
          {own ? ` · yours, ${l.visibility}` : null}
        </p>
        {l.description ? <p className="whitespace-pre-wrap text-body text-ink">{l.description}</p> : null}
        {/* B20.11 — only the seller sees a listing that is not approved, so only the seller reads why. */}
        {similar && latest ? (
          <SimilarHold
            similar={similar}
            action="Accept and open Publish"
            onDeclare={(p) =>
              navigate('/marketplace/publish', { state: { prefill: republishPrefill(l, latest, titles, p) } })
            }
          />
        ) : l.review_status === 'held' ? (
          <p role="status" className="border-l-2 border-l-held pl-2 text-body text-ink" data-testid="listing-review">
            Held for review{l.review_reason ? `: ${l.review_reason}` : ''}. Only you can see it until Talyvor approves it.
          </p>
        ) : l.review_status === 'taken_down' ? (
          <p role="status" className="border-l-2 border-l-slashed pl-2 text-body text-ink" data-testid="listing-review">
            Taken down by Talyvor{l.review_reason ? `: ${l.review_reason}` : ''}. Nobody can find or use it.
          </p>
        ) : null}
        {own ? null : <ReportListing key={l.id} listing={l} />}
      </Region>
      {(l.offers ?? []).length > 0 ? (
        <Region index="01" label="Offers">
          <ListingOffers key={l.id} listing={l} own={own} held={held} currency={currency} onCurrency={setCurrency} />
        </Region>
      ) : null}
      <Region index="02" label="Use it">
        <UseListing key={l.id} listing={l} own={own} held={held} />
      </Region>
      <Region index="03" label="Trust">
        {trust.data ? (
          <TrustPanel trust={trust.data} />
        ) : (
          <p className="text-body text-muted">{trust.isPending ? 'Reading…' : readFailure(trust.error, 'Its trust panel')}</p>
        )}
      </Region>
      {trust.data ? (
        <Region index="04" label="Family tree">
          <FamilyTree listing={l} trust={trust.data} own={own} />
        </Region>
      ) : null}
      {versions.length > 0 ? (
        <Region index="05" label="Versions">
          <Card>
            <CardHeader>Versions</CardHeader>
            {[...versions].reverse().map((v) => (
              <Row
                key={v.version}
                label={
                  <>
                    Version <span className="font-figure">{v.version}</span>
                  </>
                }
                hint={v.changelog || undefined}
              >
                <span className="font-figure text-caption text-muted">{formatWhen(v.created_at)}</span>
              </Row>
            ))}
          </Card>
        </Region>
      ) : null}
    </>
  )
}
